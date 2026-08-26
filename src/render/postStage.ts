/**
 * The owned post-processing stage: HDR scene target, bloom, tone map, encode.
 *
 * History matters here. An earlier composer was removed from this project
 * because it could intermittently output a black frame and because it leaked
 * eleven bloom targets every time it was rebuilt. This replacement is
 * deliberately narrower than a general composer:
 *
 *   - a fixed set of targets, allocated once and resized in place;
 *   - four hand-written fullscreen materials this repository owns outright;
 *   - explicit disposal, and explicit re-creation after WebGL context loss;
 *   - an allocation counter, so a leak is a test failure rather than a slow
 *     memory climb nobody notices.
 *
 * The scene target is multisampled so that moving off the default framebuffer
 * does not cost the hardware antialiasing the direct path gets for free.
 *
 * WHERE EACH TRANSFORM HAPPENS, AND WHY
 *
 * The scene renders linear HDR into an unmanaged half-float target with
 * `gl.toneMapping` set to `NoToneMapping`, and the composite then applies
 * exposure, ACES, and the sRGB transfer function. That split is not a
 * preference, it is what measurement forced. Keeping tone mapping in the scene
 * pass and making the composite a passthrough was tried in four configurations
 * and none was an identity:
 *
 *   - sRGB-tagged target, raw blit: 0.68x too dark
 *   - sRGB-tagged target, manual re-encode: 1.61x too bright
 *   - unmanaged target, manual re-encode: 1.60x too bright
 *   - unmanaged target, raw blit: 0.27x to 0.68x too dark
 *
 * The target's `colorSpace` option made no measurable difference, so what Three
 * does when rendering into a target is not predictable from the options it
 * exposes. One probe was decisive: a composite writing a constant 0.5 read back
 * as exactly 128, proving Three applies nothing after the composite shader. So
 * every transform lives in this file, where it is visible and testable.
 *
 * Linear HDR is also what bloom needs. Bloom is gathered before tone mapping and
 * added to the scene before ACES, so highlights roll off together instead of the
 * glow being pasted on after the curve has already clipped them.
 */

import * as THREE from 'three';
import { createGradeLut, GRADE_GLSL } from './materials/grading';

export interface PostStageDiagnostics {
  /** Targets created over the stage's whole lifetime. The leak canary. */
  allocations: number;
  /** Targets explicitly released over the stage's whole lifetime. */
  disposals: number;
  /** Live targets: one scene target plus one per bloom level. */
  live: number;
  width: number;
  height: number;
  samples: number;
  hasDepthTexture: boolean;
  contextLost: boolean;
  bloomLevels: number;
  /** Smallest bloom mip dimensions, so a degenerate chain is visible. */
  smallestBloom: { width: number; height: number };
  /** Occlusion buffer size, zero when no occlusion target is live. */
  aoResolution: { width: number; height: number };
}

/**
 * Bloom mip count.
 *
 * Fixed rather than quality-dependent on purpose: varying it per tier would make
 * the target set change size on a quality switch, which is exactly the kind of
 * churn the allocation counter exists to forbid. Tiers vary `bloomStrength`
 * instead, which costs nothing.
 */
const BLOOM_LEVELS = 5;

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Shared ACES and sRGB, copied verbatim from Three's shader chunks so the
 *  graded result matches the direct path's look rather than approximating it. */
const TRANSFORM_GLSL = /* glsl */ `
  #define rww_saturate(a) clamp(a, 0.0, 1.0)

  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }

  vec3 rww_aces(vec3 color, float exposure) {
    const mat3 ACESInputMat = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777)
    );
    const mat3 ACESOutputMat = mat3(
      vec3( 1.60475, -0.10208, -0.00327),
      vec3(-0.53108,  1.10813, -0.07276),
      vec3(-0.07367, -0.00605,  1.07602)
    );
    color *= exposure / 0.6;
    color = ACESInputMat * color;
    color = RRTAndODTFit(color);
    color = ACESOutputMat * color;
    return rww_saturate(color);
  }

  vec3 rww_linearToSRGB(vec3 value) {
    return mix(
      pow(value, vec3(0.41666)) * 1.055 - vec3(0.055),
      value * 12.92,
      vec3(lessThanEqual(value, vec3(0.0031308)))
    );
  }
`;

/**
 * Bright pass with a soft knee.
 *
 * The threshold is in linear HDR, which is the whole reason the scene target is
 * unmanaged half-float. Faction emissive strips are authored at roughly five
 * times their base colour, while lit hull and terrain sit well below one, so a
 * threshold near one separates "powered" from "brightly lit" without needing a
 * mask channel. The knee keeps the transition from popping as a hard edge as
 * surfaces move through it.
 */
const PREFILTER_FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  void main() {
    vec3 color = texture2D(tScene, vUv).rgb;
    float brightness = max(color.r, max(color.g, color.b));
    // Quadratic knee, as in Unity's and Frostbite's bright-pass filters.
    float soft = clamp(brightness - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-5);
    float weight = max(soft, brightness - uThreshold) / max(brightness, 1e-5);
    gl_FragColor = vec4(color * weight, 1.0);
  }
`;

/** Thirteen-tap downsample. More taps than a box filter, and specifically
 *  chosen because it is stable under motion: a plain box sample at these
 *  reductions makes small bright objects flicker as they cross texel centres. */
const DOWNSAMPLE_FRAGMENT = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 a = texture2D(tSource, vUv + uTexel * vec2(-2.0, -2.0)).rgb;
    vec3 b = texture2D(tSource, vUv + uTexel * vec2( 0.0, -2.0)).rgb;
    vec3 c = texture2D(tSource, vUv + uTexel * vec2( 2.0, -2.0)).rgb;
    vec3 d = texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
    vec3 e = texture2D(tSource, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
    vec3 f = texture2D(tSource, vUv + uTexel * vec2(-2.0,  0.0)).rgb;
    vec3 g = texture2D(tSource, vUv).rgb;
    vec3 h = texture2D(tSource, vUv + uTexel * vec2( 2.0,  0.0)).rgb;
    vec3 i = texture2D(tSource, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
    vec3 j = texture2D(tSource, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    vec3 k = texture2D(tSource, vUv + uTexel * vec2(-2.0,  2.0)).rgb;
    vec3 l = texture2D(tSource, vUv + uTexel * vec2( 0.0,  2.0)).rgb;
    vec3 m = texture2D(tSource, vUv + uTexel * vec2( 2.0,  2.0)).rgb;
    vec3 sum = (d + e + i + j) * 0.125;
    sum += (a + b + g + f) * 0.03125;
    sum += (b + c + h + g) * 0.03125;
    sum += (f + g + l + k) * 0.03125;
    sum += (g + h + m + l) * 0.03125;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

/**
 * Half-resolution ambient occlusion from scene depth.
 *
 * Position and normal are both reconstructed from the depth texture the scene
 * pass already resolved, so there is no depth prepass and no second pass over
 * world geometry. The normal is rebuilt from three depth taps rather than from
 * `dFdx`/`dFdy`, because screen-space derivatives need either GLSL3 or an
 * extension directive in a plain `ShaderMaterial`, and three taps are portable.
 *
 * Depth precision is workable here despite the very long far plane. With a near
 * plane of 0.1 m the hyperbolic depth distribution leaves roughly millimetre
 * resolution at 100 m, which is well inside the occlusion radius this uses.
 * It degrades with distance, which is the right way round: contact shading only
 * has to hold up where the player is looking closely.
 */
const AO_FRAGMENT = /* glsl */ `
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform mat4 uProjection;
  uniform mat4 uProjectionInverse;
  uniform float uRadius;
  uniform float uBias;
  varying vec2 vUv;

  const int AO_SAMPLES = 12;
  const float GOLDEN_ANGLE = 2.39996323;

  float readDepth(vec2 uv) {
    return texture2D(tDepth, uv).x;
  }

  vec3 viewPosition(vec2 uv, float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uProjectionInverse * clip;
    return view.xyz / view.w;
  }

  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  void main() {
    float depth = readDepth(vUv);
    // The far plane carries no geometry to occlude.
    if (depth >= 1.0) {
      gl_FragColor = vec4(1.0);
      return;
    }

    vec3 origin = viewPosition(vUv, depth);
    vec3 alongX = viewPosition(vUv + vec2(uTexel.x, 0.0), readDepth(vUv + vec2(uTexel.x, 0.0))) - origin;
    vec3 alongY = viewPosition(vUv + vec2(0.0, uTexel.y), readDepth(vUv + vec2(0.0, uTexel.y))) - origin;
    vec3 normal = normalize(cross(alongX, alongY));
    // View space looks down -z, so flip any normal facing away from the camera.
    if (normal.z < 0.0) normal = -normal;

    float rotation = hash12(vUv / max(uTexel.x, 1e-6)) * 6.2831853;
    float occlusion = 0.0;

    for (int index = 0; index < AO_SAMPLES; index++) {
      float fraction = (float(index) + 0.5) / float(AO_SAMPLES);
      float angle = rotation + float(index) * GOLDEN_ANGLE;
      // Square root keeps the spiral area-uniform instead of clustering at the
      // centre, which would under-sample the outer part of the radius.
      float distance = uRadius * sqrt(fraction);
      vec3 offset = vec3(cos(angle), sin(angle), 0.0) * distance;
      // Reflect into the hemisphere around the reconstructed normal.
      if (dot(offset, normal) < 0.0) offset = -offset;
      vec3 samplePoint = origin + offset + normal * uBias;

      vec4 clip = uProjection * vec4(samplePoint, 1.0);
      if (clip.w <= 0.0) continue;
      vec2 sampleUv = (clip.xy / clip.w) * 0.5 + 0.5;
      if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) continue;

      float sampleDepth = readDepth(sampleUv);
      if (sampleDepth >= 1.0) continue;
      vec3 occluder = viewPosition(sampleUv, sampleDepth);

      vec3 toOccluder = occluder - origin;
      float length2 = dot(toOccluder, toOccluder);
      if (length2 < 1e-8) continue;
      float cosine = max(dot(normal, toOccluder / sqrt(length2)), 0.0);
      // Range check, so a distant surface behind this one does not read as
      // contact. Without it, silhouette edges gain a dark halo.
      float rangeFalloff = uRadius / (uRadius + sqrt(length2));
      occlusion += cosine * rangeFalloff;
    }

    occlusion = clamp(1.0 - occlusion / float(AO_SAMPLES), 0.0, 1.0);
    gl_FragColor = vec4(occlusion, occlusion, occlusion, 1.0);
  }
`;

/**
 * Depth-aware blur for the occlusion buffer.
 *
 * The spiral is rotated per pixel, so the raw buffer is noisy by construction and
 * has to be filtered. The weight falls off with depth difference so the blur does
 * not bleed occlusion across a silhouette, which is what a plain Gaussian would
 * do and is highly visible on thin geometry like mech legs and lattice masts.
 */
const AO_BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D tAo;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform vec2 uDirection;
  varying vec2 vUv;

  void main() {
    float centreDepth = texture2D(tDepth, vUv).x;
    float total = 0.0;
    float weightSum = 0.0;
    for (int index = -3; index <= 3; index++) {
      vec2 offset = uDirection * uTexel * float(index);
      float sampleDepth = texture2D(tDepth, vUv + offset).x;
      float spatial = exp(-float(index * index) * 0.18);
      // Depth term is scaled hard because these are hyperbolic depth values, so
      // a small numeric difference is a large world-space one up close.
      float depthWeight = exp(-abs(sampleDepth - centreDepth) * 2400.0);
      float weight = spatial * depthWeight;
      total += texture2D(tAo, vUv + offset).r * weight;
      weightSum += weight;
    }
    float ao = weightSum > 1e-5 ? total / weightSum : texture2D(tAo, vUv).r;
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  }
`;

/** Nine-tap tent upsample, blended additively into the larger mip. */
const UPSAMPLE_FRAGMENT = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uTexel;
  uniform float uRadius;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel * uRadius;
    vec3 sum = texture2D(tSource, vUv + vec2(-o.x,  o.y)).rgb;
    sum += texture2D(tSource, vUv + vec2( 0.0,  o.y)).rgb * 2.0;
    sum += texture2D(tSource, vUv + vec2( o.x,  o.y)).rgb;
    sum += texture2D(tSource, vUv + vec2(-o.x,  0.0)).rgb * 2.0;
    sum += texture2D(tSource, vUv).rgb * 4.0;
    sum += texture2D(tSource, vUv + vec2( o.x,  0.0)).rgb * 2.0;
    sum += texture2D(tSource, vUv + vec2(-o.x, -o.y)).rgb;
    sum += texture2D(tSource, vUv + vec2( 0.0, -o.y)).rgb * 2.0;
    sum += texture2D(tSource, vUv + vec2( o.x, -o.y)).rgb;
    gl_FragColor = vec4(sum * (1.0 / 16.0), 1.0);
  }
`;

/**
 * Final composite: occlusion, then bloom, then exposure, ACES and the encode.
 *
 * Bloom is added in linear HDR before ACES, not after it. Adding afterwards
 * would paste glow on top of an already-clipped curve, which reads as a flat
 * white smear instead of a highlight rolling off.
 *
 * OCCLUSION IS APPLIED HERE RATHER THAN TO INDIRECT DIFFUSE, AND THAT IS A
 * COMPROMISE WORTH NAMING
 *
 * Applying occlusion to indirect diffuse alone is the correct thing to do, and
 * Three even has the slot for it in `aomap_fragment`. It is not reachable from
 * here: occlusion would have to exist before shading, which means a depth prepass
 * and a second pass over all world geometry. That cost was explicitly rejected.
 *
 * So occlusion multiplies the shaded result instead, and the error that
 * introduces is that emissive and strongly lit pixels get darkened when they
 * physically should not. That is corrected for by luminance: bright pixels keep
 * their light, so faction strips and hot specular hits are not dimmed by a crease
 * behind them. It is a heuristic, not a derivation, and it is the reason this
 * stage keeps its occlusion radius modest and its strength below one.
 *
 * Bloom is deliberately sampled before occlusion is applied. Glow leaving a
 * surface is not occluded by that surface's own crevices.
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tAo;
  uniform sampler2D tGradeDay;
  uniform sampler2D tGradeNight;
  uniform float uExposure;
  uniform float uBloomStrength;
  uniform float uAoStrength;
  uniform float uNightMix;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uGrainTime;
  varying vec2 vUv;
  ${TRANSFORM_GLSL}
  ${GRADE_GLSL}

  float rww_grainHash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec4 scene = texture2D(tScene, vUv);
    vec3 color = scene.rgb;

    if (uAoStrength > 0.0) {
      float ao = texture2D(tAo, vUv).r;
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      // Anything brighter than the diffuse range is emitting or specular and must
      // not be shaded by geometry behind it.
      //
      // The window starts at 1.2 rather than near the diffuse range. These are
      // pre-tone-map linear values, and ordinary well-lit ground already sits
      // around 0.3 to 0.5 here, so a lower start was protecting most of the
      // surfaces occlusion is supposed to shade and made the whole effect
      // near-invisible. Emissive strips sit at roughly 1.0 to 2.1.
      float emissiveProtection = smoothstep(1.2, 3.0, luminance);
      float applied = mix(ao, 1.0, emissiveProtection);
      color *= mix(1.0, applied, uAoStrength);
    }

    color += texture2D(tBloom, vUv).rgb * uBloomStrength;

    // Tone map and encode, then grade. The tables are display-referred, which is
    // where a grade belongs, and it is also why they can be authored as plain
    // lift/gamma/gain numbers in grading.ts.
    vec3 display = rww_linearToSRGB(rww_aces(color, uExposure));
    vec3 day = rww_sampleGrade(tGradeDay, display);
    vec3 night = rww_sampleGrade(tGradeNight, display);
    display = mix(day, night, uNightMix);

    // Vignette. Kept subtle and squared so it falls entirely in the corners; any
    // stronger and it starts hiding units at the edge of a tactical view.
    float radius = length(vUv - 0.5) * 1.41421356;
    display *= 1.0 - uVignette * radius * radius;

    // Grain, driven by a caller-supplied time so a fixed time gives a fixed
    // frame. The dev contact sheets rely on that to stay deterministic.
    float grain = rww_grainHash(vUv * 1024.0 + uGrainTime) - 0.5;
    display += grain * uGrain;

    gl_FragColor = vec4(clamp(display, 0.0, 1.0), scene.a);
  }
`;

interface BloomLevel {
  target: THREE.WebGLRenderTarget;
  width: number;
  height: number;
}

export class PostStage {
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private bloom: BloomLevel[] = [];

  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;

  private readonly prefilterMaterial: THREE.ShaderMaterial;
  private readonly downsampleMaterial: THREE.ShaderMaterial;
  private readonly upsampleMaterial: THREE.ShaderMaterial;
  private readonly aoMaterial: THREE.ShaderMaterial;
  private readonly aoBlurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;

  /** Half-resolution occlusion, and its ping-pong partner for the separable blur. */
  private aoTarget: THREE.WebGLRenderTarget | null = null;
  private aoBlurTarget: THREE.WebGLRenderTarget | null = null;
  private readonly white: THREE.DataTexture;
  private readonly gradeDay: THREE.DataTexture;
  private readonly gradeNight: THREE.DataTexture;

  private width = 0;
  private height = 0;
  private allocations = 0;
  private disposals = 0;
  private contextLost = false;
  private bloomStrength = 1;
  private aoStrength = 0;
  private nightMix = 0;
  private grainTime = 0;

  constructor(private readonly samples = 4) {
    this.prefilterMaterial = this.fullscreenMaterial('rww-post-prefilter', PREFILTER_FRAGMENT, {
      tScene: { value: null },
      uThreshold: { value: 1 },
      uKnee: { value: 0.6 },
    });
    this.downsampleMaterial = this.fullscreenMaterial('rww-post-downsample', DOWNSAMPLE_FRAGMENT, {
      tSource: { value: null },
      uTexel: { value: new THREE.Vector2() },
    });
    this.upsampleMaterial = this.fullscreenMaterial('rww-post-upsample', UPSAMPLE_FRAGMENT, {
      tSource: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1 },
    });
    this.upsampleMaterial.blending = THREE.AdditiveBlending;
    this.aoMaterial = this.fullscreenMaterial('rww-post-ao', AO_FRAGMENT, {
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uProjection: { value: new THREE.Matrix4() },
      uProjectionInverse: { value: new THREE.Matrix4() },
      // Metres, in view space, so the occluded region is a fixed world size
      // rather than a fixed pixel size. Sized for mech and structure contact
      // rather than fine surface detail, which the material shaders handle.
      // 1.6 m read clearly on mech feet but barely registered against plinths
      // twenty metres across, so this is a compromise across both scales.
      uRadius: { value: 2.6 },
      uBias: { value: 0.04 },
    });
    this.aoBlurMaterial = this.fullscreenMaterial('rww-post-ao-blur', AO_BLUR_FRAGMENT, {
      tAo: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDirection: { value: new THREE.Vector2(1, 0) },
    });

    // Stand-in so the composite always has a bound occlusion sampler. Sampling an
    // unbound sampler2D is undefined behaviour, and on some drivers it reads as
    // black, which would render the whole frame unlit.
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;

    // Built once. The tables are a pure function of their kind, so there is no
    // reason to rebuild them on a resize or a quality change.
    this.gradeDay = createGradeLut('day');
    this.gradeNight = createGradeLut('night');

    this.compositeMaterial = this.fullscreenMaterial('rww-post-composite', COMPOSITE_FRAGMENT, {
      tScene: { value: null },
      tBloom: { value: null },
      tAo: { value: this.white },
      tGradeDay: { value: this.gradeDay },
      tGradeNight: { value: this.gradeNight },
      uExposure: { value: 1 },
      uBloomStrength: { value: 1 },
      uAoStrength: { value: 0 },
      uNightMix: { value: 0 },
      uVignette: { value: 0.16 },
      uGrain: { value: 0.014 },
      uGrainTime: { value: 0 },
    });

    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.geometry, this.compositeMaterial);
    this.quad.name = 'rww-post-quad';
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  private fullscreenMaterial(
    name: string,
    fragmentShader: string,
    uniforms: Record<string, THREE.IUniform>,
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      name,
      uniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      // These materials do their own tone mapping and encoding where needed, so
      // Three must not add either.
      toneMapped: false,
    });
  }

  setBloomStrength(strength: number): void {
    this.bloomStrength = Math.max(0, strength);
  }

  /** Zero skips the occlusion passes entirely rather than computing and ignoring them. */
  setAoStrength(strength: number): void {
    this.aoStrength = Math.max(0, strength);
  }

  /**
   * Blend toward the night grade. Zero is full day, one is full night.
   *
   * grainTime is supplied rather than read from a clock so that a caller
   * holding it constant gets a byte-identical frame, which the dev contact sheets
   * depend on.
   */
  setGrade(nightMix: number, grainTime: number): void {
    this.nightMix = Math.min(1, Math.max(0, nightMix));
    this.grainTime = grainTime;
  }

  /**
   * Size every target to the drawing buffer.
   *
   * Called only from `Renderer.resize`, so a resize storm cannot allocate: an
   * existing target of a different size is resized in place rather than replaced.
   */
  setSize(width: number, height: number): void {
    const safeWidth = Math.max(2, Math.floor(width));
    const safeHeight = Math.max(2, Math.floor(height));
    const sizeChanged = this.width !== safeWidth || this.height !== safeHeight;
    this.width = safeWidth;
    this.height = safeHeight;

    // A render target is only a descriptor until something draws to it, so
    // building one is safe even while the context is lost. Doing it here rather
    // than lazily inside `render` keeps recreation on a path that can be tested
    // without a GPU.
    if (this.contextLost || !this.sceneTarget) {
      this.contextLost = false;
      this.allocate();
      return;
    }
    if (!sizeChanged) return;
    this.sceneTarget.setSize(safeWidth, safeHeight);
    for (let level = 0; level < this.bloom.length; level++) {
      const entry = this.bloom[level]!;
      entry.width = bloomExtent(safeWidth, level);
      entry.height = bloomExtent(safeHeight, level);
      entry.target.setSize(entry.width, entry.height);
    }
    this.aoTarget?.setSize(this.aoWidth(), this.aoHeight());
    this.aoBlurTarget?.setSize(this.aoWidth(), this.aoHeight());
  }

  private aoWidth(): number {
    return Math.max(1, Math.floor(this.width / 2));
  }

  private aoHeight(): number {
    return Math.max(1, Math.floor(this.height / 2));
  }

  private allocate(): void {
    const depthTexture = new THREE.DepthTexture(this.width, this.height);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;

    this.sceneTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      // Half float because the scene writes linear HDR: values above 1.0 must
      // survive for bloom to find them and for the composite to tone map.
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      // Unmanaged. The composite owns every transform; see the file header.
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      // Preserves the antialiasing the default framebuffer provided.
      samples: this.samples,
      // Attached for Task 4's ambient occlusion, which reads scene depth rather
      // than paying for a separate depth prepass.
      depthTexture,
    });
    this.sceneTarget.texture.name = 'rww-post-scene';
    this.allocations++;

    this.bloom = [];
    for (let level = 0; level < BLOOM_LEVELS; level++) {
      const width = bloomExtent(this.width, level);
      const height = bloomExtent(this.height, level);
      const target = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.NoColorSpace,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        // No depth and no multisampling: these are pure colour reductions.
        depthBuffer: false,
        stencilBuffer: false,
        // Clamped so the widest blur taps cannot wrap across the frame edge.
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      });
      target.texture.name = `rww-post-bloom-${level}`;
      this.bloom.push({ target, width, height });
      this.allocations++;
    }

    // Occlusion is single-channel information but stored in RGBA8: WebGL2 red-only
    // render targets are not universally filterable, and this buffer is sampled
    // bilinearly on the way back up to full resolution.
    const aoOptions: THREE.RenderTargetOptions = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    this.aoTarget = new THREE.WebGLRenderTarget(this.aoWidth(), this.aoHeight(), aoOptions);
    this.aoTarget.texture.name = 'rww-post-ao';
    this.allocations++;
    this.aoBlurTarget = new THREE.WebGLRenderTarget(this.aoWidth(), this.aoHeight(), aoOptions);
    this.aoBlurTarget.texture.name = 'rww-post-ao-blur';
    this.allocations++;
  }

  /** The resolved scene depth, for later passes that need it. */
  get depthTexture(): THREE.DepthTexture | null {
    return this.sceneTarget?.depthTexture ?? null;
  }

  /**
   * Render the scene through the stage.
   *
   * Deliberately does not touch `gl.info`. The caller owns counter lifecycle,
   * because every pass must accumulate into one frame's totals.
   */
  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, exposure: number): void {
    if (this.contextLost || !this.sceneTarget) {
      this.contextLost = false;
      if (this.width > 0 && this.height > 0) this.allocate();
      if (!this.sceneTarget) {
        gl.setRenderTarget(null);
        gl.render(scene, camera);
        return;
      }
    }

    gl.setRenderTarget(this.sceneTarget);
    gl.render(scene, camera);

    const occlusion = this.renderAo(gl, camera);
    this.renderBloom(gl);

    this.compositeMaterial.uniforms.tScene!.value = this.sceneTarget.texture;
    this.compositeMaterial.uniforms.tBloom!.value = this.bloom[0]!.target.texture;
    this.compositeMaterial.uniforms.tAo!.value = occlusion ?? this.white;
    this.compositeMaterial.uniforms.uExposure!.value = exposure;
    this.compositeMaterial.uniforms.uBloomStrength!.value = this.bloomStrength;
    this.compositeMaterial.uniforms.uAoStrength!.value = occlusion ? this.aoStrength : 0;
    this.compositeMaterial.uniforms.uNightMix!.value = this.nightMix;
    this.compositeMaterial.uniforms.uGrainTime!.value = this.grainTime;
    this.blit(gl, this.compositeMaterial, null);
  }

  /**
   * Compute occlusion, returning the filtered buffer, or null when disabled.
   *
   * The blur is separable and ping-pongs between the two half-resolution targets,
   * so the horizontal result lands in the partner and the vertical result comes
   * back to the original. That is two passes rather than one wide 2D kernel, and
   * at these radii it is both cheaper and less prone to bleeding across edges.
   */
  private renderAo(gl: THREE.WebGLRenderer, camera: THREE.Camera): THREE.Texture | null {
    if (this.aoStrength <= 0) return null;
    const depth = this.sceneTarget?.depthTexture;
    if (!depth || !this.aoTarget || !this.aoBlurTarget) return null;

    const texel = new THREE.Vector2(1 / this.aoWidth(), 1 / this.aoHeight());

    this.aoMaterial.uniforms.tDepth!.value = depth;
    (this.aoMaterial.uniforms.uTexel!.value as THREE.Vector2).copy(texel);
    (this.aoMaterial.uniforms.uProjection!.value as THREE.Matrix4).copy(camera.projectionMatrix);
    (this.aoMaterial.uniforms.uProjectionInverse!.value as THREE.Matrix4)
      .copy(camera.projectionMatrixInverse);
    this.blit(gl, this.aoMaterial, this.aoTarget);

    this.aoBlurMaterial.uniforms.tDepth!.value = depth;
    (this.aoBlurMaterial.uniforms.uTexel!.value as THREE.Vector2).copy(texel);

    this.aoBlurMaterial.uniforms.tAo!.value = this.aoTarget.texture;
    (this.aoBlurMaterial.uniforms.uDirection!.value as THREE.Vector2).set(1, 0);
    this.blit(gl, this.aoBlurMaterial, this.aoBlurTarget);

    this.aoBlurMaterial.uniforms.tAo!.value = this.aoBlurTarget.texture;
    (this.aoBlurMaterial.uniforms.uDirection!.value as THREE.Vector2).set(0, 1);
    this.blit(gl, this.aoBlurMaterial, this.aoTarget);

    return this.aoTarget.texture;
  }

  private renderBloom(gl: THREE.WebGLRenderer): void {
    const scene = this.sceneTarget!;

    // Bright pass into the largest mip.
    this.prefilterMaterial.uniforms.tScene!.value = scene.texture;
    this.blit(gl, this.prefilterMaterial, this.bloom[0]!.target);

    // Progressive reduction.
    for (let level = 1; level < this.bloom.length; level++) {
      const source = this.bloom[level - 1]!;
      this.downsampleMaterial.uniforms.tSource!.value = source.target.texture;
      (this.downsampleMaterial.uniforms.uTexel!.value as THREE.Vector2)
        .set(1 / source.width, 1 / source.height);
      this.blit(gl, this.downsampleMaterial, this.bloom[level]!.target);
    }

    // Progressive expansion, accumulating additively back up the chain. Clearing
    // is suppressed so each level keeps the reduction already stored in it.
    const previousAutoClear = gl.autoClear;
    gl.autoClear = false;
    for (let level = this.bloom.length - 1; level > 0; level--) {
      const source = this.bloom[level]!;
      this.upsampleMaterial.uniforms.tSource!.value = source.target.texture;
      (this.upsampleMaterial.uniforms.uTexel!.value as THREE.Vector2)
        .set(1 / source.width, 1 / source.height);
      this.blit(gl, this.upsampleMaterial, this.bloom[level - 1]!.target);
    }
    gl.autoClear = previousAutoClear;
  }

  private blit(
    gl: THREE.WebGLRenderer,
    material: THREE.Material,
    target: THREE.WebGLRenderTarget | null,
  ): void {
    this.quad.material = material;
    gl.setRenderTarget(target);
    gl.render(this.quadScene, this.quadCamera);
  }

  /**
   * Drop target handles owned by a lost context without issuing invalid deletes,
   * matching how `Environment.handleContextLoss` treats its own resources.
   */
  handleContextLoss(): void {
    this.contextLost = true;
    this.sceneTarget = null;
    this.bloom = [];
    this.aoTarget = null;
    this.aoBlurTarget = null;
    this.clearSamplerUniforms();
  }

  private clearSamplerUniforms(): void {
    this.prefilterMaterial.uniforms.tScene!.value = null;
    this.downsampleMaterial.uniforms.tSource!.value = null;
    this.upsampleMaterial.uniforms.tSource!.value = null;
    this.aoMaterial.uniforms.tDepth!.value = null;
    this.aoBlurMaterial.uniforms.tAo!.value = null;
    this.aoBlurMaterial.uniforms.tDepth!.value = null;
    this.compositeMaterial.uniforms.tScene!.value = null;
    this.compositeMaterial.uniforms.tBloom!.value = null;
    this.compositeMaterial.uniforms.tAo!.value = this.white;
  }

  dispose(): void {
    if (this.sceneTarget) {
      this.sceneTarget.depthTexture?.dispose();
      this.sceneTarget.dispose();
      this.disposals++;
      this.sceneTarget = null;
    }
    for (const entry of this.bloom) {
      entry.target.dispose();
      this.disposals++;
    }
    this.bloom = [];
    for (const target of [this.aoTarget, this.aoBlurTarget]) {
      if (!target) continue;
      target.dispose();
      this.disposals++;
    }
    this.aoTarget = null;
    this.aoBlurTarget = null;
    this.clearSamplerUniforms();
    this.white.dispose();
    this.gradeDay.dispose();
    this.gradeNight.dispose();
    this.prefilterMaterial.dispose();
    this.downsampleMaterial.dispose();
    this.upsampleMaterial.dispose();
    this.aoMaterial.dispose();
    this.aoBlurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.geometry.dispose();
    this.quadScene.clear();
  }

  diagnostics(): PostStageDiagnostics {
    const smallest = this.bloom.at(-1);
    return {
      allocations: this.allocations,
      disposals: this.disposals,
      live: (this.sceneTarget ? 1 : 0)
        + this.bloom.length
        + (this.aoTarget ? 1 : 0)
        + (this.aoBlurTarget ? 1 : 0),
      width: this.width,
      height: this.height,
      samples: this.samples,
      hasDepthTexture: Boolean(this.sceneTarget?.depthTexture),
      contextLost: this.contextLost,
      bloomLevels: this.bloom.length,
      smallestBloom: { width: smallest?.width ?? 0, height: smallest?.height ?? 0 },
      aoResolution: { width: this.aoTarget ? this.aoWidth() : 0, height: this.aoTarget ? this.aoHeight() : 0 },
    };
  }
}

/** Each bloom level halves the previous one, floored at one texel. */
function bloomExtent(extent: number, level: number): number {
  return Math.max(1, Math.floor(extent / 2 ** (level + 1)));
}
