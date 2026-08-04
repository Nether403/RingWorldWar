import * as THREE from 'three';
import { buildMech, makeHullMaterial, type MechRig } from '@gen/models';
import { RenderAnchor } from '@render/anchor';
import { Environment } from '@render/environment';
import { BASE_EXPOSURE, Renderer, type QualityLevel } from '@render/renderer';
import { isQualityLevel } from '@render/settings';

const CALIBRATION_TIME = 66;

export interface CalibrationManifest {
  chromeBalls: number;
  greyBalls: number;
  roughnessSamples: number;
  metalnessSamples: number;
  macbethPatches: number;
  materialSwatches: number;
  referenceMechs: number;
  quality: QualityLevel;
  toneMapping: 'ACESFilmic';
  outputColorSpace: 'srgb';
  exposure: number;
}

export function startCalibration(container: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const qualityValue = params.get('quality');
  const quality: QualityLevel = isQualityLevel(qualityValue) ? qualityValue : 'high';
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 12_000);
  camera.position.set(35, 24, 56);
  camera.lookAt(0, 7, 0);
  const renderer = new Renderer(container, camera, quality);
  renderer.autoQuality = false;
  const environment = new Environment(0x3bca1);
  environment.keyLight.shadow.mapSize.setScalar(renderer.currentSettings.shadowMapSize);
  environment.setLowQuality(quality === 'low');
  const anchor = new RenderAnchor();
  renderer.scene.add(environment.group);
  environment.buildEnvironment(renderer.gl, renderer.scene);
  const fog = new THREE.FogExp2(environment.fogColor.getHex(), environment.fogDensity);
  renderer.scene.fog = fog;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 72),
    new THREE.MeshStandardMaterial({ color: 0x35312b, roughness: 0.88, metalness: 0.18 }),
  );
  floor.name = 'calibration:floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  renderer.scene.add(floor);

  renderer.scene.add(referenceBall('calibration:chrome-ball', -19, 5, 1, 0.04, 0xbfc5ca));
  renderer.scene.add(referenceBall('calibration:grey-ball', -10, 5, 0, 0.55, 0x777777));
  renderer.scene.add(buildSweep('calibration:roughness-sweep', -19, -6, 'roughness'));
  renderer.scene.add(buildSweep('calibration:metalness-sweep', -19, -13, 'metalness'));
  renderer.scene.add(buildColorChart());
  renderer.scene.add(buildMaterialSwatches());
  renderer.scene.add(buildReferenceMech());

  const title = document.createElement('div');
  title.className = 'rww-calibration-label';
  title.textContent = 'PBR CALIBRATION / GENERATED IN CODE';
  title.style.cssText = 'position:fixed;left:18px;top:16px;color:#dbe3ec;font:600 12px/1.2 system-ui;letter-spacing:.18em;pointer-events:none';
  document.body.appendChild(title);

  const renderFrame = (): void => {
    environment.update(CALIBRATION_TIME, anchor, camera.position);
    fog.color.copy(environment.fogColor);
    fog.density = environment.fogDensity;
    (renderer.scene.background as THREE.Color).copy(environment.spaceColor);
    renderer.render(0);
  };
  renderFrame();

  const manifest: CalibrationManifest = {
    chromeBalls: 1,
    greyBalls: 1,
    roughnessSamples: 5,
    metalnessSamples: 5,
    macbethPatches: 24,
    materialSwatches: 4,
    referenceMechs: 1,
    quality,
    toneMapping: 'ACESFilmic',
    outputColorSpace: 'srgb',
    exposure: BASE_EXPOSURE,
  };
  (window as unknown as { RWWCalibration: unknown }).RWWCalibration = {
    ready: true,
    renderer,
    environment,
    scene: renderer.scene,
    camera,
    manifest,
    renderFrame,
  };

  window.addEventListener('resize', () => {
    renderer.resize(container.clientWidth, container.clientHeight);
    renderFrame();
  });
}

function referenceBall(
  name: string,
  x: number,
  z: number,
  metalness: number,
  roughness: number,
  color: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(3.3, 32, 18),
    new THREE.MeshStandardMaterial({ color, metalness, roughness }),
  );
  mesh.name = name;
  mesh.position.set(x, 3.3, z);
  mesh.castShadow = true;
  return mesh;
}

function buildSweep(name: string, x: number, z: number, channel: 'roughness' | 'metalness'): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  for (let index = 0; index < 5; index++) {
    const value = index / 4;
    const material = new THREE.MeshStandardMaterial({
      color: 0x8b8d8e,
      roughness: channel === 'roughness' ? value : 0.32,
      metalness: channel === 'metalness' ? value : 0.65,
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.8, 20, 12), material);
    ball.position.set(x + index * 4.4, 1.8, z);
    ball.castShadow = true;
    group.add(ball);
  }
  return group;
}

function buildColorChart(): THREE.InstancedMesh {
  const colors = [
    0x735244, 0xc29682, 0x627a9d, 0x576c43, 0x8580b1, 0x67bdaa,
    0xd67e2c, 0x505ba6, 0xc15a63, 0x5e3c6c, 0x9dbc40, 0xe0a32e,
    0x383d96, 0x469449, 0xaf363c, 0xe7c71f, 0xbb5695, 0x0885a1,
    0xf3f3f2, 0xc8c8c8, 0xa0a0a0, 0x7a7a79, 0x555555, 0x343434,
  ];
  const chart = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.45, 1.65, 0.22),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0 }),
    colors.length,
  );
  chart.name = 'calibration:macbeth-chart';
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < colors.length; index++) {
    matrix.makeTranslation(-4.3 + (index % 6) * 2.7, 12.8 - Math.floor(index / 6) * 1.9, -16);
    chart.setMatrixAt(index, matrix);
    chart.setColorAt(index, COLOR.setHex(colors[index]!));
  }
  chart.instanceMatrix.needsUpdate = true;
  if (chart.instanceColor) chart.instanceColor.needsUpdate = true;
  return chart;
}

function buildMaterialSwatches(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'calibration:material-swatches';
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x4b4438, roughness: 0.94, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ color: 0x252a30, roughness: 0.66, metalness: 0.78 }),
    new THREE.MeshStandardMaterial({ color: 0x71391f, roughness: 0.82, metalness: 0.42 }),
    new THREE.MeshStandardMaterial({ color: 0x85827a, roughness: 0.48, metalness: 0.62 }),
  ];
  for (let index = 0; index < materials.length; index++) {
    const swatch = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 4.2), materials[index]);
    swatch.position.set(2 + index * 5.2, 0.6, 10);
    swatch.castShadow = true;
    group.add(swatch);
  }
  return group;
}

function buildReferenceMech(): THREE.Group {
  const rig = buildMech('vanguard', 0x3bca1, 'compact');
  const hull = makeHullMaterial(0xf0821e, -1).material;
  const group = new THREE.Group();
  group.name = 'calibration:reference-mech';
  addPart(group, rig.parts.pelvis, hull, 0, rig.hipHeight, 0);
  addPart(group, rig.parts.torso, hull, 0, rig.hipHeight + rig.height * 0.045, 0);
  for (const side of [-1, 1]) addStandingLeg(group, rig, hull, side);
  group.position.set(19, 0, -4);
  group.rotation.y = -0.36;
  return group;
}

function addStandingLeg(group: THREE.Group, rig: MechRig, material: THREE.Material, side: number): void {
  const x = side * rig.hipOffset * 0.5;
  addPart(group, rig.parts.upperLeg, material, x, rig.hipHeight, 0);
  addPart(group, rig.parts.lowerLeg, material, x, rig.hipHeight - rig.legUpper, 0);
  addPart(group, rig.parts.foot, material, x, 0, 0);
}

function addPart(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): void {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

const COLOR = new THREE.Color();
