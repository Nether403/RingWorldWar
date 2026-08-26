import { describe, expect, it } from 'vitest';
import { applyTerrainQuality, makeLowTerrainMaterial, makeTerrainMaterial } from '../../src/render/materials/terrainMaterial';
import { QUALITY } from '../../src/render/renderer';

describe('terrain presentation calibration', () => {
  it('uses the same readable shadow-square depth in Low and full terrain', () => {
    const full = makeTerrainMaterial();
    const low = makeLowTerrainMaterial(full.uniforms);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: [
      '#include <common>',
      '#include <map_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <metalnessmap_fragment>',
      '#include <normal_fragment_maps>',
      '#include <lights_fragment_end>',
    ].join('\n') };
    full.material.onBeforeCompile(shader as never, {} as never);

    expect(low.fragmentShader).toContain('uPanelSpan * 0.5');
    expect(low.fragmentShader).toContain('* 0.72');
    expect(shader.fragmentShader).toContain('uPanelSpan * 0.5');
    expect(shader.fragmentShader).toContain('occ * 0.72');
  });

  it('keeps slope and detail-normal frames in view space', () => {
    const terrain = makeTerrainMaterial();
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: [
      '#include <common>',
      '#include <map_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <metalnessmap_fragment>',
      '#include <normal_fragment_maps>',
      '#include <lights_fragment_end>',
    ].join('\n') };
    terrain.material.onBeforeCompile(shader as never, {} as never);

    expect(shader.vertexShader).toContain('normalMatrix * normalize');
    expect(shader.vertexShader).toContain('vLocalAxial = normalize(normalMatrix');
    expect(shader.fragmentShader).toContain('cross(up, normalize(vLocalAxial))');
    expect(terrain.material.customProgramCacheKey()).toBe('rww-terrain-v3');
  });

  it('takes its regions from the baked fields instead of inventing them', () => {
    // The whole point of Tasks 8 to 10: material follows the landform because
    // terrain decides where material goes. If any of these low-frequency fields
    // comes back into the fragment stage, the shader has started inventing its own
    // regions again, and the cost comes back with it.
    const shader = compile();

    expect(shader.vertexShader).toContain('attribute vec4 aSplat');
    expect(shader.vertexShader).toContain('attribute float aCurvature');
    expect(shader.vertexShader).toContain('attribute float aAO');

    const fragment = shader.fragmentShader;
    // The four fields that used to decide regions from unrelated noise.
    // Matched as declarations, not as text: the comments in the shader name these
    // fields to explain why they are gone, and a plain substring search finds the
    // explanation.
    expect(fragment).not.toMatch(/float\s+deckRegion/);
    expect(fragment).not.toMatch(/float\s+nBig/);
    expect(fragment).not.toMatch(/float\s+regA\s*=\s*rww_fbm/);
    expect(fragment).not.toMatch(/float\s+regB\s*=\s*rww_fbm/);
    // The 0.0026 field was evaluated four separate times: albedo, roughness, and
    // metalness twice over. None of them should remain.
    expect(fragment).not.toContain('0.0026');
    expect(fragment).not.toContain('0.00036');
    // Districts moved to the vertex stage, where interpolation is exact.
    expect(shader.vertexShader).toContain('0.00042');
    expect(shader.vertexShader).toContain('0.00031');
    expect(fragment).toContain('float regA = vRegion.x');
  });

  it('occludes indirect light only, and leaves direct sunlight alone', () => {
    // Task 4 had to apply its depth-derived AO to the composite with a luminance
    // window, because the direct and indirect terms were already summed by then.
    // The baked term arrives inside the lighting model, so it can be put on the
    // term it physically belongs to. A regression that multiplies directDiffuse by
    // AO would flatten sunlit ground.
    const fragment = compile().fragmentShader;
    expect(fragment).toContain('reflectedLight.indirectDiffuse *= ao');
    expect(fragment).not.toMatch(/reflectedLight\.directDiffuse \*= ao/);
  });

  it('gives every tier above Low a different terrain cost', () => {
    // Medium and Ultra were byte-identical before this task. Each flag has to
    // actually differ somewhere, or the tier selector is decoration.
    const tiers = ['medium', 'high', 'ultra'] as const;
    const signatures = tiers.map((tier) => {
      const quality = QUALITY[tier];
      return [
        quality.terrainFineOctaves,
        quality.terrainTriplanarRim,
        quality.terrainDustDrift,
        quality.terrainMicroDetail,
        quality.detailFade,
      ].join('/');
    });
    expect(new Set(signatures).size).toBe(tiers.length);

    // And the flags have to reach the uniforms.
    const terrain = makeTerrainMaterial();
    applyTerrainQuality(terrain.uniforms, QUALITY.medium);
    expect(terrain.uniforms.uFineOctaves.value).toBe(2);
    expect(terrain.uniforms.uTriplanarRim.value).toBe(0);
    expect(terrain.uniforms.uMicroDetail.value).toBe(0);
    applyTerrainQuality(terrain.uniforms, QUALITY.ultra);
    expect(terrain.uniforms.uFineOctaves.value).toBe(3);
    expect(terrain.uniforms.uTriplanarRim.value).toBe(1);
    expect(terrain.uniforms.uMicroDetail.value).toBe(1);
  });

  it('guards each tier flag against work it cannot skip', () => {
    // Uniform branches only save time if the expensive body is inside them.
    const fragment = compile().fragmentShader;
    expect(fragment).toContain('if (uTriplanarRim > 0.5 && rwwSplat.w > 0.015)');
    expect(fragment).toContain('if (uDustDrift > 0.0)');
    expect(fragment).toContain('if (uMicroDetail > 0.0)');
    // Worley is the most expensive field here and most of the ring has no bared
    // deck, so it has to be behind a gate too.
    expect(fragment).toContain('if (rwwSplat.z > 0.015) cracks = rww_cells');
  });

  it('reads the two varyings that were plumbed but never used', () => {
    const fragment = compile().fragmentShader;
    // vHeight drives strata; uTime drives the dust drift.
    expect(fragment).toContain('sin(vHeight * 0.24');
    expect(fragment).toContain('uTime * 0.011');
  });

  it('leaves the frozen Low material untouched by any of it', () => {
    // Low is a separate ShaderMaterial. It must not gain an attribute, a uniform
    // branch, or a baked field, because its geometry carries none of them.
    const low = makeLowTerrainMaterial(makeTerrainMaterial().uniforms);
    for (const source of [low.vertexShader, low.fragmentShader]) {
      expect(source).not.toContain('aSplat');
      expect(source).not.toContain('aCurvature');
      expect(source).not.toContain('aAO');
      expect(source).not.toContain('uFineOctaves');
      expect(source).not.toContain('uTriplanarRim');
    }
  });
});

function compile(): { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string } {
  const terrain = makeTerrainMaterial();
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: [
      '#include <common>',
      '#include <map_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <metalnessmap_fragment>',
      '#include <normal_fragment_maps>',
      '#include <lights_fragment_end>',
    ].join('\n'),
  };
  terrain.material.onBeforeCompile(shader as never, {} as never);
  return shader;
}
