import { describe, expect, it } from 'vitest';
import manifest from '../../docs/launch-scope-progress.json';
import g01Receipt from '../../validation/evidence/launch-scope/G-01.json';
import g07Receipt from '../../validation/evidence/launch-scope/G-07.json';
import ls01Receipt from '../../validation/evidence/launch-scope/LS-01.json';
import ls08Receipt from '../../validation/evidence/launch-scope/LS-08.json';
import ls08Review from '../../validation/evidence/reviews/ls-08-criterion-review-2026-08-09.json';
import ls09Receipt from '../../validation/evidence/launch-scope/LS-09.json';
import ls09Machine from '../../validation/evidence/ls-09-shadow-intelligence-2026-08-09.json';
import ls09Review from '../../validation/evidence/reviews/ls-09-criterion-review-2026-08-09.json';
import ls09FocusedUnit from '../../validation/evidence/runs/ls-09-focused-unit-2026-08-09.json';
import ls09FocusedBrowser from '../../validation/evidence/runs/ls-09-focused-browser-2026-08-09.json';
import ls09FullCheck from '../../validation/evidence/runs/ls-09-full-check-2026-08-09.json';
import ls09CoreMatch from '../../validation/evidence/runs/ls-09-core-match-2026-08-09.json';
import ls10Receipt from '../../validation/evidence/launch-scope/LS-10.json';
import ls10Machine from '../../validation/evidence/ls-10-whole-ring-strategic-view-2026-08-09.json';
import ls10Review from '../../validation/evidence/reviews/ls-10-criterion-review-2026-08-09.json';
import ls10FocusedUnit from '../../validation/evidence/runs/ls-10-focused-unit-2026-08-09.json';
import ls10FocusedBrowser from '../../validation/evidence/runs/ls-10-focused-browser-2026-08-09.json';
import ls10FullCheck from '../../validation/evidence/runs/ls-10-full-check-2026-08-09.json';
import ls10CoreMatch from '../../validation/evidence/runs/ls-10-core-match-2026-08-09.json';
import ls11Receipt from '../../validation/evidence/launch-scope/LS-11.json';
import ls11Machine from '../../validation/evidence/ls-11-gravity-range-2026-08-09.json';
import ls11Review from '../../validation/evidence/reviews/ls-11-criterion-review-2026-08-09.json';
import ls11FocusedUnit from '../../validation/evidence/runs/ls-11-focused-unit-2026-08-09.json';
import ls11FocusedBrowser from '../../validation/evidence/runs/ls-11-focused-browser-2026-08-09.json';
import ls11FullCheck from '../../validation/evidence/runs/ls-11-full-check-2026-08-09.json';
import ls11CoreMatch from '../../validation/evidence/runs/ls-11-core-match-2026-08-09.json';
import {
  CLAIM_EVIDENCE_POLICY,
  LS07_ACCEPTANCE_IDS,
  LS07_CHECK_POLICY,
  LS07_REQUIRED_SOURCE_PATHS,
  LS07_RUN_POLICY,
  LS07_RUN_TEST_IDS,
  LS09_ACCEPTANCE_IDS,
  LS09_REQUIRED_SOURCE_PATHS,
  LS09_RUN_POLICY,
  LS10_ACCEPTANCE_IDS,
  LS10_REQUIRED_SOURCE_PATHS,
  LS10_RUN_POLICY,
  LS11_ACCEPTANCE_IDS,
  LS11_CHECK_POLICY,
  LS11_REQUIRED_SOURCE_PATHS,
  LS11_RUN_POLICY,
  LS11_RUN_TEST_IDS,
  ls07SourceSnapshotSha256,
  ls11SourceSnapshotSha256,
  validateClaimEvidenceReceipt,
  validateLS08CriterionReview,
  validateLS07EvidenceShape,
  validateLS09EvidenceShape,
  validateLS10EvidenceShape,
  validateLS11EvidenceShape,
  validateLaunchProgressManifest,
} from '../../vite.config.ts';

function copyManifest(): Record<string, any> {
  return structuredClone(manifest);
}

describe('launch progress manifest integrity', () => {
  it('predeclares the exact LS-07 completion evidence policy before implementation', () => {
    expect(CLAIM_EVIDENCE_POLICY['LS-07']).toEqual({
      acceptedState: 'complete',
      receiptPath: 'validation/evidence/launch-scope/LS-07.json',
      sourcePaths: [
        'validation/evidence/ls-07-paired-nodes-2026-08-07.json',
        'validation/evidence/reviews/ls-07-criterion-review-2026-08-07.json',
        'docs/launch-scope/ls-07-paired-spinal-nodes.md',
        'docs/launch-scope-execution-policy.md',
      ],
      checkIds: ['paired-spinal-node-alignment'],
    });
  });

  it('binds LS-08 and G-01 completion to the developer-reviewed initial cohort', async () => {
    expect(CLAIM_EVIDENCE_POLICY['LS-08']).toEqual({
      acceptedState: 'complete',
      receiptPath: 'validation/evidence/launch-scope/LS-08.json',
      sourcePaths: [
        'docs/launch-scope/ls-08-directional-advantage.md',
        'docs/playtests/2026-08-09-directional-artillery-g01.md',
        'validation/evidence/directional-artillery-visual.json',
        'validation/evidence/reviews/ls-08-criterion-review-2026-08-09.json',
        'validation/evidence/launch-scope/G-01.json',
        'docs/launch-scope-execution-policy.md',
      ],
      checkIds: ['directional-advantage-onboarding'],
    });
    expect(CLAIM_EVIDENCE_POLICY['G-01']).toEqual({
      acceptedState: 'passed',
      receiptPath: 'validation/evidence/launch-scope/G-01.json',
      sourcePaths: [
        'docs/launch-scope/ls-08-directional-advantage.md',
        'docs/playtests/2026-08-09-directional-artillery-g01.md',
      ],
      checkIds: ['developer-reviewed-initial-cohort'],
    });
    await expect(validateClaimEvidenceReceipt(copyManifest().slices[7], ls08Receipt)).resolves.toBeDefined();
    await expect(validateClaimEvidenceReceipt(copyManifest().gates[0], g01Receipt)).resolves.toBeDefined();
  });

  it('rejects an LS-08 review below the ship-ready threshold', () => {
    const review = structuredClone(ls08Review) as Record<string, any>;
    review.scores.onboarding.score = 2;

    expect(() => validateLS08CriterionReview(review)).toThrow(/onboarding.*below ship-ready/i);
  });

  it('binds LS-09 completion to exact source-bound machine evidence and independent review', async () => {
    expect(CLAIM_EVIDENCE_POLICY['LS-09']).toEqual({
      acceptedState: 'complete',
      receiptPath: 'validation/evidence/launch-scope/LS-09.json',
      sourcePaths: [
        'validation/evidence/ls-09-shadow-intelligence-2026-08-09.json',
        'validation/evidence/reviews/ls-09-criterion-review-2026-08-09.json',
        'docs/launch-scope/ls-09-shadow-timing-overhead-intelligence.md',
        'docs/launch-scope-execution-policy.md',
      ],
      checkIds: ['shadow-timing-overhead-intelligence'],
    });
    expect(ls09Machine.sourceRefs.map((source) => source.path)).toEqual(LS09_REQUIRED_SOURCE_PATHS);
    expect(ls09Machine.checks.map((check) => check.id)).toEqual(LS09_ACCEPTANCE_IDS);
    expect(ls09Machine.runs.map((run) => run.id)).toEqual(Object.keys(LS09_RUN_POLICY));
    expect(() => validateLS09EvidenceShape(ls09Machine, ls09Review, {
      'focused-unit': ls09FocusedUnit,
      'focused-browser': ls09FocusedBrowser,
      'full-check': ls09FullCheck,
      'core-match': ls09CoreMatch,
    })).not.toThrow();
    await expect(validateClaimEvidenceReceipt(copyManifest().slices[8], ls09Receipt)).resolves.toBeDefined();
  });

  it('rejects weakened LS-09 review scores and stale source snapshots', () => {
    const lowScore = structuredClone(ls09Review) as Record<string, any>;
    lowScore.scores['launch-intelligence'].score = 2;
    expect(() => validateLS09EvidenceShape(ls09Machine, lowScore, {
      'focused-unit': ls09FocusedUnit,
      'focused-browser': ls09FocusedBrowser,
      'full-check': ls09FullCheck,
      'core-match': ls09CoreMatch,
    })).toThrow(/launch-intelligence.*below ship-ready/i);

    const staleRun = structuredClone(ls09FocusedUnit) as Record<string, any>;
    staleRun.sourceSnapshotSha256 = 'f'.repeat(64);
    expect(() => validateLS09EvidenceShape(ls09Machine, ls09Review, {
      'focused-unit': staleRun,
      'focused-browser': ls09FocusedBrowser,
      'full-check': ls09FullCheck,
      'core-match': ls09CoreMatch,
    })).toThrow(/implementation source snapshot/i);
  });

  it('binds LS-10 completion to the exact whole-ring sources, runs, and independent review', async () => {
    expect(CLAIM_EVIDENCE_POLICY['LS-10']).toEqual({
      acceptedState: 'complete',
      receiptPath: 'validation/evidence/launch-scope/LS-10.json',
      sourcePaths: [
        'validation/evidence/ls-10-whole-ring-strategic-view-2026-08-09.json',
        'validation/evidence/reviews/ls-10-criterion-review-2026-08-09.json',
        'docs/launch-scope/ls-10-whole-ring-strategic-view.md',
        'docs/launch-scope-execution-policy.md',
      ],
      checkIds: ['whole-ring-strategic-view'],
    });
    expect(ls10Machine.sourceRefs.map((source) => source.path)).toEqual(LS10_REQUIRED_SOURCE_PATHS);
    expect(ls10Machine.checks.map((check) => check.id)).toEqual(LS10_ACCEPTANCE_IDS);
    expect(ls10Machine.runs.map((run) => run.id)).toEqual(Object.keys(LS10_RUN_POLICY));
    expect(() => validateLS10EvidenceShape(ls10Machine, ls10Review, {
      'focused-unit': ls10FocusedUnit,
      'focused-browser': ls10FocusedBrowser,
      'full-check': ls10FullCheck,
      'core-match': ls10CoreMatch,
    })).not.toThrow();
    await expect(validateClaimEvidenceReceipt(copyManifest().slices[9], ls10Receipt)).resolves.toBeDefined();
  });

  it('enforces the complete LS-11 evidence matrix through the final permitted remediation round', () => {
    const machine = ls11MachineEvidence();
    const review = ls11CriterionReview();
    const runs = ls11RunArtifacts(machine);
    expect(() => validateLS11EvidenceShape(machine, review, runs)).not.toThrow();

    const lowScore = structuredClone(review);
    lowScore.scores['input-observation'].score = 2;
    expect(() => validateLS11EvidenceShape(machine, lowScore, runs)).toThrow(/input-observation.*below ship-ready/i);

    const blocked = structuredClone(review);
    blocked.blockers = ['Narrow layout obscures the observer.'];
    expect(() => validateLS11EvidenceShape(machine, blocked, runs)).toThrow(/not dependency-ready/i);

    const requiredFinding = structuredClone(review);
    requiredFinding.requiredQualityFindings = ['Live status floods assistive technology.'];
    expect(() => validateLS11EvidenceShape(machine, requiredFinding, runs)).toThrow(/not dependency-ready/i);

    const forgedMatrix = structuredClone(machine);
    forgedMatrix.checks[0].testIds.push('forged-test');
    expect(() => validateLS11EvidenceShape(forgedMatrix, review, runs)).toThrow(/exact run and test policy/i);

    const staleSnapshot = structuredClone(runs);
    staleSnapshot['focused-unit'].sourceSnapshotSha256 = 'f'.repeat(64);
    expect(() => validateLS11EvidenceShape(machine, review, staleSnapshot)).toThrow(/source snapshot/i);

    const missingRunTest = structuredClone(runs);
    missingRunTest['focused-browser'].passedTestIds.pop();
    expect(() => validateLS11EvidenceShape(machine, review, missingRunTest)).toThrow(/exact predeclared test IDs/i);

    const missingReviewIdentity = structuredClone(review);
    missingReviewIdentity.reviewId = '';
    expect(() => validateLS11EvidenceShape(machine, missingReviewIdentity, runs)).toThrow(/reviewId/i);
  });

  it('binds LS-11 completion to the exact Gravity Range sources, runs, review, and receipt', async () => {
    expect(CLAIM_EVIDENCE_POLICY['LS-11']).toEqual({
      acceptedState: 'complete',
      receiptPath: 'validation/evidence/launch-scope/LS-11.json',
      sourcePaths: [
        'validation/evidence/ls-11-gravity-range-2026-08-09.json',
        'validation/evidence/reviews/ls-11-criterion-review-2026-08-09.json',
        'docs/launch-scope/ls-11-gravity-range.md',
        'docs/launch-scope-execution-policy.md',
      ],
      checkIds: ['gravity-range-mode'],
    });
    expect(ls11Machine.sourceRefs.map((source) => source.path)).toEqual(LS11_REQUIRED_SOURCE_PATHS);
    expect(ls11Machine.checks.map((check) => check.id)).toEqual(LS11_ACCEPTANCE_IDS);
    expect(ls11Machine.runs.map((run) => run.id)).toEqual(Object.keys(LS11_RUN_POLICY));
    expect(() => validateLS11EvidenceShape(ls11Machine, ls11Review, {
      'focused-unit': ls11FocusedUnit,
      'focused-browser': ls11FocusedBrowser,
      'full-check': ls11FullCheck,
      'core-match': ls11CoreMatch,
    })).not.toThrow();
    await expect(validateClaimEvidenceReceipt(copyManifest().slices[10], ls11Receipt)).resolves.toBeDefined();
  });

  it('keeps the directional-overlay canvas restoration regression in LS-07 presentation evidence', () => {
    expect(LS07_CHECK_POLICY.presentation.testIds).toContain('directional-overlay-canvas-state');
    expect(LS07_RUN_TEST_IDS['focused-browser']).toContain('directional-overlay-canvas-state');
  });

  it('requires semantic LS-07 category coverage, ship-ready scores, and no blocking findings', () => {
    const machine = ls07MachineEvidence();
    const review = ls07CriterionReview();
    const runArtifacts = ls07RunArtifacts();
    expect(() => validateLS07EvidenceShape(machine, review, runArtifacts)).not.toThrow();

    const missingCategory = structuredClone(machine);
    missingCategory.checks.pop();
    expect(() => validateLS07EvidenceShape(missingCategory, review, runArtifacts)).toThrow(/exact acceptance matrix/i);

    const lowScore = structuredClone(review);
    lowScore.scores.ai.score = 2;
    expect(() => validateLS07EvidenceShape(machine, lowScore, runArtifacts)).toThrow(/ai.*below ship-ready/i);

    const blocked = structuredClone(review);
    blocked.blockers = ['AI denial is not implemented.'];
    expect(() => validateLS07EvidenceShape(machine, blocked, runArtifacts)).toThrow(/contains blockers/i);

    const requiredFinding = structuredClone(review);
    requiredFinding.requiredQualityFindings = ['Minimap pair state is absent.'];
    expect(() => validateLS07EvidenceShape(machine, requiredFinding, runArtifacts)).toThrow(/required-quality findings/i);

    const emptyProof = structuredClone(runArtifacts);
    emptyProof['focused-unit'].passedTestIds = [];
    expect(() => validateLS07EvidenceShape(machine, review, emptyProof)).toThrow(/exact predeclared test IDs/i);

    const emptyRationale = structuredClone(review);
    emptyRationale.scores.topology.rationale = 'x';
    expect(() => validateLS07EvidenceShape(machine, emptyRationale, runArtifacts)).toThrow(/substantive rationale/i);

    const forgedTest = structuredClone(runArtifacts);
    forgedTest['focused-unit'].passedTestIds.push('forged-extra-test');
    expect(() => validateLS07EvidenceShape(machine, review, forgedTest)).toThrow(/exact predeclared test IDs/i);

    const wrongSnapshot = structuredClone(runArtifacts);
    wrongSnapshot['focused-unit'].sourceSnapshotSha256 = 'f'.repeat(64);
    expect(() => validateLS07EvidenceShape(machine, review, wrongSnapshot)).toThrow(/source snapshot/i);

    const missingProvenance = structuredClone(review);
    missingProvenance.reviewer.taskId = 'anonymous';
    expect(() => validateLS07EvidenceShape(machine, missingProvenance, runArtifacts)).toThrow(/task provenance/i);
  });

  it('accepts the repository manifest with existing evidence artifacts', async () => {
    await expect(validateLaunchProgressManifest(copyManifest())).resolves.toMatchObject({
      schema: 'rww.launch-scope-progress',
      version: 2,
      activeSlice: 'LS-12',
      reviewPolicy: { maxRemediationRounds: 2, maxVisualRemediationRounds: 1 },
    });
  });

  it('rejects a false completion without evidence references', async () => {
    const candidate = copyManifest();
    delete candidate.slices[7].evidenceRefs;

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-08.*evidenceRefs/i);
  });

  it('rejects duplicate slice IDs', async () => {
    const candidate = copyManifest();
    candidate.slices[1].id = 'LS-01';

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/duplicate.*LS-01/i);
  });

  it('rejects a missing slice ID', async () => {
    const candidate = copyManifest();
    candidate.slices.splice(9, 1);

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/37 slices/i);
  });

  it('rejects out-of-order slice IDs', async () => {
    const candidate = copyManifest();
    [candidate.slices[8], candidate.slices[9]] = [candidate.slices[9], candidate.slices[8]];

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/expected LS-09/i);
  });

  it('rejects an activeSlice whose slice is not the sole active entry', async () => {
    const candidate = copyManifest();
    candidate.slices[11].state = 'queued';
    candidate.slices[11].qualification = 'not-run';

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/exactly one active slice/i);
  });

  it('rejects invalid schema, version, and date metadata', async () => {
    const invalidSchema = copyManifest();
    invalidSchema.schema = 'rww.untrusted-progress';
    await expect(validateLaunchProgressManifest(invalidSchema)).rejects.toThrow(/schema/i);

    const invalidVersion = copyManifest();
    invalidVersion.version = 1;
    await expect(validateLaunchProgressManifest(invalidVersion)).rejects.toThrow(/version/i);

    const invalidDate = copyManifest();
    invalidDate.statusDate = '2026-02-31';
    await expect(validateLaunchProgressManifest(invalidDate)).rejects.toThrow(/statusDate/i);
  });

  it('rejects out-of-order gate IDs', async () => {
    const candidate = copyManifest();
    [candidate.gates[2], candidate.gates[3]] = [candidate.gates[3], candidate.gates[2]];

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/expected G-03/i);
  });

  it('rejects invalid states and decreasing milestones', async () => {
    const invalidState = copyManifest();
    invalidState.slices[7].state = 'done';
    await expect(validateLaunchProgressManifest(invalidState)).rejects.toThrow(/LS-08.*invalid state/i);

    const decreasingMilestone = copyManifest();
    decreasingMilestone.slices[11].milestone = 1;
    await expect(validateLaunchProgressManifest(decreasingMilestone)).rejects.toThrow(/LS-12.*milestone/i);
  });

  it('enforces the exact state, qualification, and disposition matrix', async () => {
    const completePolish = copyManifest();
    completePolish.slices[0].disposition = 'polish-backlog';
    await expect(validateLaunchProgressManifest(completePolish)).resolves.toBeDefined();

    const activePending = copyManifest();
    activePending.slices[11].qualification = 'pending';
    await expect(validateLaunchProgressManifest(activePending)).resolves.toBeDefined();

    for (const qualification of ['not-run', 'pending']) {
      const candidate = copyManifest();
      candidate.slices[0].qualification = qualification;
      await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-01.*qualification.*complete/i);
    }

    const completePending = copyManifest();
    completePending.slices[0].disposition = 'pending';
    await expect(validateLaunchProgressManifest(completePending)).rejects.toThrow(/LS-01.*disposition.*complete/i);

    const activeNotRun = copyManifest();
    activeNotRun.slices[11].qualification = 'not-run';
    await expect(validateLaunchProgressManifest(activeNotRun)).rejects.toThrow(/LS-12.*qualification.*active/i);

    for (const disposition of ['clean', 'polish-backlog']) {
      const candidate = copyManifest();
      candidate.slices[11].disposition = disposition;
      await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-12.*disposition.*active/i);
    }

    for (const qualification of ['pending', 'automation-passed']) {
      const candidate = copyManifest();
      candidate.slices[12].qualification = qualification;
      await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-13.*qualification.*queued/i);
    }

    for (const disposition of ['clean', 'polish-backlog']) {
      const candidate = copyManifest();
      candidate.slices[12].disposition = disposition;
      await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-13.*disposition.*queued/i);
    }
  }, 15_000);

  it('rejects undeclared values and changes to the bounded review policy', async () => {
    const invalidQualifications = copyManifest();
    invalidQualifications.qualifications.push('manual-passed');
    await expect(validateLaunchProgressManifest(invalidQualifications)).rejects.toThrow(/qualification values/i);

    const invalidDispositions = copyManifest();
    invalidDispositions.dispositions = ['pending', 'clean'];
    await expect(validateLaunchProgressManifest(invalidDispositions)).rejects.toThrow(/disposition values/i);

    const unboundedReview = copyManifest();
    unboundedReview.reviewPolicy.maxRemediationRounds = 3;
    await expect(validateLaunchProgressManifest(unboundedReview)).rejects.toThrow(/reviewPolicy/i);

    const extraReviewRule = copyManifest();
    extraReviewRule.reviewPolicy.allowMoreRounds = true;
    await expect(validateLaunchProgressManifest(extraReviewRule)).rejects.toThrow(/reviewPolicy.*schema/i);
  });

  it('rejects a passed gate without evidence references', async () => {
    const candidate = copyManifest();
    candidate.gates[6].evidenceRefs = [];

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/G-07.*evidenceRefs/i);
  });

  it('rejects traversal in evidence references', async () => {
    const candidate = copyManifest();
    candidate.slices[0].evidenceRefs = ['docs/../package.json'];

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/unsafe evidence reference/i);
  });

  it('rejects LS-08 false promotion using LS-01 receipt or roadmap evidence', async () => {
    const reusedReceipt = copyManifest();
    reusedReceipt.slices[7].state = 'complete';
    reusedReceipt.slices[7].qualification = 'automation-passed';
    reusedReceipt.slices[7].disposition = 'clean';
    reusedReceipt.gates[0].state = 'passed';
    reusedReceipt.slices[7].evidenceRefs = ['validation/evidence/launch-scope/LS-01.json'];
    await expect(validateLaunchProgressManifest(reusedReceipt)).rejects.toThrow(/LS-08.*exact claim receipt/i);

    const directRoadmap = copyManifest();
    directRoadmap.slices[7].state = 'complete';
    directRoadmap.slices[7].qualification = 'automation-passed';
    directRoadmap.slices[7].disposition = 'clean';
    directRoadmap.gates[0].state = 'passed';
    directRoadmap.slices[7].evidenceRefs = ['docs/roadmap.md'];
    await expect(validateLaunchProgressManifest(directRoadmap)).rejects.toThrow(/LS-08.*exact claim receipt/i);
  });

  it('rejects LS-08 completion until the developer-reviewed comprehension gate has passed', async () => {
    const candidate = copyManifest();
    candidate.gates[0].state = 'in-progress';
    delete candidate.gates[0].evidenceRefs;

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-08.*G-01/i);
  });

  it('rejects G-01 false promotion using G-07 receipt or roadmap evidence', async () => {
    const reusedReceipt = copyManifest();
    reusedReceipt.gates[0].state = 'passed';
    reusedReceipt.gates[0].evidenceRefs = ['validation/evidence/launch-scope/G-07.json'];
    await expect(validateLaunchProgressManifest(reusedReceipt)).rejects.toThrow(/G-01.*exact claim receipt/i);

    const directRoadmap = copyManifest();
    directRoadmap.gates[0].state = 'passed';
    directRoadmap.gates[0].evidenceRefs = ['docs/roadmap.md'];
    await expect(validateLaunchProgressManifest(directRoadmap)).rejects.toThrow(/G-01.*exact claim receipt/i);
  });

  it('rejects a tampered source digest in an otherwise claim-matched receipt', async () => {
    const receipt = structuredClone(ls01Receipt) as Record<string, any>;
    receipt.sourceRefs[0].sha256 = '0'.repeat(64);

    await expect(validateClaimEvidenceReceipt(copyManifest().slices[0], receipt))
      .rejects.toThrow(/SHA-256 mismatch/i);
  });

  it('rejects G-07 evidence relabeled as LS-01 despite valid current sources and check content', async () => {
    const receipt = structuredClone(g07Receipt) as Record<string, any>;
    receipt.claimId = 'LS-01';
    receipt.acceptedState = 'complete';

    await expect(validateClaimEvidenceReceipt(copyManifest().slices[0], receipt))
      .rejects.toThrow(/LS-01.*source paths.*policy/i);
  });

  it('rejects additional source paths and check IDs', async () => {
    const extraSource = structuredClone(ls01Receipt) as Record<string, any>;
    extraSource.sourceRefs.push({
      path: 'docs/roadmap.md',
      sha256: 'aa193398433241ce7c5ab919cca56b49a260e3e52ec1cd1ab6360a001066462d',
    });
    await expect(validateClaimEvidenceReceipt(copyManifest().slices[0], extraSource))
      .rejects.toThrow(/source paths.*policy/i);

    const extraCheck = structuredClone(ls01Receipt) as Record<string, any>;
    extraCheck.checks.push({ id: 'unapproved-check', result: 'passed', summary: 'Not policy approved.' });
    await expect(validateClaimEvidenceReceipt(copyManifest().slices[0], extraCheck))
      .rejects.toThrow(/check IDs.*policy/i);
  });

  it('rejects duplicate source paths and check IDs', async () => {
    const duplicateSource = structuredClone(ls01Receipt) as Record<string, any>;
    duplicateSource.sourceRefs.push(structuredClone(duplicateSource.sourceRefs[0]));
    await expect(validateClaimEvidenceReceipt(copyManifest().slices[0], duplicateSource))
      .rejects.toThrow(/duplicate sourceRefs/i);

    const duplicateCheck = structuredClone(ls01Receipt) as Record<string, any>;
    duplicateCheck.checks.push(structuredClone(duplicateCheck.checks[0]));
    await expect(validateClaimEvidenceReceipt(copyManifest().slices[0], duplicateCheck))
      .rejects.toThrow(/duplicate check IDs/i);
  });

  it('rejects evidence outside the exact claim receipt path', async () => {
    const candidate = copyManifest();
    candidate.slices[0].evidenceRefs = ['docs/not-approved.md'];

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/exact claim receipt/i);
  });

  it('rejects unsafe reference URLs', async () => {
    const candidate = copyManifest();
    candidate.references[0].url = 'javascript:alert(1)';

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/invalid reference URL/i);
  });
});

function ls07MachineEvidence(): Record<string, any> {
  return {
    schema: 'rww.ls-07-verification',
    version: 1,
    sliceId: 'LS-07',
    contractSha256: 'a'.repeat(64),
    sourceRefs: LS07_REQUIRED_SOURCE_PATHS.map((path) => ({ path, sha256: 'b'.repeat(64) })),
    runs: Object.entries(LS07_RUN_POLICY).map(([id, policy]) => ({
      id,
      command: policy.command,
      result: 'passed',
      exitCode: 0,
      artifact: { path: policy.artifactPath, sha256: 'd'.repeat(64) },
    })),
    checks: LS07_ACCEPTANCE_IDS.map((id) => ({
      id,
      result: 'passed',
      runIds: [...LS07_CHECK_POLICY[id].runIds],
      testIds: [...LS07_CHECK_POLICY[id].testIds],
    })),
  };
}

function ls07RunArtifacts(): Record<string, any> {
  const sourceSnapshotSha256 = ls07SourceSnapshotSha256(
    LS07_REQUIRED_SOURCE_PATHS.map((path) => ({ path, sha256: 'b'.repeat(64) })),
  );
  return Object.fromEntries(Object.entries(LS07_RUN_POLICY).map(([id, policy]) => [id, {
    schema: 'rww.command-verification',
    version: 1,
    id,
    command: policy.command,
    result: 'passed',
    exitCode: 0,
    sourceSnapshotSha256,
    passedTestIds: [...LS07_RUN_TEST_IDS[id as keyof typeof LS07_RUN_TEST_IDS]],
    summary: `${id} completed successfully`,
  }]));
}

function ls07CriterionReview(): Record<string, any> {
  const sourceSnapshotSha256 = ls07SourceSnapshotSha256(
    LS07_REQUIRED_SOURCE_PATHS.map((path) => ({ path, sha256: 'b'.repeat(64) })),
  );
  return {
    schema: 'rww.criterion-review',
    version: 1,
    reviewId: 'ls-07-test-review',
    claimId: 'LS-07',
    contractSha256: 'a'.repeat(64),
    policySha256: 'c'.repeat(64),
    reviewRound: 1,
    reviewType: 'gameplay-system-acceptance',
    independentContext: true,
    reviewer: {
      role: 'independent-critic',
      taskId: 'ses_testreview',
      model: 'test-model',
      completedAt: '2026-08-07T00:00:00.000Z',
      sourceSnapshotSha256,
    },
    scores: Object.fromEntries(LS07_ACCEPTANCE_IDS.map((id) => [id, {
      score: 3,
      checkId: id,
      rationale: `${id} meets the bounded ship-ready contract.`,
    }])),
    dependencyReady: true,
    blockers: [],
    requiredQualityFindings: [],
    humanValidation: [],
    polish: [],
  };
}

function ls11MachineEvidence(): Record<string, any> {
  return {
    schema: 'rww.ls-11-verification',
    version: 1,
    sliceId: 'LS-11',
    contractSha256: 'a'.repeat(64),
    sourceRefs: LS11_REQUIRED_SOURCE_PATHS.map((path) => ({ path, sha256: 'b'.repeat(64) })),
    runs: Object.entries(LS11_RUN_POLICY).map(([id, policy]) => ({
      id,
      command: policy.command,
      result: 'passed',
      exitCode: 0,
      artifact: { path: policy.artifactPath, sha256: 'd'.repeat(64) },
    })),
    checks: LS11_ACCEPTANCE_IDS.map((id) => ({
      id,
      result: 'passed',
      runIds: [...LS11_CHECK_POLICY[id].runIds],
      testIds: [...LS11_CHECK_POLICY[id].testIds],
    })),
  };
}

function ls11RunArtifacts(machine: Record<string, any>): Record<string, any> {
  const sourceSnapshotSha256 = ls11SourceSnapshotSha256(machine.sourceRefs);
  return Object.fromEntries(Object.entries(LS11_RUN_POLICY).map(([id, policy]) => [id, {
    schema: 'rww.command-verification',
    version: 1,
    id,
    command: policy.command,
    result: 'passed',
    exitCode: 0,
    sourceSnapshotSha256,
    passedTestIds: [...LS11_RUN_TEST_IDS[id as keyof typeof LS11_RUN_TEST_IDS]],
    summary: `${id} proves the bounded LS-11 verification lane passed.`,
  }]));
}

function ls11CriterionReview(): Record<string, any> {
  const sourceSnapshotSha256 = ls11SourceSnapshotSha256(
    LS11_REQUIRED_SOURCE_PATHS.map((path) => ({ path, sha256: 'b'.repeat(64) })),
  );
  return {
    schema: 'rww.criterion-review',
    version: 1,
    reviewId: 'ls-11-test-review',
    claimId: 'LS-11',
    contractSha256: 'a'.repeat(64),
    policySha256: 'c'.repeat(64),
    reviewRound: 3,
    reviewType: 'gameplay-presentation-accessibility',
    independentContext: true,
    reviewer: {
      role: 'independent-critic',
      taskId: 'ses_ls11testreview',
      model: 'test-model',
      completedAt: '2026-08-09T00:00:00.000Z',
      sourceSnapshotSha256,
    },
    scores: Object.fromEntries(LS11_ACCEPTANCE_IDS.map((id) => [id, {
      score: 3,
      checkId: id,
      rationale: `${id} meets the bounded LS-11 ship-ready contract.`,
    }])),
    dependencyReady: true,
    blockers: [],
    requiredQualityFindings: [],
    humanValidation: ['G-01'],
    polish: [],
  };
}
