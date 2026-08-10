import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Terrain } from '../../src/gen/terrain';
import { RenderAnchor } from '../../src/render/anchor';
import { BattlefieldDressing } from '../../src/render/battlefieldDressing';
import { QUALITY } from '../../src/render/renderer';
import { RING_CIRCUMFERENCE } from '../../src/core/constants';
import { deltaS } from '../../src/core/ringMath';
import {
  DISTRICT_LIFE_CUES,
  DISTRICT_PALETTES,
  ENVIRONMENT_DISTRICT_PLAN,
  MAX_DISTRICT_SCATTER_ITEMS,
} from '../../src/render/districtPlan';

describe('BattlefieldDressing', () => {
  it('rebuilds the same presentation-only ruin field for the same seed and anchor', () => {
    const anchor = new RenderAnchor();
    anchor.set(1_900, 0);
    const terrain = flatTerrain();
    const first = new BattlefieldDressing(42);
    const second = new BattlefieldDressing(42);
    first.update(anchor, terrain);
    second.update(anchor, terrain);

    expect(signature(first)).toEqual(signature(second));
    expect(signature(first).counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
  });

  it('applies bounded quality density and shadow budgets', () => {
    const anchor = new RenderAnchor();
    anchor.set(1_900, 0);
    const terrain = flatTerrain();
    const dressing = new BattlefieldDressing(43);
    const meshes = dressing.object.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);

    dressing.setQuality(QUALITY.low.dressingDistance, QUALITY.low.dressingCap, QUALITY.low.dressingShadows);
    dressing.update(anchor, terrain);
    const lowCount = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    expect(lowCount).toBeLessThanOrEqual(QUALITY.low.dressingCap);
    expect(meshes.every((mesh) => !mesh.castShadow)).toBe(true);

    dressing.setQuality(QUALITY.ultra.dressingDistance, QUALITY.ultra.dressingCap, QUALITY.ultra.dressingShadows);
    dressing.update(anchor, terrain);
    const ultraCount = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    expect(ultraCount).toBeGreaterThan(lowCount);
    expect(ultraCount).toBeLessThanOrEqual(QUALITY.ultra.dressingCap);
    expect(meshes.every((mesh) => mesh.castShadow)).toBe(true);
  });

  it('builds named authored layers at every density scale with fixed draw topology', () => {
    const dressing = new BattlefieldDressing(44, ENVIRONMENT_DISTRICT_PLAN);
    const diagnostics = dressing.diagnostics();

    expect(dressing.object.children).toHaveLength(4);
    expect(diagnostics.districtIds).toEqual(ENVIRONMENT_DISTRICT_PLAN.districts.map((district) => district.id));
    expect(diagnostics.generatedByScale.overhead).toBeGreaterThan(0);
    expect(diagnostics.generatedByScale.tactical).toBeGreaterThan(0);
    expect(diagnostics.generatedByScale.micro).toBeGreaterThan(0);
    expect(diagnostics.generatedTotal).toBeLessThanOrEqual(MAX_DISTRICT_SCATTER_ITEMS);
  });

  it('generates deterministic identities and colors for all four reusable palettes', () => {
    const first = new BattlefieldDressing(441, ENVIRONMENT_DISTRICT_PLAN);
    const second = new BattlefieldDressing(441, ENVIRONMENT_DISTRICT_PLAN);
    const identity = (dressing: BattlefieldDressing) => dressing.generatedItems().map((item) => ({
      palette: item.palette,
      silhouette: item.silhouette,
      color: item.color,
      lifeCue: item.lifeCue,
      phase: item.phase,
      s: item.s,
      z: item.z,
      yaw: item.yaw,
    }));

    expect(identity(first)).toEqual(identity(second));
    expect(new Set(first.generatedItems().map((item) => item.palette))).toEqual(new Set(DISTRICT_PALETTES));
    for (const palette of DISTRICT_PALETTES) {
      expect(first.generatedItems().filter((item) => item.palette === palette).length).toBeGreaterThan(0);
    }
    expect(new Set(first.generatedItems().flatMap((item) => item.lifeCue === null ? [] : [item.lifeCue])))
      .toEqual(new Set(DISTRICT_LIFE_CUES));
  });

  it('animates inhabited-ring cues deterministically without changing authored items', () => {
    const anchor = new RenderAnchor();
    anchor.set(0, 0);
    const terrain = flatTerrain();
    const first = new BattlefieldDressing(442, ENVIRONMENT_DISTRICT_PLAN);
    const second = new BattlefieldDressing(442, ENVIRONMENT_DISTRICT_PLAN);
    const authored = first.generatedItems().map((item) => ({ ...item }));

    first.update(anchor, terrain, 0);
    second.update(anchor, terrain, 0);
    const initial = signature(first);
    expect(signature(second)).toEqual(initial);

    first.update(anchor, terrain, 1.25);
    second.update(anchor, terrain, 1.25);
    expect(signature(first)).toEqual(signature(second));
    expect(signature(first).matrices).not.toEqual(initial.matrices);
    expect(signature(first).colors).not.toEqual(initial.colors);
    expect(first.generatedItems()).toEqual(authored);
  });

  it('freezes life-cue motion when motion is disabled', () => {
    const anchor = new RenderAnchor();
    anchor.set(0, 0);
    const dressing = new BattlefieldDressing(443, ENVIRONMENT_DISTRICT_PLAN);
    dressing.setMotionEnabled(false);
    dressing.update(anchor, flatTerrain(), 0);
    const initial = signature(dressing);

    dressing.update(anchor, flatTerrain(), 10);

    expect(signature(dressing)).toEqual(initial);
  });

  it('keeps generated scatter inside wrapped districts and outside authored exclusions', () => {
    const dressing = new BattlefieldDressing(45, ENVIRONMENT_DISTRICT_PLAN);

    for (const item of dressing.generatedItems()) {
      const district = ENVIRONMENT_DISTRICT_PLAN.districts.find((candidate) => candidate.id === item.districtId);
      if (!district) continue;
      expect(Math.abs(deltaS(district.centerS, item.s))).toBeLessThanOrEqual(district.halfLength);
      expect(item.z).toBeGreaterThanOrEqual(district.zMin);
      expect(item.z).toBeLessThanOrEqual(district.zMax);
      expect(district.exclusions.some((exclusion) =>
        Math.abs(deltaS(exclusion.centerS, item.s)) <= exclusion.halfLength
        && item.z >= exclusion.zMin
        && item.z <= exclusion.zMax,
      )).toBe(false);
    }
  });

  it('preserves landmark and tactical identity on Low while adding bounded micro-detail on Ultra', () => {
    const anchor = new RenderAnchor();
    anchor.set(0, 0);
    const dressing = new BattlefieldDressing(46, ENVIRONMENT_DISTRICT_PLAN);

    dressing.setQuality(QUALITY.low.dressingDistance, QUALITY.low.dressingCap, false);
    dressing.update(anchor, flatTerrain());
    const low = dressing.diagnostics();
    expect(low.visibleByScale.overhead).toBeGreaterThan(0);
    expect(low.visibleByScale.tactical).toBeGreaterThan(0);
    expect(low.visiblePalettes).toEqual(DISTRICT_PALETTES);
    expect(Object.values(low.visibleByPalette).every((count) => count > 0)).toBe(true);
    expect(low.visibleLifeCues).toEqual(DISTRICT_LIFE_CUES);
    expect(Object.values(low.visibleByLifeCue).every((count) => count > 0)).toBe(true);
    expect(low.visibleTotal).toBeLessThanOrEqual(QUALITY.low.dressingCap);

    dressing.setQuality(QUALITY.ultra.dressingDistance, QUALITY.ultra.dressingCap, true);
    dressing.update(anchor, flatTerrain());
    const ultra = dressing.diagnostics();
    expect(ultra.visibleByScale.micro).toBeGreaterThan(low.visibleByScale.micro);
    expect(ultra.visibleTotal).toBeLessThanOrEqual(QUALITY.ultra.dressingCap);
  });

  it('keeps a habitation or vegetation landmark visible across the full playable ring', () => {
    const anchor = new RenderAnchor();
    const dressing = new BattlefieldDressing(461, ENVIRONMENT_DISTRICT_PLAN);
    dressing.setQuality(QUALITY.low.dressingDistance, QUALITY.low.dressingCap, false);
    const terrain = flatTerrain();

    for (let s = 0; s < RING_CIRCUMFERENCE; s += 700) {
      for (const z of [-2_000, -1_000, 0, 1_000, 2_000]) {
        anchor.set(s, z);
        dressing.update(anchor, terrain);
        expect(dressing.visibleItems().some((item) =>
          item.districtId === 'inhabited-ring-corridor'
          && (item.lifeCue === 'habitation' || item.lifeCue === 'vegetation'),
        )).toBe(true);
      }
    }
  });

  it('applies per-layer slope ceilings and wrapped seam visibility', () => {
    const anchor = new RenderAnchor();
    anchor.set(RING_CIRCUMFERENCE - 20, 0);
    const dressing = new BattlefieldDressing(47, ENVIRONMENT_DISTRICT_PLAN);
    dressing.setQuality(500, 256, false);
    dressing.update(anchor, {
      heightAt: () => 7,
      slopeAt: (s: number) => Math.abs(deltaS(0, s)) < 80 ? 1 : 0,
    } as unknown as Terrain);

    expect(dressing.diagnostics().visibleTotal).toBeGreaterThan(0);
    expect(dressing.visibleItems()
      .filter((item) => item.districtId !== 'inhabited-ring-corridor')
      .every((item) => Math.abs(deltaS(0, item.s)) >= 80)).toBe(true);
  });

  it('plants instance centers from authoritative terrain height without mutating terrain data', () => {
    const anchor = new RenderAnchor();
    anchor.set(0, 0);
    const heights = new Float32Array([3, 7, 11]);
    const before = new Uint8Array(heights.buffer.slice(0));
    const terrain = {
      heights,
      heightAt: () => 7,
      slopeAt: () => 0,
    } as unknown as Terrain;
    const dressing = new BattlefieldDressing(48, ENVIRONMENT_DISTRICT_PLAN);
    dressing.setQuality(1_400, 72, false);
    dressing.update(anchor, terrain);
    const item = dressing.visibleItems()[0]!;
    const bucket = dressing.object.children.find((child) => child.name === bucketName(item.shape)) as THREE.InstancedMesh;
    const bucketItems = dressing.visibleItems().filter((candidate) => candidate.shape === item.shape);
    const matrixIndex = bucketItems.indexOf(item);
    const matrix = new THREE.Matrix4();
    bucket.getMatrixAt(matrixIndex, matrix);
    const center = new THREE.Vector3().setFromMatrixPosition(matrix);
    const expected = anchor.toVector(item.s, 7, item.z, new THREE.Vector3());
    expected.addScaledVector(anchor.upAt(item.s, new THREE.Vector3()), item.shape === 'pipe' ? item.width * 1.05 : item.height * 0.5);

    expect(center.distanceTo(expected)).toBeLessThan(0.001);
    dressing.setQuality(3_000, 256, true);
    dressing.update(anchor, terrain);
    dressing.dispose();
    expect(new Uint8Array(heights.buffer)).toEqual(before);
  });

  it('writes palette colors without expanding the four-bucket draw topology', () => {
    const anchor = new RenderAnchor();
    anchor.set(0, 0);
    const dressing = new BattlefieldDressing(49, ENVIRONMENT_DISTRICT_PLAN);
    dressing.setQuality(1_400, 72, false);
    dressing.update(anchor, flatTerrain());
    const meshes = dressing.object.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);

    expect(meshes).toHaveLength(4);
    expect(meshes.some((mesh) => mesh.instanceColor !== null && mesh.count > 0)).toBe(true);
    expect(new Set(dressing.visibleItems().map((item) => item.color)).size).toBeGreaterThan(1);
  });
});

function signature(dressing: BattlefieldDressing): { counts: number[]; matrices: number[]; colors: number[] } {
  const meshes = dressing.object.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const matrices: number[] = [];
  const colors: number[] = [];
  for (const mesh of meshes) {
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      matrices.push(...matrix.elements.map((value) => Number(value.toFixed(5))));
      mesh.getColorAt(index, color);
      colors.push(color.getHex());
    }
  }
  return { counts: meshes.map((mesh) => mesh.count), matrices, colors };
}

function flatTerrain(): Terrain {
  return {
    heightAt: () => 0,
    slopeAt: () => 0,
  } as unknown as Terrain;
}

function bucketName(shape: string): string {
  if (shape === 'tower') return 'district-overhead-landmarks';
  if (shape === 'slab') return 'district-tactical-shells';
  if (shape === 'pipe') return 'district-tactical-trunks';
  return 'district-bounded-detail';
}
