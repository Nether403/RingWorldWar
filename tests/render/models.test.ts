import * as THREE from 'three';
import { buildMech, buildStructure, makeHullMaterial, type MechClass, type StructureKind } from '@gen/models';
import { describe, expect, it } from 'vitest';

describe('procedural hull geometry', () => {
  it('presents the near exterior of a structure to FrontSide rendering', () => {
    const model = buildStructure('extractor', 17);
    const mesh = new THREE.Mesh(
      model.geometry,
      new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
    );
    mesh.updateMatrixWorld(true);
    const normals = model.geometry.getAttribute('normal');

    const sideHits = new THREE.Raycaster(
      new THREE.Vector3(100, 7, 0),
      new THREE.Vector3(-1, 0, 0),
    ).intersectObject(mesh);
    const topHits = new THREE.Raycaster(
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(mesh);

    expect(sideHits[0]?.point.x).toBeGreaterThan(0);
    expect(topHits[0]?.point.y).toBeGreaterThan(5);
    expect(normals.getY(0)).toBeLessThan(0);
    expect(normals.getY(4)).toBeGreaterThan(0);
    for (let index = 0; index < normals.count; index++) {
      expect(Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index))).toBeGreaterThan(0.99);
    }
  });

  it('builds distinct valid Bulwark and Needle silhouettes', () => {
    const bulwark = buildMech('bulwark', 18);
    const needle = buildMech('needle', 18);

    expect(bulwark.height).toBeGreaterThan(needle.height);
    expect(bulwark.radius).toBeGreaterThan(needle.radius);
    expect(bulwark.parts.torso.getAttribute('position').count).toBeGreaterThan(0);
    expect(needle.parts.torso.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('adds faction geometry without changing mech rig authority metadata', () => {
    const compact = buildMech('vanguard', 19, 'compact');
    const choir = buildMech('vanguard', 19, 'choir');

    expect(compact.parts.torso.getAttribute('position').count)
      .not.toBe(choir.parts.torso.getAttribute('position').count);
    expect({
      height: compact.height,
      radius: compact.radius,
      hipOffset: compact.hipOffset,
      hipHeight: compact.hipHeight,
      legUpper: compact.legUpper,
      legLower: compact.legLower,
      muzzles: compact.muzzles.map((muzzle) => muzzle.toArray()),
    }).toEqual({
      height: choir.height,
      radius: choir.radius,
      hipOffset: choir.hipOffset,
      hipHeight: choir.hipHeight,
      legUpper: choir.legUpper,
      legLower: choir.legLower,
      muzzles: choir.muzzles.map((muzzle) => muzzle.toArray()),
    });
  });

  it('adds faction structure grammar without changing gameplay metadata', () => {
    const compact = buildStructure('fabricator', 20, 'compact');
    const choir = buildStructure('fabricator', 20, 'choir');
    const neutralNode = buildStructure('spinalNode', 20, 'neutral');

    expect(compact.geometry.getAttribute('position').count)
      .not.toBe(choir.geometry.getAttribute('position').count);
    expect({ radius: compact.radius, height: compact.height, muzzles: compact.muzzles })
      .toEqual({ radius: choir.radius, height: choir.height, muzzles: choir.muzzles });
    expect(neutralNode.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('compiles faction style and per-instance damage through one hull program', () => {
    const hull = makeHullMaterial(0xf0821e, -1);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: [
      '#include <common>',
      '#include <map_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <emissivemap_fragment>',
    ].join('\n') };
    hull.material.onBeforeCompile(shader as never, {} as never);

    expect(shader.vertexShader).toContain('attribute float instanceDamage');
    // Phase and weathering share one vec2, because a third instanced attribute
    // costs a buffer upload per frame per mesh and broke the Low frame budget.
    expect(shader.vertexShader).toContain('attribute vec2 instanceVariation');
    expect(shader.vertexShader).toContain('vInstancePhase = instanceVariation.x');
    expect(shader.vertexShader).toContain('vWear.z = instanceVariation.y');
    expect(shader.fragmentShader).toContain('uniform float uFactionStyle');
    expect(shader.fragmentShader).toContain('uniform float uTime');
    expect(shader.fragmentShader).toContain('flickerPulse');
    expect(shader.fragmentShader).toContain('rww_damage()');
    expect(hull.material.customProgramCacheKey()).toBe('rww-hull-v5');
  });
});

/**
 * Task 11 added inset channels, swept tubes, and hydraulic rams to the primitive
 * vocabulary. Two properties are worth asserting that nothing asserted before.
 */
const MECH_CLASSES: MechClass[] = ['vanguard', 'longbow', 'wisp', 'aegis', 'bulwark', 'needle'];
const STRUCTURE_KINDS: StructureKind[] = [
  'bastion', 'extractor', 'solarArray', 'fusionCore', 'fabricator', 'mechFoundry',
  'rocketBattery', 'pointDefense', 'laserGrid', 'radarMast', 'silo', 'spinalNode',
];

/**
 * Count how many times each undirected edge appears, keyed on rounded POSITION
 * rather than on vertex index.
 *
 * Index keying would be useless here: MeshBuilder pushes four fresh vertices per
 * quad so that every face can carry its own flat normal, which means no two faces
 * ever share an index even where they share an edge in space.
 */
function edgeUseCounts(geometry: THREE.BufferGeometry): Map<string, number> {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const key = (at: number): string => {
    const x = Math.round(position.getX(at) * 10_000) / 10_000;
    const y = Math.round(position.getY(at) * 10_000) / 10_000;
    const z = Math.round(position.getZ(at) * 10_000) / 10_000;
    return `${x},${y},${z}`;
  };
  const counts = new Map<string, number>();
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const corners = [key(index.getX(triangle)), key(index.getX(triangle + 1)), key(index.getX(triangle + 2))];
    for (let corner = 0; corner < 3; corner++) {
      const a = corners[corner]!;
      const b = corners[(corner + 1) % 3]!;
      if (a === b) continue; // Degenerate; counted separately below.
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }
  }
  return counts;
}

describe('primitive vocabulary integrity', () => {
  it('closes every surface it builds', () => {
    // A closed surface has every edge shared by exactly two triangles. This is
    // what catches an open primitive, and it caught two real ones: addCylinder
    // emitted only a top cap, so every piston and mast in the game was a tube open
    // at the bottom; and the vertical inset channels terminated at their band
    // boundary as an open slot, because the recessed floor ended while the wall
    // either side of it did not.
    //
    // Interpenetration is fine for this check. A greeble sitting half inside a
    // hull, or a ram passing through a thigh, is two closed shells overlapping, and
    // each still contributes a closed surface of its own.
    for (const cls of MECH_CLASSES) {
      const rig = buildMech(cls, 18, 'compact');
      for (const [name, geometry] of Object.entries(rig.parts)) {
        const open = [...edgeUseCounts(geometry).entries()].filter(([, uses]) => uses !== 2);
        expect(open.slice(0, 4), `${cls} ${name} has ${open.length} unpaired edges`).toEqual([]);
      }
    }
    for (const kind of STRUCTURE_KINDS) {
      const model = buildStructure(kind, 22, 'compact');
      const open = [...edgeUseCounts(model.geometry).entries()].filter(([, uses]) => uses !== 2);
      expect(open.slice(0, 4), `${kind} has ${open.length} unpaired edges`).toEqual([]);
    }
  });

  it('holds every class inside its triangle budget', () => {
    // Budgets exist because mech geometry is built once and used at every quality:
    // there is no per-tier mech mesh, so anything added here lands on the frozen
    // T480s Low frame budget too.
    //
    // That is not hypothetical. The first version of this task put inset channels
    // on the thighs and shins and a second ram on each thigh, which took the mean
    // mech from 1,810 to 2,607 triangles and the Low frame p95 from 16.8 ms to
    // 33.3 ms -- dropped frames. Limb detail was removed because at tactical range
    // a channel in a sub-metre shin is sub-pixel, and the mean came back to 2,035.
    //
    // Ceilings are the measured values plus about 12% of headroom.
    const budgets: Record<MechClass, number> = {
      vanguard: 2_350,
      longbow: 2_350,
      wisp: 2_150,
      aegis: 2_450,
      bulwark: 2_400,
      needle: 2_100,
    };
    let total = 0;
    for (const cls of MECH_CLASSES) {
      const rig = buildMech(cls, 18, 'compact');
      const count = (geometry: THREE.BufferGeometry): number => (geometry.getIndex()?.count ?? 0) / 3;
      // A standing mech is a pelvis, a torso, and two of each leg part.
      const whole = count(rig.parts.pelvis) + count(rig.parts.torso)
        + 2 * (count(rig.parts.upperLeg) + count(rig.parts.lowerLeg) + count(rig.parts.foot));
      total += whole;
      expect(whole, `${cls} whole-mech triangles`).toBeLessThanOrEqual(budgets[cls]);
      // And a floor, so a class cannot be quietly emptied out.
      expect(whole).toBeGreaterThan(1_200);
    }
    // Thirty mechs is the heavy-combat unit count, and the ring floor at Low is
    // another 65,536, so the whole roster has to stay clear of the 120,000-triangle
    // contact-sheet ceiling with room for structures and effects.
    expect(total / MECH_CLASSES.length).toBeLessThan(2_300);

    for (const kind of STRUCTURE_KINDS) {
      const model = buildStructure(kind, 22, 'compact');
      const triangles = (model.geometry.getIndex()?.count ?? 0) / 3;
      expect(triangles, `${kind} triangles`).toBeLessThanOrEqual(2_000);
      expect(triangles).toBeGreaterThan(200);
    }
  });

  it('puts hydraulic hardware at more than one joint', () => {
    // There used to be exactly one actuator on a mech, alongside the thigh. Joints
    // without visible hardware read as if the limbs are glued together, and the
    // actuator silhouette is the clearest "this thing moves" cue a walker has.
    //
    // Counted as MASK_METAL area on the parts that gained a ram, which is a proxy
    // but a load-bearing one: it fails if the rams are dropped or their masks
    // change, and it does not care where exactly they sit.
    const rig = buildMech('bulwark', 18, 'compact');
    const metalFraction = (geometry: THREE.BufferGeometry): number => {
      const mask = geometry.getAttribute('aMask');
      let metal = 0;
      for (let at = 0; at < mask.count; at++) if (mask.getX(at) === 3) metal++;
      return metal / mask.count;
    };
    expect(metalFraction(rig.parts.pelvis)).toBeGreaterThan(0.1);
    expect(metalFraction(rig.parts.upperLeg)).toBeGreaterThan(0.1);
    expect(metalFraction(rig.parts.lowerLeg)).toBeGreaterThan(0.1);
  });
});

describe('welded curvature and occlusion channels', () => {
  it('reads chamfers convex and panel channels concave', () => {
    // The whole point of the weld pass. If the sign convention ever inverts, edge
    // wear moves into the recesses and grime moves onto the chamfers, which is a
    // very specific kind of wrong that still looks like "a weathered mech" in a
    // thumbnail. So it is pinned on geometry whose shape is known by construction:
    // a bevelled block with two inset channels.
    const rig = buildMech('bulwark', 18, 'compact');
    const torso = rig.parts.torso;
    // x is convexity, y is contact occlusion, packed into one attribute.
    const field = torso.getAttribute('aSurfaceField');
    const curvature = { count: field.count, getX: (at: number) => field.getX(at) };
    const mask = torso.getAttribute('aMask');
    expect(field).toBeTruthy();
    expect(field.itemSize).toBe(2);
    expect(field.count).toBe(torso.getAttribute('position').count);

    // MASK_RECESS (2) is only ever written by the channel floors and lips, so it
    // labels the concave geometry independently of the thing being measured.
    let recessSum = 0;
    let recessCount = 0;
    let hullSum = 0;
    let hullCount = 0;
    let convexPeak = -1;
    for (let at = 0; at < curvature.count; at++) {
      const value = curvature.getX(at);
      if (value > convexPeak) convexPeak = value;
      if (mask.getX(at) === 2) { recessSum += value; recessCount++; } else { hullSum += value; hullCount++; }
    }
    expect(recessCount).toBeGreaterThan(20);
    expect(hullCount).toBeGreaterThan(20);

    // Recessed geometry has to average less convex than the rest of the hull, and
    // the block's chamfer corners have to reach genuinely convex.
    expect(recessSum / recessCount).toBeLessThan(hullSum / hullCount);
    expect(convexPeak).toBeGreaterThan(0.3);

    // And both signs have to be present at all, or one of the two effects is dead.
    let negative = 0;
    let positive = 0;
    for (let at = 0; at < curvature.count; at++) {
      if (curvature.getX(at) < -0.05) negative++;
      if (curvature.getX(at) > 0.05) positive++;
    }
    expect(negative).toBeGreaterThan(10);
    expect(positive).toBeGreaterThan(10);
  });

  it('darkens contacts that curvature cannot see', () => {
    // Occlusion exists to catch a greeble sitting on a plate or a ram running down
    // a thigh: surfaces that are near each other without being adjacent, which
    // convexity is blind to. So it has to vary, and it has to vary somewhere other
    // than where curvature already does.
    const rig = buildMech('bulwark', 18, 'compact');
    for (const [name, geometry] of Object.entries(rig.parts)) {
      const occlusion = (geometry as THREE.BufferGeometry).getAttribute('aSurfaceField');
      expect(occlusion, `${name} aSurfaceField`).toBeTruthy();
      let minimum = 2;
      let maximum = -1;
      for (let at = 0; at < occlusion.count; at++) {
        const value = occlusion.getY(at);
        if (value < minimum) minimum = value;
        if (value > maximum) maximum = value;
      }
      // Fully open geometry reads 1, and the floor is 1 - 0.55 by construction.
      expect(maximum, `${name} has no open surface`).toBeGreaterThan(0.95);
      expect(minimum, `${name} occlusion floor`).toBeGreaterThanOrEqual(0.45 - 1e-6);
      // A part with no variation at all means the probe never found anything.
      expect(maximum - minimum, `${name} occlusion is constant`).toBeGreaterThan(0.05);
    }
  });

  it('keeps the added attribute memory negligible', () => {
    // Two floats a vertex, on geometry that is shared by every instance of a class,
    // so this is per class rather than per unit.
    const rig = buildMech('bulwark', 18, 'compact');
    let added = 0;
    for (const geometry of Object.values(rig.parts)) {
      added += (geometry as THREE.BufferGeometry).getAttribute('position').count * 8;
    }
    expect(added).toBeLessThan(60_000);
  });

  it('leaves flat face normals alone', () => {
    // The weld is for DATA ONLY. Merging vertices or averaging normals would round
    // off the chamfers, and the chamfer highlight is what carries the hard-surface
    // read that docs/art-direction.md section 7 depends on.
    //
    // Asserted directly: a corner where several faces meet must still hold several
    // DIFFERENT normals at one position. Averaging would collapse each of those
    // groups to a single shared direction, so this goes to zero the moment the weld
    // starts touching geometry instead of only deriving data from it.
    const rig = buildMech('bulwark', 18, 'compact');
    const foot = rig.parts.foot;
    const position = foot.getAttribute('position');
    const normal = foot.getAttribute('normal');

    const normalsAt = new Map<string, Set<string>>();
    for (let at = 0; at < position.count; at++) {
      const key = [position.getX(at), position.getY(at), position.getZ(at)]
        .map((value) => Math.round(value * 10_000) / 10_000).join(',');
      const direction = [normal.getX(at), normal.getY(at), normal.getZ(at)]
        .map((value) => Math.round(value * 1_000) / 1_000).join(',');
      if (!normalsAt.has(key)) normalsAt.set(key, new Set());
      normalsAt.get(key)!.add(direction);
    }

    const shared = [...normalsAt.values()].filter((directions) => directions.size > 1);
    expect(shared.length, 'no position carries more than one normal, so normals were welded').toBeGreaterThan(8);
    // And the widest disagreement has to be a real corner, not floating-point drift.
    expect(Math.max(...shared.map((directions) => directions.size))).toBeGreaterThanOrEqual(3);
  });
});
