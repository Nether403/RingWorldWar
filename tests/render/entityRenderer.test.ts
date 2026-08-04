import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EntityRenderer } from '../../src/render/entityRenderer';
import { RenderAnchor } from '../../src/render/anchor';
import type { Terrain } from '../../src/gen/terrain';
import { Faction } from '../../src/sim/data';
import { World } from '../../src/sim/world';

describe('EntityRenderer quality materials', () => {
  it('toggles the cheap hull path for ordinary and cloaked Wisp materials', () => {
    const entities = new EntityRenderer(42);
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    for (const child of entities.object.children) {
      if (!(child instanceof THREE.InstancedMesh) || !(child.material instanceof THREE.MeshStandardMaterial)) continue;
      if (child.name.startsWith('cloak:wisp:')) materials.set('cloak', child.material);
      if (child.name.startsWith('structure:')) materials.set('ordinary', child.material);
    }

    const qualityValues = (): number[] => [...materials.values()].map((material) => {
      const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
      material.onBeforeCompile(shader as never, {} as never);
      return (shader.uniforms as { uLowQuality: { value: number } }).uLowQuality.value;
    });

    expect([...materials.keys()].sort()).toEqual(['cloak', 'ordinary']);
    entities.setLowQuality(true);
    expect(qualityValues()).toEqual([1, 1]);
    entities.setLowQuality(false);
    expect(qualityValues()).toEqual([0, 0]);
  });

  it('creates Needle cloak and both exclusive-unit wreck buckets', () => {
    const renderer = new EntityRenderer(19) as unknown as {
      cloakMeshes: Map<string, THREE.InstancedMesh>;
      wreckMeshes: Map<string, THREE.InstancedMesh>;
    };
    expect(renderer.cloakMeshes.has('needle|torso|1')).toBe(true);
    expect(renderer.wreckMeshes.has('bulwark')).toBe(true);
    expect(renderer.wreckMeshes.has('needle')).toBe(true);
  });

  it('adds render-only recoil to the torso without moving the pelvis', () => {
    const { renderer, world, anchor } = mechScene();
    renderer.update(world, anchor, 4, Faction.Compact, 1);
    const pelvisBefore = matrix(renderer, 'vanguard|pelvis|0');
    const torsoBefore = matrix(renderer, 'vanguard|torso|0');

    renderer.consumePresentation([{
      kind: 'weaponFired', faction: Faction.Compact, id: world.units[0]!.id,
      s: 0, z: 0, h: 4, scale: 1, weapon: 'autocannon',
    }], 4);
    renderer.update(world, anchor, 4, Faction.Compact, 1);

    expect(matrix(renderer, 'vanguard|pelvis|0').elements).toEqual(pelvisBefore.elements);
    expect(matrix(renderer, 'vanguard|torso|0').elements).not.toEqual(torsoBefore.elements);
  });

  it('interpolates gait and emits one render-only footfall on a contact crossing', () => {
    const { renderer, world, anchor } = mechScene();
    const unit = world.units[0]!;
    const footfalls: number[] = [];
    renderer.onFootfall = (event) => footfalls.push(event.id);
    renderer.update(world, anchor, 1, Faction.Compact, 0);
    const atPreviousTick = matrix(renderer, 'vanguard|pelvis|0');

    unit.prevS = unit.s;
    unit.s += 4;
    unit.gait += 4;
    unit.speed = 12;
    renderer.update(world, anchor, 1.1, Faction.Compact, 0.5);
    const halfway = matrix(renderer, 'vanguard|pelvis|0');
    renderer.update(world, anchor, 1.2, Faction.Compact, 1);
    const atCurrentTick = matrix(renderer, 'vanguard|pelvis|0');

    expect(halfway.elements).not.toEqual(atPreviousTick.elements);
    expect(halfway.elements).not.toEqual(atCurrentTick.elements);
    expect(footfalls).toEqual([unit.id]);
  });

  it('preserves every contact in a bounded catch-up and settles hydraulically without mutating simulation', () => {
    const terrain = {
      heightAt: () => 0,
      slopeAt: () => 0,
      isBuildable: () => true,
    } as unknown as Terrain;
    const world = new World(terrain, 53);
    const unit = world.spawnUnit(Faction.Choir, 'needle', 0, 0);
    const anchor = new RenderAnchor();
    const renderer = new EntityRenderer(53);
    const footfalls: number[] = [];
    renderer.onFootfall = (event) => footfalls.push(event.id);
    unit.speed = 20;
    renderer.update(world, anchor, 0, Faction.Choir, 0);
    unit.prevS = unit.s;
    unit.s += 5;
    unit.gait += 5;
    const catchupHash = world.stateHash();
    renderer.update(world, anchor, 0.2, Faction.Choir, 1);
    expect(footfalls).toEqual([unit.id, unit.id]);
    expect(world.stateHash()).toBe(catchupHash);

    unit.speed = 0;
    const settleHash = world.stateHash();
    renderer.update(world, anchor, 1, Faction.Choir, 1);
    const stopped = matrix(renderer, 'needle|pelvis|1');
    renderer.update(world, anchor, 1.1, Faction.Choir, 1);
    const settling = matrix(renderer, 'needle|pelvis|1');

    expect(settling.elements).not.toEqual(stopped.elements);
    expect(world.stateHash()).toBe(settleHash);
  });

  it('never replays footfalls accumulated while a unit was hidden', () => {
    const terrain = {
      heightAt: () => 0,
      slopeAt: () => 0,
      isBuildable: () => true,
    } as unknown as Terrain;
    const world = new World(terrain, 54);
    const unit = world.spawnUnit(Faction.Choir, 'needle', 1_000, 0);
    const renderer = new EntityRenderer(54);
    const anchor = new RenderAnchor();
    anchor.set(1_000, 0);
    const footfalls: number[] = [];
    renderer.onFootfall = (event) => footfalls.push(event.id);
    renderer.update(world, anchor, 0, Faction.Choir, 0);

    unit.prevS = unit.s;
    unit.s += 7;
    unit.gait += 7;
    unit.speed = 20;
    renderer.update(world, anchor, 0.2, Faction.Compact, 1);
    renderer.update(world, anchor, 0.3, Faction.Choir, 1);

    expect(footfalls).toEqual([]);
  });

  it('renders faction-specific geometry and independent damage without mutating authority', () => {
    const terrain = {
      heightAt: () => 0,
      slopeAt: () => 0,
      isBuildable: () => true,
    } as unknown as Terrain;
    const world = new World(terrain, 55);
    const compact = world.spawnUnit(Faction.Compact, 'vanguard', 0, 0);
    const compactDamaged = world.spawnUnit(Faction.Compact, 'vanguard', 10, 10);
    const choir = world.spawnUnit(Faction.Choir, 'vanguard', 40, 0);
    const needleHealthy = world.spawnUnit(Faction.Choir, 'needle', 20, 20);
    const needleDamaged = world.spawnUnit(Faction.Choir, 'needle', 30, 20);
    const engineerHealthy = world.spawnUnit(Faction.Choir, 'engineer', 20, -15);
    const engineerDamaged = world.spawnUnit(Faction.Choir, 'engineer', 30, -15);
    const compactStructure = world.spawnStructure(Faction.Compact, 'fabricator', 0, -30, 1);
    const choirStructure = world.spawnStructure(Faction.Choir, 'fabricator', 30, -30, 1);
    const choirStructureDamaged = world.spawnStructure(Faction.Choir, 'fabricator', 45, -30, 1);
    compactDamaged.hp = compactDamaged.maxHp * 0.3;
    choir.hp = choir.maxHp * 0.4;
    needleHealthy.cloaked = true;
    needleDamaged.hp = needleDamaged.maxHp * 0.5;
    needleDamaged.cloaked = true;
    engineerDamaged.hp = engineerDamaged.maxHp * 0.35;
    choirStructureDamaged.hp = choirStructureDamaged.maxHp * 0.45;
    const renderer = new EntityRenderer(55);
    const exact = renderer as unknown as {
      mechMeshes: Map<string, THREE.InstancedMesh>;
      cloakMeshes: Map<string, THREE.InstancedMesh>;
      structMeshes: Map<string, THREE.InstancedMesh>;
      engineerMeshes: THREE.InstancedMesh[];
      mats: Array<{ uniforms: { uTime: { value: number } } }>;
    };
    const compactTorso = exact.mechMeshes.get('vanguard|torso|0')!;
    const choirTorso = exact.mechMeshes.get('vanguard|torso|1')!;
    const anchor = new RenderAnchor();
    const beforeHash = world.stateHash();

    renderer.update(world, anchor, 2, Faction.Choir, 1);

    expect(compactTorso.geometry).not.toBe(choirTorso.geometry);
    expect(compactTorso.count).toBe(2);
    expect(choirTorso.count).toBe(1);
    expect((compactTorso.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(0))
      .toBeCloseTo(0, 6);
    expect((compactTorso.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(1))
      .toBeCloseTo(0.7, 6);
    const compactPhase = compactTorso.geometry.getAttribute('instancePhase') as THREE.InstancedBufferAttribute;
    expect(compactPhase.getX(0)).not.toBeCloseTo(compactPhase.getX(1), 6);
    expect(exact.mats[Faction.Compact]!.uniforms.uTime.value).toBe(2);
    expect((choirTorso.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(0))
      .toBeCloseTo(0.6, 6);
    const needleCloak = exact.cloakMeshes.get('needle|torso|1')!;
    expect(needleCloak.count).toBe(2);
    expect((needleCloak.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(0))
      .toBeCloseTo(0, 6);
    expect((needleCloak.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(1))
      .toBeCloseTo(0.5, 6);
    const compactFabricator = exact.structMeshes.get('fabricator|0')!;
    const choirFabricator = exact.structMeshes.get('fabricator|1')!;
    expect(compactFabricator.geometry).not.toBe(choirFabricator.geometry);
    expect((compactFabricator.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(0))
      .toBeCloseTo(0, 6);
    expect(choirFabricator.count).toBe(2);
    expect((choirFabricator.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(0))
      .toBeCloseTo(0, 6);
    expect((choirFabricator.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(1))
      .toBeCloseTo(0.55, 6);
    const engineerMesh = exact.engineerMeshes[Faction.Choir]!;
    expect(engineerMesh.count).toBe(2);
    expect((engineerMesh.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(0))
      .toBeCloseTo(0, 6);
    expect((engineerMesh.geometry.getAttribute('instanceDamage') as THREE.InstancedBufferAttribute).getX(1))
      .toBeCloseTo(0.65, 6);
    expect(compact.id).not.toBe(choir.id);
    expect(compactStructure.id).not.toBe(choirStructure.id);
    expect(engineerHealthy.id).not.toBe(engineerDamaged.id);
    expect(world.stateHash()).toBe(beforeHash);
  });

  it('keeps captured Spinal Nodes on the neutral inherited material', () => {
    const renderer = new EntityRenderer(56);
    const exact = renderer as unknown as {
      structMeshes: Map<string, THREE.InstancedMesh>;
      mats: Array<{ material: THREE.Material }>;
    };
    const compact = exact.structMeshes.get('spinalNode|0')!;
    const choir = exact.structMeshes.get('spinalNode|1')!;
    const neutral = exact.structMeshes.get('spinalNode|2')!;

    expect(compact.material).toBe(exact.mats[2]!.material);
    expect(choir.material).toBe(exact.mats[2]!.material);
    expect(neutral.material).toBe(exact.mats[2]!.material);
    expect(compact.geometry).not.toBe(choir.geometry);
    expect(choir.geometry).not.toBe(neutral.geometry);
  });
});

function mechScene(): { renderer: EntityRenderer; world: World; anchor: RenderAnchor } {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  const world = new World(terrain, 52);
  world.spawnUnit(Faction.Compact, 'vanguard', 0, 0);
  const anchor = new RenderAnchor();
  anchor.set(0, 0);
  return { renderer: new EntityRenderer(52), world, anchor };
}

function matrix(renderer: EntityRenderer, key: string): THREE.Matrix4 {
  const exact = renderer as unknown as { mechMeshes: Map<string, THREE.InstancedMesh> };
  const mesh = exact.mechMeshes.get(key)!;
  const result = new THREE.Matrix4();
  mesh.getMatrixAt(0, result);
  return result;
}
