/**
 * The sky of an enclosed world.
 *
 * There is no skybox here, because there is no sky in the usual sense. Standing
 * on the inside of a ring you are looking at more world: the floor sweeps up on
 * both sides and closes overhead. What fills the "sky" is
 *
 *   - the SOLAR FILAMENT, a fusion line-light running along the ring's axis,
 *   - the SHADOW SQUARES, opaque panels orbiting the axis that sweep bands of
 *     night across the landscape,
 *   - the FAR SIDE of the ring itself, 7.2 km overhead (see ringShell.ts),
 *   - and open starfield glimpsed past the rim at the axial edges.
 *
 * A consequence of the geometry worth stating plainly: inside a ring, light
 * always comes from above. Long raking shadows are impossible. So the visual
 * drama comes instead from the shadow-square terminator sweeping across the
 * world, from volumetric shafts at its edges, and from the ring's own surfaces
 * bouncing light back onto each other -- which is a look no open-sky game has.
 */

import * as THREE from 'three';
import {
  DAY_LENGTH,
  RING_OMEGA,
  RING_CIRCUMFERENCE,
  RING_HALF_WIDTH,
  RING_RADIUS,
  SHADOW_SQUARE_COUNT,
} from '@core/constants';
import { Rng } from '@core/rng';
import { clamp01, smoothstep } from '@gen/noise';
import type { RenderAnchor } from './anchor';
import { disposeObject } from './disposeObject';

/** Radial offset of the filament from the true axis, as a fraction of R.
 *  Non-zero so that shading has direction instead of being flatly top-down. */
const FILAMENT_OFFSET = 0.34;

/** Radius at which the shadow panels orbit, as a fraction of R.
 *  Small, so they ride close to the axis: high overhead and modest in apparent
 *  size. Their radius does not affect the shadow they cast, because the light
 *  radiates from the axis -- only their angular span does. */
const PANEL_RADIUS = 0.26;

/** Angular half-width of each shadow panel, radians. */
const PANEL_HALF_SPAN = 0.19;

const PANEL_SPACING = (Math.PI * 2) / SHADOW_SQUARE_COUNT;

/** Offset the panel pattern so a match opens at midday rather than in shade. */
const PANEL_PHASE_OFFSET = PANEL_SPACING * 0.5;

/** Deepest the shadow squares ever get. Night has to stay readable -- an RTS
 *  the player cannot see is not atmospheric, it is broken. */
const MAX_OCCLUSION = 0.72;

// ---------------------------------------------------------------------------
// Day cycle
// ---------------------------------------------------------------------------

/** Colour of the filament through the cycle, from deep dusk to full noon. */
const WARM_LOW = new THREE.Color('#ff9a4a');
const WARM_MID = new THREE.Color('#ffd9a8');
const NEUTRAL = new THREE.Color('#fff4e2');
const DAY_HAZE = new THREE.Color('#9fb4c9');
const NIGHT_HAZE = new THREE.Color('#1a2334');
const DAY_SPACE = new THREE.Color('#070b13');
const NIGHT_SPACE = new THREE.Color('#010309');
const DAY_ZENITH = new THREE.Color('#182638');
const NIGHT_ZENITH = new THREE.Color('#080d18');

export interface AtmosphereSample {
  readonly space: THREE.Color;
  readonly horizon: THREE.Color;
  readonly zenith: THREE.Color;
  fogDensity: number;
}

export function sampleAtmosphere(daylight: number, target = createAtmosphereSample()): AtmosphereSample {
  const value = clamp01(daylight);
  const blend = smoothstep(0, 0.75, value);
  target.space.copy(NIGHT_SPACE).lerp(DAY_SPACE, blend);
  target.horizon.copy(NIGHT_HAZE).lerp(DAY_HAZE, blend);
  target.zenith.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, blend);
  target.fogDensity = 0.000132 - value * 0.000017;
  return target;
}

function createAtmosphereSample(): AtmosphereSample {
  return {
    space: new THREE.Color(),
    horizon: new THREE.Color(),
    zenith: new THREE.Color(),
    fogDensity: 0.000105,
  };
}

export class DayCycle {
  /** Seconds since match start. */
  time = 0;
  /** Angle of the filament around the axis. */
  filamentAngle = 0;
  /** 0 = deep shadow, 1 = full light, for the anchor's position. */
  daylight = 1;
  /** Colour and intensity of the key light. */
  readonly lightColor = new THREE.Color();
  lightIntensity = 1;
  /** Ambient/haze colour, used for fog and bounce. */
  readonly hazeColor = new THREE.Color();
  readonly atmosphere = createAtmosphereSample();
  ambientIntensity = 1;

  update(time: number, anchorS: number): void {
    this.time = time;

    // Panels orbit slowly; one full day for a fixed point takes DAY_LENGTH.
    this.filamentAngle = panelPhaseAt(this.time);

    const theta = (anchorS / RING_CIRCUMFERENCE) * Math.PI * 2;
    this.daylight = shadowFactor(theta, this.time);

    // Colour temperature warms as the light dims at the terminator.
    const d = this.daylight;
    if (d > 0.55) {
      this.lightColor.copy(WARM_MID).lerp(NEUTRAL, smoothstep(0.55, 1, d));
    } else {
      this.lightColor.copy(WARM_LOW).lerp(WARM_MID, smoothstep(0.05, 0.55, d));
    }
    // Three uses physical light units, so these numbers are small on purpose.
    this.lightIntensity = 0.30 + 1.55 * d * d;

    sampleAtmosphere(d, this.atmosphere);
    this.hazeColor.copy(this.atmosphere.horizon);
    // Ambient rises as direct light falls: on a ring, the lit landscape
    // overhead keeps throwing light down even when you are in a shadow band.
    this.ambientIntensity = 0.9 - 0.25 * d;
  }

  /** Direction the key light travels, in render space (points downward-ish). */
  keyLightDirection(anchor: RenderAnchor, out: THREE.Vector3): THREE.Vector3 {
    // Filament position in render space, offset from the axis so that shading
    // has a direction rather than being uniformly top-down.
    const rel = this.filamentAngle - (anchor.s / RING_CIRCUMFERENCE) * Math.PI * 2;
    const d = RING_RADIUS * FILAMENT_OFFSET;
    const fx = d * Math.sin(rel);
    const fy = RING_RADIUS - d * Math.cos(rel);
    // Travelling from the filament toward the anchor's floor point (0, 0, 0).
    return out.set(-fx, -fy, 0).normalize();
  }
}

/**
 * How much direct light reaches a point at ring angle `theta` at time `t`.
 * Shared by rendering and by the economy (solar arrays produce less at night),
 * so the lighting the player sees and the power they get cannot disagree.
 */
export function shadowFactor(theta: number, t: number): number {
  const panelPhase = panelPhaseAt(t);
  // Angle to the nearest panel centre.
  let rel = (theta - panelPhase) % PANEL_SPACING;
  if (rel < 0) rel += PANEL_SPACING;
  const d = Math.min(rel, PANEL_SPACING - rel);
  // 1 inside the panel's shadow, 0 outside, with a soft penumbra.
  const occluded = 1 - smoothstep(PANEL_HALF_SPAN * 0.5, PANEL_HALF_SPAN, d);
  return clamp01(1 - occluded * MAX_OCCLUSION);
}

/** Angular position of the shadow-square pattern at time t. */
export function panelPhaseAt(t: number): number {
  return (t / (DAY_LENGTH * SHADOW_SQUARE_COUNT)) * Math.PI * 2 + PANEL_PHASE_OFFSET;
}

// ---------------------------------------------------------------------------
// Sky objects
// ---------------------------------------------------------------------------

/** Everything that lives "in the sky" of the ring. */
export class Environment {
  readonly group = new THREE.Group();
  readonly cycle = new DayCycle();

  readonly keyLight: THREE.DirectionalLight;
  readonly fillLight: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;

  private filament!: THREE.Mesh;
  private filamentGlow!: THREE.Mesh;
  private panels: THREE.Mesh[] = [];
  private stars!: THREE.Points;
  private atmosphere!: THREE.Mesh;
  private readonly starPivot = new THREE.Group();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private environmentScene: THREE.Scene | null = null;

  private readonly _v = new THREE.Vector3();

  constructor(seed: number) {
    this.group.name = 'environment';
    this.starPivot.name = 'environment:star-pivot';
    this.starPivot.position.set(0, RING_RADIUS, 0);
    this.group.add(this.starPivot);

    // --- Lighting -----------------------------------------------------------
    this.keyLight = new THREE.DirectionalLight(0xfff2e0, 1.6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 4000;
    this.keyLight.shadow.bias = -0.0006;
    this.keyLight.shadow.normalBias = 0.9;
    const sc = this.keyLight.shadow.camera;
    sc.left = -700;
    sc.right = 700;
    sc.top = 700;
    sc.bottom = -700;
    this.group.add(this.keyLight, this.keyLight.target);

    // Bounce from the ring's own surfaces. On a ring this is not a cheat --
    // there really is a lit landscape overhead throwing light back down.
    this.fillLight = new THREE.HemisphereLight(0xb8ccdd, 0x4a4238, 0.35);
    this.group.add(this.fillLight);

    this.ambient = new THREE.AmbientLight(0x2a3444, 0.12);
    this.group.add(this.ambient);

    this.cycle.update(0, 0);
    this.buildAtmosphere();
    this.buildFilament();
    this.buildPanels();
    this.buildStars(seed);
  }

  // -------------------------------------------------------------------------

  private buildAtmosphere(): void {
    const geometry = new THREE.SphereGeometry(1, 16, 8);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      transparent: false,
      dithering: true,
      uniforms: {
        uSpace: { value: this.cycle.atmosphere.space.clone() },
        uHorizonOutput: { value: this.cycle.atmosphere.horizon.clone().convertLinearToSRGB() },
        uZenith: { value: this.cycle.atmosphere.zenith.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSpace;
        uniform vec3 uHorizonOutput;
        uniform vec3 uZenith;
        varying vec3 vDirection;
        void main() {
          vec3 direction = normalize(vDirection);
          float ringward = 1.0 - smoothstep(0.45, 0.9, abs(direction.z));
          float horizon = (1.0 - smoothstep(0.0, 0.42, abs(direction.y))) * ringward;
          float zenith = smoothstep(0.0, 0.78, max(direction.y, 0.0)) * 0.62;
          vec3 color = mix(uSpace, uZenith, zenith);
          float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
          gl_FragColor = vec4(max(color + dither / 255.0, 0.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          // Three's fog endpoint is mixed after output conversion in the terrain
          // shaders, so use the same framebuffer-space endpoint at the horizon.
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizonOutput, horizon);
        }
      `,
    });
    this.atmosphere = new THREE.Mesh(geometry, material);
    this.atmosphere.name = 'environment:atmosphere';
    this.atmosphere.scale.setScalar(6_000);
    this.atmosphere.renderOrder = -1_000;
    this.atmosphere.frustumCulled = false;
    this.group.add(this.atmosphere);
  }

  private buildFilament(): void {
    // A line of fusion light running the length of the ring's axis. It recedes
    // to vanishing points in both directions, which does more to communicate
    // "you are inside a cylinder" than any amount of terrain.
    const len = RING_CIRCUMFERENCE * 1.2;

    const core = new THREE.CylinderGeometry(26, 26, len, 12, 1, true);
    core.rotateX(Math.PI / 2);
    this.filament = new THREE.Mesh(
      core,
      new THREE.MeshBasicMaterial({ color: 0xfff6e8, fog: false, toneMapped: false }),
    );
    this.filament.frustumCulled = false;
    this.group.add(this.filament);

    // A soft additive sheath so it blooms convincingly.
    const glow = new THREE.CylinderGeometry(150, 150, len, 16, 1, true);
    glow.rotateX(Math.PI / 2);
    this.filamentGlow = new THREE.Mesh(
      glow,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(0xffd9a0) }, uIntensity: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec3 vNormalW;
          varying vec3 vViewDir;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vNormalW = normalize(mat3(modelMatrix) * normal);
            vViewDir = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uIntensity;
          varying vec3 vNormalW;
          varying vec3 vViewDir;
          void main() {
            float rim = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 2.0);
            gl_FragColor = vec4(uColor * rim * uIntensity, rim * 0.55 * uIntensity);
          }
        `,
      }),
    );
    this.filamentGlow.frustumCulled = false;
    this.group.add(this.filamentGlow);
  }

  private buildPanels(): void {
    // Shadow squares: slats orbiting the axis that sweep bands of night across
    // the world. Orientation matters and is easy to get backwards -- each panel
    // must be LONG along the ring axis and NARROW spinward, so its shadow falls
    // as a stripe across the full width of the habitable band and travels
    // around the ring. Long the other way, it would shade the whole world at
    // once and nothing would ever move.
    const axialLength = RING_HALF_WIDTH * 4.5;
    const spinWidth = 2 * RING_RADIUS * PANEL_RADIUS * Math.sin(PANEL_HALF_SPAN);

    // Plane in XY -> lay it flat so width runs spinward (x) and length runs
    // axially (z), with the faces pointing up and down.
    const geo = new THREE.PlaneGeometry(spinWidth, axialLength, 1, 8);
    geo.rotateX(-Math.PI / 2);

    // We only ever see the shaded underside, since the filament is above them.
    // A little emissive keeps them reading as engineered structures rather than
    // as holes cut out of the sky.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x232a34,
      roughness: 0.62,
      metalness: 0.7,
      emissive: new THREE.Color(0x121821),
      emissiveIntensity: 1,
      side: THREE.DoubleSide,
      fog: true,
    });

    for (let i = 0; i < SHADOW_SQUARE_COUNT; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      this.panels.push(m);
      this.group.add(m);
    }
  }

  private buildStars(seed: number): void {
    // Visible past the rim at the axial edges of the world. Magnitudes and
    // colour temperatures are distributed so the field does not read as noise.
    const rng = new Rng(seed ^ 0x5ee5);
    const count = 2600;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const c = new THREE.Color();
    // Just inside the camera's far plane. Stars only need to sit behind
    // everything else, and pushing them further out would force a far plane
    // that costs depth precision across the whole scene.
    const R = 11000;

    for (let i = 0; i < count; i++) {
      // Uniform on a sphere.
      const u = rng.next() * 2 - 1;
      const phi = rng.next() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(phi) * r * R;
      pos[i * 3 + 1] = u * R;
      pos[i * 3 + 2] = Math.sin(phi) * r * R;

      // Most stars are dim; a few are bright. Power law keeps it believable.
      const mag = Math.pow(rng.next(), 3.2);
      const temp = rng.next();
      c.setHSL(temp < 0.7 ? 0.58 - temp * 0.14 : 0.08, 0.35 + rng.next() * 0.35, 0.55 + mag * 0.45);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      size[i] = 6 + mag * 46;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    this.stars = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: 1 }, uOpacity: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute float aSize;
          uniform float uScale;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec3 viewDirection = mat3(viewMatrix) * mat3(modelMatrix) * position;
            vec4 mv = vec4(viewDirection, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_Position.z = gl_Position.w * 0.9999;
            gl_PointSize = aSize * uScale;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          varying vec3 vColor;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            float r = length(d);
            if (r > 0.5) discard;
            // Soft core plus a faint halo reads far better than a hard dot.
            float a = smoothstep(0.5, 0.0, r);
            a = a * a;
            gl_FragColor = vec4(vColor * (a + 0.35 * smoothstep(0.5, 0.15, r)), a * uOpacity);
          }
        `,
        vertexColors: true,
      }),
    );
    this.stars.name = 'environment:stars';
    this.stars.frustumCulled = false;
    this.starPivot.add(this.stars);
  }

  // -------------------------------------------------------------------------

  update(time: number, anchor: RenderAnchor, cameraPos: THREE.Vector3): void {
    this.cycle.update(time, anchor.s);
    this.atmosphere.position.copy(cameraPos);
    const atmosphereMaterial = this.atmosphere.material as THREE.ShaderMaterial;
    atmosphereMaterial.uniforms.uSpace!.value.copy(this.cycle.atmosphere.space);
    atmosphereMaterial.uniforms.uHorizonOutput!.value
      .copy(this.cycle.atmosphere.horizon)
      .convertLinearToSRGB();
    atmosphereMaterial.uniforms.uZenith!.value.copy(this.cycle.atmosphere.zenith);

    const anchorAngle = (anchor.s / RING_CIRCUMFERENCE) * Math.PI * 2;
    this.starPivot.rotation.z = -(RING_OMEGA * time + anchorAngle);

    // --- Filament, positioned relative to the anchor -------------------------
    const rel = this.cycle.filamentAngle - anchorAngle;
    const d = RING_RADIUS * FILAMENT_OFFSET;
    const fx = d * Math.sin(rel);
    const fy = RING_RADIUS - d * Math.cos(rel);
    this.filament.position.set(fx, fy, 0);
    this.filamentGlow.position.set(fx, fy, 0);

    const glowMat = this.filamentGlow.material as THREE.ShaderMaterial;
    glowMat.uniforms.uIntensity!.value = 0.4 + this.cycle.daylight * 1.4;
    (this.filament.material as THREE.MeshBasicMaterial).color
      .copy(this.cycle.lightColor)
      .multiplyScalar(1.6);

    // --- Shadow panels -------------------------------------------------------
    for (let i = 0; i < this.panels.length; i++) {
      const a = this.cycle.filamentAngle + i * PANEL_SPACING - anchorAngle;
      const pr = RING_RADIUS * PANEL_RADIUS;
      this.panels[i]!.position.set(pr * Math.sin(a), RING_RADIUS - pr * Math.cos(a), 0);
      this.panels[i]!.rotation.set(0, 0, -a);
    }

    // --- Key light -----------------------------------------------------------
    this.cycle.keyLightDirection(anchor, this._v);
    this.keyLight.target.position.copy(cameraPos);
    this.keyLight.position.copy(cameraPos).addScaledVector(this._v, -1400);
    this.keyLight.color.copy(this.cycle.lightColor);
    this.keyLight.intensity = this.cycle.lightIntensity;

    this.fillLight.intensity = this.cycle.ambientIntensity * 0.34;
    this.fillLight.color.copy(this.cycle.hazeColor);
    this.ambient.intensity = 0.06 + this.cycle.daylight * 0.10;

    // --- Stars fade in as the light drops ------------------------------------
    const starMat = this.stars.material as THREE.ShaderMaterial;
    starMat.uniforms.uOpacity!.value = 0.25 + (1 - this.cycle.daylight) * 0.75;
  }

  /** Fog colour for the current lighting. */
  get fogColor(): THREE.Color {
    return this.cycle.hazeColor;
  }

  get fogDensity(): number {
    return this.cycle.atmosphere.fogDensity;
  }

  get spaceColor(): THREE.Color {
    return this.cycle.atmosphere.space;
  }

  setLowQuality(enabled: boolean): void {
    this.atmosphere.visible = !enabled;
  }

  /**
   * Build the image reflected by every metal surface in the game.
   *
   * Without this, `metalness` is close to a mute button: a metal surface has no
   * diffuse response, so with nothing to reflect it renders black. Every mech
   * and building was coming out as a silhouette for exactly that reason.
   *
   * The map is a tiny equirectangular gradient drawn from the same palette as
   * the world -- dusty ground below, hazy air at the horizon, and a hot band
   * across the top standing in for the solar filament -- then prefiltered by
   * PMREM so roughness behaves correctly. 64x32 is plenty: it is only ever seen
   * blurred across curved metal.
   */
  buildEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (this.environmentScene && this.envTarget && this.environmentScene.environment === this.envTarget.texture) {
      this.environmentScene.environment = null;
    }
    this.envTarget?.dispose();
    this.envTarget = null;
    this.environmentScene = scene;
    const w = 64;
    const h = 32;
    const data = new Float32Array(w * h * 4);

    const ground = new THREE.Color('#3a3228');
    const horizon = new THREE.Color('#8ea2b6');
    const sky = new THREE.Color('#6d8299');
    const lamp = new THREE.Color('#fff0d8');
    const c = new THREE.Color();

    for (let y = 0; y < h; y++) {
      // v runs 0 at the top of the sphere to 1 at the bottom.
      const v = y / (h - 1);
      for (let x = 0; x < w; x++) {
        if (v < 0.42) {
          c.copy(sky).lerp(horizon, smoothstep(0.0, 0.42, v));
        } else if (v < 0.55) {
          c.copy(horizon).lerp(ground, smoothstep(0.42, 0.55, v));
        } else {
          c.copy(ground);
        }
        // The filament: a bright band along the top, brightest at the zenith.
        const lampT = 1 - smoothstep(0.0, 0.20, v);
        c.lerp(lamp, lampT * 0.9);
        const gain = 1 + lampT * 5;

        const i = (y * w + x) * 4;
        data[i] = c.r * gain;
        data[i + 1] = c.g * gain;
        data[i + 2] = c.b * gain;
        data[i + 3] = 1;
      }
    }

    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    this.envTarget = pmrem.fromEquirectangular(tex);
    scene.environment = this.envTarget.texture;
    // Ambient light and the environment both contribute indirect light, so the
    // ambient terms are pulled back elsewhere to compensate.
    scene.environmentIntensity = 0.55;

    tex.dispose();
    pmrem.dispose();
  }

  dispose(): void {
    if (this.environmentScene && this.envTarget && this.environmentScene.environment === this.envTarget.texture) {
      this.environmentScene.environment = null;
    }
    this.envTarget?.dispose();
    this.envTarget = null;
    this.environmentScene = null;
    this.keyLight.shadow.map?.dispose();
    this.keyLight.shadow.map = null;
    disposeObject(this.group);
  }
}

/** Where the habitable band ends and open space begins, for the shell mesh. */
export const RIM_EDGE = RING_HALF_WIDTH;
