import { describe, expect, it } from 'vitest';
import manifest from '../../docs/launch-scope-progress.json';
import g07Receipt from '../../validation/evidence/launch-scope/G-07.json';
import ls01Receipt from '../../validation/evidence/launch-scope/LS-01.json';
import {
  CLAIM_EVIDENCE_POLICY,
  LS07_ACCEPTANCE_IDS,
  LS07_CHECK_POLICY,
  LS07_REQUIRED_SOURCE_PATHS,
  LS07_RUN_POLICY,
  ls07SourceSnapshotSha256,
  validateClaimEvidenceReceipt,
  validateLS07EvidenceShape,
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
      activeSlice: 'LS-07',
      reviewPolicy: { maxRemediationRounds: 2, maxVisualRemediationRounds: 1 },
    });
  });

  it('rejects a false completion without evidence references', async () => {
    const candidate = copyManifest();
    candidate.slices[6].state = 'complete';
    candidate.slices[6].qualification = 'automation-passed';
    candidate.slices[6].disposition = 'clean';

    await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-07.*evidenceRefs/i);
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
    candidate.slices[6].state = 'queued';
    candidate.slices[6].qualification = 'not-run';

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
    invalidState.slices[6].state = 'done';
    await expect(validateLaunchProgressManifest(invalidState)).rejects.toThrow(/LS-07.*invalid state/i);

    const decreasingMilestone = copyManifest();
    decreasingMilestone.slices[11].milestone = 1;
    await expect(validateLaunchProgressManifest(decreasingMilestone)).rejects.toThrow(/LS-12.*milestone/i);
  });

  it('enforces the exact state, qualification, and disposition matrix', async () => {
    const completePolish = copyManifest();
    completePolish.slices[0].disposition = 'polish-backlog';
    await expect(validateLaunchProgressManifest(completePolish)).resolves.toBeDefined();

    const activePending = copyManifest();
    activePending.slices[6].qualification = 'pending';
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
    activeNotRun.slices[6].qualification = 'not-run';
    await expect(validateLaunchProgressManifest(activeNotRun)).rejects.toThrow(/LS-07.*qualification.*active/i);

    for (const disposition of ['clean', 'polish-backlog']) {
      const candidate = copyManifest();
      candidate.slices[6].disposition = disposition;
      await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-07.*disposition.*active/i);
    }

    for (const qualification of ['pending', 'automation-passed']) {
      const candidate = copyManifest();
      candidate.slices[7].qualification = qualification;
      await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-08.*qualification.*queued/i);
    }

    for (const disposition of ['clean', 'polish-backlog']) {
      const candidate = copyManifest();
      candidate.slices[7].disposition = disposition;
      await expect(validateLaunchProgressManifest(candidate)).rejects.toThrow(/LS-08.*disposition.*queued/i);
    }
  });

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

  it('rejects LS-07 false promotion using LS-01 receipt or roadmap evidence', async () => {
    const reusedReceipt = copyManifest();
    reusedReceipt.slices[6].state = 'complete';
    reusedReceipt.slices[6].qualification = 'automation-passed';
    reusedReceipt.slices[6].disposition = 'clean';
    reusedReceipt.slices[6].evidenceRefs = ['validation/evidence/launch-scope/LS-01.json'];
    await expect(validateLaunchProgressManifest(reusedReceipt)).rejects.toThrow(/LS-07.*exact claim receipt/i);

    const directRoadmap = copyManifest();
    directRoadmap.slices[6].state = 'complete';
    directRoadmap.slices[6].qualification = 'automation-passed';
    directRoadmap.slices[6].disposition = 'clean';
    directRoadmap.slices[6].evidenceRefs = ['docs/roadmap.md'];
    await expect(validateLaunchProgressManifest(directRoadmap)).rejects.toThrow(/LS-07.*exact claim receipt/i);
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
      sha256: '07e1231f464b4b8e9fc046ea18030b9a32e8bb18e7f3a2b9d78f3637314ba6a0',
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
  const testIdsByRun = new Map<string, string[]>();
  for (const policy of Object.values(LS07_CHECK_POLICY)) {
    for (const runId of policy.runIds) {
      const ids = testIdsByRun.get(runId) ?? [];
      for (const testId of policy.testIds) if (!ids.includes(testId)) ids.push(testId);
      testIdsByRun.set(runId, ids);
    }
  }
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
    passedTestIds: testIdsByRun.get(id) ?? [],
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
