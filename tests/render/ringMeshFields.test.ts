import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createTerrain, type Terrain } from '@gen/terrain';
import { RingMesh } from '@render/ringMesh';

/**
 * Task 9 bakes terrain's own answer for material and occlusion into static vertex
 * attributes. The terrain shader does not read them until Task 10, so nothing here
 * can be judged by looking at a frame. What can be judged is that the data is
 * present, correctly shaped, wrap-continuous, actually varying, and bounded in
 * memory.
 *
 * A full ring is 164,864 vertices and the terrain behind it takes over a second,
 * so the whole suite shares one build.
 */
function attributeOf(mesh: THREE.Mesh, name: string): THREE.BufferAttribute | null {
  const attribute = mesh.geometry.getAttribute(name);
  return attribute instanceof THREE.BufferAttribute ? attribute : null;
}

describe('baked terrain fields', { timeout: 120_000 }, () => {
  let terrain: Terrain;
  let full: RingMesh;
  let low: RingMesh;

  beforeAll(() => {
    terrain = createTerrain(6060);
    full = new RingMesh(terrain, 'high');
    low = new RingMesh(terrain, 'low');
  });

  it('emits splat, curvature, and occlusion on the full ring', () => {
    const position = attributeOf(full.mesh, 'position')!;
    const splat = attributeOf(full.mesh, 'aSplat');
    const curvature = attributeOf(full.mesh, 'aCurvature');
    const ambient = attributeOf(full.mesh, 'aAO');

    expect(splat).not.toBeNull();
    expect(curvature).not.toBeNull();
    expect(ambient).not.toBeNull();

    // One value per vertex. A shortfall would misalign every vertex past it and
    // subtly wrong the whole ring, with nothing else to reveal it.
    expect(splat!.count).toBe(position.count);
    expect(curvature!.count).toBe(position.count);
    expect(ambient!.count).toBe(position.count);
    expect(splat!.itemSize).toBe(4);

    // Quantised and normalised, so the shader sees 0..1 and -1..1 with no scaling
    // of its own.
    expect(splat!.array).toBeInstanceOf(Uint8Array);
    expect(curvature!.array).toBeInstanceOf(Int8Array);
    expect(ambient!.array).toBeInstanceOf(Uint8Array);
    expect(splat!.normalized).toBe(true);
    expect(curvature!.normalized).toBe(true);
    expect(ambient!.normalized).toBe(true);
  });

  it('keeps splat a partition of unity at every vertex', () => {
    // The shader blends straight from these weights, so a vertex that does not sum
    // to one either washes out or over-saturates. Bilinear sampling of a partition
    // of unity is itself a partition of unity, so any failure here is a real bug
    // rather than interpolation drift.
    const splat = attributeOf(full.mesh, 'aSplat')!.array as Uint8Array;
    let worst = 0;
    for (let at = 0; at < splat.length; at += 4) {
      const sum = (splat[at]! + splat[at + 1]! + splat[at + 2]! + splat[at + 3]!) / 255;
      const error = Math.abs(sum - 1);
      if (error > worst) worst = error;
    }
    // Tolerance is quantisation only: four channels each rounded to 1/255.
    expect(worst).toBeLessThanOrEqual(2 / 255);
  });

  it('agrees across the welded spinward seam', () => {
    // Column 0 and the last column are adjacent in the index buffer, so a field
    // sampled without wrapping shows up as a stripe running the ring's full width.
    // The comparison is against the ordinary neighbour-to-neighbour spread, since
    // adjacent columns are 22 m apart and are supposed to differ a little.
    const splat = attributeOf(full.mesh, 'aSplat')!.array as Uint8Array;
    const ambient = attributeOf(full.mesh, 'aAO')!.array as Uint8Array;
    const position = attributeOf(full.mesh, 'position')!;
    const cols = 1024;
    const rows = position.count / cols - 1;
    expect(Number.isInteger(rows)).toBe(true);

    let seamWorst = 0;
    let interiorWorst = 0;
    for (let j = 0; j <= rows; j++) {
      const first = j * cols;
      const last = first + cols - 1;
      for (let channel = 0; channel < 4; channel++) {
        const seam = Math.abs(splat[first * 4 + channel]! - splat[last * 4 + channel]!);
        if (seam > seamWorst) seamWorst = seam;
        const interior = Math.abs(splat[(first + 1) * 4 + channel]! - splat[first * 4 + channel]!);
        if (interior > interiorWorst) interiorWorst = interior;
      }
      const seamAmbient = Math.abs(ambient[first]! - ambient[last]!);
      if (seamAmbient > seamWorst) seamWorst = seamAmbient;
    }
    // The seam must be no worse than the roughest ordinary neighbouring pair, with
    // a little slack. A non-wrapping sample would blow straight past this.
    expect(seamWorst).toBeLessThanOrEqual(Math.max(40, interiorWorst * 1.5));
  });

  it('finds real enclosure, not a constant', () => {
    // Sky visibility that came out uniform would mean the horizon walk is broken
    // and the attribute is dead weight. The rim walls alone guarantee a spread:
    // open ring floor against the foot of a 260 m wall.
    const ambient = attributeOf(full.mesh, 'aAO')!.array as Uint8Array;
    let minimum = 255;
    let maximum = 0;
    let sum = 0;
    for (const value of ambient) {
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
      sum += value;
    }
    expect(maximum).toBeGreaterThan(240);
    expect(minimum).toBeLessThan(190);
    // Most of the ring is open ground, so the mean has to sit high. A low mean
    // would mean the whole world was darkened rather than just its hollows.
    expect(sum / ambient.length / 255).toBeGreaterThan(0.85);
  });

  it('carries curvature of both signs', () => {
    const curvature = attributeOf(full.mesh, 'aCurvature')!.array as Int8Array;
    let minimum = 127;
    let maximum = -128;
    for (const value of curvature) {
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    // Bowls and crests both have to survive quantisation, or the edge-wear term in
    // Task 12 has nothing to key off.
    expect(minimum).toBeLessThan(-6);
    expect(maximum).toBeGreaterThan(6);
    // -128 is unrepresentable under Int8 normalisation. Clamping to -127 is what
    // stops a deep bowl wrapping around to read as a crest.
    expect(minimum).toBeGreaterThanOrEqual(-127);
  });

  it('leaves the frozen Low geometry as it was', () => {
    // The T480s 720p Low budget is frozen. Low runs a separate ShaderMaterial with
    // its own shaders which will not read these attributes, so baking them there
    // would be VRAM spent on data nothing samples.
    expect(attributeOf(low.mesh, 'aSplat')).toBeNull();
    expect(attributeOf(low.mesh, 'aCurvature')).toBeNull();
    expect(attributeOf(low.mesh, 'aAO')).toBeNull();
    expect(attributeOf(low.mesh, 'aSurface')).not.toBeNull();
  });

  it('holds the added geometry memory inside a stated bound', () => {
    // The arithmetic, so the numbers below are checkable rather than folklore.
    // 1024 columns x 161 rows = 164,864 vertices.
    //   existing attributes  position 12 + normal 12 + uv 8 + aSurface 8 = 40 B
    //                        = 6,594,560 B
    //   index                1024 x 160 quads x 6 indices x 4 B = 3,932,160 B
    //   added, quantised     aSplat 4 + aCurvature 1 + aAO 1 = 6 B = 989,184 B
    //   total                11,515,904 B, of which the new fields are 8.6%
    // At float32 the same three fields would be 24 B a vertex, 3,956,736 B, and
    // would take the geometry to 14.5 MB. That 3 MB is the whole reason for the
    // quantisation.
    const vertices = attributeOf(full.mesh, 'position')!.count;
    expect(vertices).toBe(1024 * 161);

    const added = vertices * 6;
    expect(added).toBeLessThan(1_000_000);

    let total = 0;
    for (const attribute of Object.values(full.mesh.geometry.attributes)) {
      if (attribute instanceof THREE.BufferAttribute) total += attribute.array.byteLength;
    }
    const index = full.mesh.geometry.getIndex();
    if (index) total += index.array.byteLength;

    // A later change that reverts these to float32, or adds another channel, has
    // to come and argue with these numbers rather than quietly growing the mesh.
    expect(total).toBeLessThan(11_600_000);
    expect(added / total).toBeLessThan(0.09);
  });
});
