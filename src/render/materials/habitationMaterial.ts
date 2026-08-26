/**
 * Surface for inhabited, non-combat architecture.
 *
 * This exists to close the single largest coherence gap in the renderer. The
 * imported building models were the only geometry in the scene not wearing a
 * procedural surface: `AuthoredBuildingPilot` forced them to a flat `#927456`
 * albedo with roughness pinned at 0.9, so they stood next to hulls carrying
 * cast-metal grain, grime, streaking, panel relief and emissive strips, and read
 * as untextured clay. See the Key Finding in
 * `docs/procedural-graphics-overhaul.md`.
 *
 * WHY THIS CAN WORK AT ALL
 *
 * The models have vertex normals but no UVs and no embedded images, verified by
 * inspecting the GLB JSON chunks: every one reports `NORMAL` and none reports
 * `TEXCOORD_0`. That rules out shipping the source `building.png` entirely, since
 * there is no parameterisation to map it with. It also means every projection here
 * has to be triplanar in object space, which is exactly what
 * `surface.glsl.ts` provides.
 *
 * The palette is habitation rather than military: plaster and sandstone, masonry
 * courses, sun-bleached tops, grime running down from ledges, and lit windows.
 * `docs/art-direction.md` section 2 reserves saturated colour for factions, so
 * this stays low-chroma warm neutral and lets the amber and cyan keep their job.
 */

import * as THREE from 'three';
import { SURFACE_GLSL } from './surface.glsl';

export interface HabitationUniforms {
  /** Decorrelates one building from the next. */
  uSeed: { value: number };
  /** 0 in daylight, 1 at night. Drives window illumination. */
  uNightGlow: { value: number };
}

/** Warm interior light, deliberately dim and unsaturated so it cannot be mistaken
 *  for a faction accent at tactical zoom. */
const WINDOW_COLOR = new THREE.Color('#ffcE8a');

export function makeHabitationMaterial(seed: number): {
  material: THREE.MeshStandardMaterial;
  uniforms: HabitationUniforms;
} {
  const uniforms: HabitationUniforms = {
    uSeed: { value: seed % 1000 },
    uNightGlow: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    // Masonry and plaster. Kept non-metallic, which is both physically right and
    // keeps these buildings from competing with the machines for specular
    // attention.
    roughness: 0.92,
    metalness: 0.03,
    dithering: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vHabPos;
        varying vec3 vHabNormal;
        varying vec3 vHabTangent;
        varying vec3 vHabBitangent;
        // Deterministic tangent basis from a normal alone, recomputed identically
        // in the fragment stage. These models carry no tangents, and normalMatrix
        // is only declared in the vertex prefix, so this is how an object-space
        // gradient reaches view space.
        void rww_habBasis(vec3 n, out vec3 t, out vec3 b) {
          vec3 reference = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          t = normalize(cross(n, reference));
          b = cross(n, t);
        }
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vHabPos = position;
        vHabNormal = normal;
        {
          vec3 basisT;
          vec3 basisB;
          rww_habBasis(normalize(normal), basisT, basisB);
          vHabTangent = normalize(normalMatrix * basisT);
          vHabBitangent = normalize(normalMatrix * basisB);
        }
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uSeed;
        uniform float uNightGlow;
        varying vec3 vHabPos;
        varying vec3 vHabNormal;
        varying vec3 vHabTangent;
        varying vec3 vHabBitangent;
        void rww_habBasis(vec3 n, out vec3 t, out vec3 b) {
          vec3 reference = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          t = normalize(cross(n, reference));
          b = cross(n, t);
        }
        ${SURFACE_GLSL}

        /**
         * Wall coordinates for a vertical face.
         *
         * Picks whichever horizontal axis the normal points along least, so the
         * grid runs across the wall rather than into it. Without this, windows on
         * an x-facing wall would be laid out in the x plane and collapse to
         * stripes.
         */
        vec2 rww_wallUv(vec3 position, vec3 objectNormal) {
          return abs(objectNormal.x) > abs(objectNormal.z)
            ? vec2(position.z, position.y)
            : vec2(position.x, position.y);
        }

        /**
         * Horizontal masonry courses.
         *
         * One dimensional on purpose. rww_grid draws lines on both axes, so using it
         * here produced a grid: the vertical component read as corrugation down every
         * facade rather than as coursed stone.
         */
        float rww_courses(float height, float spacing, float width) {
          float f = abs(fract(height / spacing) - 0.5);
          return 1.0 - smoothstep(0.0, width, 0.5 - f);
        }

        /** Smooth window mask, for the relief field. Hard steps have no gradient. */
        float rww_windowMask(vec2 wall) {
          vec2 f = fract(wall);
          float x = smoothstep(0.16, 0.24, f.x) * (1.0 - smoothstep(0.62, 0.70, f.x));
          float y = smoothstep(0.24, 0.32, f.y) * (1.0 - smoothstep(0.70, 0.78, f.y));
          return x * y;
        }

        /**
         * Depth field for surface relief: recessed windows, masonry course lines,
         * and a coarse render texture.
         *
         * Higher means deeper. Sampled four times per fragment for a gradient, so
         * every term is smooth: the albedo pass can afford hard steps for the
         * window rectangles, but a step has a zero derivative everywhere and would
         * produce no relief at all.
         */
        float rww_habReliefField(vec3 position, vec3 objectNormal) {
          float vertical = smoothstep(0.55, 0.85, 1.0 - abs(objectNormal.y));
          vec2 wall = rww_wallUv(position, objectNormal) / vec2(3.1, 3.6);
          float windows = rww_windowMask(wall) * vertical;
          float course = rww_courses(position.y, 2.4, 0.16) * vertical;
          float render = rww_triplanarFbm(position, objectNormal, 0.9, 2, 4.0);
          return windows * 1.0 + course * 0.26 + render * 0.05;
        }
        `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec3 habNormal = normalize(vHabNormal);
        vec3 habPos = vHabPos;
        float up = clamp(habNormal.y, 0.0, 1.0);
        // Near-vertical faces are walls; everything else is roof, ledge or soffit.
        float vertical = smoothstep(0.55, 0.85, 1.0 - abs(habNormal.y));

        // --- Base plaster -----------------------------------------------------
        // Two scales of regional variation so a large facade is not one flat tone,
        // which is the specific failure the flat sandstone had.
        float macro = rww_triplanarFbm(habPos + uSeed, habNormal, 0.035, 3, 4.0);
        float meso  = rww_triplanarFbm(habPos + uSeed * 1.7, habNormal, 0.22, 3, 4.0);
        // Warm sandstone, and deliberately chromatic. A first pass used a paler,
        // more neutral plaster and the buildings came out washed out: measured
        // chromatic pixel fraction fell to 0.0008, an order of magnitude below the
        // flat albedo it replaced. Low-chroma is the rule for terrain, not for
        // architecture, and these still sit well under the faction accents.
        vec3 plasterPale = vec3(0.548, 0.428, 0.298);
        vec3 plasterDeep = vec3(0.316, 0.226, 0.152);
        vec3 albedo = mix(plasterDeep, plasterPale, macro * 0.65 + meso * 0.35);

        // Sun-bleaching on upward faces, and a cooler tone in shade. Modest, so it
        // lightens the tops without draining the hue out of them.
        albedo = mix(albedo, albedo * vec3(1.09, 1.05, 0.97), up * 0.5);

        // --- Masonry courses --------------------------------------------------
        // Horizontal banding on walls only. Courses are the strongest single cue
        // that a surface is built rather than moulded.
        float course = rww_courses(habPos.y, 2.4, 0.16);
        albedo *= 1.0 - course * 0.16 * vertical;

        // --- Structural bays --------------------------------------------------
        float bay = rww_triplanarPanels(habPos, habNormal, 0.085, 0.030, 4.0);
        albedo *= 1.0 - bay * 0.14;

        // --- Grime ------------------------------------------------------------
        // Pools where dust settles and runs down where water does. Both are keyed
        // off the surface's own orientation rather than off world height, so they
        // stay correct as a building is placed anywhere on the ring.
        float streak = rww_grimeStreak(habPos + uSeed * 0.31, up, 0.6);
        albedo *= 1.0 - (1.0 - up) * (1.0 - streak) * 0.26 * vertical;
        albedo = mix(albedo, albedo * vec3(0.78, 0.76, 0.72), up * 0.30 * meso);

        // --- Windows ----------------------------------------------------------
        // A regular grid punched into walls, with a per-cell hash deciding which
        // are occupied. The recess is darkened here; the light itself is added in
        // the emissive slot.
        vec2 wall = rww_wallUv(habPos, habNormal) / vec2(3.1, 3.6);
        vec2 cellId = floor(wall);
        vec2 cellFraction = fract(wall);
        float inWindow =
          step(0.20, cellFraction.x) * step(cellFraction.x, 0.66)
          * step(0.28, cellFraction.y) * step(cellFraction.y, 0.74);
        inWindow *= vertical;
        albedo = mix(albedo, vec3(0.055, 0.052, 0.058), inWindow * 0.85);

        diffuseColor.rgb *= albedo;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        {
          float grain = rww_triplanarFbm(vHabPos * 1.4, normalize(vHabNormal), 1.0, 2, 4.0);
          // Glass is the one smooth thing on these buildings.
          vec2 wall2 = rww_wallUv(vHabPos, normalize(vHabNormal)) / vec2(3.1, 3.6);
          vec2 fraction2 = fract(wall2);
          float glass =
            step(0.20, fraction2.x) * step(fraction2.x, 0.66)
            * step(0.28, fraction2.y) * step(fraction2.y, 0.74)
            * smoothstep(0.55, 0.85, 1.0 - abs(normalize(vHabNormal).y));
          roughnessFactor = clamp(roughness - grain * 0.14, 0.55, 1.0);
          roughnessFactor = mix(roughnessFactor, 0.22, glass);
        }
        `,
      )
      // Surface relief. Without this the window openings and masonry courses are
      // albedo-only: the buildings still read flat under a moving key light, which
      // was the remaining half of why they looked like clay. Same object-space
      // gradient approach as the hull material, for the same reason: no UVs, no
      // tangents, and no normalMatrix in the fragment prefix.
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        {
          vec3 reliefNormal = normalize(vHabNormal);
          float e = 0.12;
          float f0 = rww_habReliefField(vHabPos, reliefNormal);
          float fx = rww_habReliefField(vHabPos + vec3(e, 0.0, 0.0), reliefNormal);
          float fy = rww_habReliefField(vHabPos + vec3(0.0, e, 0.0), reliefNormal);
          float fz = rww_habReliefField(vHabPos + vec3(0.0, 0.0, e), reliefNormal);
          vec3 gradient = vec3(fx - f0, fy - f0, fz - f0) / e;
          gradient -= reliefNormal * dot(gradient, reliefNormal);
          vec3 basisT;
          vec3 basisB;
          rww_habBasis(reliefNormal, basisT, basisB);
          vec3 viewGradient = vHabTangent * dot(gradient, basisT) + vHabBitangent * dot(gradient, basisB);
          if (length(viewGradient) > 1e-5) {
            normal = normalize(normal - normalize(viewGradient) * 0.42);
          }
        }
        `,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        {
          vec3 habNormal2 = normalize(vHabNormal);
          float vertical2 = smoothstep(0.55, 0.85, 1.0 - abs(habNormal2.y));
          vec2 wall3 = rww_wallUv(vHabPos, habNormal2) / vec2(3.1, 3.6);
          vec2 cell3 = floor(wall3);
          vec2 fraction3 = fract(wall3);
          float inWindow3 =
            step(0.20, fraction3.x) * step(fraction3.x, 0.66)
            * step(0.28, fraction3.y) * step(fraction3.y, 0.74)
            * vertical2;
          // Roughly half the windows are occupied, and which half is stable per
          // building because the hash is seeded rather than time-varying.
          float occupied = step(0.46, rww_hash21(cell3 + uSeed));
          // Kept low so the post stage's bright pass does not treat a window as a
          // bloom source; these are lit rooms, not faction emitters.
          totalEmissiveRadiance += ${'vec3'}(${WINDOW_COLOR.r.toFixed(4)}, ${WINDOW_COLOR.g.toFixed(4)}, ${WINDOW_COLOR.b.toFixed(4)})
            * inWindow3 * occupied * uNightGlow * 0.85;
        }
        `,
      );
  };

  material.customProgramCacheKey = () => 'rww-habitation-v3';
  return { material, uniforms };
}
