/**
 * Production PBR calibration and visual contact sheets.
 *
 * Two jobs in one page, both served by the production renderer, environment,
 * exposure, output transform, generated IBL, and shared materials:
 *
 *   1. `?sheet=calibration` (the default) is the PBR calibration scene. It is
 *      deliberately unchanged, because `e2e/calibration.spec.ts` treats its
 *      object counts and resource budgets as a contract.
 *   2. The remaining sheets are review surfaces for procedural graphics work:
 *      every mech, every structure, the terrain material, and the authored
 *      building assets, each staged so a screenshot baseline can catch
 *      regressions that numeric assertions cannot see.
 *
 * Everything here is deterministic: fixed seeds, a fixed cycle time, no
 * animation, and a single explicit `renderFrame()`. That is what makes the
 * screenshot baselines meaningful rather than flaky.
 */

import * as THREE from 'three';
import { RING_CIRCUMFERENCE, RING_HALF_WIDTH, SHADOW_SQUARE_COUNT } from '@core/constants';
import {
  buildMech,
  buildStructure,
  makeHullMaterial,
  type FactionStyle,
  type MechClass,
  type MechRig,
  type StructureKind,
} from '@gen/models';
import { RenderAnchor } from '@render/anchor';
import { AuthoredBuildingPilot } from '@render/authoredBuildingPilot';
import { Environment } from '@render/environment';
import { applyTerrainQuality, makeTerrainMaterial, type TerrainQuality } from '@render/materials/terrainMaterial';
import { BASE_EXPOSURE, Renderer, type QualityLevel } from '@render/renderer';
import { isQualityLevel } from '@render/settings';

const CALIBRATION_TIME = 66;
const CALIBRATION_SEED = 0x3bca1;

/** Faction accents, duplicated locally so the dev page never imports sim data. */
const COMPACT_AMBER = 0xf0821e;
const CHOIR_CYAN = 0x3fd0e8;
const NEUTRAL_STEEL = 0x8fa0b0;

const MECH_CLASSES: readonly MechClass[] = [
  'vanguard', 'longbow', 'wisp', 'aegis', 'bulwark', 'needle',
];

const STRUCTURE_KINDS: readonly StructureKind[] = [
  'bastion', 'extractor', 'solarArray', 'fusionCore', 'fabricator', 'mechFoundry',
  'rocketBattery', 'pointDefense', 'laserGrid', 'radarMast', 'silo', 'spinalNode',
];

/** Kinds repeated in Choir style so the faction architecture grammar is reviewable. */
const CHOIR_COMPARISON_KINDS: readonly StructureKind[] = ['bastion', 'mechFoundry', 'silo'];

export const CALIBRATION_SHEETS = [
  'calibration', 'mechs', 'structures', 'terrain', 'authored', 'all',
] as const;

export type CalibrationSheet = (typeof CALIBRATION_SHEETS)[number];

export function isCalibrationSheet(value: string | null): value is CalibrationSheet {
  return value !== null && (CALIBRATION_SHEETS as readonly string[]).includes(value);
}

export interface CalibrationManifest {
  sheet: CalibrationSheet;
  chromeBalls: number;
  greyBalls: number;
  roughnessSamples: number;
  metalnessSamples: number;
  macbethPatches: number;
  materialSwatches: number;
  referenceMechs: number;
  /** Staged mech rigs on the contact sheet, excluding the calibration reference. */
  sheetMechs: number;
  /** Staged structure models on the contact sheet. */
  sheetStructures: number;
  /** Terrain-material patches, including the large ground plane where present. */
  sheetTerrainPatches: number;
  /** Authored building instances staged from the shipped GLB catalogue. */
  sheetAuthoredBuildings: number;
  quality: QualityLevel;
  toneMapping: 'ACESFilmic';
  outputColorSpace: 'srgb';
  exposure: number;
}

export interface FrameStatistics {
  width: number;
  height: number;
  /** Mean luminance, 0..255. */
  mean: number;
  variance: number;
  /** Fraction of the frame brighter than the space and fog floor. */
  litFraction: number;
  /** Fraction in the emissive and specular range. */
  highlightFraction: number;
  /** Fraction with meaningful saturation, which tracks faction accent presence. */
  chromaticFraction: number;
}

interface SheetFraming {
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  floor: [number, number];
}

/**
 * Per-sheet camera and floor. The calibration entry reproduces the original
 * framing exactly; changing it would invalidate the existing luminance
 * assertions in `e2e/calibration.spec.ts`.
 *
 * The contact sheets are framed noticeably more top-down than a first guess
 * would suggest, and that is deliberate. The key light travels in the ring's
 * xy plane (`DayCycle.keyLightDirection` returns a vector with no z component),
 * so inside a ring the only reliably lit faces are the ones pointing up and
 * spinward. A low camera on the +z axis can therefore only ever photograph the
 * unlit side of every subject. Looking down also matches how the tactical
 * camera actually sees units, which is the view the art has to survive.
 */
const FRAMING: Record<CalibrationSheet, SheetFraming> = {
  calibration: { cameraPosition: [35, 24, 56], cameraTarget: [0, 7, 0], floor: [100, 72] },
  mechs: { cameraPosition: [0, 46, 90], cameraTarget: [0, 4, 0], floor: [170, 110] },
  structures: { cameraPosition: [0, 168, 306], cameraTarget: [0, 8, 0], floor: [360, 400] },
  // Aimed at the swatch row rather than at the origin. Targeting the origin
  // pushes the row's apparent centre right of frame centre under this oblique
  // view and clips the first swatch.
  terrain: { cameraPosition: [0, 98, 206], cameraTarget: [0, 4, 30], floor: [0, 0] },
  // Ten placements rather than the original five, so the row is much wider.
  authored: { cameraPosition: [0, 128, 268], cameraTarget: [0, 16, 0], floor: [420, 420] },
  all: { cameraPosition: [0, 340, 330], cameraTarget: [0, 0, -150], floor: [620, 920] },
};

/**
 * Depth slot for each band on the combined sheet.
 *
 * Chosen so the bands cannot overlap once each one's own internal spread is
 * added. The combined sheet is a smoke surface for confirming every subsystem
 * still renders; the focused sheets are the actual review surfaces, because at
 * this range no single subject is large enough to judge.
 */
const ALL_SHEET_BAND: Record<'structures' | 'mechs' | 'calibration' | 'terrain' | 'authored', number> = {
  structures: -272,
  mechs: -112,
  calibration: -44,
  terrain: -30,
  authored: 90,
};

/**
 * Subject yaw on the contact sheets, in radians.
 *
 * Positive yaw turns a subject's forward (+z) toward +x, which is the direction
 * the key light comes from. At zero the fronts face the camera and sit in shade.
 */
const SHEET_YAW = 0.45;

interface SheetContents {
  mechs: number;
  structures: number;
  terrainPatches: number;
  authoredBuildings: number;
}

export async function startCalibration(container: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const qualityValue = params.get('quality');
  const quality: QualityLevel = isQualityLevel(qualityValue) ? qualityValue : 'high';
  const sheetValue = params.get('sheet');
  const sheet: CalibrationSheet = isCalibrationSheet(sheetValue) ? sheetValue : 'calibration';
  const framing = FRAMING[sheet];

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 12_000);
  camera.position.set(...framing.cameraPosition);
  camera.lookAt(...framing.cameraTarget);
  const renderer = new Renderer(container, camera, quality);
  renderer.autoQuality = false;
  const environment = new Environment(CALIBRATION_SEED);
  environment.keyLight.shadow.mapSize.setScalar(renderer.currentSettings.shadowMapSize);
  environment.setLowQuality(quality === 'low');
  const anchor = new RenderAnchor();
  renderer.scene.add(environment.group);
  environment.buildEnvironment(renderer.gl, renderer.scene);
  const fog = new THREE.FogExp2(environment.fogColor.getHex(), environment.fogDensity);
  renderer.scene.fog = fog;

  if (framing.floor[0] > 0) {
    renderer.scene.add(buildFloor(framing.floor[0], framing.floor[1]));
  }

  const contents: SheetContents = { mechs: 0, structures: 0, terrainPatches: 0, authoredBuildings: 0 };
  // Set once the authored sheet has loaded, so the review frame can show lit
  // windows without the pilot having to be reachable from renderFrame.
  let authoredNightGlow: ((glow: number) => void) | null = null;
  const showAll = sheet === 'all';

  if (sheet === 'calibration' || showAll) {
    // Offset the reference band on the combined sheet so it does not collide
    // with the mech and structure rows behind it.
    const band = showAll ? ALL_SHEET_BAND.calibration : 0;
    renderer.scene.add(referenceBall('calibration:chrome-ball', -19, 5 + band, 1, 0.04, 0xbfc5ca));
    renderer.scene.add(referenceBall('calibration:grey-ball', -10, 5 + band, 0, 0.55, 0x777777));
    renderer.scene.add(buildSweep('calibration:roughness-sweep', -19, -6 + band, 'roughness'));
    renderer.scene.add(buildSweep('calibration:metalness-sweep', -19, -13 + band, 'metalness'));
    renderer.scene.add(buildColorChart(band));
    renderer.scene.add(buildMaterialSwatches(band));
    renderer.scene.add(buildReferenceMech(band));
  }

  if (sheet === 'mechs' || showAll) {
    const group = buildMechSheet(showAll ? ALL_SHEET_BAND.mechs : 0);
    contents.mechs = MECH_CLASSES.length * 2;
    renderer.scene.add(group);
  }

  if (sheet === 'structures' || showAll) {
    const group = buildStructureSheet(showAll ? ALL_SHEET_BAND.structures : 0);
    contents.structures = STRUCTURE_KINDS.length + CHOIR_COMPARISON_KINDS.length;
    renderer.scene.add(group);
  }

  if (sheet === 'terrain' || showAll) {
    const quality = renderer.currentSettings;
    // The combined sheet omits the large ground plane, which would otherwise
    // dwarf every other band.
    const group = buildTerrainSheet(quality, !showAll, showAll ? ALL_SHEET_BAND.terrain : 0);
    contents.terrainPatches = showAll ? TERRAIN_PATCHES.length : TERRAIN_PATCHES.length + 1;
    renderer.scene.add(group);
  }

  if (sheet === 'authored' || showAll) {
    const pilot = new AuthoredBuildingPilot();
    await pilot.load();
    contents.authoredBuildings = layOutAuthoredBuildings(pilot, showAll ? ALL_SHEET_BAND.authored : 0);
    authoredNightGlow = (glow) => pilot.setNightGlow(glow);
    renderer.scene.add(pilot.object);
  }

  const title = document.createElement('div');
  title.className = 'rww-calibration-label';
  title.textContent = `${sheetTitle(sheet)} / GENERATED IN CODE`;
  title.style.cssText = 'position:fixed;left:18px;top:16px;color:#dbe3ec;font:600 12px/1.2 system-ui;letter-spacing:.18em;pointer-events:none';
  document.body.appendChild(title);

  const renderFrame = (): void => {
    environment.update(CALIBRATION_TIME, anchor, camera.position);
    fog.color.copy(environment.fogColor);
    fog.density = environment.fogDensity;
    (renderer.scene.background as THREE.Color).copy(environment.spaceColor);
    // Fixed grain time keeps the sheet byte-reproducible across repeated frames.
    renderer.setGrade(1 - environment.cycle.daylight, CALIBRATION_TIME);
    authoredNightGlow?.(1 - environment.cycle.daylight);
    renderer.render(0);
  };
  renderFrame();

  /**
   * Draw and read back in one synchronous turn.
   *
   * The renderer does not request `preserveDrawingBuffer`, so the colour buffer
   * is not guaranteed to survive compositing. Capturing here, immediately after
   * the draw call, is what makes the screenshot baselines reliable instead of
   * intermittently blank.
   */
  const captureFrame = (): string => {
    renderFrame();
    return renderer.gl.domElement.toDataURL('image/png');
  };

  /**
   * Deterministic image statistics for the current frame.
   *
   * Screenshot baselines catch layout and geometry changes but are compared with
   * a pixel tolerance, which makes them poor at detecting a material going flat
   * or a light losing intensity: those can shift the whole image slightly
   * without tripping a per-pixel threshold. These numbers close that gap, and
   * unlike an image they are readable directly in a failure message.
   */
  const frameStatistics = (): FrameStatistics => {
    renderFrame();
    const gl = renderer.gl.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let sum = 0;
    let squared = 0;
    let lit = 0;
    let highlight = 0;
    let chromatic = 0;
    let samples = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      sum += luminance;
      squared += luminance * luminance;
      // Above the near-black space and fog floor, so this tracks how much of the
      // frame is actually occupied by lit subject matter.
      if (luminance > 24) lit++;
      // Emissive and specular range. Without bloom these clip flat, which is
      // exactly the Task 3 signal.
      if (luminance > 210) highlight++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 26) chromatic++;
      samples++;
    }
    const mean = sum / samples;
    return {
      width,
      height,
      mean,
      variance: squared / samples - mean * mean,
      litFraction: lit / samples,
      highlightFraction: highlight / samples,
      chromaticFraction: chromatic / samples,
    };
  };

  const manifest: CalibrationManifest = {
    sheet,
    chromeBalls: sheet === 'calibration' || showAll ? 1 : 0,
    greyBalls: sheet === 'calibration' || showAll ? 1 : 0,
    roughnessSamples: sheet === 'calibration' || showAll ? 5 : 0,
    metalnessSamples: sheet === 'calibration' || showAll ? 5 : 0,
    macbethPatches: sheet === 'calibration' || showAll ? 24 : 0,
    materialSwatches: sheet === 'calibration' || showAll ? 4 : 0,
    referenceMechs: sheet === 'calibration' || showAll ? 1 : 0,
    sheetMechs: contents.mechs,
    sheetStructures: contents.structures,
    sheetTerrainPatches: contents.terrainPatches,
    sheetAuthoredBuildings: contents.authoredBuildings,
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
    sheet,
    sheets: CALIBRATION_SHEETS,
    renderFrame,
    captureFrame,
    frameStatistics,
  };

  window.addEventListener('resize', () => {
    renderer.resize(container.clientWidth, container.clientHeight);
    renderFrame();
  });
}

function sheetTitle(sheet: CalibrationSheet): string {
  switch (sheet) {
    case 'calibration': return 'PBR CALIBRATION';
    case 'mechs': return 'MECH CONTACT SHEET';
    case 'structures': return 'STRUCTURE CONTACT SHEET';
    case 'terrain': return 'TERRAIN MATERIAL SHEET';
    case 'authored': return 'AUTHORED BUILDING SHEET';
    case 'all': return 'FULL CONTACT SHEET';
  }
}

// ---------------------------------------------------------------------------
// Shared staging
// ---------------------------------------------------------------------------

function buildFloor(width: number, depth: number): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: 0x35312b, roughness: 0.88, metalness: 0.18 }),
  );
  floor.name = 'calibration:floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return floor;
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

function buildColorChart(bandZ: number): THREE.InstancedMesh {
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
    matrix.makeTranslation(-4.3 + (index % 6) * 2.7, 12.8 - Math.floor(index / 6) * 1.9, -16 + bandZ);
    chart.setMatrixAt(index, matrix);
    chart.setColorAt(index, COLOR.setHex(colors[index]));
  }
  chart.instanceMatrix.needsUpdate = true;
  if (chart.instanceColor) chart.instanceColor.needsUpdate = true;
  return chart;
}

function buildMaterialSwatches(bandZ: number): THREE.Group {
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
    swatch.position.set(2 + index * 5.2, 0.6, 10 + bandZ);
    swatch.castShadow = true;
    group.add(swatch);
  }
  return group;
}

function buildReferenceMech(bandZ: number): THREE.Group {
  const rig = buildMech('vanguard', CALIBRATION_SEED, 'compact');
  const hull = makeHullMaterial(COMPACT_AMBER, -1).material;
  const group = new THREE.Group();
  group.name = 'calibration:reference-mech';
  addStandingMech(group, rig, hull);
  group.position.set(19, 0, -4 + bandZ);
  group.rotation.y = -0.36;
  return group;
}

/**
 * Stage a mech in the neutral standing pose used by `EntityRenderer.drawMech`
 * at rest: pelvis and torso on the hip line, both legs straight, feet flat.
 * Eight parts, which `e2e/calibration.spec.ts` asserts.
 */
function addStandingMech(group: THREE.Group, rig: MechRig, material: THREE.Material): void {
  addPart(group, rig.parts.pelvis, material, 0, rig.hipHeight, 0);
  addPart(group, rig.parts.torso, material, 0, rig.hipHeight + rig.height * 0.045, 0);
  for (const side of [-1, 1]) {
    const x = side * rig.hipOffset * 0.5;
    addPart(group, rig.parts.upperLeg, material, x, rig.hipHeight, 0);
    addPart(group, rig.parts.lowerLeg, material, x, rig.hipHeight - rig.legUpper, 0);
    addPart(group, rig.parts.foot, material, x, 0, 0);
  }
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

// ---------------------------------------------------------------------------
// Mech sheet
// ---------------------------------------------------------------------------

/**
 * Every class in both faction styles, Compact in front and Choir behind, so
 * silhouette, proportion, faction grammar, and hull surface can all be compared
 * in one frame.
 */
function buildMechSheet(bandZ: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'calibration:mech-sheet';
  const columnSpacing = 16;
  const firstColumn = -((MECH_CLASSES.length - 1) * columnSpacing) / 2;
  const rows: Array<{ style: FactionStyle; color: number; styleValue: number; z: number }> = [
    { style: 'compact', color: COMPACT_AMBER, styleValue: -1, z: -18 },
    { style: 'choir', color: CHOIR_CYAN, styleValue: 1, z: 18 },
  ];

  for (const row of rows) {
    const hull = makeHullMaterial(row.color, row.styleValue).material;
    for (let index = 0; index < MECH_CLASSES.length; index++) {
      const cls = MECH_CLASSES[index];
      // Same derivation as EntityRenderer, so the sheet shows shipped geometry.
      const rig = buildMech(cls, CALIBRATION_SEED + cls.length * 7919, row.style);
      const mech = new THREE.Group();
      mech.name = `calibration:mech:${cls}:${row.style}`;
      addStandingMech(mech, rig, hull);
      mech.position.set(firstColumn + index * columnSpacing, 0, row.z + bandZ);
      mech.rotation.y = SHEET_YAW;
      group.add(mech);
    }
  }
  return group;
}

// ---------------------------------------------------------------------------
// Structure sheet
// ---------------------------------------------------------------------------

/**
 * All twelve kinds in Compact style across two rows, plus three kinds repeated
 * in Choir style. The uneven detail distribution this reveals is the subject of
 * Task 14 in `docs/procedural-graphics-overhaul.md`.
 */
function buildStructureSheet(bandZ: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'calibration:structure-sheet';
  const compact = makeHullMaterial(COMPACT_AMBER, -1).material;
  const choir = makeHullMaterial(CHOIR_CYAN, 1).material;
  const neutral = makeHullMaterial(NEUTRAL_STEEL).material;

  // Rows are separated generously because the tallest structures reach 40 m and
  // would otherwise occlude whatever sits behind them.
  const rows: Array<{ kinds: readonly StructureKind[]; style: FactionStyle; z: number }> = [
    { kinds: STRUCTURE_KINDS.slice(0, 6), style: 'compact', z: -128 },
    { kinds: STRUCTURE_KINDS.slice(6), style: 'compact', z: -14 },
    { kinds: CHOIR_COMPARISON_KINDS, style: 'choir', z: 104 },
  ];

  for (const row of rows) {
    const models = row.kinds.map((kind) => ({
      kind,
      // Same derivation as EntityRenderer.
      model: buildStructure(kind, CALIBRATION_SEED + kind.length * 104729, row.style),
    }));
    const gap = 12;
    const width = models.reduce((total, entry) => total + entry.model.radius * 2, 0)
      + gap * (models.length - 1);
    let cursor = -width / 2;
    for (const entry of models) {
      cursor += entry.model.radius;
      // spinalNode is a pre-existing megastructure fixture and is never in a
      // faction style, matching how EntityRenderer materialises it.
      const material = entry.kind === 'spinalNode' ? neutral : (row.style === 'choir' ? choir : compact);
      const mesh = new THREE.Mesh(entry.model.geometry, material);
      mesh.name = `calibration:structure:${entry.kind}:${row.style}`;
      mesh.position.set(cursor, 0, row.z + bandZ);
      mesh.rotation.y = SHEET_YAW;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      cursor += entry.model.radius + gap;
    }
  }
  return group;
}

// ---------------------------------------------------------------------------
// Terrain sheet
// ---------------------------------------------------------------------------

interface TerrainPatch {
  readonly id: string;
  /** Ring surface coordinates fed to the material through `aSurface`. */
  readonly s: number;
  readonly z: number;
  /** Baked geometry tilt in radians, which is what drives the slope term. */
  readonly tilt: number;
  /**
   * Splat weights staged explicitly: dust, rock, bared deck, rim wall.
   *
   * SET HERE RATHER THAN SAMPLED FROM A REAL TERRAIN, because this is a reference
   * chart and not a screenshot of the world. Sampling would show whatever four
   * layers the seed happened to put under seven arbitrary coordinates, and bared
   * deck covers well under a tenth of the ring, so the layer most likely to
   * regress would be the one least likely to appear. Staging the weights
   * guarantees every layer and the interesting mixtures are all on the sheet.
   *
   * They must sum to one, exactly as the baked attribute does.
   */
  readonly splat: readonly [number, number, number, number];
  /** Baked curvature: negative on a crest, positive in a bowl. Drives the damp staining. */
  readonly curvature: number;
  /** Baked sky visibility: 1 open, lower when enclosed. Drives indirect occlusion. */
  readonly ao: number;
}

/**
 * One patch per material state, plus the mixtures and the two terms that are
 * invisible on open flat ground.
 *
 * The tilted entries exercise the slope-driven strata banding, which needs a real
 * surface normal; the rim entry exercises the ring-frame wall projection and its
 * metalness; the enclosed entry exercises the baked occlusion, which by design
 * does nothing at all where the sky is open.
 */
const TERRAIN_PATCHES: readonly TerrainPatch[] = [
  // Deliberately not GROUND_PLANE_S. A patch sampling the same coordinates as
  // the ground plane it sits on renders identically and becomes invisible.
  //
  // ONE VARIABLE AT A TIME. The first three share a surface coordinate, a splat,
  // and a tilt, and differ only in the field being shown, so each is a direct A/B
  // against `dust`. The first version of this sheet moved occlusion and curvature
  // together on one patch, which made it impossible to tell which of the two had
  // produced the difference -- or, as it turned out, whether one of them was doing
  // anything at all.
  { id: 'dust', s: 20_500, z: 1_400, tilt: 0, splat: [1, 0, 0, 0], curvature: 0, ao: 1 },
  { id: 'dust-occluded', s: 20_500, z: 1_400, tilt: 0, splat: [1, 0, 0, 0], curvature: 0, ao: 0.5 },
  { id: 'dust-damp', s: 20_500, z: 1_400, tilt: 0, splat: [1, 0, 0, 0], curvature: 0.9, ao: 1 },
  { id: 'rock', s: 11_300, z: 600, tilt: 0.42, splat: [0.12, 0.88, 0, 0], curvature: -0.5, ao: 1 },
  { id: 'rock-steep', s: 17_000, z: -900, tilt: 0.85, splat: [0.05, 0.95, 0, 0], curvature: -0.7, ao: 1 },
  { id: 'deck', s: 9_400, z: 200, tilt: 0, splat: [0.1, 0.15, 0.75, 0], curvature: 0, ao: 1 },
  { id: 'rim', s: 4_000, z: RING_HALF_WIDTH * 0.95, tilt: 0, splat: [0, 0, 0, 1], curvature: 0, ao: 1 },
];

/** Ring position the large reference ground plane is centred on. */
const GROUND_PLANE_S = 1_200;

/**
 * The production terrain material, staged on flat and tilted patches.
 *
 * Two details make this show the real thing rather than an approximation.
 * First, `aSurface` is an independent attribute, so a patch can sample any ring
 * coordinate while sitting in front of the camera. Second, the shader derives
 * local up from object-space position, so baking the tilt into the geometry
 * (rather than rotating the mesh) is what produces a real slope reading.
 */
function buildTerrainSheet(quality: TerrainQuality, includeGroundPlane: boolean, bandZ: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'calibration:terrain-sheet';
  const { material, uniforms } = makeTerrainMaterial();
  applyTerrainQuality(uniforms, quality);
  // Park the sample point between two shadow squares. Left at zero, every patch
  // would sit inside a shadow band and read as deep shade.
  uniforms.uPanelPhase.value = Math.PI / SHADOW_SQUARE_COUNT;

  if (includeGroundPlane) {
    // Large enough to show both panel-line scales: structural bays at 420 m and
    // deck plates at 60 m.
    // Mostly dust with a little rock and deck showing, which is what the open ring
    // floor actually looks like, and enough deck for the plate joins to appear.
    const plane = new THREE.Mesh(
      terrainPatchGeometry(480, 48, GROUND_PLANE_S, 0, 0, {
        splat: [0.68, 0.2, 0.12, 0],
        curvature: 0.1,
        ao: 0.96,
      }),
      material,
    );
    plane.name = 'calibration:terrain:ground-plane';
    plane.position.set(0, 0, -60 + bandZ);
    plane.receiveShadow = true;
    group.add(plane);
  }

  const spacing = 28;
  const firstColumn = -((TERRAIN_PATCHES.length - 1) * spacing) / 2;
  for (let index = 0; index < TERRAIN_PATCHES.length; index++) {
    const patch = TERRAIN_PATCHES[index];
    const mesh = new THREE.Mesh(terrainPatchGeometry(24, 16, patch.s, patch.z, patch.tilt, patch), material);
    mesh.name = `calibration:terrain:${patch.id}`;
    mesh.position.set(firstColumn + index * spacing, 6, 50 + bandZ);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/**
 * A flat grid carrying ring surface coordinates, optionally tilted about the
 * spinward axis. Positions stay centred on the origin so the shader's
 * object-space ring frame keeps reading as level ground.
 */
function terrainPatchGeometry(
  size: number,
  segments: number,
  surfaceS: number,
  surfaceZ: number,
  tilt: number,
  fields: Pick<TerrainPatch, 'splat' | 'curvature' | 'ao'>,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  if (tilt !== 0) geometry.rotateZ(tilt);

  const position = geometry.getAttribute('position');
  const surface = new Float32Array(position.count * 2);
  // The material reads these as normalised integer attributes, so a patch has to
  // supply them in the same form the ring mesh bakes. Without them WebGL feeds the
  // shader an unspecified default -- (0,0,0,1) for a vec4, which is pure rim wall,
  // and zero for the occlusion float, which is total darkness -- and every swatch
  // on the sheet would be wrong in a way that looks deliberate.
  const splat = new Uint8Array(position.count * 4);
  const curvature = new Int8Array(position.count);
  const ambient = new Uint8Array(position.count);

  for (let index = 0; index < position.count; index++) {
    // Undo the tilt when deriving surface coordinates so the material samples a
    // square region of ring surface regardless of how the patch is angled. The
    // axial coordinate is unaffected, because the tilt is about the ring axis.
    const localS = tilt === 0 ? position.getX(index) : position.getX(index) / Math.cos(tilt);
    surface[index * 2] = wrapSurface(surfaceS + localS);
    surface[index * 2 + 1] = clampAxial(surfaceZ + position.getZ(index));

    splat[index * 4] = Math.round(fields.splat[0] * 255);
    splat[index * 4 + 1] = Math.round(fields.splat[1] * 255);
    splat[index * 4 + 2] = Math.round(fields.splat[2] * 255);
    splat[index * 4 + 3] = Math.round(fields.splat[3] * 255);
    curvature[index] = Math.max(-127, Math.min(127, Math.round(fields.curvature * 127)));
    ambient[index] = Math.round(fields.ao * 255);
  }

  geometry.setAttribute('aSurface', new THREE.BufferAttribute(surface, 2));
  geometry.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4, true));
  geometry.setAttribute('aCurvature', new THREE.BufferAttribute(curvature, 1, true));
  geometry.setAttribute('aAO', new THREE.BufferAttribute(ambient, 1, true));
  return geometry;
}

function wrapSurface(s: number): number {
  const wrapped = s % RING_CIRCUMFERENCE;
  return wrapped < 0 ? wrapped + RING_CIRCUMFERENCE : wrapped;
}

function clampAxial(z: number): number {
  return z < -RING_HALF_WIDTH ? -RING_HALF_WIDTH : z > RING_HALF_WIDTH ? RING_HALF_WIDTH : z;
}

// ---------------------------------------------------------------------------
// Authored building sheet
// ---------------------------------------------------------------------------

/**
 * Lay the shipped authored models out in a row, spaced by their real footprints.
 *
 * `AuthoredBuildingPilot` is reused rather than reimplemented so the sheet shows
 * exactly the normalisation and material treatment that ship, including the flat
 * sandstone albedo that Task 7 exists to replace. Its `update()` is deliberately
 * not called, because that would place the models in ring space rather than in a
 * review row.
 *
 * Each instance is reparented into a wrapper before being positioned. The pilot
 * stores its footprint-centring and ground-alignment offset on the instance's own
 * `position`, so writing to that property directly would silently discard it.
 * Note that the shipped `update()` does exactly that, which is a pre-existing
 * placement bug recorded against Task 7 rather than something to fix here.
 */
function layOutAuthoredBuildings(pilot: AuthoredBuildingPilot, bandZ: number): number {
  const bounds = new THREE.Box3();
  const size = new THREE.Vector3();
  const instances = [...pilot.object.children];
  const gap = 10;

  const wrapped = instances.map((instance) => {
    const wrapper = new THREE.Group();
    wrapper.name = `calibration:authored:${instance.name}`;
    wrapper.add(instance);
    // Space on the model's own x extent. Using the larger of x and z
    // overestimates anything deeper than it is wide and leaves gaps in the row.
    bounds.setFromObject(wrapper);
    bounds.getSize(size);
    return { wrapper, width: size.x };
  });

  // Two rows rather than one. Ten buildings in a single row spans roughly 500
  // units, which forces the camera far enough back that the surface detail this
  // sheet exists to review is no longer legible.
  const rowCount = 2;
  const perRow = Math.ceil(wrapped.length / rowCount);
  const rowDepth = 150;
  for (let row = 0; row < rowCount; row++) {
    const entries = wrapped.slice(row * perRow, (row + 1) * perRow);
    if (entries.length === 0) continue;
    const total = entries.reduce((sum, entry) => sum + entry.width, 0) + gap * (entries.length - 1);
    let cursor = -total / 2;
    const z = bandZ + (row - (rowCount - 1) / 2) * rowDepth;
    for (const entry of entries) {
      cursor += entry.width / 2;
      entry.wrapper.position.set(cursor, 0, z);
      pilot.object.add(entry.wrapper);
      cursor += entry.width / 2 + gap;
    }
  }
  pilot.object.updateMatrixWorld(true);
  return wrapped.length;
}

const COLOR = new THREE.Color();
