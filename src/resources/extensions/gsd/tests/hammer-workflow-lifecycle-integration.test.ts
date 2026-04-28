import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { ensureDbOpen } from '../bootstrap/dynamic-tools.ts';
import { closeDatabase, _getAdapter, getMilestone, getSlice, getTask, getVerificationEvidence, updateTaskStatus } from '../gsd-db.ts';
import { _clearGsdRootCache, gsdRoot } from '../paths.ts';
import { runWithTurnGeneration, bumpTurnGeneration, _resetTurnEpoch } from '../auto/turn-epoch.ts';
import { clearParseCache } from '../files.ts';
import { handlePlanMilestone } from '../tools/plan-milestone.ts';
import { handlePlanSlice } from '../tools/plan-slice.ts';
import { handleCompleteTask } from '../tools/complete-task.ts';
import { handleCompleteSlice } from '../tools/complete-slice.ts';
import { handleValidateMilestone } from '../tools/validate-milestone.ts';
import { handleCompleteMilestone } from '../tools/complete-milestone.ts';
import { emitUokAuditEvent, buildAuditEnvelope } from '../uok/audit.ts';

function tempHammerBase(label: string): string {
  const base = mkdtempSync(join(tmpdir(), `hammer-lifecycle-${label}-`));
  mkdirSync(join(base, '.hammer'), { recursive: true });
  return base;
}

function cleanup(base: string): void {
  try { closeDatabase(); } catch { /* ok */ }
  _clearGsdRootCache();
  clearParseCache();
  rmSync(base, { recursive: true, force: true });
}

function assertNoLegacyGsd(base: string): void {
  assert.equal(existsSync(join(base, '.gsd')), false, 'Hammer lifecycle must not create a legacy .gsd directory');
}

function assertUnderHammer(base: string, path: string, label: string): void {
  const rel = relative(base, path).replaceAll('\\', '/');
  assert.ok(rel.startsWith('.hammer/'), `${label} should be under .hammer, got ${rel}`);
  assert.equal(rel.startsWith('.gsd/'), false, `${label} must not be under .gsd`);
}

function read(base: string, rel: string): string {
  return readFileSync(join(base, rel), 'utf-8');
}

function listArtifactPaths(base: string): string[] {
  const root = join(base, '.hammer');
  const found: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(abs);
      } else {
        found.push(relative(base, abs).replaceAll('\\', '/'));
      }
    }
  }
  walk(root);
  return found.sort();
}

test('hammer workflow lifecycle: DB-backed handlers render every artifact under .hammer only', async () => {
  const base = tempHammerBase('happy');
  try {
    assert.equal(await ensureDbOpen(base), true, 'ensureDbOpen should create/open .hammer/gsd.db');
    assert.equal(gsdRoot(base), join(base, '.hammer'));
    assert.ok(existsSync(join(base, '.hammer', 'gsd.db')), 'DB should exist in .hammer');

    const milestonePlan = await handlePlanMilestone({
      milestoneId: 'M900',
      title: 'Hammer Lifecycle Proof',
      vision: 'Prove DB-backed planning, execution, validation, and completion stay inside the Hammer state root.',
      successCriteria: [
        'All lifecycle handlers return .hammer artifact paths.',
        'Generated artifacts preserve Hammer/IAM continuity language and visible mixed evidence.',
      ],
      keyRisks: [
        { risk: 'Fallback path regression', whyItMatters: 'A handler could recreate .gsd during Hammer execution.' },
      ],
      proofStrategy: [
        { riskOrUnknown: 'State-root continuity', retireIn: 'S01', whatWillBeProven: 'A full lifecycle leaves no .gsd side effects.' },
      ],
      verificationContract: 'Inspect returned paths, generated files, DB rows, state projections, event log, manifest, and audit payloads.',
      verificationIntegration: 'Exercise existing handlers rather than writing artifacts directly.',
      verificationOperational: 'Missing evidence remains visible as mixed/unproven diagnostics.',
      verificationUat: 'Read generated Hammer artifacts and verify awareness continuity sections.',
      definitionOfDone: ['No .gsd directory exists', 'Completion summary renders Hammer/IAM handoff language'],
      requirementCoverage: 'R020 — Hammer lifecycle substrate stays state-root aware.',
      boundaryMapMarkdown: '| From | To | Produces | Consumes |\n|------|----|----------|----------|\n| handlers | .hammer | lifecycle artifacts | SQLite state |',
      slices: [
        {
          sliceId: 'S01',
          title: 'Lifecycle inside Hammer',
          risk: 'medium',
          depends: [],
          demo: 'The lifecycle completes without creating .gsd.',
          goal: 'Plan and complete one DB-backed Hammer slice.',
          successCriteria: 'Task, slice, validation, milestone, projections, manifest, event log, and audit artifacts stay under .hammer.',
          proofLevel: 'integration',
          integrationClosure: 'Existing handler APIs drive every state transition.',
          observabilityImpact: 'Inspect .hammer/STATE.md, .hammer/state-manifest.json, .hammer/event-log.jsonl, .hammer/audit/events.jsonl, and SQLite diagnostics.',
        },
      ],
    }, base);
    assert.ok(!('error' in milestonePlan), `plan milestone failed: ${'error' in milestonePlan ? milestonePlan.error : ''}`);
    assertUnderHammer(base, milestonePlan.roadmapPath, 'roadmapPath');

    const slicePlan = await handlePlanSlice({
      milestoneId: 'M900',
      sliceId: 'S01',
      goal: 'Complete the Hammer lifecycle through DB-backed handlers.',
      successCriteria: '- Existing handlers perform all lifecycle writes\n- Missing verification evidence remains visible as mixed diagnostics\n- No legacy .gsd directory appears',
      proofLevel: 'integration',
      integrationClosure: 'Slice completion consumes task completion and milestone completion consumes slice validation.',
      observabilityImpact: '- Lifecycle artifacts are rendered into .hammer\n- Event log, state manifest, and STATE.md are inspectable under .hammer',
      tasks: [
        {
          taskId: 'T01',
          title: 'Complete lifecycle task',
          description: 'Use the real completion handler so SUMMARY.md and projection hooks are exercised.',
          estimate: '10m',
          files: ['src/resources/extensions/gsd/tools/complete-task.ts'],
          verify: 'assert .hammer-only lifecycle artifacts',
          inputs: ['src/resources/extensions/gsd/tools/complete-task.ts'],
          expectedOutput: ['.hammer/milestones/M900/slices/S01/tasks/T01-SUMMARY.md'],
          observabilityImpact: 'SUMMARY.md must retain Hammer/IAM diagnostics for absent evidence.',
        },
      ],
    }, base);
    assert.ok(!('error' in slicePlan), `plan slice failed: ${'error' in slicePlan ? slicePlan.error : ''}`);
    assertUnderHammer(base, slicePlan.planPath, 'planPath');
    for (const taskPlanPath of slicePlan.taskPlanPaths) assertUnderHammer(base, taskPlanPath, 'taskPlanPath');

    const taskResult = await handleCompleteTask({
      milestoneId: 'M900',
      sliceId: 'S01',
      taskId: 'T01',
      oneLiner: 'Completed a Hammer lifecycle task through the DB-backed handler.',
      narrative: 'Used handleCompleteTask in a .hammer-only fixture so task DB rows, SUMMARY rendering, plan checkbox updates, projections, manifest writes, and event logging all run through the existing lifecycle code.',
      verification: 'Intentionally no verificationEvidence rows were supplied for this task-level completion so the generated Hammer summary must expose the boundary as unproven/mixed instead of silently passing.',
      deviations: 'None.',
      knownIssues: 'The task intentionally omits verificationEvidence to prove the diagnostic section remains visible.',
      keyFiles: ['src/resources/extensions/gsd/tools/complete-task.ts'],
      keyDecisions: [],
      blockerDiscovered: false,
      verificationEvidence: [],
    }, base);
    assert.ok(!('error' in taskResult), `complete task failed: ${'error' in taskResult ? taskResult.error : ''}`);
    assertUnderHammer(base, taskResult.summaryPath, 'summaryPath');

    const sliceResult = await handleCompleteSlice({
      milestoneId: 'M900',
      sliceId: 'S01',
      sliceTitle: 'Lifecycle inside Hammer',
      oneLiner: 'Completed the Hammer lifecycle slice through DB-backed handlers.',
      narrative: 'The slice completion consumed the completed task row and wrote SUMMARY/UAT artifacts from the real handler while preserving Hammer/IAM continuity sections.',
      verification: 'Generated artifacts, event log, state manifest, STATE.md, and DB rows were inspected in the lifecycle test.',
      uatContent: '1. Open .hammer/milestones/M900.\n2. Confirm ROADMAP, PLAN, SUMMARY, UAT, VALIDATION, and milestone SUMMARY exist.\n3. Confirm .gsd never appears.',
      deviations: 'None.',
      knownLimitations: 'None.',
      followUps: 'None.',
      keyFiles: ['src/resources/extensions/gsd/tools/complete-slice.ts'],
      keyDecisions: [],
      patternsEstablished: ['Use gsdRoot(basePath) for handler-created fallback paths.'],
      observabilitySurfaces: ['.hammer/event-log.jsonl', '.hammer/state-manifest.json', '.hammer/STATE.md'],
      provides: ['A .hammer-only completed lifecycle slice'],
      requirementsSurfaced: [],
      drillDownPaths: ['.hammer/milestones/M900/slices/S01/tasks/T01-SUMMARY.md'],
      affects: [],
      requirementsAdvanced: [{ id: 'R020', how: 'Lifecycle handlers used the Hammer state root.' }],
      requirementsValidated: [{ id: 'R020', proof: 'No .gsd side effects and all handler paths returned under .hammer.' }],
      requirementsInvalidated: [],
      filesModified: [
        { path: 'src/resources/extensions/gsd/tools/complete-slice.ts', description: 'Fallback path remains state-root aware.' },
      ],
      requires: [],
      operationalReadiness: 'Audit and projection artifacts are present under .hammer for future agents.',
    }, base);
    assert.ok(!('error' in sliceResult), `complete slice failed: ${'error' in sliceResult ? sliceResult.error : ''}`);
    assertUnderHammer(base, sliceResult.summaryPath, 'slice summaryPath');
    assertUnderHammer(base, sliceResult.uatPath, 'slice uatPath');

    const validationResult = await handleValidateMilestone({
      milestoneId: 'M900',
      verdict: 'pass',
      remediationRound: 0,
      successCriteriaChecklist: '- [x] Lifecycle artifacts returned under .hammer\n- [x] Missing task verification evidence remained visible as mixed diagnostics',
      sliceDeliveryAudit: '| Slice | Claimed | Delivered |\n|-------|---------|-----------|\n| S01 | .hammer-only lifecycle | .hammer-only lifecycle |',
      crossSliceIntegration: 'Single-slice lifecycle proof; no cross-slice mismatch.',
      requirementCoverage: 'R020 validated by .hammer-only handler execution.',
      verificationClasses: 'Contract/integration/operational checks all inspect Hammer artifacts and DB rows.',
      verdictRationale: 'The lifecycle used existing handlers, produced .hammer artifacts, and left missing verification evidence visible.',
    }, base, { uokGatesEnabled: true, traceId: 'hammer-lifecycle-trace', turnId: 'M900:validate' });
    assert.ok(!('error' in validationResult), `validate milestone failed: ${'error' in validationResult ? validationResult.error : ''}`);
    assertUnderHammer(base, validationResult.validationPath, 'validationPath');

    emitUokAuditEvent(base, buildAuditEnvelope({
      traceId: 'hammer-lifecycle-trace',
      turnId: 'M900:complete',
      category: 'verification',
      type: 'hammer-lifecycle-artifact-check',
      payload: {
        phaseId: 'completion',
        unitId: 'M900/S01/T01',
        artifactPaths: [taskResult.summaryPath, sliceResult.summaryPath, validationResult.validationPath],
        iamErrorKind: 'none',
        remediation: 'none',
        promptSummary: '[redacted] Hammer lifecycle fixture',
        auditSummary: '[redacted] paths remain under .hammer',
      },
    }));

    const milestoneResult = await handleCompleteMilestone({
      milestoneId: 'M900',
      title: 'Hammer Lifecycle Proof',
      oneLiner: 'Completed the Hammer lifecycle milestone through .hammer-only DB-backed handlers.',
      narrative: 'Plan, task completion, slice completion, milestone validation, audit emission, and milestone completion all ran through the existing DB-backed handlers in a .hammer-only fixture.',
      verificationPassed: true,
      successCriteriaResults: '- All returned handler paths were under .hammer.\n- No .gsd directory exists.\n- Generated artifacts contain Hammer/IAM continuity language.',
      definitionOfDoneResults: '- DB rows reached complete status.\n- State projections and manifest were rendered under .hammer.',
      requirementOutcomes: 'R020 validated — the workflow substrate remained Hammer-aware and state-root scoped.',
      keyDecisions: ['Handler fallback paths use gsdRoot(basePath) rather than basePath/.gsd.'],
      keyFiles: ['src/resources/extensions/gsd/tests/hammer-workflow-lifecycle-integration.test.ts'],
      lessonsLearned: ['Missing verification evidence must remain visible as unproven or mixed diagnostics.'],
      followUps: 'None.',
      deviations: 'None.',
    }, base);
    assert.ok(!('error' in milestoneResult), `complete milestone failed: ${'error' in milestoneResult ? milestoneResult.error : ''}`);
    assertUnderHammer(base, milestoneResult.summaryPath, 'milestone summaryPath');

    const expectedFiles = [
      '.hammer/gsd.db',
      '.hammer/milestones/M900/M900-ROADMAP.md',
      '.hammer/milestones/M900/M900-VALIDATION.md',
      '.hammer/milestones/M900/M900-SUMMARY.md',
      '.hammer/milestones/M900/slices/S01/S01-PLAN.md',
      '.hammer/milestones/M900/slices/S01/S01-SUMMARY.md',
      '.hammer/milestones/M900/slices/S01/S01-UAT.md',
      '.hammer/milestones/M900/slices/S01/tasks/T01-PLAN.md',
      '.hammer/milestones/M900/slices/S01/tasks/T01-SUMMARY.md',
      '.hammer/STATE.md',
      '.hammer/state-manifest.json',
      '.hammer/event-log.jsonl',
      '.hammer/audit/events.jsonl',
    ];
    for (const rel of expectedFiles) assert.ok(existsSync(join(base, rel)), `${rel} should exist`);

    assertNoLegacyGsd(base);

    const taskSummary = read(base, '.hammer/milestones/M900/slices/S01/tasks/T01-SUMMARY.md');
    assert.match(taskSummary, /^## Hammer Awareness Handoff/m);
    assert.match(taskSummary, /^## Diagnostics/m);
    assert.match(taskSummary, /No verification evidence rows were recorded; treat this as an unproven no-degradation boundary until verified\./);
    assert.match(taskSummary, /verification_result: (untested|mixed)/);
    assert.match(taskSummary, /No verification commands discovered/);

    const sliceSummary = read(base, '.hammer/milestones/M900/slices/S01/S01-SUMMARY.md');
    assert.match(sliceSummary, /^## Hammer Awareness Handoff/m);
    assert.match(sliceSummary, /^## Forward Intelligence/m);
    assert.match(sliceSummary, /Hammer\/IAM provenance/);

    const uat = read(base, '.hammer/milestones/M900/slices/S01/S01-UAT.md');
    assert.match(uat, /^## Hammer Awareness Contract/m);
    assert.match(uat, /^## Awareness \/ Provenance Evidence/m);

    const validation = read(base, '.hammer/milestones/M900/M900-VALIDATION.md');
    assert.match(validation, /^## Verification Class Compliance/m);
    assert.match(validation, /missing task verification evidence remained visible/i);

    const milestoneSummary = read(base, '.hammer/milestones/M900/M900-SUMMARY.md');
    assert.match(milestoneSummary, /^## Hammer Awareness Handoff/m);
    assert.match(milestoneSummary, /^## Cross-Slice Verification/m);
    assert.match(milestoneSummary, /^## Decision Re-evaluation/m);
    assert.match(milestoneSummary, /Hammer\/IAM generated-artifact language/);

    const state = read(base, '.hammer/STATE.md');
    assert.match(state, /^# Hammer State/m);
    assert.match(state, /Last Completed Milestone|Active Milestone/);

    const manifest = JSON.parse(read(base, '.hammer/state-manifest.json')) as {
      milestones: Array<{ id: string; status: string }>;
      slices: Array<{ id: string; status: string }>;
      tasks: Array<{ id: string; status: string }>;
      verification_evidence: unknown[];
    };
    assert.equal(manifest.milestones.find(m => m.id === 'M900')?.status, 'complete');
    assert.equal(manifest.slices.find(s => s.id === 'S01')?.status, 'complete');
    assert.equal(manifest.tasks.find(t => t.id === 'T01')?.status, 'complete');
    assert.deepEqual(manifest.verification_evidence, [], 'missing verification evidence should remain absent in the manifest, not synthesized as pass');

    const eventLog = read(base, '.hammer/event-log.jsonl').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.deepEqual(
      eventLog.map(event => event.cmd),
      ['plan-milestone', 'plan-slice', 'complete-task', 'complete-slice', 'complete-milestone'],
    );
    for (const event of eventLog) {
      assert.equal(typeof event.ts, 'string');
      assert.equal(typeof event.hash, 'string');
      assert.equal(typeof event.session_id, 'string');
    }

    const auditEvents = read(base, '.hammer/audit/events.jsonl').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.ok(auditEvents.length >= 2, 'validation gate and explicit audit events should be written');
    const lifecycleAudit = auditEvents.find(event => event.type === 'hammer-lifecycle-artifact-check');
    assert.ok(lifecycleAudit, 'explicit lifecycle audit event should exist');
    assert.equal(lifecycleAudit.category, 'verification');
    assert.equal(lifecycleAudit.traceId, 'hammer-lifecycle-trace');
    assert.equal(typeof lifecycleAudit.ts, 'string');
    assert.deepEqual(lifecycleAudit.payload.iamErrorKind, 'none');
    assert.equal(lifecycleAudit.payload.phaseId, 'completion');
    assert.equal(lifecycleAudit.payload.unitId, 'M900/S01/T01');
    assert.equal(lifecycleAudit.payload.remediation, 'none');
    assert.match(lifecycleAudit.payload.promptSummary, /^\[redacted\]/);
    assert.match(lifecycleAudit.payload.auditSummary, /^\[redacted\]/);
    for (const artifactPath of lifecycleAudit.payload.artifactPaths) assertUnderHammer(base, artifactPath, 'audit artifact path');

    const adapter = _getAdapter();
    assert.ok(adapter, 'database adapter should remain open for DB diagnostics');
    const artifactRows = adapter.prepare('SELECT path FROM artifacts ORDER BY path').all() as Array<{ path: string }>;
    assert.ok(artifactRows.some(row => row.path === 'milestones/M900/M900-ROADMAP.md'), 'ROADMAP artifact row should be state-root relative');
    assert.ok(artifactRows.some(row => row.path === 'milestones/M900/slices/S01/S01-PLAN.md'), 'PLAN artifact row should be state-root relative');
    assert.ok(artifactRows.every(row => !row.path.startsWith('.gsd/') && !row.path.startsWith('/')), 'artifact DB paths should be state-root relative');

    const dbAuditRows = adapter.prepare('SELECT type, payload_json FROM audit_events ORDER BY ts, event_id').all() as Array<{ type: string; payload_json: string }>;
    assert.ok(dbAuditRows.some(row => row.type === 'hammer-lifecycle-artifact-check'), 'audit_events table should contain lifecycle audit');

    const omegaRunCount = (adapter.prepare('SELECT COUNT(*) AS count FROM omega_runs').get() as { count: number }).count;
    const omegaArtifactCount = (adapter.prepare('SELECT COUNT(*) AS count FROM omega_phase_artifacts').get() as { count: number }).count;
    const volvoxEpochCount = (adapter.prepare('SELECT COUNT(*) AS count FROM volvox_epochs').get() as { count: number }).count;
    assert.equal(omegaRunCount, 0, 'this lifecycle proof does not synthesize Omega rows');
    assert.equal(omegaArtifactCount, 0, 'this lifecycle proof does not synthesize Omega phase artifact rows');
    assert.equal(volvoxEpochCount, 0, 'this lifecycle proof does not synthesize VOLVOX epochs');

    assert.equal(getMilestone('M900')?.status, 'complete');
    assert.equal(getSlice('M900', 'S01')?.status, 'complete');
    assert.equal(getTask('M900', 'S01', 'T01')?.status, 'complete');
    assert.deepEqual(getVerificationEvidence('M900', 'S01', 'T01'), []);

    const allArtifacts = listArtifactPaths(base);
    assert.ok(allArtifacts.every(path => path.startsWith('.hammer/')), 'every lifecycle artifact should be under .hammer');
    assert.ok(allArtifacts.some(path => path.endsWith('M900-SUMMARY.md')), 'milestone summary should be present in artifact inventory');
  } finally {
    cleanup(base);
  }
});

test('hammer workflow lifecycle: stale duplicate fallback paths use .hammer when resolved dirs are absent', async () => {
  const base = tempHammerBase('stale');
  try {
    assert.equal(await ensureDbOpen(base), true);

    const firstPlan = await handlePlanMilestone({
      milestoneId: 'M901',
      title: 'Stale fallback proof',
      vision: 'Prove stale duplicate fallback paths are Hammer-scoped.',
      slices: [{
        sliceId: 'S01',
        title: 'Fallback slice',
        risk: 'low',
        depends: [],
        demo: 'Duplicate completion returns .hammer paths.',
        goal: 'Exercise stale duplicate path synthesis.',
        successCriteria: 'The synthesized stale paths use the selected state root.',
        proofLevel: 'unit/integration',
        integrationClosure: 'No .gsd fallback is returned.',
        observabilityImpact: 'Returned paths are direct diagnostics.',
      }],
    }, base);
    assert.ok(!('error' in firstPlan));

    const secondPlan = await handlePlanSlice({
      milestoneId: 'M901',
      sliceId: 'S01',
      goal: 'Exercise stale duplicate path synthesis.',
      tasks: [{
        taskId: 'T01',
        title: 'Fallback task',
        description: 'Complete once, remove disk dirs, then simulate stale duplicate completion.',
        estimate: '5m',
        files: ['src/resources/extensions/gsd/tools/complete-task.ts'],
        verify: 'assert returned duplicate paths',
        inputs: ['src/resources/extensions/gsd/tools/complete-task.ts'],
        expectedOutput: ['.hammer path diagnostics'],
      }],
    }, base);
    assert.ok(!('error' in secondPlan));

    const completeTask = await handleCompleteTask({
      milestoneId: 'M901',
      sliceId: 'S01',
      taskId: 'T01',
      oneLiner: 'Completed once.',
      narrative: 'Initial completion.',
      verification: 'Verified once.',
      verificationEvidence: [{ command: 'true', exitCode: 0, verdict: '✅ pass', durationMs: 1 }],
    }, base);
    assert.ok(!('error' in completeTask));

    rmSync(join(base, '.hammer', 'milestones', 'M901'), { recursive: true, force: true });
    _resetTurnEpoch();
    bumpTurnGeneration('hammer lifecycle stale task duplicate test');
    try {
      const staleTask = await runWithTurnGeneration(0, () => handleCompleteTask({
        milestoneId: 'M901',
        sliceId: 'S01',
        taskId: 'T01',
        oneLiner: 'Stale duplicate.',
        narrative: 'Stale duplicate.',
        verification: 'Stale duplicate.',
      }, base));
      assert.ok(!('error' in staleTask), `stale task should return duplicate success: ${'error' in staleTask ? staleTask.error : ''}`);
      assert.equal(staleTask.duplicate, true);
      assert.equal(staleTask.stale, true);
      assertUnderHammer(base, staleTask.summaryPath, 'stale task summaryPath');
    } finally {
      _resetTurnEpoch();
    }

    const repairPlan = await handlePlanSlice({
      milestoneId: 'M901',
      sliceId: 'S01',
      goal: 'Exercise stale duplicate path synthesis after a repaired plan render.',
      tasks: [{
        taskId: 'T01',
        title: 'Fallback task',
        description: 'Complete once, remove disk dirs, then simulate stale duplicate completion.',
        estimate: '5m',
        files: ['src/resources/extensions/gsd/tools/complete-task.ts'],
        verify: 'assert returned duplicate paths',
        inputs: ['src/resources/extensions/gsd/tools/complete-task.ts'],
        expectedOutput: ['.hammer path diagnostics'],
      }],
    }, base);
    assert.ok(!('error' in repairPlan));
    updateTaskStatus('M901', 'S01', 'T01', 'complete', new Date().toISOString());

    const completeSlice = await handleCompleteSlice({
      milestoneId: 'M901',
      sliceId: 'S01',
      sliceTitle: 'Fallback slice',
      oneLiner: 'Completed slice once.',
      narrative: 'Initial slice completion.',
      verification: 'Verified once.',
      uatContent: 'Verified once.',
    }, base);
    assert.ok(!('error' in completeSlice), `complete slice failed: ${'error' in completeSlice ? completeSlice.error : ''}`);

    rmSync(join(base, '.hammer', 'milestones', 'M901'), { recursive: true, force: true });
    _resetTurnEpoch();
    bumpTurnGeneration('hammer lifecycle stale slice duplicate test');
    try {
      const staleSlice = await runWithTurnGeneration(0, () => handleCompleteSlice({
        milestoneId: 'M901',
        sliceId: 'S01',
        sliceTitle: 'Fallback slice',
        oneLiner: 'Stale duplicate.',
        narrative: 'Stale duplicate.',
        verification: 'Stale duplicate.',
        uatContent: 'Stale duplicate.',
      }, base));
      assert.ok(!('error' in staleSlice), `stale slice should return duplicate success: ${'error' in staleSlice ? staleSlice.error : ''}`);
      assert.equal(staleSlice.duplicate, true);
      assert.equal(staleSlice.stale, true);
      assertUnderHammer(base, staleSlice.summaryPath, 'stale slice summaryPath');
      assertUnderHammer(base, staleSlice.uatPath, 'stale slice uatPath');
    } finally {
      _resetTurnEpoch();
    }

    assertNoLegacyGsd(base);
  } finally {
    cleanup(base);
  }
});
