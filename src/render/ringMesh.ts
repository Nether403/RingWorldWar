/**
 * The world, as one mesh.
 *
 * Because the ring is only 22.6 km around, the entire playable world fits
 * comfortably in a single BufferGeometry. That removes an enormous amount of
 * machinery that a large open world would need -- no chunk streaming, no LOD
 * seams, no popping -- and reduces the whole planet to one draw call.
 *
 * The floating origin still has to work, though, and rebuilding a 300k-vertex
 * mesh whenever it moves would be far too slow. The trick is that render space
 * is rotationally symmetric about the ring axis: moving the anchor spinward by
 * ds is exactly equivalent to rotating the world about the axis by -ds/R. So
 * the mesh is built once and thereafter repositioned by a single transform.
 *
 * Terrain receives shadows but does not cast them. At this scale terrain
 * self-shadowing contributes very little, and excluding ~1M triangles from the
 * shadow pass is most of the reason the frame budget closes.
 */

import * as THREE from 'three';
import {
  RING_CIRCUMFERENCE,
  RING_HALF_WIDTH,
  RING_RADIUS,
} from '@core/constants';
import type { Terrain } from '@gen/terrain';
import { RIM_WALL_HEIGHT } from '@gen/terrain';
import type { RenderAnchor } from './anchor';
import { makeTerrainMaterial, type TerrainUniforms } from './materials/terrainMaterial';

/** Vertices around the ring. 1024 gives ~22 m spacing. */
const SEG_S = 1024;
/** Vertices across the ring's width. */
const SEG_Z = 160;

export class RingMesh {
  readonly object = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly uniforms: TerrainUniforms;

  constructor(terrain: Terrain) {
    this.object.name = 'ring';

    const geometry = buildRingGeometry(terrain);
    const { material, uniforms } = makeTerrainMaterial();
    this.uniforms = uniforms;

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    // The mesh is the whole world; it is never off screen.
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
  }

  /**
   * Re-place the world for the current anchor. This is the entire cost of the
   * floating origin for terrain: one rotation and one translation.
   */
  syncToAnchor(anchor: RenderAnchor): void {
    const dTheta = (anchor.s / RING_CIRCUMFERENCE) * Math.PI * 2;
    // Rotate about the ring axis, which in render space is the line (0, R, z).
    this.object.rotation.z = -dTheta;
    this.object.position.set(
      -RING_RADIUS * Math.sin(dTheta),
      RING_RADIUS - RING_RADIUS * Math.cos(dTheta),
      -anchor.z,
    );
  }
}

/**
 * Build the ring in the canonical frame (anchor at s = 0, z = 0).
 *
 * Vertices are placed with the exact ring->render projection, so the geometry
 * genuinely closes into a torus-section: walk far enough spinward and you
 * arrive back where you started, upside down relative to where you began.
 */
function buildRingGeometry(terrain: Terrain): THREE.BufferGeometry {
  const cols = SEG_S;
  const rows = SEG_Z;
  const vertCount = cols * (rows + 1);

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  // Surface coordinates travel with the vertex so the shader can do stable,
  // wrap-correct procedural texturing without deriving it from world position.
  const surface = new Float32Array(vertCount * 2);

  const n = { x: 0, y: 0, z: 0 };

  for (let j = 0; j <= rows; j++) {
    const z = -RING_HALF_WIDTH + (j / rows) * RING_HALF_WIDTH * 2;
    for (let i = 0; i < cols; i++) {
      const s = (i / cols) * RING_CIRCUMFERENCE;
      const h = terrain.heightAt(s, z);

      const dTheta = s / RING_RADIUS;
      const r = RING_RADIUS - h;
      const cs = Math.cos(dTheta);
      const sn = Math.sin(dTheta);

      const idx = j * cols + i;
      positions[idx * 3] = r * sn;
      positions[idx * 3 + 1] = RING_RADIUS - r * cs;
      positions[idx * 3 + 2] = z;

      // Terrain normal, expressed in the local tangent frame, then rotated
      // into render space by the same angle as the position.
      terrain.normalAt(s, z, n);
      // Local frame: tangent = (cos, sin, 0), up = (-sin, cos, 0), axial = z.
      normals[idx * 3] = n.x * cs + n.y * -sn;
      normals[idx * 3 + 1] = n.x * sn + n.y * cs;
      normals[idx * 3 + 2] = n.z;

      uvs[idx * 2] = s / 512;
      uvs[idx * 2 + 1] = z / 512;
      surface[idx * 2] = s;
      surface[idx * 2 + 1] = z;
    }
  }

  // Indices, wrapping in the spinward direction so there is no seam.
  const quadCount = cols * rows;
  const indices = new Uint32Array(quadCount * 6);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const i1 = (i + 1) % cols;
      const a = j * cols + i;
      const b = j * cols + i1;
      const c = (j + 1) * cols + i;
      const d = (j + 1) * cols + i1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aSurface', new THREE.BufferAttribute(surface, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  // Bounding sphere must be set manually since we never frustum-cull this.
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, RING_RADIUS, 0),
    RING_RADIUS + RIM_WALL_HEIGHT + 10,
  );
  return geo;
}
