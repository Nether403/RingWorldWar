import { describe, expect, it } from 'vitest';
import { makeLowTerrainMaterial, makeTerrainMaterial } from '../../src/render/materials/terrainMaterial';

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
    expect(terrain.material.customProgramCacheKey()).toBe('rww-terrain-v2');
  });
});
