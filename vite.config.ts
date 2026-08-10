import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const alias = {
  '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
  '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
  '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
  '@gen': fileURLToPath(new URL('./src/gen', import.meta.url)),
  '@ai': fileURLToPath(new URL('./src/ai', import.meta.url)),
  '@headless': fileURLToPath(new URL('./src/headless', import.meta.url)),
  '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
};

export { alias };

const root = fileURLToPath(new URL('.', import.meta.url));
const progressFile = resolve(root, 'docs/launch-scope-progress.json');
const roadmapFiles = [
  resolve(root, 'docs/publishable-game-roadmap.md'),
  resolve(root, 'docs/roadmap.md'),
] as const;
const goalsFile = resolve(root, '.opencode/goals/state.json');
const loopsDirectory = resolve(root, '.opencode/opencode-loop');
const runsDirectory = resolve(root, 'output/runs');
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_RECEIPT_BYTES = 512 * 1024;
const MAX_EVIDENCE_SOURCE_BYTES = 2 * 1024 * 1024;
const evidenceDigestCache = new Map<string, { size: number; mtimeMs: number; digest: string }>();
const RECEIPT_LIMIT = 8;
const LOOP_FILE_LIMIT = 3;
const RECEIPT_COMMANDS = new Set([
  'doctor',
  'perf',
  'phase4e-browser-qualification',
  'play',
  'run',
  'visual',
]);
const RECEIPT_STATUSES = new Set(['error', 'failed', 'failure', 'success']);
const SLICE_STATES = new Set(['complete', 'active', 'queued']);
const SLICE_QUALIFICATIONS = new Set(['not-run', 'pending', 'automation-passed']);
const SLICE_DISPOSITIONS = new Set(['pending', 'clean', 'polish-backlog']);
const COMPLETE_DISPOSITIONS = new Set(['clean', 'polish-backlog']);
const GATE_STATES = new Set(['passed', 'in-progress', 'open']);
export const CLAIM_EVIDENCE_POLICY = Object.freeze({
  'LS-01': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-01.json',
    sourcePaths: Object.freeze(['docs/publishable-game-roadmap.md']),
    checkIds: Object.freeze(['authoritative-launch-contract']),
  }),
  'LS-02': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-02.json',
    sourcePaths: Object.freeze([
      'docs/gate-1.md',
      'docs/roadmap.md',
      'validation/evidence/full-suite-2026-08-05.json',
    ]),
    checkIds: Object.freeze(['technical-baseline-reproducible']),
  }),
  'LS-03': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-03.json',
    sourcePaths: Object.freeze(['docs/roadmap.md']),
    checkIds: Object.freeze(['faction-perspective-authority']),
  }),
  'LS-04': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-04.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-04-runtime-scenario-2026-08-07.json',
      'validation/references/sc2-wings-of-liberty.json',
    ]),
    checkIds: Object.freeze(['runtime-scenario-world-factory']),
  }),
  'LS-05': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-05.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-05-campaign-platform-2026-08-07.json',
      'validation/evidence/reviews/ls-05-criterion-review-2026-08-07.json',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['campaign-registry-profile-lifecycle']),
  }),
  'LS-06': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-06.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-06-camera-controller-2026-08-07.json',
      'validation/evidence/reviews/ls-06-criterion-review-2026-08-07.json',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['camera-controller-lifecycle']),
  }),
  'LS-07': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-07.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-07-paired-nodes-2026-08-07.json',
      'validation/evidence/reviews/ls-07-criterion-review-2026-08-07.json',
      'docs/launch-scope/ls-07-paired-spinal-nodes.md',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['paired-spinal-node-alignment']),
  }),
  'LS-08': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-08.json',
    sourcePaths: Object.freeze([
      'docs/launch-scope/ls-08-directional-advantage.md',
      'docs/playtests/2026-08-09-directional-artillery-g01.md',
      'validation/evidence/directional-artillery-visual.json',
      'validation/evidence/reviews/ls-08-criterion-review-2026-08-09.json',
      'validation/evidence/launch-scope/G-01.json',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['directional-advantage-onboarding']),
  }),
  'LS-09': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-09.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-09-shadow-intelligence-2026-08-09.json',
      'validation/evidence/reviews/ls-09-criterion-review-2026-08-09.json',
      'docs/launch-scope/ls-09-shadow-timing-overhead-intelligence.md',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['shadow-timing-overhead-intelligence']),
  }),
  'LS-10': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-10.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-10-whole-ring-strategic-view-2026-08-09.json',
      'validation/evidence/reviews/ls-10-criterion-review-2026-08-09.json',
      'docs/launch-scope/ls-10-whole-ring-strategic-view.md',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['whole-ring-strategic-view']),
  }),
  'LS-11': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-11.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-11-gravity-range-2026-08-09.json',
      'validation/evidence/reviews/ls-11-criterion-review-2026-08-09.json',
      'docs/launch-scope/ls-11-gravity-range.md',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['gravity-range-mode']),
  }),
  'LS-12': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-12.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-12-layered-district-scatter-2026-08-09.json',
      'validation/evidence/reviews/ls-12-criterion-review-2026-08-09.json',
      'docs/launch-scope/ls-12-layered-district-scatter.md',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['layered-district-scatter-foundation']),
  }),
  'LS-13': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-13.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-13-environmental-district-palettes-2026-08-09.json',
      'validation/evidence/reviews/ls-13-criterion-review-2026-08-09.json',
      'docs/launch-scope/ls-13-environmental-district-palettes.md',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['environmental-district-palettes']),
  }),
  'LS-14': Object.freeze({
    acceptedState: 'complete',
    receiptPath: 'validation/evidence/launch-scope/LS-14.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-14-inhabited-ring-life-2026-08-10.json',
      'validation/evidence/reviews/ls-14-criterion-review-2026-08-10.json',
      'docs/launch-scope/ls-14-inhabited-ring-life.md',
      'docs/launch-scope-execution-policy.md',
    ]),
    checkIds: Object.freeze(['inhabited-ring-life']),
  }),
  'G-01': Object.freeze({
    acceptedState: 'passed',
    receiptPath: 'validation/evidence/launch-scope/G-01.json',
    sourcePaths: Object.freeze([
      'docs/launch-scope/ls-08-directional-advantage.md',
      'docs/playtests/2026-08-09-directional-artillery-g01.md',
    ]),
    checkIds: Object.freeze(['developer-reviewed-initial-cohort']),
  }),
  'G-05': Object.freeze({
    acceptedState: 'passed',
    receiptPath: 'validation/evidence/launch-scope/G-05.json',
    sourcePaths: Object.freeze([
      'validation/evidence/ls-14-inhabited-ring-life-2026-08-10.json',
      'validation/evidence/reviews/ls-14-criterion-review-2026-08-10.json',
      'docs/launch-scope/ls-14-inhabited-ring-life.md',
    ]),
    checkIds: Object.freeze(['inhabited-battlefield-legibility']),
  }),
  'G-07': Object.freeze({
    acceptedState: 'passed',
    receiptPath: 'validation/evidence/launch-scope/G-07.json',
    sourcePaths: Object.freeze([
      'docs/t480s-low-performance.md',
      'validation/evidence/phase-4c-t480s-quality-2026-08-05.json',
    ]),
    checkIds: Object.freeze(['t480s-720p-low-contract']),
  }),
} as const);

type ClaimEvidenceId = keyof typeof CLAIM_EVIDENCE_POLICY;

export const LS07_ACCEPTANCE_IDS = Object.freeze([
  'topology',
  'capture',
  'alignment',
  'gameplay-consequence',
  'ai',
  'persistence',
  'presentation',
  'regression',
  'scope',
] as const);

export const LS08_ACCEPTANCE_IDS = Object.freeze([
  'directional-profile',
  'weapon-mode-gate',
  'presentation-accessibility',
  'authoritative-targeting',
  'onboarding',
  'regression-scope',
] as const);

export const LS09_ACCEPTANCE_IDS = Object.freeze([
  'shadow-authority',
  'gameplay-consequences',
  'launch-intelligence',
  'strategic-contacts',
  'authority-ai',
  'presentation-accessibility',
  'persistence-regression',
  'scope',
] as const);

export const LS09_REQUIRED_SOURCE_PATHS = Object.freeze([
  'src/core/shadow.ts',
  'src/sim/data.ts',
  'src/sim/world.ts',
  'src/game.ts',
  'src/main.ts',
  'src/render/environment.ts',
  'src/render/effects.ts',
  'src/render/presentationEvents.ts',
  'src/audio/audioEngine.ts',
  'src/ai/opponent.ts',
  'src/ui/hud.ts',
  'tests/core/shadow.test.ts',
  'tests/sim/shadowIntelligence.test.ts',
  'tests/sim/vision.test.ts',
  'tests/render/environment.test.ts',
  'tests/render/presentationEvents.test.ts',
  'tests/audio/audioEngine.test.ts',
  'tests/ai/strategist.test.ts',
  'tests/ui/hud.test.ts',
  'e2e/shadow-intelligence.spec.ts',
] as const);

export const LS10_ACCEPTANCE_IDS = Object.freeze([
  'dedicated-view',
  'simplified-annulus',
  'shadow-authority',
  'strategic-authority',
  'input-isolation',
  'presentation-accessibility',
  'lifecycle-regression',
] as const);

export const LS10_REQUIRED_SOURCE_PATHS = Object.freeze([
  'src/render/strategicAnnulus.ts',
  'src/render/cameraController.ts',
  'src/game.ts',
  'src/main.ts',
  'src/ui/hud.ts',
  'src/ui/settingsMenu.ts',
  'tests/render/strategicAnnulus.test.ts',
  'tests/render/cameraController.test.ts',
  'e2e/whole-ring-strategic-view.spec.ts',
  'e2e/camera-controller.spec.ts',
  'e2e/camera-transaction.spec.ts',
  'e2e/shadow-intelligence.spec.ts',
  'e2e/spinal-alignment.spec.ts',
] as const);

export const LS10_RUN_POLICY = Object.freeze({
  'focused-unit': Object.freeze({
    command: 'npx vitest run tests/render/cameraController.test.ts tests/render/strategicAnnulus.test.ts tests/ui/hud.test.ts',
    artifactPath: 'validation/evidence/runs/ls-10-focused-unit-2026-08-09.json',
  }),
  'focused-browser': Object.freeze({
    command: 'npx playwright test e2e/whole-ring-strategic-view.spec.ts e2e/camera-controller.spec.ts e2e/camera-transaction.spec.ts e2e/shadow-intelligence.spec.ts e2e/spinal-alignment.spec.ts --project=chromium-regression',
    artifactPath: 'validation/evidence/runs/ls-10-focused-browser-2026-08-09.json',
  }),
  'full-check': Object.freeze({
    command: 'npm run check',
    artifactPath: 'validation/evidence/runs/ls-10-full-check-2026-08-09.json',
  }),
  'core-match': Object.freeze({
    command: 'npm run validate:core-match',
    artifactPath: 'validation/evidence/runs/ls-10-core-match-2026-08-09.json',
  }),
} as const);

type LS10RunId = keyof typeof LS10_RUN_POLICY;

export const LS10_RUN_TEST_IDS = Object.freeze({
  'focused-unit': Object.freeze([
    'whole-ring-registration',
    'whole-ring-camera-restoration',
    'whole-ring-quality-restoration',
    'whole-ring-projection',
    'strategic-annulus-authority',
    'strategic-annulus-disposal',
  ]),
  'focused-browser': Object.freeze([
    'whole-ring-strategic-view',
    'direct-camera-regression',
    'camera-transaction-regression',
    'shadow-intelligence-regression',
    'spinal-alignment-regression',
  ]),
  'full-check': Object.freeze(['full-check']),
  'core-match': Object.freeze(['core-match-cohorts']),
} as const);

export const LS10_CHECK_POLICY = Object.freeze({
  'dedicated-view': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS10RunId[]), testIds: Object.freeze(['whole-ring-registration', 'whole-ring-camera-restoration', 'whole-ring-quality-restoration', 'whole-ring-strategic-view']) }),
  'simplified-annulus': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS10RunId[]), testIds: Object.freeze(['whole-ring-projection', 'strategic-annulus-authority', 'whole-ring-strategic-view']) }),
  'shadow-authority': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS10RunId[]), testIds: Object.freeze(['strategic-annulus-authority', 'shadow-intelligence-regression']) }),
  'strategic-authority': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS10RunId[]), testIds: Object.freeze(['strategic-annulus-authority', 'whole-ring-strategic-view', 'spinal-alignment-regression']) }),
  'input-isolation': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS10RunId[]), testIds: Object.freeze(['whole-ring-registration', 'whole-ring-strategic-view', 'camera-transaction-regression']) }),
  'presentation-accessibility': Object.freeze({ runIds: Object.freeze(['focused-browser'] as LS10RunId[]), testIds: Object.freeze(['whole-ring-strategic-view']) }),
  'lifecycle-regression': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser', 'full-check', 'core-match'] as LS10RunId[]), testIds: Object.freeze(['strategic-annulus-disposal', 'direct-camera-regression', 'full-check', 'core-match-cohorts']) }),
} as const);

export const LS11_ACCEPTANCE_IDS = Object.freeze([
  'production-launch',
  'canonical-setup',
  'authoritative-loop',
  'direction-comprehension',
  'input-observation',
  'presentation-accessibility',
  'lifecycle-regression',
] as const);

export const LS11_REQUIRED_SOURCE_PATHS = Object.freeze([
  'src/arcade/gravityRange.ts',
  'src/arcade/gravityRangeScenario.ts',
  'src/scenario/runtimeScenario.ts',
  'src/scenario/worldFactory.ts',
  'src/sim/ballistics.ts',
  'src/sim/data.ts',
  'src/sim/world.ts',
  'src/game.ts',
  'src/main.ts',
  'src/render/cameraController.ts',
  'src/ui/gravityRangePanel.ts',
  'src/ui/hud.ts',
  'src/ui/settingsMenu.ts',
  'src/ui/titleScreen.ts',
  'src/ui/titleScreen.css',
  'tests/arcade/gravityRange.test.ts',
  'tests/scenario/runtimeScenario.test.ts',
  'tests/sim/artillery.test.ts',
  'tests/sim/ballistics.test.ts',
  'e2e/gravity-range.spec.ts',
  'e2e/whole-ring-strategic-view.spec.ts',
  'e2e/title-screen.spec.ts',
] as const);

export const LS11_RUN_POLICY = Object.freeze({
  'focused-unit': Object.freeze({
    command: 'npx vitest run tests/arcade/gravityRange.test.ts tests/sim/ballistics.test.ts tests/sim/artillery.test.ts tests/scenario/runtimeScenario.test.ts',
    artifactPath: 'validation/evidence/runs/ls-11-focused-unit-2026-08-09.json',
  }),
  'focused-browser': Object.freeze({
    command: 'npx playwright test e2e/gravity-range.spec.ts e2e/whole-ring-strategic-view.spec.ts e2e/title-screen.spec.ts --project=chromium-regression',
    artifactPath: 'validation/evidence/runs/ls-11-focused-browser-2026-08-09.json',
  }),
  'full-check': Object.freeze({
    command: 'npm run check',
    artifactPath: 'validation/evidence/runs/ls-11-full-check-2026-08-09.json',
  }),
  'core-match': Object.freeze({
    command: 'npm run validate:core-match',
    artifactPath: 'validation/evidence/runs/ls-11-core-match-2026-08-09.json',
  }),
} as const);

type LS11RunId = keyof typeof LS11_RUN_POLICY;

export const LS11_RUN_TEST_IDS = Object.freeze({
  'focused-unit': Object.freeze([
    'gravity-range-setup',
    'gravity-range-loop',
    'gravity-range-authority',
    'directional-ballistics-regression',
    'artillery-authority-regression',
    'runtime-scenario-regression',
  ]),
  'focused-browser': Object.freeze([
    'gravity-range-production',
    'gravity-range-responsive',
    'gravity-range-keyboard',
    'gravity-range-lifecycle',
    'whole-ring-strategic-view-regression',
    'title-screen-regression',
  ]),
  'full-check': Object.freeze(['full-check']),
  'core-match': Object.freeze(['core-match-cohorts']),
} as const);

export const LS11_CHECK_POLICY = Object.freeze({
  'production-launch': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS11RunId[]), testIds: Object.freeze(['gravity-range-setup', 'gravity-range-production', 'title-screen-regression']) }),
  'canonical-setup': Object.freeze({ runIds: Object.freeze(['focused-unit'] as LS11RunId[]), testIds: Object.freeze(['gravity-range-setup', 'directional-ballistics-regression', 'runtime-scenario-regression']) }),
  'authoritative-loop': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS11RunId[]), testIds: Object.freeze(['gravity-range-loop', 'gravity-range-authority', 'artillery-authority-regression', 'gravity-range-production']) }),
  'direction-comprehension': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS11RunId[]), testIds: Object.freeze(['gravity-range-loop', 'gravity-range-production', 'gravity-range-keyboard']) }),
  'input-observation': Object.freeze({ runIds: Object.freeze(['focused-browser'] as LS11RunId[]), testIds: Object.freeze(['gravity-range-production', 'gravity-range-keyboard', 'whole-ring-strategic-view-regression']) }),
  'presentation-accessibility': Object.freeze({ runIds: Object.freeze(['focused-browser'] as LS11RunId[]), testIds: Object.freeze(['gravity-range-production', 'gravity-range-responsive', 'gravity-range-keyboard']) }),
  'lifecycle-regression': Object.freeze({ runIds: Object.freeze(['focused-browser', 'full-check', 'core-match'] as LS11RunId[]), testIds: Object.freeze(['gravity-range-keyboard', 'gravity-range-lifecycle', 'whole-ring-strategic-view-regression', 'full-check', 'core-match-cohorts']) }),
} as const);

export const LS12_ACCEPTANCE_IDS = Object.freeze([
  'authored-layer-contract',
  'deterministic-scatter',
  'ring-terrain-placement',
  'presentation-authority',
  'quality-readability',
  'lifecycle-regression',
  'presentation-acceptance',
] as const);

export const LS12_REQUIRED_SOURCE_PATHS = Object.freeze([
  'src/render/districtPlan.ts',
  'src/render/battlefieldDressing.ts',
  'src/render/renderer.ts',
  'src/main.ts',
  'tests/render/districtPlan.test.ts',
  'tests/render/battlefieldDressing.test.ts',
  'tests/render/disposal.test.ts',
  'tests/render/settings.test.ts',
  'e2e/layered-district-scatter.spec.ts',
  'playwright.ls12.config.ts',
] as const);

export const LS12_RUN_POLICY = Object.freeze({
  'focused-unit': Object.freeze({
    command: 'npx vitest run tests/render/districtPlan.test.ts tests/render/battlefieldDressing.test.ts tests/render/disposal.test.ts tests/render/settings.test.ts',
    artifactPath: 'validation/evidence/runs/ls-12-focused-unit-2026-08-09.json',
  }),
  'focused-browser': Object.freeze({
    command: 'npm run test:e2e:ls12',
    artifactPath: 'validation/evidence/runs/ls-12-focused-browser-2026-08-09.json',
  }),
  'full-check': Object.freeze({
    command: 'npm run check',
    artifactPath: 'validation/evidence/runs/ls-12-full-check-2026-08-09.json',
  }),
  'core-match': Object.freeze({
    command: 'npm run validate:core-match',
    artifactPath: 'validation/evidence/runs/ls-12-core-match-2026-08-09.json',
  }),
} as const);

type LS12RunId = keyof typeof LS12_RUN_POLICY;

export const LS12_RUN_TEST_IDS = Object.freeze({
  'focused-unit': Object.freeze([
    'district-plan-contract',
    'deterministic-bounded-scatter',
    'ring-terrain-placement',
    'terrain-authority-isolation',
    'quality-priority-budget',
    'district-resource-disposal',
  ]),
  'focused-browser': Object.freeze([
    'production-low-district-foundation',
    'production-quality-resource-authority',
  ]),
  'full-check': Object.freeze(['full-check']),
  'core-match': Object.freeze(['core-match-cohorts']),
} as const);

export const LS12_CHECK_POLICY = Object.freeze({
  'authored-layer-contract': Object.freeze({ runIds: Object.freeze(['focused-unit'] as LS12RunId[]), testIds: Object.freeze(['district-plan-contract']) }),
  'deterministic-scatter': Object.freeze({ runIds: Object.freeze(['focused-unit'] as LS12RunId[]), testIds: Object.freeze(['deterministic-bounded-scatter']) }),
  'ring-terrain-placement': Object.freeze({ runIds: Object.freeze(['focused-unit'] as LS12RunId[]), testIds: Object.freeze(['ring-terrain-placement']) }),
  'presentation-authority': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser', 'core-match'] as LS12RunId[]), testIds: Object.freeze(['terrain-authority-isolation', 'production-quality-resource-authority', 'core-match-cohorts']) }),
  'quality-readability': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS12RunId[]), testIds: Object.freeze(['quality-priority-budget', 'production-low-district-foundation']) }),
  'lifecycle-regression': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser', 'full-check', 'core-match'] as LS12RunId[]), testIds: Object.freeze(['district-resource-disposal', 'production-quality-resource-authority', 'full-check', 'core-match-cohorts']) }),
  'presentation-acceptance': Object.freeze({ runIds: Object.freeze(['focused-browser'] as LS12RunId[]), testIds: Object.freeze(['production-low-district-foundation']) }),
} as const);

export const LS13_ACCEPTANCE_IDS = Object.freeze([
  'strict-palette-contract',
  'reusable-authored-coverage',
  'deterministic-identity',
  'fixed-render-topology',
  'low-readability',
  'authority-lifecycle',
  'regression-review',
] as const);

export const LS13_REQUIRED_SOURCE_PATHS = Object.freeze([
  'src/render/districtPlan.ts',
  'src/render/battlefieldDressing.ts',
  'tests/render/districtPlan.test.ts',
  'tests/render/battlefieldDressing.test.ts',
  'e2e/environmental-district-palettes.spec.ts',
  'playwright.ls13.config.ts',
] as const);

export const LS13_RUN_POLICY = Object.freeze({
  'focused-unit': Object.freeze({
    command: 'npx vitest run tests/render/districtPlan.test.ts tests/render/battlefieldDressing.test.ts tests/render/disposal.test.ts tests/render/settings.test.ts',
    artifactPath: 'validation/evidence/runs/ls-13-focused-unit-2026-08-09.json',
  }),
  'focused-browser': Object.freeze({
    command: 'npm run test:e2e:ls13',
    artifactPath: 'validation/evidence/runs/ls-13-focused-browser-2026-08-09.json',
  }),
  'full-check': Object.freeze({
    command: 'npm run check',
    artifactPath: 'validation/evidence/runs/ls-13-full-check-2026-08-09.json',
  }),
  'core-match': Object.freeze({
    command: 'npm run validate:core-match',
    artifactPath: 'validation/evidence/runs/ls-13-core-match-2026-08-09.json',
  }),
} as const);

type LS13RunId = keyof typeof LS13_RUN_POLICY;

export const LS13_RUN_TEST_IDS = Object.freeze({
  'focused-unit': Object.freeze([
    'strict-palette-contract',
    'reusable-authored-coverage',
    'deterministic-palette-identity',
    'fixed-render-topology',
    'authority-lifecycle',
  ]),
  'focused-browser': Object.freeze([
    'production-low-four-palettes',
    'production-palette-quality-authority',
  ]),
  'full-check': Object.freeze(['full-check']),
  'core-match': Object.freeze(['core-match-cohorts']),
} as const);

export const LS13_CHECK_POLICY = Object.freeze({
  'strict-palette-contract': Object.freeze({ runIds: Object.freeze(['focused-unit'] as LS13RunId[]), testIds: Object.freeze(['strict-palette-contract']) }),
  'reusable-authored-coverage': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS13RunId[]), testIds: Object.freeze(['reusable-authored-coverage', 'production-low-four-palettes']) }),
  'deterministic-identity': Object.freeze({ runIds: Object.freeze(['focused-unit'] as LS13RunId[]), testIds: Object.freeze(['deterministic-palette-identity']) }),
  'fixed-render-topology': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS13RunId[]), testIds: Object.freeze(['fixed-render-topology', 'production-low-four-palettes']) }),
  'low-readability': Object.freeze({ runIds: Object.freeze(['focused-browser'] as LS13RunId[]), testIds: Object.freeze(['production-low-four-palettes']) }),
  'authority-lifecycle': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser', 'core-match'] as LS13RunId[]), testIds: Object.freeze(['authority-lifecycle', 'production-palette-quality-authority', 'core-match-cohorts']) }),
  'regression-review': Object.freeze({ runIds: Object.freeze(['focused-browser', 'full-check', 'core-match'] as LS13RunId[]), testIds: Object.freeze(['production-palette-quality-authority', 'full-check', 'core-match-cohorts']) }),
} as const);

export const LS14_ACCEPTANCE_IDS = Object.freeze([
  'strict-cue-grammar',
  'ring-wide-inhabited-coverage',
  'deterministic-bounded-activity',
  'placement-authority',
  'fixed-topology-low-readability',
  'accessibility-lifecycle',
  'regression-review',
] as const);

export const LS14_REQUIRED_SOURCE_PATHS = Object.freeze([
  'src/render/districtPlan.ts',
  'src/render/battlefieldDressing.ts',
  'tests/render/districtPlan.test.ts',
  'tests/render/battlefieldDressing.test.ts',
  'e2e/inhabited-ring-life.spec.ts',
  'playwright.ls14.config.ts',
] as const);

export const LS14_RUN_POLICY = Object.freeze({
  'focused-unit': Object.freeze({
    command: 'npx vitest run tests/render/districtPlan.test.ts tests/render/battlefieldDressing.test.ts tests/render/disposal.test.ts tests/render/settings.test.ts',
    artifactPath: 'validation/evidence/runs/ls-14-focused-unit-2026-08-10.json',
  }),
  'focused-browser': Object.freeze({
    command: 'npm run test:e2e:ls14',
    artifactPath: 'validation/evidence/runs/ls-14-focused-browser-2026-08-10.json',
  }),
  'full-check': Object.freeze({
    command: 'npm run check',
    artifactPath: 'validation/evidence/runs/ls-14-full-check-2026-08-10.json',
  }),
  'core-match': Object.freeze({
    command: 'npm run validate:core-match',
    artifactPath: 'validation/evidence/runs/ls-14-core-match-2026-08-10.json',
  }),
} as const);

type LS14RunId = keyof typeof LS14_RUN_POLICY;

export const LS14_RUN_TEST_IDS = Object.freeze({
  'focused-unit': Object.freeze([
    'strict-life-cue-grammar',
    'ring-wide-inhabited-coverage',
    'deterministic-bounded-activity',
    'placement-authority',
    'fixed-topology',
    'reduced-motion-lifecycle',
  ]),
  'focused-browser': Object.freeze([
    'production-low-life-cues',
    'production-activity-authority',
    'production-reduced-motion',
    'production-sustained-resource-budget',
  ]),
  'full-check': Object.freeze(['full-check']),
  'core-match': Object.freeze(['core-match-cohorts']),
} as const);

export const LS14_CHECK_POLICY = Object.freeze({
  'strict-cue-grammar': Object.freeze({ runIds: Object.freeze(['focused-unit'] as LS14RunId[]) }),
  'ring-wide-inhabited-coverage': Object.freeze({ runIds: Object.freeze(['focused-unit'] as LS14RunId[]) }),
  'deterministic-bounded-activity': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS14RunId[]) }),
  'placement-authority': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser', 'core-match'] as LS14RunId[]) }),
  'fixed-topology-low-readability': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS14RunId[]) }),
  'accessibility-lifecycle': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS14RunId[]) }),
  'regression-review': Object.freeze({ runIds: Object.freeze(['focused-browser', 'full-check', 'core-match'] as LS14RunId[]) }),
} as const);

export const LS15_ACCEPTANCE_IDS = Object.freeze([
  'public-alpha-front-door',
  'arc-completable',
  'onboarding-legibility',
  'persistence-continuity',
  'authority-boundary',
  'regression-review',
] as const);

export const LS15_REQUIRED_SOURCE_PATHS = Object.freeze([
  'src/tutorial/mission.ts',
  'src/tutorial/narrative.ts',
  'src/campaign/missionRegistry.ts',
  'src/campaign/campaignRoute.ts',
  'src/campaign/campaignProfile.ts',
  'src/scenario/firstContact.ts',
  'src/scenario/route.ts',
  'src/main.ts',
  'src/ui/titleScreen.ts',
  'src/ui/hud.ts',
  'tests/tutorial/mission.test.ts',
  'tests/tutorial/gameSave.test.ts',
  'tests/campaign/missionRegistry.test.ts',
  'tests/campaign/campaignRoute.test.ts',
  'tests/campaign/campaignProfile.test.ts',
  'e2e/integrated-tutorial-arc.spec.ts',
  'e2e/tutorial.spec.ts',
  'e2e/campaign.spec.ts',
] as const);

export const LS15_RUN_POLICY = Object.freeze({
  'focused-unit': Object.freeze({
    command: 'npx vitest run tests/tutorial/mission.test.ts tests/tutorial/gameSave.test.ts tests/campaign/missionRegistry.test.ts tests/campaign/campaignRoute.test.ts tests/campaign/campaignProfile.test.ts',
    artifactPath: 'validation/evidence/runs/ls-15-focused-unit-2026-08-10.json',
  }),
  'focused-browser': Object.freeze({
    command: 'npx playwright test e2e/integrated-tutorial-arc.spec.ts --project=chromium-regression',
    artifactPath: 'validation/evidence/runs/ls-15-focused-browser-2026-08-10.json',
  }),
  'full-check': Object.freeze({
    command: 'npm run check',
    artifactPath: 'validation/evidence/runs/ls-15-full-check-2026-08-10.json',
  }),
  'core-match': Object.freeze({
    command: 'npm run validate:core-match',
    artifactPath: 'validation/evidence/runs/ls-15-core-match-2026-08-10.json',
  }),
} as const);

type LS15RunId = keyof typeof LS15_RUN_POLICY;

export const LS15_RUN_TEST_IDS = Object.freeze({
  'focused-unit': Object.freeze([
    'tutorial-arc-objective-authority',
    'tutorial-arc-persistence',
    'campaign-registry-contract',
    'campaign-route-and-profile',
  ]),
  'focused-browser': Object.freeze([
    'production-front-door-launch',
    'production-arc-completion',
    'production-arc-persistence',
    'production-standalone-boundary',
  ]),
  'full-check': Object.freeze(['full-check']),
  'core-match': Object.freeze(['core-match-cohorts']),
} as const);

export const LS15_CHECK_POLICY = Object.freeze({
  'public-alpha-front-door': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS15RunId[]) }),
  'arc-completable': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS15RunId[]) }),
  'onboarding-legibility': Object.freeze({ runIds: Object.freeze(['focused-browser'] as LS15RunId[]) }),
  'persistence-continuity': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS15RunId[]) }),
  'authority-boundary': Object.freeze({ runIds: Object.freeze(['focused-unit', 'focused-browser', 'core-match'] as LS15RunId[]) }),
  'regression-review': Object.freeze({ runIds: Object.freeze(['focused-browser', 'full-check', 'core-match'] as LS15RunId[]) }),
} as const);

export const LS09_RUN_POLICY = Object.freeze({
  'focused-unit': Object.freeze({
    command: 'npx vitest run tests/core/shadow.test.ts tests/sim/shadowIntelligence.test.ts tests/sim/vision.test.ts tests/render/environment.test.ts tests/render/presentationEvents.test.ts tests/audio/audioEngine.test.ts tests/ai/strategist.test.ts tests/ui/hud.test.ts',
    artifactPath: 'validation/evidence/runs/ls-09-focused-unit-2026-08-09.json',
  }),
  'focused-browser': Object.freeze({
    command: 'npx playwright test e2e/shadow-intelligence.spec.ts --project=chromium-regression',
    artifactPath: 'validation/evidence/runs/ls-09-focused-browser-2026-08-09.json',
  }),
  'full-check': Object.freeze({
    command: 'npm run check',
    artifactPath: 'validation/evidence/runs/ls-09-full-check-2026-08-09.json',
  }),
  'core-match': Object.freeze({
    command: 'npm run validate:core-match',
    artifactPath: 'validation/evidence/runs/ls-09-core-match-2026-08-09.json',
  }),
} as const);

type LS09RunId = keyof typeof LS09_RUN_POLICY;

export const LS09_CHECK_POLICY = Object.freeze({
  'shadow-authority': Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS09RunId[]),
    testIds: Object.freeze([
      'shadow-cycle-authority',
      'shadow-transition-timing',
      'shadow-boundary-semantics',
      'render-shadow-parity',
    ]),
  }),
  'gameplay-consequences': Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS09RunId[]),
    testIds: Object.freeze(['solar-shadow-output', 'source-local-shadow-sensors']),
  }),
  'launch-intelligence': Object.freeze({
    runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS09RunId[]),
    testIds: Object.freeze([
      'deep-shadow-launch-signal',
      'deep-shadow-projectile-plume',
      'deep-shadow-launch-audio',
      'global-shadow-launch-production',
    ]),
  }),
  'strategic-contacts': Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS09RunId[]),
    testIds: Object.freeze([
      'strategic-contact-categories',
      'strategic-contact-live-state',
      'strategic-contact-los-independence',
    ]),
  }),
  'authority-ai': Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS09RunId[]),
    testIds: Object.freeze(['strategic-contact-authority-boundary', 'ai-strategic-contact-boundary']),
  }),
  'presentation-accessibility': Object.freeze({
    runIds: Object.freeze(['focused-unit', 'focused-browser'] as LS09RunId[]),
    testIds: Object.freeze(['shadow-timing-copy', 'strategic-contact-category-copy', 'shadow-intelligence-hud']),
  }),
  'persistence-regression': Object.freeze({
    runIds: Object.freeze(['focused-unit', 'full-check', 'core-match'] as LS09RunId[]),
    testIds: Object.freeze(['shadow-save-continuation', 'full-check', 'core-match-cohorts']),
  }),
  scope: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS09RunId[]),
    testIds: Object.freeze(['ls09-scope-exclusions']),
  }),
} as const);

export const LS09_RUN_TEST_IDS = Object.freeze({
  'focused-unit': Object.freeze([
    'shadow-cycle-authority',
    'shadow-transition-timing',
    'shadow-boundary-semantics',
    'render-shadow-parity',
    'solar-shadow-output',
    'source-local-shadow-sensors',
    'deep-shadow-launch-signal',
    'deep-shadow-projectile-plume',
    'deep-shadow-launch-audio',
    'strategic-contact-categories',
    'strategic-contact-live-state',
    'strategic-contact-los-independence',
    'strategic-contact-authority-boundary',
    'ai-strategic-contact-boundary',
    'shadow-timing-copy',
    'strategic-contact-category-copy',
    'shadow-save-continuation',
    'ls09-scope-exclusions',
  ]),
  'focused-browser': Object.freeze(['shadow-intelligence-hud', 'global-shadow-launch-production']),
  'full-check': Object.freeze(['full-check']),
  'core-match': Object.freeze(['core-match-cohorts']),
} as const);

export const LS07_REQUIRED_SOURCE_PATHS = Object.freeze([
  'src/sim/data.ts',
  'src/sim/world.ts',
  'src/sim/serialize.ts',
  'src/scenario/runtimeScenario.ts',
  'src/scenario/worldFactory.ts',
  'src/scenario/firstContact.ts',
  'src/ai/opponent.ts',
  'src/ui/hud.ts',
  'tests/sim/spinalAlignment.test.ts',
  'tests/sim/serialize.test.ts',
  'tests/ai/strategist.test.ts',
  'tests/scenario/runtimeScenario.test.ts',
  'e2e/spinal-alignment.spec.ts',
] as const);

export const LS07_RUN_POLICY = Object.freeze({
  'focused-unit': Object.freeze({
    command: 'npx vitest run tests/sim/spinalAlignment.test.ts tests/sim/serialize.test.ts tests/ai/strategist.test.ts tests/scenario/runtimeScenario.test.ts',
    artifactPath: 'validation/evidence/runs/ls-07-focused-unit-2026-08-07.json',
  }),
  'focused-browser': Object.freeze({
    command: 'npx playwright test e2e/spinal-alignment.spec.ts --project=chromium-regression',
    artifactPath: 'validation/evidence/runs/ls-07-focused-browser-2026-08-07.json',
  }),
  'full-check': Object.freeze({
    command: 'npm run check',
    artifactPath: 'validation/evidence/runs/ls-07-full-check-2026-08-07.json',
  }),
  'core-match': Object.freeze({
    command: 'npm run validate:core-match',
    artifactPath: 'validation/evidence/runs/ls-07-core-match-2026-08-07.json',
  }),
} as const);

type LS07RunId = keyof typeof LS07_RUN_POLICY;

export const LS07_CHECK_POLICY = Object.freeze({
  topology: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['canonical-pair-topology', 'scenario-pair-identity']),
  }),
  capture: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['two-phase-capture-timing', 'contested-freeze-friendly-repair', 'damage-neutralization']),
  }),
  alignment: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['alignment-event-order', 'unpaired-node-behavior']),
  }),
  'gameplay-consequence': Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['pair-only-dominance', 'existing-victory-outcomes']),
  }),
  ai: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['ai-pair-completion', 'ai-pair-denial-defense']),
  }),
  persistence: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['world-v2-round-trip', 'world-v1-pair-migration', 'legacy-game-save-compatibility']),
  }),
  presentation: Object.freeze({
    runIds: Object.freeze(['focused-browser'] as LS07RunId[]),
    testIds: Object.freeze([
      'hud-minimap-pair-state',
      'alignment-accessible-events',
      'hidden-mate-no-leak',
      'directional-overlay-canvas-state',
    ]),
  }),
  regression: Object.freeze({
    runIds: Object.freeze(['full-check', 'core-match'] as LS07RunId[]),
    testIds: Object.freeze(['full-check', 'core-match-cohorts']),
  }),
  scope: Object.freeze({
    runIds: Object.freeze(['focused-unit'] as LS07RunId[]),
    testIds: Object.freeze(['ls07-scope-exclusions']),
  }),
} as const);

export const LS07_RUN_TEST_IDS = Object.freeze({
  'focused-unit': Object.freeze([
    'canonical-pair-topology',
    'scenario-pair-identity',
    'two-phase-capture-timing',
    'contested-freeze-friendly-repair',
    'damage-neutralization',
    'alignment-event-order',
    'unpaired-node-behavior',
    'pair-only-dominance',
    'existing-victory-outcomes',
    'ai-pair-completion',
    'ai-pair-denial-defense',
    'world-v2-round-trip',
    'world-v1-pair-migration',
    'legacy-game-save-compatibility',
    'ls07-scope-exclusions',
  ]),
  'focused-browser': Object.freeze([
    'hud-minimap-pair-state',
    'alignment-accessible-events',
    'hidden-mate-no-leak',
    'directional-overlay-canvas-state',
  ]),
  'full-check': Object.freeze(['full-check']),
  'core-match': Object.freeze(['core-match-cohorts']),
} as const);

function evidencePolicy(claimId: string) {
  return Object.prototype.hasOwnProperty.call(CLAIM_EVIDENCE_POLICY, claimId)
    ? CLAIM_EVIDENCE_POLICY[claimId as ClaimEvidenceId]
    : null;
}

async function readBoundedText(path: string, maxBytes: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) throw new Error('Progress source is not a bounded file');
  return readFile(path, 'utf8');
}

async function readJson(path: string, maxBytes = MAX_TEXT_BYTES): Promise<Record<string, unknown>> {
  return JSON.parse(await readBoundedText(path, maxBytes)) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireExactKeys(record: Record<string, unknown>, keys: string[], label: string) {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has an invalid schema`);
  }
}

function isSafeRepositoryPath(path: string): boolean {
  const segments = path.split('/');
  return !path.includes('\\')
    && !path.startsWith('/')
    && !segments.includes('..')
    && /^(?:docs|validation)\/[A-Za-z0-9._/-]+$/.test(path);
}

function isSafeImplementationPath(path: string): boolean {
  const segments = path.split('/');
  return !path.includes('\\')
    && !path.startsWith('/')
    && !segments.includes('..')
    && (/^(?:src|tests|e2e)\/[A-Za-z0-9._/-]+$/.test(path) || /^playwright\.ls(?:12|13|14)\.config\.ts$/.test(path));
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireNonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} must be a lowercase SHA-256`);
  return digest;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => requireNonEmptyString(entry, `${label}[${index}]`));
}

export function ls07SourceSnapshotSha256(sourceRefsValue: unknown): string {
  const sourceRefs = asArray(sourceRefsValue).map((source, index) =>
    requireRecord(source, `LS-07 source snapshot[${index}]`));
  const canonical = sourceRefs.map((source, index) => ({
    path: requireNonEmptyString(source.path, `LS-07 source snapshot[${index}].path`),
    sha256: requireSha256(source.sha256, `LS-07 source snapshot[${index}].sha256`),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function validateLS07EvidenceShape(
  machineValue: unknown,
  reviewValue: unknown,
  runArtifactValues: Record<string, unknown>,
  expectedHashes?: { contractSha256: string; policySha256: string },
): void {
  const machine = requireRecord(machineValue, 'LS-07 machine evidence');
  requireExactKeys(
    machine,
    ['schema', 'version', 'sliceId', 'contractSha256', 'sourceRefs', 'runs', 'checks'],
    'LS-07 machine evidence',
  );
  if (machine.schema !== 'rww.ls-07-verification' || machine.version !== 1 || machine.sliceId !== 'LS-07') {
    throw new Error('LS-07 machine evidence has an invalid identity');
  }
  const contractSha256 = requireSha256(machine.contractSha256, 'LS-07 machine contractSha256');
  if (expectedHashes && contractSha256 !== expectedHashes.contractSha256) {
    throw new Error('LS-07 machine evidence does not bind the current contract');
  }

  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-07 machine sourceRefs[${index}]`));
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-07 machine sourceRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-07 machine sourceRefs[${index}].path`);
    if (!isSafeImplementationPath(path)) throw new Error(`Unsafe LS-07 implementation source path: ${path}`);
    requireSha256(source.sha256, `LS-07 machine sourceRefs[${index}].sha256`);
    return path;
  });
  if (new Set(sourcePaths).size !== sourcePaths.length) throw new Error('LS-07 machine evidence has duplicate source paths');
  for (const requiredPath of LS07_REQUIRED_SOURCE_PATHS) {
    if (!sourcePaths.includes(requiredPath)) throw new Error(`LS-07 machine evidence is missing required source: ${requiredPath}`);
  }
  const sourceSnapshotSha256 = ls07SourceSnapshotSha256(sourceRefs);

  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-07 machine runs[${index}]`));
  const runIds = runs.map((run, index) => {
    requireExactKeys(run, ['id', 'command', 'result', 'exitCode', 'artifact'], `LS-07 machine runs[${index}]`);
    return requireNonEmptyString(run.id, `LS-07 machine runs[${index}].id`);
  });
  if (JSON.stringify(runIds) !== JSON.stringify(Object.keys(LS07_RUN_POLICY))) {
    throw new Error('LS-07 machine runs do not match the exact verification policy');
  }
  const passedTestIdsByRun = new Map<string, Set<string>>();
  for (const [index, run] of runs.entries()) {
    const id = runIds[index] as LS07RunId;
    const runPolicy = LS07_RUN_POLICY[id];
    if (run.command !== runPolicy.command || run.result !== 'passed' || run.exitCode !== 0) {
      throw new Error(`LS-07 verification run ${id} did not pass its exact command`);
    }
    const artifact = requireRecord(run.artifact, `LS-07 machine runs[${index}].artifact`);
    requireExactKeys(artifact, ['path', 'sha256'], `LS-07 machine runs[${index}].artifact`);
    if (artifact.path !== runPolicy.artifactPath) throw new Error(`LS-07 verification run ${id} has the wrong artifact path`);
    requireSha256(artifact.sha256, `LS-07 machine runs[${index}].artifact.sha256`);

    const runArtifact = requireRecord(runArtifactValues[id], `LS-07 run artifact ${id}`);
    requireExactKeys(
      runArtifact,
      ['schema', 'version', 'id', 'command', 'result', 'exitCode', 'sourceSnapshotSha256', 'passedTestIds', 'summary'],
      `LS-07 run artifact ${id}`,
    );
    if (runArtifact.schema !== 'rww.command-verification' || runArtifact.version !== 1 || runArtifact.id !== id) {
      throw new Error(`LS-07 run artifact ${id} has an invalid identity`);
    }
    if (runArtifact.command !== runPolicy.command || runArtifact.result !== 'passed' || runArtifact.exitCode !== 0) {
      throw new Error(`LS-07 run artifact ${id} does not prove the exact passing command`);
    }
    requireSha256(runArtifact.sourceSnapshotSha256, `LS-07 run artifact ${id}.sourceSnapshotSha256`);
    if (runArtifact.sourceSnapshotSha256 !== sourceSnapshotSha256) {
      throw new Error(`LS-07 run artifact ${id} does not bind the implementation source snapshot`);
    }
    const runSummary = requireNonEmptyString(runArtifact.summary, `LS-07 run artifact ${id}.summary`);
    if (runSummary.length < 20) throw new Error(`LS-07 run artifact ${id} lacks a substantive summary`);
    const passedTestIds = requireStringArray(runArtifact.passedTestIds, `LS-07 run artifact ${id}.passedTestIds`);
    if (new Set(passedTestIds).size !== passedTestIds.length) throw new Error(`LS-07 run artifact ${id} has duplicate test IDs`);
    passedTestIdsByRun.set(id, new Set(passedTestIds));
  }
  for (const runId of Object.keys(LS07_RUN_POLICY)) {
    if (JSON.stringify([...passedTestIdsByRun.get(runId)!]) !== JSON.stringify(LS07_RUN_TEST_IDS[runId as LS07RunId])) {
      throw new Error(`LS-07 run artifact ${runId} does not contain the exact predeclared test IDs`);
    }
  }

  const checks = asArray(machine.checks).map((check, index) =>
    requireRecord(check, `LS-07 machine checks[${index}]`));
  const checkIds = checks.map((check, index) => {
    requireExactKeys(check, ['id', 'result', 'runIds', 'testIds'], `LS-07 machine checks[${index}]`);
    if (check.result !== 'passed') throw new Error(`LS-07 machine check ${String(check.id)} did not pass`);
    return requireNonEmptyString(check.id, `LS-07 machine checks[${index}].id`);
  });
  if (JSON.stringify(checkIds) !== JSON.stringify(LS07_ACCEPTANCE_IDS)) {
    throw new Error('LS-07 machine checks do not cover the exact acceptance matrix');
  }
  for (const [index, check] of checks.entries()) {
    const id = checkIds[index] as keyof typeof LS07_CHECK_POLICY;
    const checkPolicy = LS07_CHECK_POLICY[id];
    const checkRunIds = requireStringArray(check.runIds, `LS-07 machine checks[${index}].runIds`);
    const testIds = requireStringArray(check.testIds, `LS-07 machine checks[${index}].testIds`);
    if (JSON.stringify(checkRunIds) !== JSON.stringify(checkPolicy.runIds)
      || JSON.stringify(testIds) !== JSON.stringify(checkPolicy.testIds)) {
      throw new Error(`LS-07 machine check ${id} does not match its exact run and test policy`);
    }
    for (const testId of testIds) {
      if (!checkRunIds.some((runId) => passedTestIdsByRun.get(runId)?.has(testId))) {
        throw new Error(`LS-07 machine check ${id} cannot prove test ID ${testId}`);
      }
    }
  }

  const review = requireRecord(reviewValue, 'LS-07 criterion review');
  requireExactKeys(
    review,
    [
      'schema', 'version', 'reviewId', 'claimId', 'contractSha256', 'policySha256', 'reviewRound',
      'reviewType', 'independentContext', 'reviewer', 'scores', 'dependencyReady', 'blockers',
      'requiredQualityFindings', 'humanValidation', 'polish',
    ],
    'LS-07 criterion review',
  );
  if (review.schema !== 'rww.criterion-review' || review.version !== 1 || review.claimId !== 'LS-07') {
    throw new Error('LS-07 criterion review has an invalid identity');
  }
  requireNonEmptyString(review.reviewId, 'LS-07 criterion review reviewId');
  if (review.reviewType !== 'gameplay-system-acceptance' || review.independentContext !== true) {
    throw new Error('LS-07 criterion review is not an independent gameplay-system review');
  }
  const reviewer = requireRecord(review.reviewer, 'LS-07 criterion review reviewer');
  requireExactKeys(reviewer, ['role', 'taskId', 'model', 'completedAt', 'sourceSnapshotSha256'], 'LS-07 criterion review reviewer');
  if (reviewer.role !== 'independent-critic') throw new Error('LS-07 criterion review has the wrong reviewer role');
  const taskId = requireNonEmptyString(reviewer.taskId, 'LS-07 criterion review reviewer.taskId');
  if (!/^ses_[A-Za-z0-9]+$/.test(taskId)) throw new Error('LS-07 criterion review has invalid task provenance');
  requireNonEmptyString(reviewer.model, 'LS-07 criterion review reviewer.model');
  const completedAt = requireNonEmptyString(reviewer.completedAt, 'LS-07 criterion review reviewer.completedAt');
  if (!isoDateString(completedAt)) throw new Error('LS-07 criterion review has invalid completion time');
  if (requireSha256(reviewer.sourceSnapshotSha256, 'LS-07 criterion review reviewer.sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-07 criterion review does not bind the implementation source snapshot');
  }
  if (!Number.isInteger(review.reviewRound) || Number(review.reviewRound) < 1 || Number(review.reviewRound) > 3) {
    throw new Error('LS-07 criterion review exceeds the bounded review policy');
  }
  const reviewContractSha256 = requireSha256(review.contractSha256, 'LS-07 review contractSha256');
  const reviewPolicySha256 = requireSha256(review.policySha256, 'LS-07 review policySha256');
  if (expectedHashes && (
    reviewContractSha256 !== expectedHashes.contractSha256
    || reviewPolicySha256 !== expectedHashes.policySha256
  )) {
    throw new Error('LS-07 criterion review does not bind the current contract and execution policy');
  }

  const scores = requireRecord(review.scores, 'LS-07 criterion review scores');
  requireExactKeys(scores, [...LS07_ACCEPTANCE_IDS], 'LS-07 criterion review scores');
  for (const id of LS07_ACCEPTANCE_IDS) {
    const scoreRecord = requireRecord(scores[id], `LS-07 criterion review scores.${id}`);
    requireExactKeys(scoreRecord, ['score', 'checkId', 'rationale'], `LS-07 criterion review scores.${id}`);
    if (scoreRecord.checkId !== id) throw new Error(`LS-07 criterion ${id} is not linked to its machine check`);
    const rationale = requireNonEmptyString(scoreRecord.rationale, `LS-07 criterion review scores.${id}.rationale`);
    if (rationale.length < 20) throw new Error(`LS-07 criterion ${id} lacks a substantive rationale`);
    const score = scoreRecord.score;
    if (!Number.isInteger(score) || Number(score) < 3 || Number(score) > 4) {
      throw new Error(`LS-07 criterion ${id} is below ship-ready`);
    }
  }
  if (review.dependencyReady !== true) throw new Error('LS-07 criterion review is not dependency-ready');
  if (requireStringArray(review.blockers, 'LS-07 criterion review blockers').length !== 0) {
    throw new Error('LS-07 criterion review contains blockers');
  }
  if (requireStringArray(review.requiredQualityFindings, 'LS-07 criterion review requiredQualityFindings').length !== 0) {
    throw new Error('LS-07 criterion review contains required-quality findings');
  }
  if (requireStringArray(review.humanValidation, 'LS-07 criterion review humanValidation').length !== 0) {
    throw new Error('LS-07 criterion review must not claim human validation');
  }
  const polish = asArray(review.polish).map((finding, index) =>
    requireRecord(finding, `LS-07 criterion review polish[${index}]`));
  for (const [index, finding] of polish.entries()) {
    requireExactKeys(finding, ['id', 'summary', 'reopenTrigger'], `LS-07 criterion review polish[${index}]`);
    requireNonEmptyString(finding.id, `LS-07 criterion review polish[${index}].id`);
    requireNonEmptyString(finding.summary, `LS-07 criterion review polish[${index}].summary`);
    requireNonEmptyString(finding.reopenTrigger, `LS-07 criterion review polish[${index}].reopenTrigger`);
  }
}

export function validateLS08CriterionReview(
  reviewValue: unknown,
  expectedHashes?: { contractSha256: string; policySha256: string },
): void {
  const review = requireRecord(reviewValue, 'LS-08 criterion review');
  requireExactKeys(
    review,
    [
      'schema',
      'version',
      'reviewId',
      'claimId',
      'reviewRound',
      'reviewerRole',
      'reviewedAt',
      'contractSha256',
      'policySha256',
      'scores',
      'blockers',
      'humanValidation',
    ],
    'LS-08 criterion review',
  );
  if (review.schema !== 'rww.criterion-review' || review.version !== 1 || review.claimId !== 'LS-08') {
    throw new Error('LS-08 criterion review has an invalid identity');
  }
  requireNonEmptyString(review.reviewId, 'LS-08 criterion review reviewId');
  if (review.reviewRound !== 1 || review.reviewerRole !== 'human-developer') {
    throw new Error('LS-08 criterion review must be the initial human developer review');
  }
  if (!isoDateString(requireNonEmptyString(review.reviewedAt, 'LS-08 criterion review reviewedAt'))) {
    throw new Error('LS-08 criterion review has an invalid completion time');
  }
  const contractSha256 = requireSha256(review.contractSha256, 'LS-08 criterion review contractSha256');
  const policySha256 = requireSha256(review.policySha256, 'LS-08 criterion review policySha256');
  if (expectedHashes && (
    contractSha256 !== expectedHashes.contractSha256
    || policySha256 !== expectedHashes.policySha256
  )) {
    throw new Error('LS-08 criterion review does not bind the current contract and execution policy');
  }
  const scores = requireRecord(review.scores, 'LS-08 criterion review scores');
  requireExactKeys(scores, [...LS08_ACCEPTANCE_IDS], 'LS-08 criterion review scores');
  for (const id of LS08_ACCEPTANCE_IDS) {
    const score = requireRecord(scores[id], `LS-08 criterion review scores.${id}`);
    requireExactKeys(score, ['score', 'rationale'], `LS-08 criterion review scores.${id}`);
    if (!Number.isInteger(score.score) || Number(score.score) < 3 || Number(score.score) > 4) {
      throw new Error(`LS-08 criterion ${id} is below ship-ready`);
    }
    if (requireNonEmptyString(score.rationale, `LS-08 criterion review scores.${id}.rationale`).length < 20) {
      throw new Error(`LS-08 criterion ${id} lacks a substantive rationale`);
    }
  }
  if (requireStringArray(review.blockers, 'LS-08 criterion review blockers').length !== 0) {
    throw new Error('LS-08 criterion review contains blockers');
  }
  if (JSON.stringify(requireStringArray(review.humanValidation, 'LS-08 criterion review humanValidation')) !== JSON.stringify(['G-01'])) {
    throw new Error('LS-08 criterion review must bind the G-01 human validation');
  }
}

export function ls09SourceSnapshotSha256(sourceRefsValue: unknown): string {
  const sourceRefs = asArray(sourceRefsValue).map((source, index) =>
    requireRecord(source, `LS-09 source snapshot[${index}]`));
  const canonical = sourceRefs.map((source, index) => ({
    path: requireNonEmptyString(source.path, `LS-09 source snapshot[${index}].path`),
    sha256: requireSha256(source.sha256, `LS-09 source snapshot[${index}].sha256`),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function ls10SourceSnapshotSha256(sourceRefsValue: unknown): string {
  const sourceRefs = asArray(sourceRefsValue).map((source, index) =>
    requireRecord(source, `LS-10 source snapshot[${index}]`));
  const canonical = sourceRefs.map((source, index) => ({
    path: requireNonEmptyString(source.path, `LS-10 source snapshot[${index}].path`),
    sha256: requireSha256(source.sha256, `LS-10 source snapshot[${index}].sha256`),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function ls11SourceSnapshotSha256(sourceRefsValue: unknown): string {
  const sourceRefs = asArray(sourceRefsValue).map((source, index) =>
    requireRecord(source, `LS-11 source snapshot[${index}]`));
  const canonical = sourceRefs.map((source, index) => ({
    path: requireNonEmptyString(source.path, `LS-11 source snapshot[${index}].path`),
    sha256: requireSha256(source.sha256, `LS-11 source snapshot[${index}].sha256`),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function ls12SourceSnapshotSha256(sourceRefsValue: unknown): string {
  const sourceRefs = asArray(sourceRefsValue).map((source, index) =>
    requireRecord(source, `LS-12 source snapshot[${index}]`));
  const canonical = sourceRefs.map((source, index) => ({
    path: requireNonEmptyString(source.path, `LS-12 source snapshot[${index}].path`),
    sha256: requireSha256(source.sha256, `LS-12 source snapshot[${index}].sha256`),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function ls13SourceSnapshotSha256(sourceRefsValue: unknown): string {
  const sourceRefs = asArray(sourceRefsValue).map((source, index) =>
    requireRecord(source, `LS-13 source snapshot[${index}]`));
  const canonical = sourceRefs.map((source, index) => ({
    path: requireNonEmptyString(source.path, `LS-13 source snapshot[${index}].path`),
    sha256: requireSha256(source.sha256, `LS-13 source snapshot[${index}].sha256`),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function ls14SourceSnapshotSha256(sourceRefsValue: unknown): string {
  const sourceRefs = asArray(sourceRefsValue).map((source, index) =>
    requireRecord(source, `LS-14 source snapshot[${index}]`));
  const canonical = sourceRefs.map((source, index) => ({
    path: requireNonEmptyString(source.path, `LS-14 source snapshot[${index}].path`),
    sha256: requireSha256(source.sha256, `LS-14 source snapshot[${index}].sha256`),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function ls15SourceSnapshotSha256(sourceRefsValue: unknown): string {
  const sourceRefs = asArray(sourceRefsValue).map((source, index) =>
    requireRecord(source, `LS-15 source snapshot[${index}]`));
  const canonical = sourceRefs.map((source, index) => ({
    path: requireNonEmptyString(source.path, `LS-15 source snapshot[${index}].path`),
    sha256: requireSha256(source.sha256, `LS-15 source snapshot[${index}].sha256`),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function validateLS15EvidenceShape(
  machineValue: unknown,
  runArtifactValues: Record<string, unknown>,
  expectedHashes?: { contractSha256: string },
): void {
  const machine = requireRecord(machineValue, 'LS-15 machine evidence');
  requireExactKeys(machine, [
    'schema', 'version', 'sliceId', 'contractSha256', 'sourceSnapshotSha256',
    'sourceRefs', 'runs', 'checks',
  ], 'LS-15 machine evidence');
  if (machine.schema !== 'rww.ls-15-verification' || machine.version !== 1 || machine.sliceId !== 'LS-15') {
    throw new Error('LS-15 machine evidence has an invalid identity');
  }
  const contractSha256 = requireSha256(machine.contractSha256, 'LS-15 machine contractSha256');
  if (expectedHashes && contractSha256 !== expectedHashes.contractSha256) {
    throw new Error('LS-15 machine evidence does not bind the current contract');
  }

  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-15 machine sourceRefs[${index}]`));
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-15 machine sourceRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-15 machine sourceRefs[${index}].path`);
    if (!isSafeImplementationPath(path)) throw new Error(`Unsafe LS-15 implementation source path: ${path}`);
    requireSha256(source.sha256, `LS-15 machine sourceRefs[${index}].sha256`);
    return path;
  });
  if (JSON.stringify(sourcePaths) !== JSON.stringify(LS15_REQUIRED_SOURCE_PATHS)) {
    throw new Error('LS-15 machine evidence does not bind the exact implementation sources');
  }
  const sourceSnapshotSha256 = ls15SourceSnapshotSha256(sourceRefs);
  if (requireSha256(machine.sourceSnapshotSha256, 'LS-15 machine sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-15 machine evidence source snapshot is invalid');
  }

  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-15 machine runs[${index}]`));
  const runIds = runs.map((run, index) => {
    requireExactKeys(run, ['id', 'command', 'result', 'exitCode', 'artifact'], `LS-15 machine runs[${index}]`);
    return requireNonEmptyString(run.id, `LS-15 machine runs[${index}].id`);
  });
  if (JSON.stringify(runIds) !== JSON.stringify(Object.keys(LS15_RUN_POLICY))) {
    throw new Error('LS-15 machine runs do not match the exact verification policy');
  }
  for (const [index, run] of runs.entries()) {
    const id = runIds[index] as LS15RunId;
    const policy = LS15_RUN_POLICY[id];
    if (run.command !== policy.command || run.result !== 'passed' || run.exitCode !== 0) {
      throw new Error(`LS-15 verification run ${id} did not pass its exact command`);
    }
    const artifact = requireRecord(run.artifact, `LS-15 machine runs[${index}].artifact`);
    requireExactKeys(artifact, ['path', 'sha256'], `LS-15 machine runs[${index}].artifact`);
    if (artifact.path !== policy.artifactPath) throw new Error(`LS-15 verification run ${id} has the wrong artifact path`);
    requireSha256(artifact.sha256, `LS-15 machine runs[${index}].artifact.sha256`);
    const runArtifact = requireRecord(runArtifactValues[id], `LS-15 run artifact ${id}`);
    requireExactKeys(runArtifact, [
      'schema', 'version', 'id', 'command', 'result', 'exitCode',
      'sourceSnapshotSha256', 'passedTestIds', 'summary',
    ], `LS-15 run artifact ${id}`);
    if (runArtifact.schema !== 'rww.command-verification' || runArtifact.version !== 1
      || runArtifact.id !== id || runArtifact.command !== policy.command
      || runArtifact.result !== 'passed' || runArtifact.exitCode !== 0) {
      throw new Error(`LS-15 run artifact ${id} does not prove the exact passing command`);
    }
    if (requireSha256(runArtifact.sourceSnapshotSha256, `LS-15 run artifact ${id}.sourceSnapshotSha256`) !== sourceSnapshotSha256) {
      throw new Error(`LS-15 run artifact ${id} does not bind the implementation source snapshot`);
    }
    if (JSON.stringify(requireStringArray(runArtifact.passedTestIds, `LS-15 run artifact ${id}.passedTestIds`))
      !== JSON.stringify(LS15_RUN_TEST_IDS[id])) {
      throw new Error(`LS-15 run artifact ${id} does not contain the exact predeclared test IDs`);
    }
    if (requireNonEmptyString(runArtifact.summary, `LS-15 run artifact ${id}.summary`).length < 20) {
      throw new Error(`LS-15 run artifact ${id} lacks a substantive summary`);
    }
  }

  const checks = asArray(machine.checks).map((check, index) => requireRecord(check, `LS-15 machine checks[${index}]`));
  const checkIds = checks.map((check, index) => {
    requireExactKeys(check, ['id', 'result', 'runIds'], `LS-15 machine checks[${index}]`);
    if (check.result !== 'passed') throw new Error(`LS-15 machine check ${String(check.id)} did not pass`);
    return requireNonEmptyString(check.id, `LS-15 machine checks[${index}].id`);
  });
  if (JSON.stringify(checkIds) !== JSON.stringify(LS15_ACCEPTANCE_IDS)) {
    throw new Error('LS-15 machine checks do not cover the exact acceptance matrix');
  }
  for (const [index, check] of checks.entries()) {
    const id = checkIds[index] as keyof typeof LS15_CHECK_POLICY;
    const runIdsForCheck = requireStringArray(check.runIds, `LS-15 machine checks[${index}].runIds`);
    if (JSON.stringify(runIdsForCheck) !== JSON.stringify(LS15_CHECK_POLICY[id].runIds)) {
      throw new Error(`LS-15 machine check ${id} does not match its exact run policy`);
    }
  }
}

export function validateLS14EvidenceShape(
  machineValue: unknown,
  reviewValue: unknown,
  runArtifactValues: Record<string, unknown>,
  expectedHashes?: { contractSha256: string; policySha256: string },
): void {
  const machine = requireRecord(machineValue, 'LS-14 machine evidence');
  requireExactKeys(machine, [
    'schema', 'version', 'sliceId', 'contractSha256', 'sourceSnapshotSha256',
    'sourceRefs', 'visualRefs', 'runs', 'checks',
  ], 'LS-14 machine evidence');
  if (machine.schema !== 'rww.ls-14-verification' || machine.version !== 1 || machine.sliceId !== 'LS-14') {
    throw new Error('LS-14 machine evidence has an invalid identity');
  }
  const contractSha256 = requireSha256(machine.contractSha256, 'LS-14 machine contractSha256');
  if (expectedHashes && contractSha256 !== expectedHashes.contractSha256) {
    throw new Error('LS-14 machine evidence does not bind the current contract');
  }

  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-14 machine sourceRefs[${index}]`));
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-14 machine sourceRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-14 machine sourceRefs[${index}].path`);
    if (!isSafeImplementationPath(path)) throw new Error(`Unsafe LS-14 implementation source path: ${path}`);
    requireSha256(source.sha256, `LS-14 machine sourceRefs[${index}].sha256`);
    return path;
  });
  if (JSON.stringify(sourcePaths) !== JSON.stringify(LS14_REQUIRED_SOURCE_PATHS)) {
    throw new Error('LS-14 machine evidence does not bind the exact implementation sources');
  }
  const sourceSnapshotSha256 = ls14SourceSnapshotSha256(sourceRefs);
  if (requireSha256(machine.sourceSnapshotSha256, 'LS-14 machine sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-14 machine evidence source snapshot is invalid');
  }

  const visualRefs = asArray(machine.visualRefs).map((source, index) =>
    requireRecord(source, `LS-14 visualRefs[${index}]`));
  const visualPaths = visualRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-14 visualRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-14 visualRefs[${index}].path`);
    if (!isSafeRepositoryPath(path) || !path.startsWith('validation/evidence/')) {
      throw new Error(`Unsafe LS-14 visual evidence path: ${path}`);
    }
    requireSha256(source.sha256, `LS-14 visualRefs[${index}].sha256`);
    return path;
  });
  if (JSON.stringify(visualPaths) !== JSON.stringify([
    'validation/evidence/ls-14-low-runtime.jpeg',
    'validation/evidence/ls-14-performance-trace.json.gz',
  ])) throw new Error('LS-14 visual evidence paths are incomplete');

  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-14 machine runs[${index}]`));
  const runIds = runs.map((run, index) => {
    requireExactKeys(run, ['id', 'command', 'result', 'exitCode', 'artifact'], `LS-14 machine runs[${index}]`);
    return requireNonEmptyString(run.id, `LS-14 machine runs[${index}].id`);
  });
  if (JSON.stringify(runIds) !== JSON.stringify(Object.keys(LS14_RUN_POLICY))) {
    throw new Error('LS-14 machine runs do not match the exact verification policy');
  }
  for (const [index, run] of runs.entries()) {
    const id = runIds[index] as LS14RunId;
    const policy = LS14_RUN_POLICY[id];
    if (run.command !== policy.command || run.result !== 'passed' || run.exitCode !== 0) {
      throw new Error(`LS-14 verification run ${id} did not pass its exact command`);
    }
    const artifact = requireRecord(run.artifact, `LS-14 machine runs[${index}].artifact`);
    requireExactKeys(artifact, ['path', 'sha256'], `LS-14 machine runs[${index}].artifact`);
    if (artifact.path !== policy.artifactPath) throw new Error(`LS-14 verification run ${id} has the wrong artifact path`);
    requireSha256(artifact.sha256, `LS-14 machine runs[${index}].artifact.sha256`);
    const runArtifact = requireRecord(runArtifactValues[id], `LS-14 run artifact ${id}`);
    requireExactKeys(runArtifact, [
      'schema', 'version', 'id', 'command', 'result', 'exitCode',
      'sourceSnapshotSha256', 'passedTestIds', 'summary',
    ], `LS-14 run artifact ${id}`);
    if (runArtifact.schema !== 'rww.command-verification' || runArtifact.version !== 1
      || runArtifact.id !== id || runArtifact.command !== policy.command
      || runArtifact.result !== 'passed' || runArtifact.exitCode !== 0) {
      throw new Error(`LS-14 run artifact ${id} does not prove the exact passing command`);
    }
    if (requireSha256(runArtifact.sourceSnapshotSha256, `LS-14 run artifact ${id}.sourceSnapshotSha256`) !== sourceSnapshotSha256) {
      throw new Error(`LS-14 run artifact ${id} does not bind the implementation source snapshot`);
    }
    if (JSON.stringify(requireStringArray(runArtifact.passedTestIds, `LS-14 run artifact ${id}.passedTestIds`))
      !== JSON.stringify(LS14_RUN_TEST_IDS[id])) {
      throw new Error(`LS-14 run artifact ${id} does not contain the exact predeclared test IDs`);
    }
    if (requireNonEmptyString(runArtifact.summary, `LS-14 run artifact ${id}.summary`).length < 20) {
      throw new Error(`LS-14 run artifact ${id} lacks a substantive summary`);
    }
  }

  const checks = asArray(machine.checks).map((check, index) => requireRecord(check, `LS-14 machine checks[${index}]`));
  const checkIds = checks.map((check, index) => {
    requireExactKeys(check, ['id', 'result', 'runIds'], `LS-14 machine checks[${index}]`);
    if (check.result !== 'passed') throw new Error(`LS-14 machine check ${String(check.id)} did not pass`);
    return requireNonEmptyString(check.id, `LS-14 machine checks[${index}].id`);
  });
  if (JSON.stringify(checkIds) !== JSON.stringify(LS14_ACCEPTANCE_IDS)) {
    throw new Error('LS-14 machine checks do not cover the exact acceptance matrix');
  }
  for (const [index, check] of checks.entries()) {
    const id = checkIds[index] as keyof typeof LS14_CHECK_POLICY;
    const runIdsForCheck = requireStringArray(check.runIds, `LS-14 machine checks[${index}].runIds`);
    if (JSON.stringify(runIdsForCheck) !== JSON.stringify(LS14_CHECK_POLICY[id].runIds)) {
      throw new Error(`LS-14 machine check ${id} does not match its exact run policy`);
    }
  }

  const review = requireRecord(reviewValue, 'LS-14 criterion review');
  requireExactKeys(review, [
    'schema', 'version', 'reviewId', 'claimId', 'contractSha256', 'policySha256',
    'reviewRound', 'reviewType', 'independentContext', 'reviewer', 'scores',
    'dependencyReady', 'blockers', 'requiredQualityFindings', 'humanValidation', 'polish',
  ], 'LS-14 criterion review');
  if (review.schema !== 'rww.criterion-review' || review.version !== 1 || review.claimId !== 'LS-14'
    || review.reviewType !== 'platform-presentation-accessibility' || review.independentContext !== true
    || !Number.isInteger(review.reviewRound) || Number(review.reviewRound) < 1 || Number(review.reviewRound) > 2) {
    throw new Error('LS-14 criterion review has an invalid identity or review round');
  }
  const reviewer = requireRecord(review.reviewer, 'LS-14 criterion review reviewer');
  requireExactKeys(reviewer, ['role', 'taskId', 'model', 'completedAt', 'sourceSnapshotSha256'], 'LS-14 criterion review reviewer');
  if (reviewer.role !== 'independent-critic'
    || !/^ses_[A-Za-z0-9]+$/.test(requireNonEmptyString(reviewer.taskId, 'LS-14 reviewer taskId'))
    || !isoDateString(requireNonEmptyString(reviewer.completedAt, 'LS-14 reviewer completedAt'))
    || requireSha256(reviewer.sourceSnapshotSha256, 'LS-14 reviewer sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-14 criterion review has invalid independent provenance');
  }
  requireNonEmptyString(reviewer.model, 'LS-14 reviewer model');
  if (expectedHashes && (
    requireSha256(review.contractSha256, 'LS-14 review contractSha256') !== expectedHashes.contractSha256
    || requireSha256(review.policySha256, 'LS-14 review policySha256') !== expectedHashes.policySha256
  )) throw new Error('LS-14 criterion review does not bind the current contract and execution policy');
  const scores = requireRecord(review.scores, 'LS-14 criterion review scores');
  requireExactKeys(scores, [...LS14_ACCEPTANCE_IDS], 'LS-14 criterion review scores');
  for (const id of LS14_ACCEPTANCE_IDS) {
    const score = requireRecord(scores[id], `LS-14 criterion review scores.${id}`);
    requireExactKeys(score, ['score', 'checkId', 'rationale'], `LS-14 criterion review scores.${id}`);
    if (score.checkId !== id || !Number.isInteger(score.score) || Number(score.score) < 3 || Number(score.score) > 4
      || requireNonEmptyString(score.rationale, `LS-14 criterion review scores.${id}.rationale`).length < 20) {
      throw new Error(`LS-14 criterion ${id} is below ship-ready or lacks rationale`);
    }
  }
  if (review.dependencyReady !== true
    || requireStringArray(review.blockers, 'LS-14 review blockers').length !== 0
    || requireStringArray(review.requiredQualityFindings, 'LS-14 review requiredQualityFindings').length !== 0
    || requireStringArray(review.humanValidation, 'LS-14 review humanValidation').length !== 0) {
    throw new Error('LS-14 criterion review is not dependency-ready');
  }
}

export function validateLS13EvidenceShape(
  machineValue: unknown,
  reviewValue: unknown,
  runArtifactValues: Record<string, unknown>,
  expectedHashes?: { contractSha256: string; policySha256: string },
): void {
  const machine = requireRecord(machineValue, 'LS-13 machine evidence');
  requireExactKeys(machine, ['schema', 'version', 'sliceId', 'contractSha256', 'sourceRefs', 'runs', 'checks'], 'LS-13 machine evidence');
  if (machine.schema !== 'rww.ls-13-verification' || machine.version !== 1 || machine.sliceId !== 'LS-13') {
    throw new Error('LS-13 machine evidence has an invalid identity');
  }
  const contractSha256 = requireSha256(machine.contractSha256, 'LS-13 machine contractSha256');
  if (expectedHashes && contractSha256 !== expectedHashes.contractSha256) {
    throw new Error('LS-13 machine evidence does not bind the current contract');
  }
  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-13 machine sourceRefs[${index}]`));
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-13 machine sourceRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-13 machine sourceRefs[${index}].path`);
    if (!isSafeImplementationPath(path)) throw new Error(`Unsafe LS-13 implementation source path: ${path}`);
    requireSha256(source.sha256, `LS-13 machine sourceRefs[${index}].sha256`);
    return path;
  });
  if (JSON.stringify(sourcePaths) !== JSON.stringify(LS13_REQUIRED_SOURCE_PATHS)) {
    throw new Error('LS-13 machine evidence does not bind the exact implementation sources');
  }
  const sourceSnapshotSha256 = ls13SourceSnapshotSha256(sourceRefs);
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-13 machine runs[${index}]`));
  const runIds = runs.map((run, index) => {
    requireExactKeys(run, ['id', 'command', 'result', 'exitCode', 'artifact'], `LS-13 machine runs[${index}]`);
    return requireNonEmptyString(run.id, `LS-13 machine runs[${index}].id`);
  });
  if (JSON.stringify(runIds) !== JSON.stringify(Object.keys(LS13_RUN_POLICY))) {
    throw new Error('LS-13 machine runs do not match the exact verification policy');
  }
  const passedTestIdsByRun = new Map<string, Set<string>>();
  for (const [index, run] of runs.entries()) {
    const id = runIds[index] as LS13RunId;
    const policy = LS13_RUN_POLICY[id];
    if (run.command !== policy.command || run.result !== 'passed' || run.exitCode !== 0) {
      throw new Error(`LS-13 verification run ${id} did not pass its exact command`);
    }
    const artifact = requireRecord(run.artifact, `LS-13 machine runs[${index}].artifact`);
    requireExactKeys(artifact, ['path', 'sha256'], `LS-13 machine runs[${index}].artifact`);
    if (artifact.path !== policy.artifactPath) throw new Error(`LS-13 verification run ${id} has the wrong artifact path`);
    requireSha256(artifact.sha256, `LS-13 machine runs[${index}].artifact.sha256`);
    const runArtifact = requireRecord(runArtifactValues[id], `LS-13 run artifact ${id}`);
    requireExactKeys(runArtifact, ['schema', 'version', 'id', 'command', 'result', 'exitCode', 'sourceSnapshotSha256', 'passedTestIds', 'summary'], `LS-13 run artifact ${id}`);
    if (runArtifact.schema !== 'rww.command-verification' || runArtifact.version !== 1 || runArtifact.id !== id
      || runArtifact.command !== policy.command || runArtifact.result !== 'passed' || runArtifact.exitCode !== 0) {
      throw new Error(`LS-13 run artifact ${id} does not prove the exact passing command`);
    }
    if (requireSha256(runArtifact.sourceSnapshotSha256, `LS-13 run artifact ${id}.sourceSnapshotSha256`) !== sourceSnapshotSha256) {
      throw new Error(`LS-13 run artifact ${id} does not bind the implementation source snapshot`);
    }
    if (requireNonEmptyString(runArtifact.summary, `LS-13 run artifact ${id}.summary`).length < 20) {
      throw new Error(`LS-13 run artifact ${id} lacks a substantive summary`);
    }
    const passedTestIds = requireStringArray(runArtifact.passedTestIds, `LS-13 run artifact ${id}.passedTestIds`);
    if (JSON.stringify(passedTestIds) !== JSON.stringify(LS13_RUN_TEST_IDS[id])) {
      throw new Error(`LS-13 run artifact ${id} does not contain the exact predeclared test IDs`);
    }
    passedTestIdsByRun.set(id, new Set(passedTestIds));
  }
  const checks = asArray(machine.checks).map((check, index) => requireRecord(check, `LS-13 machine checks[${index}]`));
  const checkIds = checks.map((check, index) => {
    requireExactKeys(check, ['id', 'result', 'runIds', 'testIds'], `LS-13 machine checks[${index}]`);
    if (check.result !== 'passed') throw new Error(`LS-13 machine check ${String(check.id)} did not pass`);
    return requireNonEmptyString(check.id, `LS-13 machine checks[${index}].id`);
  });
  if (JSON.stringify(checkIds) !== JSON.stringify(LS13_ACCEPTANCE_IDS)) {
    throw new Error('LS-13 machine checks do not cover the exact acceptance matrix');
  }
  for (const [index, check] of checks.entries()) {
    const id = checkIds[index] as keyof typeof LS13_CHECK_POLICY;
    const policy = LS13_CHECK_POLICY[id];
    const checkRunIds = requireStringArray(check.runIds, `LS-13 machine checks[${index}].runIds`);
    const testIds = requireStringArray(check.testIds, `LS-13 machine checks[${index}].testIds`);
    if (JSON.stringify(checkRunIds) !== JSON.stringify(policy.runIds)
      || JSON.stringify(testIds) !== JSON.stringify(policy.testIds)) {
      throw new Error(`LS-13 machine check ${id} does not match its exact run and test policy`);
    }
    for (const testId of testIds) {
      if (!checkRunIds.some((runId) => passedTestIdsByRun.get(runId)?.has(testId))) {
        throw new Error(`LS-13 machine check ${id} cannot prove test ID ${testId}`);
      }
    }
  }
  const review = requireRecord(reviewValue, 'LS-13 criterion review');
  requireExactKeys(review, [
    'schema', 'version', 'reviewId', 'claimId', 'contractSha256', 'policySha256', 'reviewRound',
    'reviewType', 'independentContext', 'reviewer', 'scores', 'dependencyReady', 'blockers',
    'requiredQualityFindings', 'humanValidation', 'polish',
  ], 'LS-13 criterion review');
  if (review.schema !== 'rww.criterion-review' || review.version !== 1 || review.claimId !== 'LS-13'
    || review.reviewType !== 'platform-presentation-accessibility' || review.independentContext !== true) {
    throw new Error('LS-13 criterion review has an invalid identity or review type');
  }
  if (!Number.isInteger(review.reviewRound) || Number(review.reviewRound) < 1 || Number(review.reviewRound) > 2) {
    throw new Error('LS-13 criterion review exceeds the bounded review policy');
  }
  const reviewer = requireRecord(review.reviewer, 'LS-13 criterion review reviewer');
  requireExactKeys(reviewer, ['role', 'taskId', 'model', 'completedAt', 'sourceSnapshotSha256'], 'LS-13 criterion review reviewer');
  if (reviewer.role !== 'independent-critic' || !/^ses_[A-Za-z0-9]+$/.test(requireNonEmptyString(reviewer.taskId, 'LS-13 reviewer taskId'))
    || !isoDateString(requireNonEmptyString(reviewer.completedAt, 'LS-13 reviewer completedAt'))
    || requireSha256(reviewer.sourceSnapshotSha256, 'LS-13 reviewer sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-13 criterion review has invalid independent provenance');
  }
  requireNonEmptyString(reviewer.model, 'LS-13 reviewer model');
  if (expectedHashes && (
    requireSha256(review.contractSha256, 'LS-13 review contractSha256') !== expectedHashes.contractSha256
    || requireSha256(review.policySha256, 'LS-13 review policySha256') !== expectedHashes.policySha256
  )) throw new Error('LS-13 criterion review does not bind the current contract and execution policy');
  const scores = requireRecord(review.scores, 'LS-13 criterion review scores');
  requireExactKeys(scores, [...LS13_ACCEPTANCE_IDS], 'LS-13 criterion review scores');
  for (const id of LS13_ACCEPTANCE_IDS) {
    const score = requireRecord(scores[id], `LS-13 criterion review scores.${id}`);
    requireExactKeys(score, ['score', 'checkId', 'rationale'], `LS-13 criterion review scores.${id}`);
    if (score.checkId !== id || !Number.isInteger(score.score) || Number(score.score) < 3 || Number(score.score) > 4
      || requireNonEmptyString(score.rationale, `LS-13 criterion review scores.${id}.rationale`).length < 20) {
      throw new Error(`LS-13 criterion ${id} is below ship-ready or lacks rationale`);
    }
  }
  if (review.dependencyReady !== true
    || requireStringArray(review.blockers, 'LS-13 review blockers').length !== 0
    || requireStringArray(review.requiredQualityFindings, 'LS-13 review requiredQualityFindings').length !== 0
    || requireStringArray(review.humanValidation, 'LS-13 review humanValidation').length !== 0) {
    throw new Error('LS-13 criterion review is not dependency-ready');
  }
  for (const [index, finding] of asArray(review.polish).entries()) {
    const record = requireRecord(finding, `LS-13 criterion review polish[${index}]`);
    requireExactKeys(record, ['id', 'summary', 'reopenTrigger'], `LS-13 criterion review polish[${index}]`);
    requireNonEmptyString(record.id, `LS-13 criterion review polish[${index}].id`);
    requireNonEmptyString(record.summary, `LS-13 criterion review polish[${index}].summary`);
    requireNonEmptyString(record.reopenTrigger, `LS-13 criterion review polish[${index}].reopenTrigger`);
  }
}

export function validateLS12EvidenceShape(
  machineValue: unknown,
  reviewValue: unknown,
  runArtifactValues: Record<string, unknown>,
  expectedHashes?: { contractSha256: string; policySha256: string },
): void {
  const machine = requireRecord(machineValue, 'LS-12 machine evidence');
  requireExactKeys(machine, ['schema', 'version', 'sliceId', 'contractSha256', 'sourceRefs', 'runs', 'checks'], 'LS-12 machine evidence');
  if (machine.schema !== 'rww.ls-12-verification' || machine.version !== 1 || machine.sliceId !== 'LS-12') {
    throw new Error('LS-12 machine evidence has an invalid identity');
  }
  const contractSha256 = requireSha256(machine.contractSha256, 'LS-12 machine contractSha256');
  if (expectedHashes && contractSha256 !== expectedHashes.contractSha256) {
    throw new Error('LS-12 machine evidence does not bind the current contract');
  }
  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-12 machine sourceRefs[${index}]`));
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-12 machine sourceRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-12 machine sourceRefs[${index}].path`);
    if (!isSafeImplementationPath(path)) throw new Error(`Unsafe LS-12 implementation source path: ${path}`);
    requireSha256(source.sha256, `LS-12 machine sourceRefs[${index}].sha256`);
    return path;
  });
  if (JSON.stringify(sourcePaths) !== JSON.stringify(LS12_REQUIRED_SOURCE_PATHS)) {
    throw new Error('LS-12 machine evidence does not bind the exact implementation sources');
  }
  const sourceSnapshotSha256 = ls12SourceSnapshotSha256(sourceRefs);
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-12 machine runs[${index}]`));
  const runIds = runs.map((run, index) => {
    requireExactKeys(run, ['id', 'command', 'result', 'exitCode', 'artifact'], `LS-12 machine runs[${index}]`);
    return requireNonEmptyString(run.id, `LS-12 machine runs[${index}].id`);
  });
  if (JSON.stringify(runIds) !== JSON.stringify(Object.keys(LS12_RUN_POLICY))) {
    throw new Error('LS-12 machine runs do not match the exact verification policy');
  }
  const passedTestIdsByRun = new Map<string, Set<string>>();
  for (const [index, run] of runs.entries()) {
    const id = runIds[index] as LS12RunId;
    const policy = LS12_RUN_POLICY[id];
    if (run.command !== policy.command || run.result !== 'passed' || run.exitCode !== 0) {
      throw new Error(`LS-12 verification run ${id} did not pass its exact command`);
    }
    const artifact = requireRecord(run.artifact, `LS-12 machine runs[${index}].artifact`);
    requireExactKeys(artifact, ['path', 'sha256'], `LS-12 machine runs[${index}].artifact`);
    if (artifact.path !== policy.artifactPath) throw new Error(`LS-12 verification run ${id} has the wrong artifact path`);
    requireSha256(artifact.sha256, `LS-12 machine runs[${index}].artifact.sha256`);
    const runArtifact = requireRecord(runArtifactValues[id], `LS-12 run artifact ${id}`);
    requireExactKeys(
      runArtifact,
      ['schema', 'version', 'id', 'command', 'result', 'exitCode', 'sourceSnapshotSha256', 'passedTestIds', 'summary'],
      `LS-12 run artifact ${id}`,
    );
    if (runArtifact.schema !== 'rww.command-verification' || runArtifact.version !== 1 || runArtifact.id !== id
      || runArtifact.command !== policy.command || runArtifact.result !== 'passed' || runArtifact.exitCode !== 0) {
      throw new Error(`LS-12 run artifact ${id} does not prove the exact passing command`);
    }
    if (requireSha256(runArtifact.sourceSnapshotSha256, `LS-12 run artifact ${id}.sourceSnapshotSha256`) !== sourceSnapshotSha256) {
      throw new Error(`LS-12 run artifact ${id} does not bind the implementation source snapshot`);
    }
    if (requireNonEmptyString(runArtifact.summary, `LS-12 run artifact ${id}.summary`).length < 20) {
      throw new Error(`LS-12 run artifact ${id} lacks a substantive summary`);
    }
    const passedTestIds = requireStringArray(runArtifact.passedTestIds, `LS-12 run artifact ${id}.passedTestIds`);
    if (JSON.stringify(passedTestIds) !== JSON.stringify(LS12_RUN_TEST_IDS[id])) {
      throw new Error(`LS-12 run artifact ${id} does not contain the exact predeclared test IDs`);
    }
    passedTestIdsByRun.set(id, new Set(passedTestIds));
  }
  const checks = asArray(machine.checks).map((check, index) => requireRecord(check, `LS-12 machine checks[${index}]`));
  const checkIds = checks.map((check, index) => {
    requireExactKeys(check, ['id', 'result', 'runIds', 'testIds'], `LS-12 machine checks[${index}]`);
    if (check.result !== 'passed') throw new Error(`LS-12 machine check ${String(check.id)} did not pass`);
    return requireNonEmptyString(check.id, `LS-12 machine checks[${index}].id`);
  });
  if (JSON.stringify(checkIds) !== JSON.stringify(LS12_ACCEPTANCE_IDS)) {
    throw new Error('LS-12 machine checks do not cover the exact acceptance matrix');
  }
  for (const [index, check] of checks.entries()) {
    const id = checkIds[index] as keyof typeof LS12_CHECK_POLICY;
    const policy = LS12_CHECK_POLICY[id];
    const checkRunIds = requireStringArray(check.runIds, `LS-12 machine checks[${index}].runIds`);
    const testIds = requireStringArray(check.testIds, `LS-12 machine checks[${index}].testIds`);
    if (JSON.stringify(checkRunIds) !== JSON.stringify(policy.runIds)
      || JSON.stringify(testIds) !== JSON.stringify(policy.testIds)) {
      throw new Error(`LS-12 machine check ${id} does not match its exact run and test policy`);
    }
    for (const testId of testIds) {
      if (!checkRunIds.some((runId) => passedTestIdsByRun.get(runId)?.has(testId))) {
        throw new Error(`LS-12 machine check ${id} cannot prove test ID ${testId}`);
      }
    }
  }
  const review = requireRecord(reviewValue, 'LS-12 criterion review');
  requireExactKeys(
    review,
    [
      'schema', 'version', 'reviewId', 'claimId', 'contractSha256', 'policySha256', 'reviewRound',
      'reviewType', 'independentContext', 'reviewer', 'scores', 'dependencyReady', 'blockers',
      'requiredQualityFindings', 'humanValidation', 'polish',
    ],
    'LS-12 criterion review',
  );
  if (review.schema !== 'rww.criterion-review' || review.version !== 1 || review.claimId !== 'LS-12'
    || review.reviewType !== 'platform-presentation-accessibility' || review.independentContext !== true) {
    throw new Error('LS-12 criterion review has an invalid identity or review type');
  }
  requireNonEmptyString(review.reviewId, 'LS-12 criterion review reviewId');
  if (!Number.isInteger(review.reviewRound) || Number(review.reviewRound) < 1 || Number(review.reviewRound) > 2) {
    throw new Error('LS-12 criterion review exceeds the bounded review policy');
  }
  const reviewer = requireRecord(review.reviewer, 'LS-12 criterion review reviewer');
  requireExactKeys(reviewer, ['role', 'taskId', 'model', 'completedAt', 'sourceSnapshotSha256'], 'LS-12 criterion review reviewer');
  if (reviewer.role !== 'independent-critic' || !/^ses_[A-Za-z0-9]+$/.test(requireNonEmptyString(reviewer.taskId, 'LS-12 reviewer taskId'))
    || !isoDateString(requireNonEmptyString(reviewer.completedAt, 'LS-12 reviewer completedAt'))
    || requireSha256(reviewer.sourceSnapshotSha256, 'LS-12 reviewer sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-12 criterion review has invalid independent provenance');
  }
  requireNonEmptyString(reviewer.model, 'LS-12 reviewer model');
  if (expectedHashes && (
    requireSha256(review.contractSha256, 'LS-12 review contractSha256') !== expectedHashes.contractSha256
    || requireSha256(review.policySha256, 'LS-12 review policySha256') !== expectedHashes.policySha256
  )) throw new Error('LS-12 criterion review does not bind the current contract and execution policy');
  const scores = requireRecord(review.scores, 'LS-12 criterion review scores');
  requireExactKeys(scores, [...LS12_ACCEPTANCE_IDS], 'LS-12 criterion review scores');
  for (const id of LS12_ACCEPTANCE_IDS) {
    const score = requireRecord(scores[id], `LS-12 criterion review scores.${id}`);
    requireExactKeys(score, ['score', 'checkId', 'rationale'], `LS-12 criterion review scores.${id}`);
    if (score.checkId !== id || !Number.isInteger(score.score) || Number(score.score) < 3 || Number(score.score) > 4
      || requireNonEmptyString(score.rationale, `LS-12 criterion review scores.${id}.rationale`).length < 20) {
      throw new Error(`LS-12 criterion ${id} is below ship-ready or lacks rationale`);
    }
  }
  if (review.dependencyReady !== true
    || requireStringArray(review.blockers, 'LS-12 review blockers').length !== 0
    || requireStringArray(review.requiredQualityFindings, 'LS-12 review requiredQualityFindings').length !== 0
    || requireStringArray(review.humanValidation, 'LS-12 review humanValidation').length !== 0) {
    throw new Error('LS-12 criterion review is not dependency-ready');
  }
  for (const [index, finding] of asArray(review.polish).entries()) {
    const record = requireRecord(finding, `LS-12 criterion review polish[${index}]`);
    requireExactKeys(record, ['id', 'summary', 'reopenTrigger'], `LS-12 criterion review polish[${index}]`);
    requireNonEmptyString(record.id, `LS-12 criterion review polish[${index}].id`);
    requireNonEmptyString(record.summary, `LS-12 criterion review polish[${index}].summary`);
    requireNonEmptyString(record.reopenTrigger, `LS-12 criterion review polish[${index}].reopenTrigger`);
  }
}

export function validateLS11EvidenceShape(
  machineValue: unknown,
  reviewValue: unknown,
  runArtifactValues: Record<string, unknown>,
  expectedHashes?: { contractSha256: string; policySha256: string },
): void {
  const machine = requireRecord(machineValue, 'LS-11 machine evidence');
  requireExactKeys(
    machine,
    ['schema', 'version', 'sliceId', 'contractSha256', 'sourceRefs', 'runs', 'checks'],
    'LS-11 machine evidence',
  );
  if (machine.schema !== 'rww.ls-11-verification' || machine.version !== 1 || machine.sliceId !== 'LS-11') {
    throw new Error('LS-11 machine evidence has an invalid identity');
  }
  const contractSha256 = requireSha256(machine.contractSha256, 'LS-11 machine contractSha256');
  if (expectedHashes && contractSha256 !== expectedHashes.contractSha256) {
    throw new Error('LS-11 machine evidence does not bind the current contract');
  }

  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-11 machine sourceRefs[${index}]`));
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-11 machine sourceRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-11 machine sourceRefs[${index}].path`);
    if (!isSafeImplementationPath(path)) throw new Error(`Unsafe LS-11 implementation source path: ${path}`);
    requireSha256(source.sha256, `LS-11 machine sourceRefs[${index}].sha256`);
    return path;
  });
  if (JSON.stringify(sourcePaths) !== JSON.stringify(LS11_REQUIRED_SOURCE_PATHS)) {
    throw new Error('LS-11 machine evidence does not bind the exact implementation sources');
  }
  const sourceSnapshotSha256 = ls11SourceSnapshotSha256(sourceRefs);

  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-11 machine runs[${index}]`));
  const runIds = runs.map((run, index) => {
    requireExactKeys(run, ['id', 'command', 'result', 'exitCode', 'artifact'], `LS-11 machine runs[${index}]`);
    return requireNonEmptyString(run.id, `LS-11 machine runs[${index}].id`);
  });
  if (JSON.stringify(runIds) !== JSON.stringify(Object.keys(LS11_RUN_POLICY))) {
    throw new Error('LS-11 machine runs do not match the exact verification policy');
  }
  const passedTestIdsByRun = new Map<string, Set<string>>();
  for (const [index, run] of runs.entries()) {
    const id = runIds[index] as LS11RunId;
    const policy = LS11_RUN_POLICY[id];
    if (run.command !== policy.command || run.result !== 'passed' || run.exitCode !== 0) {
      throw new Error(`LS-11 verification run ${id} did not pass its exact command`);
    }
    const artifact = requireRecord(run.artifact, `LS-11 machine runs[${index}].artifact`);
    requireExactKeys(artifact, ['path', 'sha256'], `LS-11 machine runs[${index}].artifact`);
    if (artifact.path !== policy.artifactPath) throw new Error(`LS-11 verification run ${id} has the wrong artifact path`);
    requireSha256(artifact.sha256, `LS-11 machine runs[${index}].artifact.sha256`);
    const runArtifact = requireRecord(runArtifactValues[id], `LS-11 run artifact ${id}`);
    requireExactKeys(
      runArtifact,
      ['schema', 'version', 'id', 'command', 'result', 'exitCode', 'sourceSnapshotSha256', 'passedTestIds', 'summary'],
      `LS-11 run artifact ${id}`,
    );
    if (runArtifact.schema !== 'rww.command-verification' || runArtifact.version !== 1 || runArtifact.id !== id
      || runArtifact.command !== policy.command || runArtifact.result !== 'passed' || runArtifact.exitCode !== 0) {
      throw new Error(`LS-11 run artifact ${id} does not prove the exact passing command`);
    }
    if (requireSha256(runArtifact.sourceSnapshotSha256, `LS-11 run artifact ${id}.sourceSnapshotSha256`) !== sourceSnapshotSha256) {
      throw new Error(`LS-11 run artifact ${id} does not bind the implementation source snapshot`);
    }
    if (requireNonEmptyString(runArtifact.summary, `LS-11 run artifact ${id}.summary`).length < 20) {
      throw new Error(`LS-11 run artifact ${id} lacks a substantive summary`);
    }
    const passedTestIds = requireStringArray(runArtifact.passedTestIds, `LS-11 run artifact ${id}.passedTestIds`);
    if (JSON.stringify(passedTestIds) !== JSON.stringify(LS11_RUN_TEST_IDS[id])) {
      throw new Error(`LS-11 run artifact ${id} does not contain the exact predeclared test IDs`);
    }
    passedTestIdsByRun.set(id, new Set(passedTestIds));
  }

  const checks = asArray(machine.checks).map((check, index) => requireRecord(check, `LS-11 machine checks[${index}]`));
  const checkIds = checks.map((check, index) => {
    requireExactKeys(check, ['id', 'result', 'runIds', 'testIds'], `LS-11 machine checks[${index}]`);
    if (check.result !== 'passed') throw new Error(`LS-11 machine check ${String(check.id)} did not pass`);
    return requireNonEmptyString(check.id, `LS-11 machine checks[${index}].id`);
  });
  if (JSON.stringify(checkIds) !== JSON.stringify(LS11_ACCEPTANCE_IDS)) {
    throw new Error('LS-11 machine checks do not cover the exact acceptance matrix');
  }
  for (const [index, check] of checks.entries()) {
    const id = checkIds[index] as keyof typeof LS11_CHECK_POLICY;
    const policy = LS11_CHECK_POLICY[id];
    const checkRunIds = requireStringArray(check.runIds, `LS-11 machine checks[${index}].runIds`);
    const testIds = requireStringArray(check.testIds, `LS-11 machine checks[${index}].testIds`);
    if (JSON.stringify(checkRunIds) !== JSON.stringify(policy.runIds)
      || JSON.stringify(testIds) !== JSON.stringify(policy.testIds)) {
      throw new Error(`LS-11 machine check ${id} does not match its exact run and test policy`);
    }
    for (const testId of testIds) {
      if (!checkRunIds.some((runId) => passedTestIdsByRun.get(runId)?.has(testId))) {
        throw new Error(`LS-11 machine check ${id} cannot prove test ID ${testId}`);
      }
    }
  }

  const review = requireRecord(reviewValue, 'LS-11 criterion review');
  requireExactKeys(
    review,
    [
      'schema', 'version', 'reviewId', 'claimId', 'contractSha256', 'policySha256', 'reviewRound',
      'reviewType', 'independentContext', 'reviewer', 'scores', 'dependencyReady', 'blockers',
      'requiredQualityFindings', 'humanValidation', 'polish',
    ],
    'LS-11 criterion review',
  );
  if (review.schema !== 'rww.criterion-review' || review.version !== 1 || review.claimId !== 'LS-11'
    || review.reviewType !== 'gameplay-presentation-accessibility' || review.independentContext !== true) {
    throw new Error('LS-11 criterion review has an invalid identity or review type');
  }
  requireNonEmptyString(review.reviewId, 'LS-11 criterion review reviewId');
  if (!Number.isInteger(review.reviewRound) || Number(review.reviewRound) < 1 || Number(review.reviewRound) > 3) {
    throw new Error('LS-11 criterion review exceeds the bounded review policy');
  }
  const reviewer = requireRecord(review.reviewer, 'LS-11 criterion review reviewer');
  requireExactKeys(reviewer, ['role', 'taskId', 'model', 'completedAt', 'sourceSnapshotSha256'], 'LS-11 criterion review reviewer');
  if (reviewer.role !== 'independent-critic' || !/^ses_[A-Za-z0-9]+$/.test(requireNonEmptyString(reviewer.taskId, 'LS-11 reviewer taskId'))
    || !isoDateString(requireNonEmptyString(reviewer.completedAt, 'LS-11 reviewer completedAt'))
    || requireSha256(reviewer.sourceSnapshotSha256, 'LS-11 reviewer sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-11 criterion review has invalid independent provenance');
  }
  requireNonEmptyString(reviewer.model, 'LS-11 reviewer model');
  if (expectedHashes && (
    requireSha256(review.contractSha256, 'LS-11 review contractSha256') !== expectedHashes.contractSha256
    || requireSha256(review.policySha256, 'LS-11 review policySha256') !== expectedHashes.policySha256
  )) throw new Error('LS-11 criterion review does not bind the current contract and execution policy');
  const scores = requireRecord(review.scores, 'LS-11 criterion review scores');
  requireExactKeys(scores, [...LS11_ACCEPTANCE_IDS], 'LS-11 criterion review scores');
  for (const id of LS11_ACCEPTANCE_IDS) {
    const score = requireRecord(scores[id], `LS-11 criterion review scores.${id}`);
    requireExactKeys(score, ['score', 'checkId', 'rationale'], `LS-11 criterion review scores.${id}`);
    if (score.checkId !== id || !Number.isInteger(score.score) || Number(score.score) < 3 || Number(score.score) > 4
      || requireNonEmptyString(score.rationale, `LS-11 criterion review scores.${id}.rationale`).length < 20) {
      throw new Error(`LS-11 criterion ${id} is below ship-ready or lacks rationale`);
    }
  }
  if (review.dependencyReady !== true
    || requireStringArray(review.blockers, 'LS-11 review blockers').length !== 0
    || requireStringArray(review.requiredQualityFindings, 'LS-11 review requiredQualityFindings').length !== 0
    || JSON.stringify(requireStringArray(review.humanValidation, 'LS-11 review humanValidation')) !== JSON.stringify(['G-01'])) {
    throw new Error('LS-11 criterion review is not dependency-ready');
  }
  for (const [index, finding] of asArray(review.polish).entries()) {
    const record = requireRecord(finding, `LS-11 criterion review polish[${index}]`);
    requireExactKeys(record, ['id', 'summary', 'reopenTrigger'], `LS-11 criterion review polish[${index}]`);
    requireNonEmptyString(record.id, `LS-11 criterion review polish[${index}].id`);
    requireNonEmptyString(record.summary, `LS-11 criterion review polish[${index}].summary`);
    requireNonEmptyString(record.reopenTrigger, `LS-11 criterion review polish[${index}].reopenTrigger`);
  }
}

export function validateLS10EvidenceShape(
  machineValue: unknown,
  reviewValue: unknown,
  runArtifactValues: Record<string, unknown>,
  expectedHashes?: { contractSha256: string; policySha256: string },
): void {
  const machine = requireRecord(machineValue, 'LS-10 machine evidence');
  requireExactKeys(
    machine,
    ['schema', 'version', 'sliceId', 'contractSha256', 'sourceRefs', 'runs', 'checks'],
    'LS-10 machine evidence',
  );
  if (machine.schema !== 'rww.ls-10-verification' || machine.version !== 1 || machine.sliceId !== 'LS-10') {
    throw new Error('LS-10 machine evidence has an invalid identity');
  }
  const contractSha256 = requireSha256(machine.contractSha256, 'LS-10 machine contractSha256');
  if (expectedHashes && contractSha256 !== expectedHashes.contractSha256) {
    throw new Error('LS-10 machine evidence does not bind the current contract');
  }

  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-10 machine sourceRefs[${index}]`));
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-10 machine sourceRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-10 machine sourceRefs[${index}].path`);
    if (!isSafeImplementationPath(path)) throw new Error(`Unsafe LS-10 implementation source path: ${path}`);
    requireSha256(source.sha256, `LS-10 machine sourceRefs[${index}].sha256`);
    return path;
  });
  if (JSON.stringify(sourcePaths) !== JSON.stringify(LS10_REQUIRED_SOURCE_PATHS)) {
    throw new Error('LS-10 machine evidence does not bind the exact implementation sources');
  }
  const sourceSnapshotSha256 = ls10SourceSnapshotSha256(sourceRefs);

  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-10 machine runs[${index}]`));
  const runIds = runs.map((run, index) => {
    requireExactKeys(run, ['id', 'command', 'result', 'exitCode', 'artifact'], `LS-10 machine runs[${index}]`);
    return requireNonEmptyString(run.id, `LS-10 machine runs[${index}].id`);
  });
  if (JSON.stringify(runIds) !== JSON.stringify(Object.keys(LS10_RUN_POLICY))) {
    throw new Error('LS-10 machine runs do not match the exact verification policy');
  }
  const passedTestIdsByRun = new Map<string, Set<string>>();
  for (const [index, run] of runs.entries()) {
    const id = runIds[index] as LS10RunId;
    const policy = LS10_RUN_POLICY[id];
    if (run.command !== policy.command || run.result !== 'passed' || run.exitCode !== 0) {
      throw new Error(`LS-10 verification run ${id} did not pass its exact command`);
    }
    const artifact = requireRecord(run.artifact, `LS-10 machine runs[${index}].artifact`);
    requireExactKeys(artifact, ['path', 'sha256'], `LS-10 machine runs[${index}].artifact`);
    if (artifact.path !== policy.artifactPath) throw new Error(`LS-10 verification run ${id} has the wrong artifact path`);
    requireSha256(artifact.sha256, `LS-10 machine runs[${index}].artifact.sha256`);
    const runArtifact = requireRecord(runArtifactValues[id], `LS-10 run artifact ${id}`);
    requireExactKeys(
      runArtifact,
      ['schema', 'version', 'id', 'command', 'result', 'exitCode', 'sourceSnapshotSha256', 'passedTestIds', 'summary'],
      `LS-10 run artifact ${id}`,
    );
    if (runArtifact.schema !== 'rww.command-verification' || runArtifact.version !== 1 || runArtifact.id !== id
      || runArtifact.command !== policy.command || runArtifact.result !== 'passed' || runArtifact.exitCode !== 0) {
      throw new Error(`LS-10 run artifact ${id} does not prove the exact passing command`);
    }
    if (requireSha256(runArtifact.sourceSnapshotSha256, `LS-10 run artifact ${id}.sourceSnapshotSha256`) !== sourceSnapshotSha256) {
      throw new Error(`LS-10 run artifact ${id} does not bind the implementation source snapshot`);
    }
    if (requireNonEmptyString(runArtifact.summary, `LS-10 run artifact ${id}.summary`).length < 20) {
      throw new Error(`LS-10 run artifact ${id} lacks a substantive summary`);
    }
    const passedTestIds = requireStringArray(runArtifact.passedTestIds, `LS-10 run artifact ${id}.passedTestIds`);
    if (JSON.stringify(passedTestIds) !== JSON.stringify(LS10_RUN_TEST_IDS[id])) {
      throw new Error(`LS-10 run artifact ${id} does not contain the exact predeclared test IDs`);
    }
    passedTestIdsByRun.set(id, new Set(passedTestIds));
  }

  const checks = asArray(machine.checks).map((check, index) => requireRecord(check, `LS-10 machine checks[${index}]`));
  const checkIds = checks.map((check, index) => {
    requireExactKeys(check, ['id', 'result', 'runIds', 'testIds'], `LS-10 machine checks[${index}]`);
    if (check.result !== 'passed') throw new Error(`LS-10 machine check ${String(check.id)} did not pass`);
    return requireNonEmptyString(check.id, `LS-10 machine checks[${index}].id`);
  });
  if (JSON.stringify(checkIds) !== JSON.stringify(LS10_ACCEPTANCE_IDS)) {
    throw new Error('LS-10 machine checks do not cover the exact acceptance matrix');
  }
  for (const [index, check] of checks.entries()) {
    const id = checkIds[index] as keyof typeof LS10_CHECK_POLICY;
    const policy = LS10_CHECK_POLICY[id];
    const checkRunIds = requireStringArray(check.runIds, `LS-10 machine checks[${index}].runIds`);
    const testIds = requireStringArray(check.testIds, `LS-10 machine checks[${index}].testIds`);
    if (JSON.stringify(checkRunIds) !== JSON.stringify(policy.runIds)
      || JSON.stringify(testIds) !== JSON.stringify(policy.testIds)) {
      throw new Error(`LS-10 machine check ${id} does not match its exact run and test policy`);
    }
    for (const testId of testIds) {
      if (!checkRunIds.some((runId) => passedTestIdsByRun.get(runId)?.has(testId))) {
        throw new Error(`LS-10 machine check ${id} cannot prove test ID ${testId}`);
      }
    }
  }

  const review = requireRecord(reviewValue, 'LS-10 criterion review');
  requireExactKeys(
    review,
    [
      'schema', 'version', 'reviewId', 'claimId', 'contractSha256', 'policySha256', 'reviewRound',
      'reviewType', 'independentContext', 'reviewer', 'scores', 'dependencyReady', 'blockers',
      'requiredQualityFindings', 'humanValidation', 'polish',
    ],
    'LS-10 criterion review',
  );
  if (review.schema !== 'rww.criterion-review' || review.version !== 1 || review.claimId !== 'LS-10'
    || review.reviewType !== 'platform-presentation-accessibility' || review.independentContext !== true) {
    throw new Error('LS-10 criterion review has an invalid identity or review type');
  }
  if (!Number.isInteger(review.reviewRound) || Number(review.reviewRound) < 1 || Number(review.reviewRound) > 2) {
    throw new Error('LS-10 criterion review exceeds the bounded review policy');
  }
  const reviewer = requireRecord(review.reviewer, 'LS-10 criterion review reviewer');
  requireExactKeys(reviewer, ['role', 'taskId', 'model', 'completedAt', 'sourceSnapshotSha256'], 'LS-10 criterion review reviewer');
  if (reviewer.role !== 'independent-critic' || !/^ses_[A-Za-z0-9]+$/.test(requireNonEmptyString(reviewer.taskId, 'LS-10 reviewer taskId'))
    || !isoDateString(requireNonEmptyString(reviewer.completedAt, 'LS-10 reviewer completedAt'))
    || requireSha256(reviewer.sourceSnapshotSha256, 'LS-10 reviewer sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-10 criterion review has invalid independent provenance');
  }
  requireNonEmptyString(reviewer.model, 'LS-10 reviewer model');
  if (expectedHashes && (
    requireSha256(review.contractSha256, 'LS-10 review contractSha256') !== expectedHashes.contractSha256
    || requireSha256(review.policySha256, 'LS-10 review policySha256') !== expectedHashes.policySha256
  )) throw new Error('LS-10 criterion review does not bind the current contract and execution policy');
  const scores = requireRecord(review.scores, 'LS-10 criterion review scores');
  requireExactKeys(scores, [...LS10_ACCEPTANCE_IDS], 'LS-10 criterion review scores');
  for (const id of LS10_ACCEPTANCE_IDS) {
    const score = requireRecord(scores[id], `LS-10 criterion review scores.${id}`);
    requireExactKeys(score, ['score', 'checkId', 'rationale'], `LS-10 criterion review scores.${id}`);
    if (score.checkId !== id || !Number.isInteger(score.score) || Number(score.score) < 3 || Number(score.score) > 4
      || requireNonEmptyString(score.rationale, `LS-10 criterion review scores.${id}.rationale`).length < 20) {
      throw new Error(`LS-10 criterion ${id} is below ship-ready or lacks rationale`);
    }
  }
  if (review.dependencyReady !== true
    || requireStringArray(review.blockers, 'LS-10 review blockers').length !== 0
    || requireStringArray(review.requiredQualityFindings, 'LS-10 review requiredQualityFindings').length !== 0
    || requireStringArray(review.humanValidation, 'LS-10 review humanValidation').length !== 0) {
    throw new Error('LS-10 criterion review is not dependency-ready');
  }
  for (const [index, finding] of asArray(review.polish).entries()) {
    const record = requireRecord(finding, `LS-10 criterion review polish[${index}]`);
    requireExactKeys(record, ['id', 'summary', 'reopenTrigger'], `LS-10 criterion review polish[${index}]`);
    requireNonEmptyString(record.id, `LS-10 criterion review polish[${index}].id`);
    requireNonEmptyString(record.summary, `LS-10 criterion review polish[${index}].summary`);
    requireNonEmptyString(record.reopenTrigger, `LS-10 criterion review polish[${index}].reopenTrigger`);
  }
}

export function validateLS09EvidenceShape(
  machineValue: unknown,
  reviewValue: unknown,
  runArtifactValues: Record<string, unknown>,
  expectedHashes?: { contractSha256: string; policySha256: string },
): void {
  const machine = requireRecord(machineValue, 'LS-09 machine evidence');
  requireExactKeys(
    machine,
    ['schema', 'version', 'sliceId', 'contractSha256', 'sourceRefs', 'runs', 'checks'],
    'LS-09 machine evidence',
  );
  if (machine.schema !== 'rww.ls-09-verification' || machine.version !== 1 || machine.sliceId !== 'LS-09') {
    throw new Error('LS-09 machine evidence has an invalid identity');
  }
  const contractSha256 = requireSha256(machine.contractSha256, 'LS-09 machine contractSha256');
  if (expectedHashes && contractSha256 !== expectedHashes.contractSha256) {
    throw new Error('LS-09 machine evidence does not bind the current contract');
  }

  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-09 machine sourceRefs[${index}]`));
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `LS-09 machine sourceRefs[${index}]`);
    const path = requireNonEmptyString(source.path, `LS-09 machine sourceRefs[${index}].path`);
    if (!isSafeImplementationPath(path)) throw new Error(`Unsafe LS-09 implementation source path: ${path}`);
    requireSha256(source.sha256, `LS-09 machine sourceRefs[${index}].sha256`);
    return path;
  });
  if (JSON.stringify(sourcePaths) !== JSON.stringify(LS09_REQUIRED_SOURCE_PATHS)) {
    throw new Error('LS-09 machine evidence does not bind the exact implementation sources');
  }
  const sourceSnapshotSha256 = ls09SourceSnapshotSha256(sourceRefs);

  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-09 machine runs[${index}]`));
  const runIds = runs.map((run, index) => {
    requireExactKeys(run, ['id', 'command', 'result', 'exitCode', 'artifact'], `LS-09 machine runs[${index}]`);
    return requireNonEmptyString(run.id, `LS-09 machine runs[${index}].id`);
  });
  if (JSON.stringify(runIds) !== JSON.stringify(Object.keys(LS09_RUN_POLICY))) {
    throw new Error('LS-09 machine runs do not match the exact verification policy');
  }
  const passedTestIdsByRun = new Map<string, Set<string>>();
  for (const [index, run] of runs.entries()) {
    const id = runIds[index] as LS09RunId;
    const policy = LS09_RUN_POLICY[id];
    if (run.command !== policy.command || run.result !== 'passed' || run.exitCode !== 0) {
      throw new Error(`LS-09 verification run ${id} did not pass its exact command`);
    }
    const artifact = requireRecord(run.artifact, `LS-09 machine runs[${index}].artifact`);
    requireExactKeys(artifact, ['path', 'sha256'], `LS-09 machine runs[${index}].artifact`);
    if (artifact.path !== policy.artifactPath) throw new Error(`LS-09 verification run ${id} has the wrong artifact path`);
    requireSha256(artifact.sha256, `LS-09 machine runs[${index}].artifact.sha256`);

    const runArtifact = requireRecord(runArtifactValues[id], `LS-09 run artifact ${id}`);
    requireExactKeys(
      runArtifact,
      ['schema', 'version', 'id', 'command', 'result', 'exitCode', 'sourceSnapshotSha256', 'passedTestIds', 'summary'],
      `LS-09 run artifact ${id}`,
    );
    if (runArtifact.schema !== 'rww.command-verification' || runArtifact.version !== 1 || runArtifact.id !== id) {
      throw new Error(`LS-09 run artifact ${id} has an invalid identity`);
    }
    if (runArtifact.command !== policy.command || runArtifact.result !== 'passed' || runArtifact.exitCode !== 0) {
      throw new Error(`LS-09 run artifact ${id} does not prove the exact passing command`);
    }
    if (requireSha256(runArtifact.sourceSnapshotSha256, `LS-09 run artifact ${id}.sourceSnapshotSha256`) !== sourceSnapshotSha256) {
      throw new Error(`LS-09 run artifact ${id} does not bind the implementation source snapshot`);
    }
    if (requireNonEmptyString(runArtifact.summary, `LS-09 run artifact ${id}.summary`).length < 20) {
      throw new Error(`LS-09 run artifact ${id} lacks a substantive summary`);
    }
    const passedTestIds = requireStringArray(runArtifact.passedTestIds, `LS-09 run artifact ${id}.passedTestIds`);
    if (JSON.stringify(passedTestIds) !== JSON.stringify(LS09_RUN_TEST_IDS[id])) {
      throw new Error(`LS-09 run artifact ${id} does not contain the exact predeclared test IDs`);
    }
    passedTestIdsByRun.set(id, new Set(passedTestIds));
  }

  const checks = asArray(machine.checks).map((check, index) =>
    requireRecord(check, `LS-09 machine checks[${index}]`));
  const checkIds = checks.map((check, index) => {
    requireExactKeys(check, ['id', 'result', 'runIds', 'testIds'], `LS-09 machine checks[${index}]`);
    if (check.result !== 'passed') throw new Error(`LS-09 machine check ${String(check.id)} did not pass`);
    return requireNonEmptyString(check.id, `LS-09 machine checks[${index}].id`);
  });
  if (JSON.stringify(checkIds) !== JSON.stringify(LS09_ACCEPTANCE_IDS)) {
    throw new Error('LS-09 machine checks do not cover the exact acceptance matrix');
  }
  for (const [index, check] of checks.entries()) {
    const id = checkIds[index] as keyof typeof LS09_CHECK_POLICY;
    const policy = LS09_CHECK_POLICY[id];
    const checkRunIds = requireStringArray(check.runIds, `LS-09 machine checks[${index}].runIds`);
    const testIds = requireStringArray(check.testIds, `LS-09 machine checks[${index}].testIds`);
    if (JSON.stringify(checkRunIds) !== JSON.stringify(policy.runIds)
      || JSON.stringify(testIds) !== JSON.stringify(policy.testIds)) {
      throw new Error(`LS-09 machine check ${id} does not match its exact run and test policy`);
    }
    for (const testId of testIds) {
      if (!checkRunIds.some((runId) => passedTestIdsByRun.get(runId)?.has(testId))) {
        throw new Error(`LS-09 machine check ${id} cannot prove test ID ${testId}`);
      }
    }
  }

  const review = requireRecord(reviewValue, 'LS-09 criterion review');
  requireExactKeys(
    review,
    [
      'schema', 'version', 'reviewId', 'claimId', 'contractSha256', 'policySha256', 'reviewRound',
      'reviewType', 'independentContext', 'reviewer', 'scores', 'dependencyReady', 'blockers',
      'requiredQualityFindings', 'humanValidation', 'polish',
    ],
    'LS-09 criterion review',
  );
  if (review.schema !== 'rww.criterion-review' || review.version !== 1 || review.claimId !== 'LS-09') {
    throw new Error('LS-09 criterion review has an invalid identity');
  }
  if (review.reviewType !== 'gameplay-system-acceptance' || review.independentContext !== true) {
    throw new Error('LS-09 criterion review is not an independent gameplay-system review');
  }
  requireNonEmptyString(review.reviewId, 'LS-09 criterion review reviewId');
  if (!Number.isInteger(review.reviewRound) || Number(review.reviewRound) < 1 || Number(review.reviewRound) > 3) {
    throw new Error('LS-09 criterion review exceeds the bounded review policy');
  }
  const reviewer = requireRecord(review.reviewer, 'LS-09 criterion review reviewer');
  requireExactKeys(reviewer, ['role', 'taskId', 'model', 'completedAt', 'sourceSnapshotSha256'], 'LS-09 criterion review reviewer');
  if (reviewer.role !== 'independent-critic' || !/^ses_[A-Za-z0-9]+$/.test(requireNonEmptyString(reviewer.taskId, 'LS-09 reviewer taskId'))) {
    throw new Error('LS-09 criterion review has invalid independent task provenance');
  }
  requireNonEmptyString(reviewer.model, 'LS-09 criterion review reviewer.model');
  if (!isoDateString(requireNonEmptyString(reviewer.completedAt, 'LS-09 criterion review reviewer.completedAt'))) {
    throw new Error('LS-09 criterion review has invalid completion time');
  }
  if (requireSha256(reviewer.sourceSnapshotSha256, 'LS-09 reviewer sourceSnapshotSha256') !== sourceSnapshotSha256) {
    throw new Error('LS-09 criterion review does not bind the implementation source snapshot');
  }
  const reviewContractSha256 = requireSha256(review.contractSha256, 'LS-09 review contractSha256');
  const reviewPolicySha256 = requireSha256(review.policySha256, 'LS-09 review policySha256');
  if (expectedHashes && (
    reviewContractSha256 !== expectedHashes.contractSha256
    || reviewPolicySha256 !== expectedHashes.policySha256
  )) throw new Error('LS-09 criterion review does not bind the current contract and execution policy');

  const scores = requireRecord(review.scores, 'LS-09 criterion review scores');
  requireExactKeys(scores, [...LS09_ACCEPTANCE_IDS], 'LS-09 criterion review scores');
  for (const id of LS09_ACCEPTANCE_IDS) {
    const score = requireRecord(scores[id], `LS-09 criterion review scores.${id}`);
    requireExactKeys(score, ['score', 'checkId', 'rationale'], `LS-09 criterion review scores.${id}`);
    if (score.checkId !== id || !Number.isInteger(score.score) || Number(score.score) < 3 || Number(score.score) > 4) {
      throw new Error(`LS-09 criterion ${id} is below ship-ready`);
    }
    if (requireNonEmptyString(score.rationale, `LS-09 criterion review scores.${id}.rationale`).length < 20) {
      throw new Error(`LS-09 criterion ${id} lacks a substantive rationale`);
    }
  }
  if (review.dependencyReady !== true) throw new Error('LS-09 criterion review is not dependency-ready');
  if (requireStringArray(review.blockers, 'LS-09 criterion review blockers').length !== 0) {
    throw new Error('LS-09 criterion review contains blockers');
  }
  if (requireStringArray(review.requiredQualityFindings, 'LS-09 criterion review requiredQualityFindings').length !== 0) {
    throw new Error('LS-09 criterion review contains required-quality findings');
  }
  if (requireStringArray(review.humanValidation, 'LS-09 criterion review humanValidation').length !== 0) {
    throw new Error('LS-09 criterion review must not claim human validation');
  }
  for (const [index, finding] of asArray(review.polish).entries()) {
    const record = requireRecord(finding, `LS-09 criterion review polish[${index}]`);
    requireExactKeys(record, ['id', 'summary', 'reopenTrigger'], `LS-09 criterion review polish[${index}]`);
    requireNonEmptyString(record.id, `LS-09 criterion review polish[${index}].id`);
    requireNonEmptyString(record.summary, `LS-09 criterion review polish[${index}].summary`);
    requireNonEmptyString(record.reopenTrigger, `LS-09 criterion review polish[${index}].reopenTrigger`);
  }
}

async function validateLS09CurrentSources(machineValue: unknown): Promise<void> {
  const machine = requireRecord(machineValue, 'LS-09 machine evidence');
  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-09 machine sourceRefs[${index}]`));
  await Promise.all(sourceRefs.map(async (source, index) => {
    const path = requireNonEmptyString(source.path, `LS-09 machine sourceRefs[${index}].path`);
    const expected = requireSha256(source.sha256, `LS-09 machine sourceRefs[${index}].sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
    } catch {
      throw new Error(`LS-09 implementation source is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-09 implementation source SHA-256 mismatch: ${path}`);
  }));
}

async function validateLS10CurrentSources(machineValue: unknown): Promise<void> {
  const machine = requireRecord(machineValue, 'LS-10 machine evidence');
  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-10 machine sourceRefs[${index}]`));
  await Promise.all(sourceRefs.map(async (source, index) => {
    const path = requireNonEmptyString(source.path, `LS-10 machine sourceRefs[${index}].path`);
    const expected = requireSha256(source.sha256, `LS-10 machine sourceRefs[${index}].sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
    } catch {
      throw new Error(`LS-10 implementation source is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-10 implementation source SHA-256 mismatch: ${path}`);
  }));
}

async function validateLS11CurrentSources(machineValue: unknown): Promise<void> {
  const machine = requireRecord(machineValue, 'LS-11 machine evidence');
  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-11 machine sourceRefs[${index}]`));
  await Promise.all(sourceRefs.map(async (source, index) => {
    const path = requireNonEmptyString(source.path, `LS-11 machine sourceRefs[${index}].path`);
    const expected = requireSha256(source.sha256, `LS-11 machine sourceRefs[${index}].sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
    } catch {
      throw new Error(`LS-11 implementation source is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-11 implementation source SHA-256 mismatch: ${path}`);
  }));
}

async function validateLS12CurrentSources(machineValue: unknown): Promise<void> {
  const machine = requireRecord(machineValue, 'LS-12 machine evidence');
  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-12 machine sourceRefs[${index}]`));
  await Promise.all(sourceRefs.map(async (source, index) => {
    const path = requireNonEmptyString(source.path, `LS-12 machine sourceRefs[${index}].path`);
    const expected = requireSha256(source.sha256, `LS-12 machine sourceRefs[${index}].sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
    } catch {
      throw new Error(`LS-12 implementation source is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-12 implementation source SHA-256 mismatch: ${path}`);
  }));
}

async function validateLS13CurrentSources(machineValue: unknown): Promise<void> {
  const machine = requireRecord(machineValue, 'LS-13 machine evidence');
  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-13 machine sourceRefs[${index}]`));
  await Promise.all(sourceRefs.map(async (source, index) => {
    const path = requireNonEmptyString(source.path, `LS-13 machine sourceRefs[${index}].path`);
    const expected = requireSha256(source.sha256, `LS-13 machine sourceRefs[${index}].sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
    } catch {
      throw new Error(`LS-13 implementation source is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-13 implementation source SHA-256 mismatch: ${path}`);
  }));
}

async function validateLS14CurrentSources(machineValue: unknown): Promise<void> {
  const machine = requireRecord(machineValue, 'LS-14 machine evidence');
  const refs = [...asArray(machine.sourceRefs), ...asArray(machine.visualRefs)].map((source, index) =>
    requireRecord(source, `LS-14 current source[${index}]`));
  await Promise.all(refs.map(async (source, index) => {
    const path = requireNonEmptyString(source.path, `LS-14 current source[${index}].path`);
    const expected = requireSha256(source.sha256, `LS-14 current source[${index}].sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
    } catch {
      throw new Error(`LS-14 source is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-14 source SHA-256 mismatch: ${path}`);
  }));
}

async function loadLS14RunArtifacts(machineValue: unknown): Promise<Record<string, unknown>> {
  const machine = requireRecord(machineValue, 'LS-14 machine evidence');
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-14 machine runs[${index}]`));
  const result: Record<string, unknown> = {};
  for (const [index, run] of runs.entries()) {
    const id = requireNonEmptyString(run.id, `LS-14 machine runs[${index}].id`);
    const artifact = requireRecord(run.artifact, `LS-14 machine runs[${index}].artifact`);
    const path = requireNonEmptyString(artifact.path, `LS-14 machine runs[${index}].artifact.path`);
    if (!isSafeRepositoryPath(path) || !path.startsWith('validation/evidence/runs/')) {
      throw new Error(`Unsafe LS-14 run artifact path: ${path}`);
    }
    const expected = requireSha256(artifact.sha256, `LS-14 machine runs[${index}].artifact.sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
      result[id] = await readJson(resolve(root, path));
    } catch {
      throw new Error(`LS-14 run artifact is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-14 run artifact SHA-256 mismatch: ${path}`);
  }
  return result;
}

async function loadLS13RunArtifacts(machineValue: unknown): Promise<Record<string, unknown>> {
  const machine = requireRecord(machineValue, 'LS-13 machine evidence');
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-13 machine runs[${index}]`));
  const result: Record<string, unknown> = {};
  for (const [index, run] of runs.entries()) {
    const id = requireNonEmptyString(run.id, `LS-13 machine runs[${index}].id`);
    const artifact = requireRecord(run.artifact, `LS-13 machine runs[${index}].artifact`);
    const path = requireNonEmptyString(artifact.path, `LS-13 machine runs[${index}].artifact.path`);
    if (!isSafeRepositoryPath(path) || !path.startsWith('validation/evidence/runs/')) {
      throw new Error(`Unsafe LS-13 run artifact path: ${path}`);
    }
    const expected = requireSha256(artifact.sha256, `LS-13 machine runs[${index}].artifact.sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
      result[id] = await readJson(resolve(root, path));
    } catch {
      throw new Error(`LS-13 run artifact is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-13 run artifact SHA-256 mismatch: ${path}`);
  }
  return result;
}

async function loadLS12RunArtifacts(machineValue: unknown): Promise<Record<string, unknown>> {
  const machine = requireRecord(machineValue, 'LS-12 machine evidence');
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-12 machine runs[${index}]`));
  const result: Record<string, unknown> = {};
  for (const [index, run] of runs.entries()) {
    const id = requireNonEmptyString(run.id, `LS-12 machine runs[${index}].id`);
    const artifact = requireRecord(run.artifact, `LS-12 machine runs[${index}].artifact`);
    const path = requireNonEmptyString(artifact.path, `LS-12 machine runs[${index}].artifact.path`);
    if (!isSafeRepositoryPath(path) || !path.startsWith('validation/evidence/runs/')) {
      throw new Error(`Unsafe LS-12 run artifact path: ${path}`);
    }
    const expected = requireSha256(artifact.sha256, `LS-12 machine runs[${index}].artifact.sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
      result[id] = await readJson(resolve(root, path));
    } catch {
      throw new Error(`LS-12 run artifact is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-12 run artifact SHA-256 mismatch: ${path}`);
  }
  return result;
}

async function loadLS11RunArtifacts(machineValue: unknown): Promise<Record<string, unknown>> {
  const machine = requireRecord(machineValue, 'LS-11 machine evidence');
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-11 machine runs[${index}]`));
  const result: Record<string, unknown> = {};
  for (const [index, run] of runs.entries()) {
    const id = requireNonEmptyString(run.id, `LS-11 machine runs[${index}].id`);
    const artifact = requireRecord(run.artifact, `LS-11 machine runs[${index}].artifact`);
    const path = requireNonEmptyString(artifact.path, `LS-11 machine runs[${index}].artifact.path`);
    if (!isSafeRepositoryPath(path) || !path.startsWith('validation/evidence/runs/')) {
      throw new Error(`Unsafe LS-11 run artifact path: ${path}`);
    }
    const expected = requireSha256(artifact.sha256, `LS-11 machine runs[${index}].artifact.sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
      result[id] = await readJson(resolve(root, path));
    } catch {
      throw new Error(`LS-11 run artifact is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-11 run artifact SHA-256 mismatch: ${path}`);
  }
  return result;
}

async function loadLS10RunArtifacts(machineValue: unknown): Promise<Record<string, unknown>> {
  const machine = requireRecord(machineValue, 'LS-10 machine evidence');
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-10 machine runs[${index}]`));
  const result: Record<string, unknown> = {};
  for (const [index, run] of runs.entries()) {
    const id = requireNonEmptyString(run.id, `LS-10 machine runs[${index}].id`);
    const artifact = requireRecord(run.artifact, `LS-10 machine runs[${index}].artifact`);
    const path = requireNonEmptyString(artifact.path, `LS-10 machine runs[${index}].artifact.path`);
    if (!isSafeRepositoryPath(path) || !path.startsWith('validation/evidence/runs/')) {
      throw new Error(`Unsafe LS-10 run artifact path: ${path}`);
    }
    const expected = requireSha256(artifact.sha256, `LS-10 machine runs[${index}].artifact.sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
      result[id] = await readJson(resolve(root, path));
    } catch {
      throw new Error(`LS-10 run artifact is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-10 run artifact SHA-256 mismatch: ${path}`);
  }
  return result;
}

async function loadLS09RunArtifacts(machineValue: unknown): Promise<Record<string, unknown>> {
  const machine = requireRecord(machineValue, 'LS-09 machine evidence');
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-09 machine runs[${index}]`));
  const result: Record<string, unknown> = {};
  for (const [index, run] of runs.entries()) {
    const id = requireNonEmptyString(run.id, `LS-09 machine runs[${index}].id`);
    const artifact = requireRecord(run.artifact, `LS-09 machine runs[${index}].artifact`);
    const path = requireNonEmptyString(artifact.path, `LS-09 machine runs[${index}].artifact.path`);
    if (!isSafeRepositoryPath(path) || !path.startsWith('validation/evidence/runs/')) {
      throw new Error(`Unsafe LS-09 run artifact path: ${path}`);
    }
    const expected = requireSha256(artifact.sha256, `LS-09 machine runs[${index}].artifact.sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
      result[id] = await readJson(resolve(root, path));
    } catch {
      throw new Error(`LS-09 run artifact is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-09 run artifact SHA-256 mismatch: ${path}`);
  }
  return result;
}

async function validateLS07CurrentSources(machineValue: unknown): Promise<void> {
  const machine = requireRecord(machineValue, 'LS-07 machine evidence');
  const sourceRefs = asArray(machine.sourceRefs).map((source, index) =>
    requireRecord(source, `LS-07 machine sourceRefs[${index}]`));
  await Promise.all(sourceRefs.map(async (source, index) => {
    const path = requireNonEmptyString(source.path, `LS-07 machine sourceRefs[${index}].path`);
    const expected = requireSha256(source.sha256, `LS-07 machine sourceRefs[${index}].sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
    } catch {
      throw new Error(`LS-07 implementation source is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-07 implementation source SHA-256 mismatch: ${path}`);
  }));
}

async function loadLS07RunArtifacts(machineValue: unknown): Promise<Record<string, unknown>> {
  const machine = requireRecord(machineValue, 'LS-07 machine evidence');
  const runs = asArray(machine.runs).map((run, index) => requireRecord(run, `LS-07 machine runs[${index}]`));
  const result: Record<string, unknown> = {};
  for (const [index, run] of runs.entries()) {
    const id = requireNonEmptyString(run.id, `LS-07 machine runs[${index}].id`);
    const artifact = requireRecord(run.artifact, `LS-07 machine runs[${index}].artifact`);
    const path = requireNonEmptyString(artifact.path, `LS-07 machine runs[${index}].artifact.path`);
    if (!isSafeRepositoryPath(path) || !path.startsWith('validation/evidence/runs/')) {
      throw new Error(`Unsafe LS-07 run artifact path: ${path}`);
    }
    const expected = requireSha256(artifact.sha256, `LS-07 machine runs[${index}].artifact.sha256`);
    let actual: string;
    try {
      actual = await sha256File(resolve(root, path));
      result[id] = await readJson(resolve(root, path));
    } catch {
      throw new Error(`LS-07 run artifact is absent or unbounded: ${path}`);
    }
    if (actual !== expected) throw new Error(`LS-07 run artifact SHA-256 mismatch: ${path}`);
  }
  return result;
}

async function sha256File(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_EVIDENCE_SOURCE_BYTES) {
    throw new Error('Evidence source is not a bounded file');
  }
  const cached = evidenceDigestCache.get(path);
  if (cached?.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.digest;
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  evidenceDigestCache.set(path, { size: info.size, mtimeMs: info.mtimeMs, digest });
  return digest;
}

function validateOrderedIds(items: Record<string, unknown>[], prefix: string, count: number, label: string) {
  if (items.length !== count) throw new Error(`Manifest must contain exactly ${count} ${label}`);
  const ids = items.map((item, index) => requireNonEmptyString(item.id, `${label}[${index}].id`));
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) throw new Error(`Duplicate ${label} ID: ${duplicate}`);
  ids.forEach((id, index) => {
    const expected = `${prefix}-${String(index + 1).padStart(2, '0')}`;
    if (id !== expected) throw new Error(`Invalid ${label} order: expected ${expected}, received ${id}`);
  });
}

export async function validateClaimEvidenceReceipt(
  itemValue: unknown,
  receiptValue: unknown,
): Promise<Record<string, unknown>> {
  const item = requireRecord(itemValue, 'claim');
  const claimId = requireNonEmptyString(item.id, 'claim.id');
  const acceptedState = requireNonEmptyString(item.state, `${claimId}.state`);
  const policy = evidencePolicy(claimId);
  if (policy === null) throw new Error(`${claimId} has no claim evidence policy`);
  if (acceptedState !== policy.acceptedState) {
    throw new Error(`${claimId} state does not match its evidence policy`);
  }
  const receipt = requireRecord(receiptValue, `${claimId} evidence receipt`);
  requireExactKeys(
    receipt,
    ['schema', 'version', 'claimId', 'acceptedState', 'issuedAt', 'sourceRefs', 'checks'],
    `${claimId} evidence receipt`,
  );
  if (receipt.schema !== 'rww.launch-scope-evidence') throw new Error(`${claimId} receipt has an invalid schema`);
  if (receipt.version !== 1) throw new Error(`${claimId} receipt has an invalid version`);
  if (receipt.claimId !== claimId) throw new Error(`${claimId} receipt claimId does not match the claim`);
  if (receipt.acceptedState !== acceptedState) {
    throw new Error(`${claimId} receipt acceptedState does not match ${acceptedState}`);
  }
  const issuedAt = requireNonEmptyString(receipt.issuedAt, `${claimId} receipt issuedAt`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(issuedAt)
    || Number.isNaN(Date.parse(issuedAt))
    || new Date(issuedAt).toISOString() !== issuedAt) {
    throw new Error(`${claimId} receipt has an invalid issuedAt`);
  }

  const sourceRefs = asArray(receipt.sourceRefs).map((source, index) =>
    requireRecord(source, `${claimId}.sourceRefs[${index}]`));
  if (sourceRefs.length === 0) throw new Error(`${claimId} receipt must contain sourceRefs`);
  const sourcePaths = sourceRefs.map((source, index) => {
    requireExactKeys(source, ['path', 'sha256'], `${claimId}.sourceRefs[${index}]`);
    return requireNonEmptyString(source.path, `${claimId}.sourceRefs[${index}].path`);
  });
  if (new Set(sourcePaths).size !== sourcePaths.length) throw new Error(`${claimId} receipt has duplicate sourceRefs`);
  if (JSON.stringify(sourcePaths) !== JSON.stringify(policy.sourcePaths)) {
    throw new Error(`${claimId} receipt source paths do not match its evidence policy`);
  }
  await Promise.all(sourceRefs.map(async (source, index) => {
    const sourcePath = sourcePaths[index]!;
    if (!isSafeRepositoryPath(sourcePath)) throw new Error(`Unsafe evidence source path: ${sourcePath}`);
    const digest = requireNonEmptyString(source.sha256, `${claimId}.sourceRefs[${index}].sha256`);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${claimId} has an invalid source SHA-256`);
    let actualDigest: string;
    try {
      actualDigest = await sha256File(resolve(root, sourcePath));
    } catch {
      throw new Error(`Evidence source is absent or unbounded: ${sourcePath}`);
    }
    if (actualDigest !== digest) throw new Error(`Evidence source SHA-256 mismatch: ${sourcePath}`);
  }));

  const checks = asArray(receipt.checks).map((check, index) =>
    requireRecord(check, `${claimId}.checks[${index}]`));
  if (checks.length === 0) throw new Error(`${claimId} receipt must contain at least one check`);
  const checkIds = checks.map((check, index) =>
    requireNonEmptyString(check.id, `${claimId}.checks[${index}].id`));
  if (new Set(checkIds).size !== checkIds.length) throw new Error(`${claimId} receipt has duplicate check IDs`);
  if (JSON.stringify(checkIds) !== JSON.stringify(policy.checkIds)) {
    throw new Error(`${claimId} receipt check IDs do not match its evidence policy`);
  }
  for (const [index, check] of checks.entries()) {
    requireExactKeys(check, ['id', 'result', 'summary'], `${claimId}.checks[${index}]`);
    requireNonEmptyString(check.summary, `${claimId}.checks[${index}].summary`);
    if (check.result !== 'passed') throw new Error(`${claimId}.checks[${index}] did not pass`);
  }
  if (claimId === 'LS-07') {
    const digestByPath = new Map(sourceRefs.map((source, index) => [
      sourcePaths[index]!,
      requireSha256(source.sha256, `${claimId}.sourceRefs[${index}].sha256`),
    ]));
    const machine = await readJson(resolve(root, policy.sourcePaths[0]));
    const review = await readJson(resolve(root, policy.sourcePaths[1]));
    const runArtifacts = await loadLS07RunArtifacts(machine);
    validateLS07EvidenceShape(machine, review, runArtifacts, {
      contractSha256: digestByPath.get('docs/launch-scope/ls-07-paired-spinal-nodes.md')!,
      policySha256: digestByPath.get('docs/launch-scope-execution-policy.md')!,
    });
    await validateLS07CurrentSources(machine);
  }
  if (claimId === 'LS-08') {
    const digestByPath = new Map(sourceRefs.map((source, index) => [
      sourcePaths[index]!,
      requireSha256(source.sha256, `${claimId}.sourceRefs[${index}].sha256`),
    ]));
    const review = await readJson(resolve(root, 'validation/evidence/reviews/ls-08-criterion-review-2026-08-09.json'));
    validateLS08CriterionReview(review, {
      contractSha256: digestByPath.get('docs/launch-scope/ls-08-directional-advantage.md')!,
      policySha256: digestByPath.get('docs/launch-scope-execution-policy.md')!,
    });
  }
  if (claimId === 'LS-09') {
    const digestByPath = new Map(sourceRefs.map((source, index) => [
      sourcePaths[index]!,
      requireSha256(source.sha256, `${claimId}.sourceRefs[${index}].sha256`),
    ]));
    const machine = await readJson(resolve(root, policy.sourcePaths[0]));
    const review = await readJson(resolve(root, policy.sourcePaths[1]));
    const runArtifacts = await loadLS09RunArtifacts(machine);
    validateLS09EvidenceShape(machine, review, runArtifacts, {
      contractSha256: digestByPath.get('docs/launch-scope/ls-09-shadow-timing-overhead-intelligence.md')!,
      policySha256: digestByPath.get('docs/launch-scope-execution-policy.md')!,
    });
    await validateLS09CurrentSources(machine);
  }
  if (claimId === 'LS-10') {
    const digestByPath = new Map(sourceRefs.map((source, index) => [
      sourcePaths[index]!,
      requireSha256(source.sha256, `${claimId}.sourceRefs[${index}].sha256`),
    ]));
    const machine = await readJson(resolve(root, policy.sourcePaths[0]));
    const review = await readJson(resolve(root, policy.sourcePaths[1]));
    const runArtifacts = await loadLS10RunArtifacts(machine);
    validateLS10EvidenceShape(machine, review, runArtifacts, {
      contractSha256: digestByPath.get('docs/launch-scope/ls-10-whole-ring-strategic-view.md')!,
      policySha256: digestByPath.get('docs/launch-scope-execution-policy.md')!,
    });
    await validateLS10CurrentSources(machine);
  }
  if (claimId === 'LS-11') {
    const digestByPath = new Map(sourceRefs.map((source, index) => [
      sourcePaths[index]!,
      requireSha256(source.sha256, `${claimId}.sourceRefs[${index}].sha256`),
    ]));
    const machine = await readJson(resolve(root, policy.sourcePaths[0]));
    const review = await readJson(resolve(root, policy.sourcePaths[1]));
    const runArtifacts = await loadLS11RunArtifacts(machine);
    validateLS11EvidenceShape(machine, review, runArtifacts, {
      contractSha256: digestByPath.get('docs/launch-scope/ls-11-gravity-range.md')!,
      policySha256: digestByPath.get('docs/launch-scope-execution-policy.md')!,
    });
    await validateLS11CurrentSources(machine);
  }
  if (claimId === 'LS-12') {
    const digestByPath = new Map(sourceRefs.map((source, index) => [
      sourcePaths[index]!,
      requireSha256(source.sha256, `${claimId}.sourceRefs[${index}].sha256`),
    ]));
    const machine = await readJson(resolve(root, policy.sourcePaths[0]));
    const review = await readJson(resolve(root, policy.sourcePaths[1]));
    const runArtifacts = await loadLS12RunArtifacts(machine);
    validateLS12EvidenceShape(machine, review, runArtifacts, {
      contractSha256: digestByPath.get('docs/launch-scope/ls-12-layered-district-scatter.md')!,
      policySha256: digestByPath.get('docs/launch-scope-execution-policy.md')!,
    });
    await validateLS12CurrentSources(machine);
  }
  if (claimId === 'LS-13') {
    const digestByPath = new Map(sourceRefs.map((source, index) => [
      sourcePaths[index]!,
      requireSha256(source.sha256, `${claimId}.sourceRefs[${index}].sha256`),
    ]));
    const machine = await readJson(resolve(root, policy.sourcePaths[0]));
    const review = await readJson(resolve(root, policy.sourcePaths[1]));
    const runArtifacts = await loadLS13RunArtifacts(machine);
    validateLS13EvidenceShape(machine, review, runArtifacts, {
      contractSha256: digestByPath.get('docs/launch-scope/ls-13-environmental-district-palettes.md')!,
      policySha256: digestByPath.get('docs/launch-scope-execution-policy.md')!,
    });
    await validateLS13CurrentSources(machine);
  }
  if (claimId === 'LS-14') {
    const digestByPath = new Map(sourceRefs.map((source, index) => [
      sourcePaths[index]!,
      requireSha256(source.sha256, `${claimId}.sourceRefs[${index}].sha256`),
    ]));
    const machine = await readJson(resolve(root, policy.sourcePaths[0]));
    const review = await readJson(resolve(root, policy.sourcePaths[1]));
    const runArtifacts = await loadLS14RunArtifacts(machine);
    validateLS14EvidenceShape(machine, review, runArtifacts, {
      contractSha256: digestByPath.get('docs/launch-scope/ls-14-inhabited-ring-life.md')!,
      policySha256: digestByPath.get('docs/launch-scope-execution-policy.md')!,
    });
    await validateLS14CurrentSources(machine);
  }
  if (claimId === 'G-05') {
    const machine = await readJson(resolve(root, policy.sourcePaths[0]));
    const review = await readJson(resolve(root, policy.sourcePaths[1]));
    const runArtifacts = await loadLS14RunArtifacts(machine);
    validateLS14EvidenceShape(machine, review, runArtifacts);
    await validateLS14CurrentSources(machine);
  }
  return receipt;
}

async function validateEvidenceRefs(item: Record<string, unknown>, required: boolean, label: string) {
  const value = item.evidenceRefs;
  if (value === undefined && !required) return;
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`${label} must contain exactly one claim evidence receipt in evidenceRefs`);
  }
  const reference = requireNonEmptyString(value[0], `${label}.evidenceRefs[0]`);
  if (!isSafeRepositoryPath(reference)) throw new Error(`Unsafe evidence reference: ${reference}`);
  const policy = evidencePolicy(label);
  if (policy === null) throw new Error(`${label} has no policy for an exact claim receipt`);
  if (String(item.state) !== policy.acceptedState) {
    throw new Error(`${label} state does not match its evidence policy`);
  }
  if (reference !== policy.receiptPath) {
    throw new Error(`${label} must reference its exact claim receipt: ${policy.receiptPath}`);
  }
  let receipt: Record<string, unknown>;
  try {
    receipt = await readJson(resolve(root, reference));
  } catch {
    throw new Error(`Claim evidence receipt is absent or invalid: ${reference}`);
  }
  await validateClaimEvidenceReceipt(item, receipt);
}

export async function validateLaunchProgressManifest(value: unknown): Promise<Record<string, unknown>> {
  const plan = requireRecord(value, 'manifest');
  requireExactKeys(
    plan,
    [
      'schema',
      'version',
      'statusDate',
      'activeSlice',
      'states',
      'qualifications',
      'dispositions',
      'reviewPolicy',
      'slices',
      'gates',
      'references',
    ],
    'manifest',
  );
  if (plan.schema !== 'rww.launch-scope-progress') throw new Error('Invalid manifest schema');
  if (plan.version !== 2) throw new Error('Invalid manifest version');
  const statusDate = requireNonEmptyString(plan.statusDate, 'statusDate');
  const parsedDate = new Date(`${statusDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statusDate)
    || Number.isNaN(parsedDate.valueOf())
    || parsedDate.toISOString().slice(0, 10) !== statusDate) {
    throw new Error('Invalid manifest statusDate');
  }
  if (JSON.stringify(plan.states) !== JSON.stringify([...SLICE_STATES])) {
    throw new Error('Manifest states must match the allowed slice states');
  }
  if (JSON.stringify(plan.qualifications) !== JSON.stringify([...SLICE_QUALIFICATIONS])) {
    throw new Error('Manifest qualification values must match the allowed values');
  }
  if (JSON.stringify(plan.dispositions) !== JSON.stringify([...SLICE_DISPOSITIONS])) {
    throw new Error('Manifest disposition values must match the allowed values');
  }
  const reviewPolicy = requireRecord(plan.reviewPolicy, 'reviewPolicy');
  requireExactKeys(
    reviewPolicy,
    ['maxRemediationRounds', 'maxVisualRemediationRounds'],
    'reviewPolicy',
  );
  if (reviewPolicy.maxRemediationRounds !== 2 || reviewPolicy.maxVisualRemediationRounds !== 1) {
    throw new Error('reviewPolicy must keep remediation rounds bounded at 2 total and 1 visual-only');
  }

  const gates = asArray(plan.gates).map((gate, index) => requireRecord(gate, `gates[${index}]`));
  validateOrderedIds(gates, 'G', 8, 'gates');
  const gateStateById = new Map(gates.map((gate) => [String(gate.id), String(gate.state)]));

  const slices = asArray(plan.slices).map((slice, index) => requireRecord(slice, `slices[${index}]`));
  validateOrderedIds(slices, 'LS', 37, 'slices');
  let previousMilestone = -1;
  for (const slice of slices) {
    const id = String(slice.id);
    requireExactKeys(
      slice,
      slice.evidenceRefs === undefined
        ? ['id', 'milestone', 'title', 'state', 'qualification', 'disposition', 'evidence']
        : ['id', 'milestone', 'title', 'state', 'qualification', 'disposition', 'evidence', 'evidenceRefs'],
      id,
    );
    requireNonEmptyString(slice.title, `${id}.title`);
    requireNonEmptyString(slice.evidence, `${id}.evidence`);
    const state = String(slice.state);
    const qualification = String(slice.qualification);
    const disposition = String(slice.disposition);
    if (!SLICE_STATES.has(state)) throw new Error(`${id} has an invalid state`);
    if (!SLICE_QUALIFICATIONS.has(qualification)) throw new Error(`${id} has an invalid qualification`);
    if (!SLICE_DISPOSITIONS.has(disposition)) throw new Error(`${id} has an invalid disposition`);
    if (state === 'complete' && qualification !== 'automation-passed') {
      throw new Error(`${id} qualification is invalid for complete state`);
    }
    if (state === 'complete' && !COMPLETE_DISPOSITIONS.has(disposition)) {
      throw new Error(`${id} disposition is invalid for complete state`);
    }
    if (id === 'LS-08' && state === 'complete' && gateStateById.get('G-01') !== 'passed') {
      throw new Error('LS-08 cannot complete until G-01 has passed');
    }
    if (state === 'active' && !['pending', 'automation-passed'].includes(qualification)) {
      throw new Error(`${id} qualification is invalid for active state`);
    }
    if (state === 'active' && disposition !== 'pending') {
      throw new Error(`${id} disposition is invalid for active state`);
    }
    if (state === 'queued' && qualification !== 'not-run') {
      throw new Error(`${id} qualification is invalid for queued state`);
    }
    if (state === 'queued' && disposition !== 'pending') {
      throw new Error(`${id} disposition is invalid for queued state`);
    }
    if (!Number.isInteger(slice.milestone)
      || Number(slice.milestone) < 0
      || Number(slice.milestone) < previousMilestone) {
      throw new Error(`${id} has an invalid or decreasing milestone`);
    }
    previousMilestone = Number(slice.milestone);
    await validateEvidenceRefs(slice, state === 'complete', id);
  }
  const activeSlices = slices.filter((slice) => slice.state === 'active');
  if (activeSlices.length !== 1) throw new Error('Manifest must contain exactly one active slice');
  const activeSlice = requireNonEmptyString(plan.activeSlice, 'activeSlice');
  if (activeSlices[0]?.id !== activeSlice) throw new Error('activeSlice must match the sole active slice');

  for (const gate of gates) {
    const id = String(gate.id);
    requireNonEmptyString(gate.title, `${id}.title`);
    requireNonEmptyString(gate.target, `${id}.target`);
    requireNonEmptyString(gate.evidence, `${id}.evidence`);
    if (!GATE_STATES.has(String(gate.state))) throw new Error(`${id} has an invalid state`);
    await validateEvidenceRefs(gate, gate.state === 'passed', id);
  }

  const references = asArray(plan.references).map((reference, index) =>
    requireRecord(reference, `references[${index}]`));
  if (references.length !== 3) throw new Error('Manifest must contain exactly 3 references');
  const referenceIds = references.map((reference, index) =>
    requireNonEmptyString(reference.id, `references[${index}].id`));
  if (new Set(referenceIds).size !== referenceIds.length) throw new Error('Reference IDs must be unique');
  for (const reference of references) {
    requireNonEmptyString(reference.label, `${reference.id}.label`);
    requireNonEmptyString(reference.use, `${reference.id}.use`);
    const urlText = requireNonEmptyString(reference.url, `${reference.id}.url`);
    try {
      const url = new URL(urlText);
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error('unsafe URL');
    } catch {
      throw new Error(`${reference.id} has an invalid reference URL`);
    }
  }
  return plan;
}

function allowlistedString(value: unknown, allowed: ReadonlySet<string>): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function isoDateString(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    ? value
    : null;
}

async function summarizeRoadmap(path: string) {
  const [content, info] = await Promise.all([readBoundedText(path, MAX_TEXT_BYTES), stat(path)]);
  const heading = content.match(/^#\s+(.+)$/m)?.[1] ?? basename(path);
  const status = content.match(/^\*\*Status(?: date)?[:*]*\*\*\s*:?\s*(.+)$/mi)?.[1] ?? null;
  return {
    path: `docs/${basename(path)}`,
    heading,
    status,
    sections: (content.match(/^##\s+/gm) ?? []).length,
    modifiedAt: info.mtime.toISOString(),
  };
}

async function summarizeGoals() {
  try {
    const state = await readJson(goalsFile);
    const goals = asArray(state.goals).map(asRecord);
    return {
      available: true,
      total: goals.length,
      active: goals.filter((goal) => ['active', 'running', 'in_progress'].includes(String(goal.status))).length,
      results: asArray(state.results).length,
      archives: asArray(state.archives).length,
    };
  } catch {
    return { available: false, total: 0, active: 0, results: 0, archives: 0 };
  }
}

async function summarizeLoops() {
  try {
    const names = (await readdir(loopsDirectory))
      .filter((name) => /^ses_[A-Za-z0-9]+\.json$/.test(name))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, LOOP_FILE_LIMIT);
    const files = await Promise.all(names.map(async (name) => {
      const state = await readJson(resolve(loopsDirectory, name));
      const jobs = asArray(state.jobs).map(asRecord);
      return {
        jobs: jobs.length,
        running: jobs.filter((job) => ['active', 'running', 'in_progress'].includes(String(job.status))).length,
      };
    }));
    return {
      available: true,
      sessions: files.length,
      jobs: files.reduce((sum, file) => sum + file.jobs, 0),
      running: files.reduce((sum, file) => sum + file.running, 0),
    };
  } catch {
    return { available: false, sessions: 0, jobs: 0, running: 0 };
  }
}

async function newestReceipts() {
  try {
    const runIds = (await readdir(runsDirectory))
      .filter((name) => /^\d{8}T\d{6}(?:\.\d+)?Z-[A-Za-z0-9._-]+$/.test(name))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, RECEIPT_LIMIT);
    const summaries = await Promise.all(runIds.map(async (runId) => {
      try {
        const receipt = await readJson(resolve(runsDirectory, runId, 'receipt.json'), MAX_RECEIPT_BYTES);
        const command = asRecord(receipt.command);
        const outcome = asRecord(receipt.outcome);
        const environmental = asRecord(receipt.environmental);
        return {
          runId,
          command: allowlistedString(command.name, RECEIPT_COMMANDS) ?? 'other',
          status: allowlistedString(outcome.status, RECEIPT_STATUSES) ?? 'unknown',
          startedAt: isoDateString(environmental.startedAt),
          durationMilliseconds: typeof environmental.durationMilliseconds === 'number'
            ? environmental.durationMilliseconds
            : null,
          path: `output/runs/${runId}/receipt.json`,
        };
      } catch {
        return null;
      }
    }));
    return summaries.filter((receipt) => receipt !== null);
  } catch {
    return [];
  }
}

async function buildProgressPayload() {
  const [[rawPlan, planInfo], roadmaps, goals, loops, receipts] = await Promise.all([
    Promise.all([readJson(progressFile), stat(progressFile)]),
    Promise.all(roadmapFiles.map(summarizeRoadmap)),
    summarizeGoals(),
    summarizeLoops(),
    newestReceipts(),
  ]);
  const plan = await validateLaunchProgressManifest(rawPlan);
  return {
    generatedAt: new Date().toISOString(),
    planModifiedAt: planInfo.mtime.toISOString(),
    plan,
    roadmaps,
    goals,
    loops,
    receipts,
  };
}

function progressEndpoint(): Plugin {
  return {
    name: 'rww-progress-endpoint',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (pathname !== '/__rww/progress') return next();
        response.setHeader('Cache-Control', 'no-store, max-age=0');
        response.setHeader('Pragma', 'no-cache');
        response.setHeader('Expires', '0');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET, HEAD');
          return response.end(JSON.stringify({ error: 'Method not allowed' }));
        }
        try {
          const body = JSON.stringify(await buildProgressPayload());
          response.statusCode = 200;
          return response.end(request.method === 'HEAD' ? undefined : body);
        } catch {
          response.statusCode = 500;
          return response.end(JSON.stringify({ error: 'Progress data unavailable' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [progressEndpoint()],
  resolve: { alias },
  server: { port: 5180, open: false },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
