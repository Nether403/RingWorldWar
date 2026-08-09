import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Terrain } from '../../src/gen/terrain';
import { RenderAnchor } from '../../src/render/anchor';
import { BattlefieldDressing } from '../../src/render/battlefieldDressing';
import { QUALITY } from '../../src/render/renderer';
import { RING_CIRCUMFERENCE } from '../../src/core/constants';
import { deltaS } from '../../src/core/ringMath';
import { FOUNDATION_DISTRICT_PLAN, MAX_DISTRICT_SCATTER_ITEMS } from '../../src/render/districtPlan';

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
    const dressing = new BattlefieldDressing(44, FOUNDATION_DISTRICT_PLAN);
    const diagnostics = dressing.diagnostics();

    expect(dressing.object.children).toHaveLength(4);
    expect(diagnostics.districtIds).toEqual(FOUNDATION_DISTRICT_PLAN.districts.map((district) => district.id));
    expect(diagnostics.generatedByScale.overhead).toBeGreaterThan(0);
    expect(diagnostics.generatedByScale.tactical).toBeGreaterThan(0);
    expect(diagnostics.generatedByScale.micro).toBeGreaterThan(0);
    expect(diagnostics.generatedTotal).toBeLessThanOrEqual(MAX_DISTRICT_SCATTER_ITEMS);
  });

  it('keeps generated scatter inside wrapped districts and outside authored exclusions', () => {
    const dressing = new BattlefieldDressing(45, FOUNDATION_DISTRICT_PLAN);

    for (const item of dressing.generatedItems()) {
      const district = FOUNDATION_DISTRICT_PLAN.districts.find((candidate) => candidate.id === item.districtId)!;
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
    const dressing = new BattlefieldDressing(46, FOUNDATION_DISTRICT_PLAN);

    dressing.setQuality(QUALITY.low.dressingDistance, QUALITY.low.dressingCap, false);
    dressing.update(anchor, flatTerrain());
    const low = dressing.diagnostics();
    expect(low.visibleByScale.overhead).toBeGreaterThan(0);
    expect(low.visibleByScale.tactical).toBeGreaterThan(0);
    expect(low.visibleTotal).toBeLessThanOrEqual(QUALITY.low.dressingCap);

    dressing.setQuality(QUALITY.ultra.dressingDistance, QUALITY.ultra.dressingCap, true);
    dressing.update(anchor, flatTerrain());
    const ultra = dressing.diagnostics();
    expect(ultra.visibleByScale.micro).toBeGreaterThan(low.visibleByScale.micro);
    expect(ultra.visibleTotal).toBeLessThanOrEqual(QUALITY.ultra.dressingCap);
  });

  it('applies per-layer slope ceilings and wrapped seam visibility', () => {
    const anchor = new RenderAnchor();
    anchor.set(RING_CIRCUMFERENCE - 20, 0);
    const dressing = new BattlefieldDressing(47, FOUNDATION_DISTRICT_PLAN);
    dressing.setQuality(500, 256, false);
    dressing.update(anchor, {
      heightAt: () => 7,
      slopeAt: (s: number) => Math.abs(deltaS(0, s)) < 80 ? 1 : 0,
    } as unknown as Terrain);

    expect(dressing.diagnostics().visibleTotal).toBeGreaterThan(0);
    expect(dressing.visibleItems().every((item) => Math.abs(deltaS(0, item.s)) >= 80)).toBe(true);
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
    const dressing = new BattlefieldDressing(48, FOUNDATION_DISTRICT_PLAN);
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
});

function signature(dressing: BattlefieldDressing): { counts: number[]; matrices: number[] } {
  const meshes = dressing.object.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
  const matrix = new THREE.Matrix4();
  const matrices: number[] = [];
  for (const mesh of meshes) {
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      matrices.push(...matrix.elements.map((value) => Number(value.toFixed(5))));
    }
  }
  return { counts: meshes.map((mesh) => mesh.count), matrices };
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
