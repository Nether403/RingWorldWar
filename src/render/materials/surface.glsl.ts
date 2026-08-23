/**
 * The shared procedural surface library.
 *
 * Before this existed there were two unrelated noise implementations in the
 * renderer: `NOISE_GLSL` in `terrainMaterial.ts` and the `hs_hash`/`hs_noise`
 * pair injected by `makeHullMaterial`. They used different hashes, different
 * interpolation, and different frequency conventions, so a terrain crack and a
 * hull scratch had no visual relationship to each other. The environmental
 * dressing had no procedural surface at all, and the imported buildings were
 * forced to a flat albedo.
 *
 * `docs/art-direction.md` section 0 rule 1 asks for coherence over detail. This
 * module is that rule expressed as code: one vocabulary, four consumers (terrain,
 * hulls, dressing, authored geometry).
 *
 * WHY TRIPLANAR AND OBJECT SPACE
 *
 * Every projection here works from a position and a normal rather than from a UV
 * set. That is what lets the same material run on generated geometry, on the ring
 * heightfield, and on imported glTF that carries no UVs at all, which is the
 * specific reason the authored buildings could not previously be given a real
 * surface. See Task 7 in `docs/procedural-graphics-overhaul.md`.
 *
 * Function bodies in `SURFACE_NOISE_GLSL` were moved verbatim from their previous
 * homes so the extraction step could be verified as visually neutral against the
 * Task 1 baselines before anything new was added. `rww_hash31` and `rww_vnoise3`
 * are the former `hs_hash` and `hs_noise` under the shared prefix.
 */

/**
 * Primitives. Cheap value noise rather than simplex throughout: at the
 * frequencies these are used the difference is invisible under a PBR response and
 * value noise is roughly three times faster.
 */
export const SURFACE_NOISE_GLSL = /* glsl */ `
  float rww_hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float rww_hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
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
  float rww_vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(rww_hash31(i), rww_hash31(i + vec3(1,0,0)), f.x),
          mix(rww_hash31(i + vec3(0,1,0)), rww_hash31(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(rww_hash31(i + vec3(0,0,1)), rww_hash31(i + vec3(1,0,1)), f.x),
          mix(rww_hash31(i + vec3(0,1,1)), rww_hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
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
  float rww_fbm3(vec3 p, int oct) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      s += a * rww_vnoise3(p);
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

/**
 * Projection and surface-character helpers built on the primitives.
 *
 * These are the additive half of the library: nothing here existed before, and
 * everything here is what makes one material able to dress generated and imported
 * geometry alike.
 */
export const SURFACE_DETAIL_GLSL = /* glsl */ `
  /**
   * Triplanar blend weights from a normal.
   *
   * The exponent controls how quickly a face commits to one projection. Low values
   * smear three projections together and lose detail; very high values produce a
   * visible seam along the 45-degree line. Four is the usual compromise.
   */
  vec3 rww_triplanarWeights(vec3 normal, float sharpness) {
    vec3 weights = pow(abs(normal), vec3(sharpness));
    return weights / max(weights.x + weights.y + weights.z, 1e-5);
  }

  /**
   * Triplanar FBM. Samples the same 2D field down each axis and blends, so a
   * vertical wall gets the same surface character as the floor instead of the
   * stretched smear a single planar projection produces.
   */
  float rww_triplanarFbm(vec3 position, vec3 normal, float scale, int oct, float sharpness) {
    vec3 w = rww_triplanarWeights(normal, sharpness);
    float x = rww_fbm(position.zy * scale, oct);
    float y = rww_fbm(position.xz * scale, oct);
    float z = rww_fbm(position.xy * scale, oct);
    return x * w.x + y * w.y + z * w.z;
  }

  /** Triplanar panel lining. Two scales read as structural bays and deck plates. */
  float rww_triplanarPanels(vec3 position, vec3 normal, float scale, float width, float sharpness) {
    vec3 w = rww_triplanarWeights(normal, sharpness);
    float x = rww_grid(position.zy * scale, width);
    float y = rww_grid(position.xz * scale, width);
    float z = rww_grid(position.xy * scale, width);
    return x * w.x + y * w.y + z * w.z;
  }

  /**
   * Gradient of a triplanar field, as a tangent-space normal perturbation.
   *
   * Finite differences rather than an analytic derivative, because the fields are
   * built from value noise and a grid function that has no useful derivative at
   * its discontinuities. epsilon is in the same units as position.
   */
  vec3 rww_surfaceNormal(
    vec3 position, vec3 normal, float scale, int oct, float epsilon, float strength
  ) {
    float centre = rww_triplanarFbm(position, normal, scale, oct, 4.0);
    float alongX = rww_triplanarFbm(position + vec3(epsilon, 0.0, 0.0), normal, scale, oct, 4.0);
    float alongZ = rww_triplanarFbm(position + vec3(0.0, 0.0, epsilon), normal, scale, oct, 4.0);
    return normalize(vec3((centre - alongX) * strength, 1.0, (centre - alongZ) * strength));
  }

  /**
   * Curvature-driven wear.
   *
   * Convex edges lose paint to contact; concave corners collect grime. This is the
   * pair of effects docs/procedural-assets.md section 2 identifies as the most
   * reliable way to stop a CG surface looking clean and fake, and it needs real
   * curvature rather than a noise threshold to land on the actual edges.
   *
   * curvature is signed: positive convex, negative concave, zero flat.
   */
  float rww_edgeWear(float curvature, float breakup, float amount) {
    float convex = smoothstep(0.15, 0.75, curvature);
    // Broken up by noise so the wear does not read as a uniform outline.
    return convex * mix(0.45, 1.0, breakup) * amount;
  }

  float rww_cavityGrime(float curvature, float amount) {
    return smoothstep(0.1, 0.7, -curvature) * amount;
  }

  /**
   * Grime that pools on upward faces and streaks down vertical ones.
   *
   * up is the cosine against the surface's own up direction, which on the ring
   * is the local radial rather than world +Y.
   */
  float rww_grimeStreak(vec3 position, float up, float scale) {
    // Stretched vertically so the pattern reads as run-off rather than as noise.
    float streak = rww_vnoise3(vec3(position.x * scale, position.y * scale * 0.08, position.z * scale));
    return mix(streak, 1.0, up);
  }
`;

/** Everything, for consumers that want the whole vocabulary. */
export const SURFACE_GLSL = `${SURFACE_NOISE_GLSL}\n${SURFACE_DETAIL_GLSL}`;
