/**
 * Terrain material.
 *
 * Built by extending MeshStandardMaterial rather than writing a shader from
 * scratch, which keeps Three's PBR lighting, shadow receiving, fog and tone
 * mapping working, and lets us spend the effort on the parts that actually
 * determine how good it looks:
 *
 *   - HEIGHT-BASED SPLAT BLENDING between four procedural surfaces. Blending by
 *     a per-layer height field rather than lerping alpha is the single change
 *     that stops procedural ground reading as smeared noise; transitions get
 *     interlocking, gritty edges instead of soft gradients.
 *   - CURVATURE AND CAVITY DARKENING, so crevices read as crevices.
 *   - PANEL LINES at two scales, because the floor is a megastructure deck, not
 *     a planet. This is what makes even bare ground read as built.
 *   - TRUE SHADOW-SQUARE OCCLUSION, applied only to direct light, so the
 *     terminator sweeping across the world darkens the sun without flattening
 *     the ambient bounce.
 *
 * Everything is computed from surface coordinates carried on the vertices, so
 * it is stable under the floating origin and wraps seamlessly around the ring.
 */

import * as THREE from 'three';
import { RING_HALF_WIDTH, RING_RADIUS, SHADOW_SQUARE_COUNT } from '@core/constants';
import { SURFACE_NOISE_GLSL } from './surface.glsl';

export interface TerrainUniforms {
  uTime: { value: number };
  uPanelPhase: { value: number };
  uPanelSpan: { value: number };
  uAmbientTint: { value: THREE.Color };
  /** Detail-normal strength, faded out with distance. */
  uDetailFade: { value: number };
  /**
   * Per-feature tier controls.
   *
   * One uniform per feature rather than more meanings piled onto `uDetailFade`,
   * so that what a tier turns off is legible at the call site instead of encoded
   * in a single number. All of them are branched on in uniform control flow: every
   * fragment of a draw takes the same path, so the GPU genuinely skips the work
   * rather than executing both sides and discarding one.
   */
  uFineOctaves: { value: number };
  uTriplanarRim: { value: number };
  uDustDrift: { value: number };
  uMicroDetail: { value: number };
}

/** The subset of a quality tier that the terrain material cares about. */
export interface TerrainQuality {
  detailFade: number;
  terrainFineOctaves: number;
  terrainTriplanarRim: boolean;
  terrainDustDrift: number;
  terrainMicroDetail: number;
}

/**
 * Push a quality tier into the terrain uniforms.
 *
 * One function rather than five assignments at each of the four call sites that
 * change tier, so a new terrain feature is wired once and cannot be missed at one
 * of them. Structurally typed rather than importing `QualitySettings`, to keep the
 * material from depending on the renderer.
 */
export function applyTerrainQuality(uniforms: TerrainUniforms, quality: TerrainQuality): void {
  uniforms.uDetailFade.value = quality.detailFade;
  uniforms.uFineOctaves.value = quality.terrainFineOctaves;
  uniforms.uTriplanarRim.value = quality.terrainTriplanarRim ? 1 : 0;
  uniforms.uDustDrift.value = quality.terrainDustDrift;
  uniforms.uMicroDetail.value = quality.terrainMicroDetail;
}

export function makeLowTerrainMaterial(uniforms: TerrainUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...uniforms,
      uHalfWidth: { value: RING_HALF_WIDTH },
      uPanelSpacing: { value: (Math.PI * 2) / SHADOW_SQUARE_COUNT },
    },
    fog: true,
    dithering: true,
    vertexShader: /* glsl */ `
      attribute vec2 aSurface;
      varying vec2 vSurface;
      varying float vSlope;
      varying float vTheta;
      varying float vLight;
      #include <fog_pars_vertex>
      void main() {
        vSurface = aSurface;
        vec2 fromAxis = vec2(position.x, position.y - ${RING_RADIUS.toFixed(1)});
        vec3 localUp = normalize(vec3(-fromAxis, 0.0));
        vec3 objectNormal = normalize(normal);
        vSlope = 1.0 - clamp(dot(objectNormal, localUp), 0.0, 1.0);
        vTheta = atan(position.x, ${RING_RADIUS.toFixed(1)} - position.y);
        vLight = 0.68 + 0.32 * max(dot(objectNormal, normalize(vec3(0.24, 0.94, 0.18))), 0.0);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPanelPhase;
      uniform float uPanelSpan;
      uniform float uPanelSpacing;
      uniform float uHalfWidth;
      uniform vec3 uAmbientTint;
      varying vec2 vSurface;
      varying float vSlope;
      varying float vTheta;
      varying float vLight;
      #include <common>
      #include <fog_pars_fragment>
      #include <dithering_pars_fragment>

      float lowHash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float lowNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(lowHash(i), lowHash(i + vec2(1.0, 0.0)), u.x),
          mix(lowHash(i + vec2(0.0, 1.0)), lowHash(i + 1.0), u.x), u.y);
      }
      float lowGrid(vec2 p, float width) {
        vec2 g = abs(fract(p) - 0.5);
        return 1.0 - smoothstep(0.0, width, 0.5 - max(g.x, g.y));
      }
      void main() {
        float region = lowNoise(vSurface * 0.00055 + 17.0);
        float district = 0.5 + 0.5 * sin(vSurface.x * 0.0017 + sin(vSurface.y * 0.006));
        vec3 dust = mix(vec3(0.145, 0.142, 0.132), vec3(0.275, 0.242, 0.184), region);
        vec3 albedo = mix(dust, vec3(0.105, 0.112, 0.125), clamp(vSlope * 2.3, 0.0, 0.78));
        albedo *= mix(0.68, 1.42, smoothstep(0.24, 0.76, district));
        float rim = smoothstep(0.80, 0.97, abs(vSurface.y) / uHalfWidth);
        albedo = mix(albedo, vec3(0.184, 0.177, 0.165), rim);
        albedo *= 1.0 - lowGrid(vSurface / 420.0, 0.008) * 0.25;
        float rel = mod(vTheta - uPanelPhase, uPanelSpacing);
        float d = min(rel, uPanelSpacing - rel);
        float band = 1.0 - (1.0 - smoothstep(uPanelSpan * 0.5, uPanelSpan, d)) * 0.72;
        vec3 outgoingLight = albedo * vLight * band + uAmbientTint * (1.0 - band) * 0.035;
        gl_FragColor = vec4(outgoingLight, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
        #include <dithering_fragment>
      }
    `,
  });
}

/**
 * Noise and blending now come from the shared surface library so that a terrain
 * crack and a hull scratch are built from the same vocabulary. The bodies moved
 * verbatim; see src/render/materials/surface.glsl.ts.
 */
const NOISE_GLSL = SURFACE_NOISE_GLSL;
export function makeTerrainMaterial(sharedUniforms?: TerrainUniforms): {
  material: THREE.MeshStandardMaterial;
  uniforms: TerrainUniforms;
} {
  const uniforms: TerrainUniforms = sharedUniforms ?? {
    uTime: { value: 0 },
    uPanelPhase: { value: 0 },
    uPanelSpan: { value: 0.19 },
    uAmbientTint: { value: new THREE.Color('#8ea6bd') },
    uDetailFade: { value: 1 },
    uFineOctaves: { value: 3 },
    uTriplanarRim: { value: 1 },
    uDustDrift: { value: 1 },
    uMicroDetail: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    dithering: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.uRingRadius = { value: RING_RADIUS };
    shader.uniforms.uHalfWidth = { value: RING_HALF_WIDTH };
    shader.uniforms.uPanelSpacing = { value: (Math.PI * 2) / SHADOW_SQUARE_COUNT };

    // ---------------------------------------------------------------- vertex
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        attribute vec2 aSurface;
        // Baked by buildRingGeometry from terrain's own fields. See Task 9.
        attribute vec4 aSplat;
        attribute float aCurvature;
        attribute float aAO;
        varying vec2 vSurface;
        varying float vHeight;
        varying float vTheta;
        varying vec3 vLocalUp;
        varying vec3 vLocalAxial;
        varying vec3 vViewPos;
        varying vec4 vSplat;
        varying float vCurvature;
        varying float vAO;
        varying vec2 vRegion;
        ${NOISE_GLSL}
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vSurface = aSurface;
        // In object space the ring axis is the line (0, R, z), so height above
        // the floor and angle around the ring both fall out of the position.
        vec2 fromAxis = vec2(position.x, position.y - ${RING_RADIUS.toFixed(1)});
        vHeight = ${RING_RADIUS.toFixed(1)} - length(fromAxis);
        vTheta = atan(position.x, ${RING_RADIUS.toFixed(1)} - position.y);
        vLocalUp = normalize(normalMatrix * normalize(vec3(-fromAxis, 0.0)));
        vLocalAxial = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
        vViewPos = (modelViewMatrix * vec4(position, 1.0)).xyz;

        vSplat = aSplat;
        vCurvature = aCurvature;
        vAO = aAO;

        // District character, evaluated PER VERTEX rather than per pixel.
        //
        // These two fields have periods of about 2.4 km and 3.2 km. Vertices are
        // 22 m apart, so interpolating them across a triangle is exact to well
        // inside a colour step, and it moves six fbm octaves off a shader that
        // runs on most of the screen onto one that runs 165k times. This is the
        // cheapest six octaves in the file to give up.
        vRegion = vec2(
          rww_fbm(aSurface * 0.00042 + 3.1, 3),
          rww_fbm(aSurface * 0.00031 + 71.9, 3)
        );
        `,
      );

    // -------------------------------------------------------------- fragment
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uPanelPhase;
        uniform float uPanelSpan;
        uniform float uPanelSpacing;
        uniform float uHalfWidth;
        uniform vec3 uAmbientTint;
        uniform float uDetailFade;
        uniform int uFineOctaves;
        uniform float uTriplanarRim;
        uniform float uDustDrift;
        uniform float uMicroDetail;
        varying vec2 vSurface;
        varying float vHeight;
        varying float vTheta;
        varying vec3 vLocalUp;
        varying vec3 vLocalAxial;
        varying vec3 vViewPos;
        varying vec4 vSplat;
        varying float vCurvature;
        varying float vAO;
        varying vec2 vRegion;
        ${NOISE_GLSL}

        // Fraction of direct light reaching this point past the shadow squares.
        float rww_shadowBand(float theta) {
          float rel = mod(theta - uPanelPhase, uPanelSpacing);
          float d = min(rel, uPanelSpacing - rel);
          float occ = 1.0 - smoothstep(uPanelSpan * 0.5, uPanelSpan, d);
          return 1.0 - occ * 0.72;
        }

        /**
         * Projection weights in the RING's own frame: up, axial, spinward.
         *
         * This is the fix for the stretched rim walls that Task 6 deferred. A
         * near-vertical wall textured from (arc length, axial) alone gets the
         * floor projection smeared up its face, because the face barely moves in
         * those two coordinates while climbing 260 m.
         *
         * WHY NOT THE SHARED rww_triplanarWeights ON OBJECT-SPACE POSITION: on a
         * ring, object space is not aligned with local up. At theta = 0 up is +y
         * and at theta = 90 degrees up is +x, so a world-axis triplanar would
         * hand the three projections different roles depending on where you stand,
         * and the wall material would change character around the circumference.
         * The ring frame does not have that problem, and it reduces to blending
         * three 2D projections that all use coordinates already to hand:
         * (arc, axial) for the floor, (arc, height) and (axial, height) for walls.
         */
        vec3 rww_ringProjection(vec3 nrm, vec3 localUp, vec3 localAxial, float sharpness) {
          float up = abs(dot(nrm, localUp));
          float axial = abs(dot(nrm, localAxial));
          float spinward = sqrt(max(0.0, 1.0 - up * up - axial * axial));
          vec3 w = pow(vec3(up, axial, spinward), vec3(sharpness));
          return w / max(w.x + w.y + w.z, 1e-5);
        }
        `,
      )
      // ---- Albedo -------------------------------------------------------
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 su = vSurface;

        // Slope: how far the surface normal has tipped away from local up.
        vec3 rwwUp = normalize(vLocalUp);
        vec3 rwwNormal = normalize(vNormal);
        float slope = 1.0 - clamp(dot(rwwNormal, rwwUp), 0.0, 1.0);

        // --- Where each material goes: decided by the terrain, not by noise ---
        //
        // This is the change the whole terrain half of the overhaul was for. What
        // used to happen here was that the shader invented its own regions from
        // noise fields -- nBig, deckRegion, regA, regB -- that had nothing to do
        // with the landform being drawn. Dust could sit on a ridge crest; bared
        // deck could appear on a slope no water had ever run down. Material never
        // corresponded to shape because nothing connected the two.
        //
        // Terrain now answers the question itself, from erosion: dust where
        // sediment settled and the grade is gentle, rock where it is steep or flow
        // has stripped the cover, bared deck in the channels carrying the most
        // water, and the rim wall where the containment structure is. The weights
        // are a partition of unity, so they blend directly.
        vec4 rwwSplat = clamp(vSplat, 0.0, 1.0);

        // --- Per-pixel detail, and only what genuinely has to be per-pixel ----
        // Everything with a period longer than a couple of vertex spacings is
        // either baked or interpolated now.
        float nMid  = rww_fbm(su * 0.021, 3);
        float nFine = rww_fbm(su * 0.15, uFineOctaves);
        float nGrit = rww_vnoise(su * 1.1);

        // Large structural plates, not mud cracks. Small cells here read as a
        // dried-lakebed texture stretched over the whole world, which is the most
        // common way procedural ground gives itself away.
        //
        // Skipped outright where no deck is exposed. Worley is the most expensive
        // single field in this shader and most of the ring is under regolith.
        float cracks = 1.0;
        if (rwwSplat.z > 0.015) cracks = rww_cells(su * 0.0075);

        float hDust  = nMid * 0.6 + nFine * 0.4;
        float hRock  = nFine * 0.7 + nGrit * 0.3;
        float hPlate = 1.0 - smoothstep(0.04, 0.30, cracks);

        // --- Palette --------------------------------------------------------
        vec3 cDust  = mix(vec3(0.212, 0.190, 0.152), vec3(0.303, 0.272, 0.216), nFine);
        vec3 cRock  = mix(vec3(0.104, 0.110, 0.121), vec3(0.183, 0.185, 0.184), nGrit);
        vec3 cPlate = mix(vec3(0.068, 0.074, 0.083), vec3(0.117, 0.122, 0.128), nMid);
        vec3 cRim   = mix(vec3(0.148, 0.146, 0.140), vec3(0.219, 0.212, 0.199), nMid);

        // Oxidised copper staining in the low, damp places. A single warm hue
        // against all this grey is what keeps the palette from going dead.
        //
        // Driven by curvature and dust cover instead of its own noise field:
        // positive curvature is a bowl, and dust cover means sediment settled
        // there, so the two together are exactly "low and damp". Cheaper than the
        // three octaves it replaces, and it lands where the landform says it
        // should rather than wherever an unrelated field happened to peak.
        float damp = clamp(vCurvature * 1.7, 0.0, 1.0) * rwwSplat.x;
        cDust = mix(cDust, vec3(0.212, 0.117, 0.062), damp * 0.55);

        // Blend by height, not by alpha. Height blending is what gives transitions
        // interlocking, gritty edges instead of soft gradients.
        float m1 = rww_hblend(rwwSplat.x, hDust, rwwSplat.y, hRock, 0.9);
        vec3 albedo = mix(cDust, cRock, m1);
        float m2 = rww_hblend(rwwSplat.x + rwwSplat.y, 0.5, rwwSplat.z, hPlate, 0.8);
        albedo = mix(albedo, cPlate, m2 * 0.8);

        // --- Rim walls, in the ring's own projection --------------------------
        if (uTriplanarRim > 0.5 && rwwSplat.w > 0.015) {
          vec3 w = rww_ringProjection(rwwNormal, rwwUp, normalize(vLocalAxial), 4.0);
          // Floor projection is the one already in hand; the two wall projections
          // swap an in-plane axis for height, which is what stops the material
          // being smeared vertically up a 260 m face.
          float wallScale = 0.055;
          float grain =
              rww_fbm(su * wallScale, 3) * w.x
            + rww_fbm(vec2(su.x, vHeight) * wallScale, 3) * w.y
            + rww_fbm(vec2(su.y, vHeight) * wallScale, 3) * w.z;
          float seams =
              rww_grid(su / 18.0, 0.02) * w.x
            + rww_grid(vec2(su.x, vHeight) / 18.0, 0.02) * w.y
            + rww_grid(vec2(su.y, vHeight) / 18.0, 0.02) * w.z;
          vec3 cWall = mix(vec3(0.132, 0.131, 0.127), vec3(0.246, 0.238, 0.221), grain);
          cWall *= 1.0 - seams * 0.34;
          albedo = mix(albedo, cWall, rwwSplat.w);
        } else {
          albedo = mix(albedo, cRim, rwwSplat.w);
        }

        // --- Regional character ---------------------------------------------
        // Kilometre-scale zones so the ring reads as a place with districts rather
        // than one tone stretched 22 km. Without this the world is uniform grey
        // however good the close-up detail is, because at RTS range only the large
        // scales survive. Interpolated from the vertex stage now.
        float regA = vRegion.x;
        float regB = vRegion.y;
        albedo = mix(albedo, albedo * vec3(1.34, 1.28, 1.15), smoothstep(0.56, 0.86, regA));
        albedo = mix(albedo, albedo * vec3(0.55, 0.58, 0.66), smoothstep(0.58, 0.88, regB));
        float rust = smoothstep(0.62, 0.9, regA * regB * 2.2);
        albedo = mix(albedo, vec3(0.176, 0.088, 0.049), rust * 0.5);

        // --- Strata on exposed rock faces -------------------------------------
        // vHeight is metres above the ring floor and was plumbed through the vertex
        // stage without ever being read. Bedding planes are horizontal, so height
        // is exactly the right coordinate, and it is the cue that makes a steep
        // face read as cut rock rather than as tilted ground.
        float strata = rwwSplat.y * smoothstep(0.22, 0.58, slope);
        if (strata > 0.002) {
          float layer = 0.5 + 0.5 * sin(vHeight * 0.24 + nMid * 2.4);
          albedo *= mix(1.0, 0.84 + 0.32 * layer, strata);
        }

        // --- Panel lines ----------------------------------------------------
        // Two scales: structural bays and deck plates. Both darken slightly and
        // catch a highlight, which is most of what sells "machined".
        float bay   = rww_grid(su / 420.0, 0.006);
        float plate = rww_grid(su / 60.0, 0.014) * (0.25 + 0.75 * m2);
        float lines = clamp(bay * 0.8 + plate * 0.45, 0.0, 1.0);
        albedo *= 1.0 - lines * 0.30;

        // Cavity darkening along the plate joins, only where deck is exposed.
        albedo *= 1.0 - (1.0 - smoothstep(0.0, 0.05, cracks)) * 0.22 * rwwSplat.z;

        // --- Drifting dust ----------------------------------------------------
        // uTime was bound and never read. This is deliberately near the threshold
        // of noticing: dust creeping over the ground is a living-world cue, and
        // anything strong enough to see as motion would read as a bug.
        if (uDustDrift > 0.0) {
          float drift = rww_vnoise(su * 0.055 + vec2(uTime * 0.011, uTime * 0.004));
          albedo = mix(albedo, cDust * 1.07, rwwSplat.x * drift * 0.11 * uDustDrift);
        }

        // Fine grit variation so nothing is ever a flat colour.
        albedo *= 0.90 + 0.20 * nGrit;

        // Micro-grain, Ultra only.
        if (uMicroDetail > 0.0) {
          albedo *= 1.0 - uMicroDetail * 0.09 * rww_vnoise(su * 5.3);
        }

        diffuseColor.rgb *= albedo;
        `,
      )
      // ---- Roughness ------------------------------------------------------
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        {
          // Dust is very rough; exposed deck plating is smoother and wetter. The
          // deck mask is the baked splat channel rather than a fourth evaluation of
          // the same noise field the albedo used, and the variation term reuses
          // nMid instead of computing a fresh three-octave fbm at a similar scale.
          roughnessFactor = mix(0.97, 0.60, rwwSplat.z) - nMid * 0.10 + slope * 0.05;
          // Rim walls are structure, not sediment: harder and a little polished.
          roughnessFactor = mix(roughnessFactor, 0.55, rwwSplat.w * 0.6);
          roughnessFactor = clamp(roughnessFactor, 0.28, 1.0);
        }
        `,
      )
      // ---- Metalness ------------------------------------------------------
      .replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `
        float metalnessFactor = metalness;
        {
          // Both masks are baked, so this costs two multiplies where it used to
          // cost a four-octave fbm and a smoothstep over the axial coordinate.
          metalnessFactor = clamp(rwwSplat.z * 0.55 + rwwSplat.w * 0.45, 0.0, 0.85);
        }
        `,
      )
      // ---- Detail normals -------------------------------------------------
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        {
          // Derive a detail normal from the gradient of the same fields used
          // for albedo, so bumps and colour agree. Faded out with distance to
          // avoid shimmering on the far side of the ring.
          float dist = length(vViewPos);
          float fade = uDetailFade * (1.0 - smoothstep(220.0, 900.0, dist));
          if (fade > 0.001) {
            vec2 e = vec2(0.35, 0.0);
            float c0 = rww_fbm(vSurface * 0.22, uFineOctaves) + rww_vnoise(vSurface * 1.6) * 0.35;
            float cx = rww_fbm((vSurface + e.xy) * 0.22, uFineOctaves) + rww_vnoise((vSurface + e.xy) * 1.6) * 0.35;
            float cy = rww_fbm((vSurface + e.yx) * 0.22, uFineOctaves) + rww_vnoise((vSurface + e.yx) * 1.6) * 0.35;
            vec3 bump = normalize(vec3((c0 - cx) * 9.0 * fade, 1.0, (c0 - cy) * 9.0 * fade));
            // Rotate the tangent-space bump into the local surface frame.
            vec3 up = normalize(vLocalUp);
            vec3 t = normalize(cross(up, normalize(vLocalAxial)) + 1e-5);
            vec3 b = cross(up, t);
            normal = normalize(normal + (t * bump.x + b * bump.z) * 0.85);
          }
        }
        `,
      )
      // ---- Shadow squares occlude direct light only -----------------------
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        {
          // Baked sky occlusion, applied to INDIRECT light only.
          //
          // This is the placement Task 4 wanted and could not have. That pass works
          // from the depth buffer and had to be applied to the composite with a
          // luminance-protection window, because by then the direct and indirect
          // terms are already summed and there is nothing left to separate. Here
          // the occlusion arrives as a vertex attribute inside the lighting model,
          // while the two terms are still apart, so it can multiply the one it
          // physically belongs to and leave direct sunlight alone. Sunlit ground
          // stays sunlit; what darkens is the sky contribution into places that
          // cannot see much sky.
          float ao = mix(1.0, clamp(vAO, 0.0, 1.0), 0.9);
          reflectedLight.indirectDiffuse *= ao;
          reflectedLight.indirectSpecular *= ao;

          float band = rww_shadowBand(vTheta);
          reflectedLight.directDiffuse *= band;
          reflectedLight.directSpecular *= band;
          // A touch of cool bounce fills the shadow so it reads as shade rather
          // than as a hole in the world. Occluded too: it is sky light, and a
          // valley floor sees less of the sky than the ridge above it.
          reflectedLight.indirectDiffuse += uAmbientTint * (1.0 - band) * 0.055 * ao;
        }
        `,
      );
  };

  // Changing onBeforeCompile requires a fresh program key.
  // Changing onBeforeCompile requires a fresh program key. Tier differences are
  // uniform branches inside this one program rather than separate compilations, so
  // switching quality cannot grow the program set.
  material.customProgramCacheKey = () => 'rww-terrain-v3';

  return { material, uniforms };
}
