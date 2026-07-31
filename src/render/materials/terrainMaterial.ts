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

export interface TerrainUniforms {
  uTime: { value: number };
  uPanelPhase: { value: number };
  uPanelSpan: { value: number };
  uAmbientTint: { value: THREE.Color };
  uDetailFade: { value: number };
}

/** Shared GLSL: cheap value noise. Simplex is nicer but this is 3x faster and
 *  at these frequencies the difference is invisible under a PBR response. */
const NOISE_GLSL = /* glsl */ `
  float rww_hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float rww_vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = rww_hash21(i);
    float b = rww_hash21(i + vec2(1.0, 0.0));
    float c = rww_hash21(i + vec2(0.0, 1.0));
    float d = rww_hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float rww_fbm(vec2 p, int oct) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      s += a * rww_vnoise(p);
      n += a;
      p *= 2.03;
      a *= 0.5;
    }
    return s / max(n, 1e-4);
  }
  // Worley-ish cell borders, used for cracked plating.
  float rww_cells(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(rww_hash21(i + g), rww_hash21(i + g + 17.3));
        float d = length(g + o - f);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
      }
    }
    return f2 - f1;
  }
  // Distance to the nearest line of a grid, in cell units.
  float rww_grid(vec2 p, float width) {
    vec2 g = abs(fract(p) - 0.5);
    float d = 0.5 - max(g.x, g.y);
    return 1.0 - smoothstep(0.0, width, d);
  }
  /**
   * Height-based blend. Given two layers with weights and heights, pick the one
   * that "stands proud". This is what gives splat transitions a real edge.
   */
  float rww_hblend(float wa, float ha, float wb, float hb, float sharpness) {
    float a = wa + ha * sharpness;
    float b = wb + hb * sharpness;
    float m = max(a, b) - 0.12;
    float ca = max(a - m, 0.0);
    float cb = max(b - m, 0.0);
    return cb / max(ca + cb, 1e-5);
  }
`;

export function makeTerrainMaterial(): {
  material: THREE.MeshStandardMaterial;
  uniforms: TerrainUniforms;
} {
  const uniforms: TerrainUniforms = {
    uTime: { value: 0 },
    uPanelPhase: { value: 0 },
    uPanelSpan: { value: 0.19 },
    uAmbientTint: { value: new THREE.Color('#8ea6bd') },
    uDetailFade: { value: 1 },
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
        varying vec2 vSurface;
        varying float vHeight;
        varying float vTheta;
        varying vec3 vLocalUp;
        varying vec3 vViewPos;
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
        vLocalUp = normalize(vec3(-fromAxis, 0.0));
        vViewPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
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
        varying vec2 vSurface;
        varying float vHeight;
        varying float vTheta;
        varying vec3 vLocalUp;
        varying vec3 vViewPos;
        ${NOISE_GLSL}

        // Fraction of direct light reaching this point past the shadow squares.
        float rww_shadowBand(float theta) {
          float rel = mod(theta - uPanelPhase, uPanelSpacing);
          float d = min(rel, uPanelSpacing - rel);
          float occ = 1.0 - smoothstep(uPanelSpan * 0.55, uPanelSpan, d);
          return 1.0 - occ * 0.94;
        }
        `,
      )
      // ---- Albedo -------------------------------------------------------
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 su = vSurface;

        // Slope: how far the surface normal has tipped away from local up.
        float slope = 1.0 - clamp(dot(normalize(vNormal), normalize(vLocalUp)), 0.0, 1.0);
        float rimT = smoothstep(0.80, 0.97, abs(su.y) / uHalfWidth);

        // --- Per-layer detail heights -------------------------------------
        float nBig    = rww_fbm(su * 0.0026, 4);
        float nMid    = rww_fbm(su * 0.021, 4);
        float nFine   = rww_fbm(su * 0.15, 3);
        float nGrit   = rww_vnoise(su * 1.1);
        // Large structural plates, not mud cracks. Small cells here read as a
        // dried-lakebed texture stretched over the whole world, which is the
        // most common way procedural ground gives itself away.
        float cracks  = rww_cells(su * 0.0075);

        float hDust  = nMid * 0.6 + nFine * 0.4;
        float hRock  = nFine * 0.7 + nGrit * 0.3;
        float hPlate = 1.0 - smoothstep(0.04, 0.30, cracks);

        // --- Layer weights --------------------------------------------------
        // Dust collects on flats; rock shows on slopes; the megastructure deck
        // shows through where the regolith has been scoured away.
        float wDust  = (1.0 - slope * 2.4) * (0.55 + nBig * 0.9);
        float wRock  = slope * 2.2 + nBig * 0.35;
        // Exposed deck is a regional feature, not a global one. Gated hard so
        // the cell pattern appears in a few scoured districts instead of
        // tiling the entire 22 km of world, which is what makes procedural
        // ground look procedural.
        float deckRegion = smoothstep(0.60, 0.80, rww_fbm(su * 0.00036 + 41.3, 3));
        float wPlate = smoothstep(0.70, 0.97, nBig) * (1.0 - slope * 1.6) * deckRegion;
        wDust  = max(wDust, 0.0);
        wRock  = max(wRock, 0.0);
        wPlate = max(wPlate, 0.0);

        // --- Palette --------------------------------------------------------
        vec3 cDust  = mix(vec3(0.212, 0.190, 0.152), vec3(0.303, 0.272, 0.216), nFine);
        vec3 cRock  = mix(vec3(0.104, 0.110, 0.121), vec3(0.183, 0.185, 0.184), nGrit);
        vec3 cPlate = mix(vec3(0.068, 0.074, 0.083), vec3(0.117, 0.122, 0.128), nMid);
        vec3 cRim   = mix(vec3(0.148, 0.146, 0.140), vec3(0.219, 0.212, 0.199), nMid);

        // Oxidised copper staining in the low, damp places. A single warm hue
        // against all this grey is what keeps the palette from going dead.
        float ox = smoothstep(0.55, 0.95, rww_fbm(su * 0.0075 + 13.7, 3)) * (1.0 - slope * 1.4);
        cDust = mix(cDust, vec3(0.212, 0.117, 0.062), ox * 0.6);

        // Blend by height, not by alpha.
        float m1 = rww_hblend(wDust, hDust, wRock, hRock, 0.9);
        vec3 albedo = mix(cDust, cRock, m1);
        float m2 = rww_hblend(1.0 - wPlate, 0.5, wPlate, hPlate, 0.8) * deckRegion;
        albedo = mix(albedo, cPlate, m2 * 0.7);
        albedo = mix(albedo, cRim, rimT);

        // --- Regional character ---------------------------------------------
        // Kilometre-scale zones so the ring reads as a place with districts
        // rather than one tone stretched 22 km. Without this the world is
        // uniform grey however good the close-up detail is, because at RTS
        // range only the large scales survive.
        float regA = rww_fbm(su * 0.00042 + 3.1, 3);
        float regB = rww_fbm(su * 0.00031 + 71.9, 3);
        // Pale ash flats.
        albedo = mix(albedo, albedo * vec3(1.34, 1.28, 1.15), smoothstep(0.56, 0.86, regA));
        // Dark burnt scrith.
        albedo = mix(albedo, albedo * vec3(0.55, 0.58, 0.66), smoothstep(0.58, 0.88, regB));
        // Deep rust belts, where the two overlap.
        float rust = smoothstep(0.62, 0.9, regA * regB * 2.2);
        albedo = mix(albedo, vec3(0.176, 0.088, 0.049), rust * 0.5);

        // --- Panel lines ----------------------------------------------------
        // Two scales: structural bays and deck plates. Both darken slightly and
        // catch a highlight, which is most of what sells "machined".
        float bay   = rww_grid(su / 420.0, 0.006);
        float plate = rww_grid(su / 60.0, 0.014) * (0.25 + 0.75 * m2);
        float lines = clamp(bay * 0.8 + plate * 0.45, 0.0, 1.0);
        albedo *= 1.0 - lines * 0.30;

        // Cavity darkening along the plate joins, only where deck is exposed.
        albedo *= 1.0 - (1.0 - smoothstep(0.0, 0.05, cracks)) * 0.20 * deckRegion;

        // Fine grit variation so nothing is ever a flat colour.
        albedo *= 0.90 + 0.20 * nGrit;

        diffuseColor.rgb *= albedo;
        `,
      )
      // ---- Roughness ------------------------------------------------------
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        {
          float slope2 = 1.0 - clamp(dot(normalize(vNormal), normalize(vLocalUp)), 0.0, 1.0);
          float nR = rww_fbm(vSurface * 0.045, 3);
          // Dust is very rough; exposed deck plating is smoother and wetter.
          float deck = smoothstep(0.62, 0.95, rww_fbm(vSurface * 0.0026, 4));
          roughnessFactor = mix(0.97, 0.62, deck) - nR * 0.10 + slope2 * 0.05;
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
          float deck = smoothstep(0.66, 0.98, rww_fbm(vSurface * 0.0026, 4));
          float rimT2 = smoothstep(0.80, 0.97, abs(vSurface.y) / uHalfWidth);
          metalnessFactor = clamp(deck * 0.55 + rimT2 * 0.45, 0.0, 0.85);
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
            float c0 = rww_fbm(vSurface * 0.22, 3) + rww_vnoise(vSurface * 1.6) * 0.35;
            float cx = rww_fbm((vSurface + e.xy) * 0.22, 3) + rww_vnoise((vSurface + e.xy) * 1.6) * 0.35;
            float cy = rww_fbm((vSurface + e.yx) * 0.22, 3) + rww_vnoise((vSurface + e.yx) * 1.6) * 0.35;
            vec3 bump = normalize(vec3((c0 - cx) * 9.0 * fade, 1.0, (c0 - cy) * 9.0 * fade));
            // Rotate the tangent-space bump into the local surface frame.
            vec3 up = normalize(vLocalUp);
            vec3 t = normalize(cross(up, vec3(0.0, 0.0, 1.0)) + 1e-5);
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
          float band = rww_shadowBand(vTheta);
          reflectedLight.directDiffuse *= band;
          reflectedLight.directSpecular *= band;
          // A touch of cool bounce fills the shadow so it reads as shade rather
          // than as a hole in the world.
          reflectedLight.indirectDiffuse += uAmbientTint * (1.0 - band) * 0.055;
        }
        `,
      );
  };

  // Changing onBeforeCompile requires a fresh program key.
  material.customProgramCacheKey = () => 'rww-terrain-v1';

  return { material, uniforms };
}
