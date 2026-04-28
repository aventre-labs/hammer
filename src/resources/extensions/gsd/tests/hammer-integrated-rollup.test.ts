import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { runHammerIdentityScan } from "../../../../../scripts/check-hammer-identity.mjs";
import { runPromptWorkflowCoverageScan } from "../../../../../scripts/check-hammer-prompt-workflow-coverage.mjs";
import { ensureDbOpen } from "../bootstrap/dynamic-tools.ts";
import {
  _getAdapter,
  closeDatabase,
  insertGateRow,
  insertMilestone,
  insertOmegaRun,
  insertSlice,
  insertTask,
  insertVolvoxEpochMutationRow,
  insertVolvoxEpochRow,
  upsertOmegaPhaseArtifact,
} from "../gsd-db.ts";
import { renderPlanFromDb, renderRoadmapFromDb } from "../markdown-renderer.ts";
import { _clearGsdRootCache, gsdRoot } from "../paths.ts";
import { handleCompleteSlice } from "../tools/complete-slice.ts";
import { handleCompleteTask } from "../tools/complete-task.ts";
import { renderStateProjection } from "../workflow-projections.ts";
import { writeManifest } from "../workflow-manifest.ts";
import { clearParseCache } from "../files.ts";
import { buildAuditEnvelope, emitUokAuditEvent } from "../uok/audit.ts";

const CANONICAL_STAGES = [
  "materiality",
  "vitality",
  "interiority",
  "criticality",
  "connectivity",
  "lucidity",
  "necessity",
  "reciprocity",
  "totality",
  "continuity",
] as const;

function makeHammerBase(t: test.TestContext): string {
  const base = mkdtempSync(join(tmpdir(), "hammer-rollup-"));
  mkdirSync(join(base, ".hammer"), { recursive: true });
  t.after(() => {
    try { closeDatabase(); } catch { /* ok */ }
    _clearGsdRootCache();
    clearParseCache();
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

function writeTrackedFixture(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function read(base: string, rel: string): string {
  return readFileSync(join(base, rel), "utf-8");
}

function rel(base: string, path: string): string {
  return relative(base, path).replaceAll("\\", "/");
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else files.push(abs);
    }
  }
  walk(root);
  return files.sort();
}

function seedWorkflow(base: string): void {
  insertMilestone({
    id: "M910",
    title: "Hammer integrated rollup",
    status: "active",
    planning: {
      vision: "Roll up Hammer no-degradation evidence from tracked fixtures and inline .hammer state.",
      successCriteria: ["Generated artifacts preserve Hammer/IAM sections"],
      requirementCoverage: "R003, R004, R008, R017, and R020 covered by integrated rollup.",
    },
  });
  insertSlice({
    id: "S10",
    milestoneId: "M910",
    title: "Integrated no-degradation rollup",
    status: "pending",
    planning: {
      goal: "Exercise DB-backed Hammer lifecycle and awareness evidence.",
      successCriteria: "Generated task/slice artifacts and .hammer diagnostics contain no-degradation evidence.",
      proofLevel: "integration",
      integrationClosure: "The fixture uses existing handlers, scanner exports, and SQLite diagnostics.",
      observabilityImpact: ".hammer/STATE.md, .hammer/state-manifest.json, audit_events, omega_phase_artifacts, volvox_epochs.",
    },
  });
  insertTask({
    milestoneId: "M910",
    sliceId: "S10",
    id: "T01",
    title: "Rollup task",
    status: "pending",
    planning: {
      description: "Complete through handleCompleteTask so generated task artifacts are real handler output.",
      estimate: "10m",
      files: ["scripts/verify-hammer-integrated-no-degradation.mjs"],
      verify: "rollup fixture assertions",
      inputs: ["tracked scanner modules"],
      expectedOutput: [".hammer/milestones/M910/slices/S10/tasks/T01-SUMMARY.md"],
      observabilityImpact: "Task summary exposes verification evidence and diagnostics.",
    },
  });
  insertGateRow({ milestoneId: "M910", sliceId: "S10", gateId: "Q5", scope: "task", taskId: "T01" });
  insertGateRow({ milestoneId: "M910", sliceId: "S10", gateId: "Q6", scope: "task", taskId: "T01" });
  insertGateRow({ milestoneId: "M910", sliceId: "S10", gateId: "Q7", scope: "task", taskId: "T01" });
  insertGateRow({ milestoneId: "M910", sliceId: "S10", gateId: "Q8", scope: "slice" });
}

function seedAwarenessDiagnostics(base: string): void {
  const root = gsdRoot(base);
  const now = "2026-04-27T00:00:00.000Z";
  const artifactDir = join(root, "omega", "phases", "research-slice", "M910__S10", "rollup-run");
  const targetArtifactPath = join(root, "milestones", "M910", "slices", "S10", "S10-RESEARCH.md");
  writeTrackedFixture(targetArtifactPath, "# S10 Research\n\nHammer Omega rollup target.\n");
  const stageFilePaths = Object.fromEntries(CANONICAL_STAGES.map((stage, index) => {
    const stagePath = join(artifactDir, `stage-${String(index + 1).padStart(2, "0")}-${stage}.md`);
    writeTrackedFixture(stagePath, `# ${stage}\n\nHammer native Omega ${stage} evidence.\n`);
    return [stage, stagePath];
  })) as Record<(typeof CANONICAL_STAGES)[number], string>;
  const runManifestPath = join(artifactDir, "run-manifest.json");
  const manifestPath = join(artifactDir, "phase-manifest.json");
  const synthesisPath = join(artifactDir, "synthesis.md");
  writeTrackedFixture(synthesisPath, "# Synthesis\n\nHammer native Omega continuity evidence.\n");
  writeTrackedFixture(runManifestPath, `${JSON.stringify({ stages: CANONICAL_STAGES, stageCount: 10 }, null, 2)}\n`);
  writeTrackedFixture(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    unitType: "research-slice",
    unitId: "M910/S10",
    runId: "rollup-run",
    targetArtifactPath,
    manifestPath,
    artifactDir,
    runManifestPath,
    stageFilePaths,
    stageCount: 10,
    synthesisPath,
    status: "complete",
    diagnostics: [],
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  }, null, 2)}\n`);
  insertOmegaRun({
    id: "rollup-run",
    query: "Hammer integrated rollup native Omega proof",
    persona: "engineer",
    runes_applied: JSON.stringify(["RIGOR", "HUMAN"]),
    stages_requested: JSON.stringify(CANONICAL_STAGES),
    stage_count: 10,
    status: "complete",
    artifact_dir: artifactDir,
    created_at: now,
    completed_at: now,
    error_message: null,
  });
  upsertOmegaPhaseArtifact({
    unitType: "research-slice",
    unitId: "M910/S10",
    runId: "rollup-run",
    targetArtifactPath,
    manifestPath,
    artifactDir,
    runManifestPath,
    synthesisPath,
    stageCount: 10,
    status: "complete",
    diagnostics: [],
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  });
  insertVolvoxEpochRow({
    id: "epoch-rollup",
    status: "failed",
    trigger: "integrated-rollup",
    startedAt: now,
    completedAt: now,
    thresholdsJson: JSON.stringify({ offspringCount: 3 }),
    processedCount: 1,
    changedCount: 1,
    diagnosticsCount: 1,
    blockingDiagnosticsCount: 1,
    propagationEligibleCount: 1,
    archivedCount: 0,
    countsJson: JSON.stringify({ processed: 1, blockingDiagnostics: 1 }),
    diagnosticsJson: JSON.stringify([{ code: "false-germline", severity: "blocking", remediation: "Clear propagation eligibility or supply provenance." }]),
    errorMessage: "blocked by false-germline diagnostic",
  });
  insertVolvoxEpochMutationRow({
    epochId: "epoch-rollup",
    memoryId: "MEM-rollup",
    beforeJson: JSON.stringify({ cellType: "UNDIFFERENTIATED" }),
    afterJson: JSON.stringify({ cellType: "GERMLINE" }),
    changedFieldsJson: JSON.stringify(["volvox_cell_type"]),
    diagnosticsJson: JSON.stringify([{ code: "false-germline", remediation: "Clear propagation eligibility or supply provenance." }]),
    createdAt: now,
  });
  emitUokAuditEvent(base, buildAuditEnvelope({
    traceId: "trace-rollup",
    turnId: "turn-rollup",
    category: "gate",
    type: "iam-subagent-policy-block",
    payload: {
      phaseId: "gate-evaluate",
      unitId: "M910/S10/gates",
      artifactPaths: [manifestPath, synthesisPath],
      iamErrorKind: "missing-iam-envelope",
      remediation: "Add IAM_SUBAGENT_CONTRACT with role, envelopeId, expected artifacts, and mutation boundary.",
      promptSummary: "[redacted] markerless gate prompt",
      auditSummary: "[redacted] policy block summary",
      timestamp: now,
    },
  }));
}

test("integrated rollup scanner exports are green without ignored fixtures", async () => {
  const identity = await runHammerIdentityScan({ root: process.cwd(), enforce: true });
  assert.equal(identity.exitCode, 0);
  assert.equal(identity.summary.unclassifiedCount, 0);

  const coverage = await runPromptWorkflowCoverageScan({ root: process.cwd(), enforce: true });
  assert.equal(coverage.exitCode, 0);
  assert.equal(coverage.summary.ok, true);
  assert.equal(coverage.summary.violationCount, 0);
  assert.equal(coverage.summary.allowlistedCount, 0);
  assert.ok(coverage.scannedFiles.every((file) => !file.startsWith(".gsd/")), "scanner must not rely on ignored .gsd fixtures");
});

test("integrated rollup fixture exposes Hammer lifecycle, Omega, VOLVOX, and IAM policy evidence", async (t) => {
  const base = makeHammerBase(t);
  assert.equal(await ensureDbOpen(base), true);
  assert.equal(gsdRoot(base), join(base, ".hammer"));
  seedWorkflow(base);
  seedAwarenessDiagnostics(base);

  const roadmap = await renderRoadmapFromDb(base, "M910");
  const plan = await renderPlanFromDb(base, "M910", "S10");
  assert.equal(rel(base, roadmap.roadmapPath), ".hammer/milestones/M910/M910-ROADMAP.md");
  assert.equal(rel(base, plan.planPath), ".hammer/milestones/M910/slices/S10/S10-PLAN.md");

  const taskResult = await handleCompleteTask({
    milestoneId: "M910",
    sliceId: "S10",
    taskId: "T01",
    oneLiner: "Completed the Hammer integrated rollup fixture.",
    narrative: "The rollup uses tracked scanner exports plus inline .hammer state to prove lifecycle artifacts, native Omega rows, VOLVOX diagnostics, and IAM subagent policy audit payloads.",
    verification: "Scanner exports were green and fixture artifacts were inspected directly.",
    keyFiles: ["scripts/verify-hammer-integrated-no-degradation.mjs", "src/resources/extensions/gsd/tests/hammer-integrated-rollup.test.ts"],
    verificationEvidence: [
      { command: "node scripts/check-hammer-identity.mjs --enforce", exitCode: 0, verdict: "✅ pass", durationMs: 1 },
      { command: "node scripts/check-hammer-prompt-workflow-coverage.mjs --enforce", exitCode: 0, verdict: "✅ pass", durationMs: 1 },
    ],
    failureModes: "Subprocess failures surface through the verifier with command, exit code, stderr/stdout excerpts, and remediation. Filesystem/SQLite fixture failures bubble as Node test assertion failures with artifact paths. Scanner inventory errors return structured non-zero results.",
    loadProfile: "The rollup is a bounded CI-style verifier over seven subprocess checks plus one inline fixture; the 10x breakpoint is subprocess/test runtime, protected by serial execution, bounded output buffers, and targeted S10 test scope.",
    negativeTests: "No-degradation tests cover missing/partial/stale Omega artifacts, malformed Omega executor output, invalid runes, invalid VOLVOX thresholds, false-germline blocking, markerless IAM subagent prompts, mismatched envelopes, and scanner violation fixtures.",
  }, base);
  assert.ok(!("error" in taskResult), `complete task failed: ${"error" in taskResult ? taskResult.error : ""}`);

  const sliceResult = await handleCompleteSlice({
    milestoneId: "M910",
    sliceId: "S10",
    sliceTitle: "Integrated no-degradation rollup",
    oneLiner: "Completed the Hammer integrated no-degradation rollup fixture.",
    narrative: "Task completion and slice completion ran through real DB-backed handlers while native Omega, VOLVOX, and IAM audit rows remained inspectable under .hammer.",
    verification: "Read .hammer lifecycle artifacts, state projection, state manifest, audit events, omega_phase_artifacts, volvox_epochs, and volvox_epoch_mutations.",
    uatContent: "1. Run node scripts/verify-hammer-integrated-no-degradation.mjs.\n2. Confirm every check passes.\n3. Inspect requirement evidence summary for R003, R004, R008, R017, and R020.",
    keyFiles: ["scripts/verify-hammer-integrated-no-degradation.mjs", "src/resources/extensions/gsd/tests/hammer-integrated-rollup.test.ts"],
    observabilitySurfaces: [".hammer/STATE.md", ".hammer/state-manifest.json", ".hammer/audit/events.jsonl", "omega_phase_artifacts", "volvox_epochs"],
    drillDownPaths: [".hammer/milestones/M910/slices/S10/tasks/T01-SUMMARY.md"],
    requirementsAdvanced: [
      { id: "R003", how: "Existing handlers and renderers were exercised instead of reimplemented." },
      { id: "R004", how: "Native ten-stage Omega phase artifacts were persisted and inspected." },
      { id: "R008", how: "Rune/SAVESUCCESS negative coverage is included in the S10 integration bundle." },
      { id: "R017", how: "Awareness-required paths fail closed with remediation and audit evidence." },
      { id: "R020", how: "Core lifecycle handlers completed under .hammer with Hammer/IAM generated language." },
    ],
    requirementsValidated: [
      { id: "R003", proof: "DB-backed plan, complete-task, and complete-slice handlers produced real artifacts." },
      { id: "R004", proof: "omega_runs and omega_phase_artifacts contain a complete ten-stage run." },
      { id: "R008", proof: "The S10 bundle includes Rune/SAVESUCCESS happy and negative coverage." },
      { id: "R017", proof: "No-degradation fixture records Omega failures, IAM policy blocks, and VOLVOX blocking diagnostics." },
      { id: "R020", proof: ".hammer state root, generated artifacts, state projection, manifest, and audit logs are present." },
    ],
    filesModified: [
      { path: "scripts/verify-hammer-integrated-no-degradation.mjs", description: "One-command final verifier." },
      { path: "src/resources/extensions/gsd/tests/hammer-integrated-rollup.test.ts", description: "Rollup fixture and scanner export assertions." },
    ],
    operationalReadiness: "- Final command emits command-by-command pass/fail status and requirement evidence.\n- Failure payloads include command, exit code, remediation, stdout/stderr excerpts, timestamps, artifact paths, IAM error kinds, and redacted prompt/audit summaries.",
  }, base);
  assert.ok(!("error" in sliceResult), `complete slice failed: ${"error" in sliceResult ? sliceResult.error : ""}`);

  await renderStateProjection(base);
  writeManifest(base);

  const taskSummary = read(base, ".hammer/milestones/M910/slices/S10/tasks/T01-SUMMARY.md");
  assert.match(taskSummary, /^## Hammer Awareness Handoff/m);
  assert.match(taskSummary, /^## Diagnostics/m);
  assert.match(taskSummary, /node scripts\/check-hammer-identity\.mjs --enforce/);
  assert.match(taskSummary, /node scripts\/check-hammer-prompt-workflow-coverage\.mjs --enforce/);

  const sliceSummary = read(base, ".hammer/milestones/M910/slices/S10/S10-SUMMARY.md");
  assert.match(sliceSummary, /^## Hammer Awareness Handoff/m);
  assert.match(sliceSummary, /^## Operational Readiness/m);
  assert.match(sliceSummary, /^## Forward Intelligence/m);
  assert.match(sliceSummary, /R003/);
  assert.match(sliceSummary, /R004/);
  assert.match(sliceSummary, /R008/);
  assert.match(sliceSummary, /R017/);
  assert.match(sliceSummary, /R020/);
  assert.match(sliceSummary, /Hammer\/IAM provenance/);

  const uat = read(base, ".hammer/milestones/M910/slices/S10/S10-UAT.md");
  assert.match(uat, /^## Hammer Awareness Contract/m);
  assert.match(uat, /^## Awareness \/ Provenance Evidence/m);

  const state = read(base, ".hammer/STATE.md");
  assert.match(state, /^# Hammer State/m);
  const manifest = JSON.parse(read(base, ".hammer/state-manifest.json")) as Record<string, unknown>;
  assert.ok(Array.isArray(manifest.tasks));
  assert.ok((manifest.tasks as Array<Record<string, unknown>>).some((task) => task.id === "T01" && task.status === "complete"));

  const audit = read(base, ".hammer/audit/events.jsonl");
  assert.match(audit, /iam-subagent-policy-block/);
  assert.match(audit, /missing-iam-envelope/);
  assert.match(audit, /\[redacted\] markerless gate prompt/);
  assert.doesNotMatch(audit, /SECRET|api_key|sk-/i);

  const adapter = _getAdapter();
  assert.ok(adapter);
  const omega = adapter.prepare("SELECT stage_count, status, manifest_path FROM omega_phase_artifacts WHERE unit_type = 'research-slice' AND unit_id = 'M910/S10'").get() as Record<string, unknown>;
  assert.equal(omega.stage_count, 10);
  assert.equal(omega.status, "complete");
  assert.ok(rel(base, String(omega.manifest_path)).startsWith(".hammer/omega/phases/research-slice/M910__S10/"));

  const volvox = adapter.prepare("SELECT status, blocking_diagnostics_count, diagnostics_json FROM volvox_epochs WHERE id = 'epoch-rollup'").get() as Record<string, unknown>;
  assert.equal(volvox.status, "failed");
  assert.equal(volvox.blocking_diagnostics_count, 1);
  assert.match(String(volvox.diagnostics_json), /false-germline/);
  const mutationCount = (adapter.prepare("SELECT COUNT(*) AS count FROM volvox_epoch_mutations WHERE epoch_id = 'epoch-rollup'").get() as { count: number }).count;
  assert.equal(mutationCount, 1);

  const auditRow = adapter.prepare("SELECT payload_json FROM audit_events WHERE type = 'iam-subagent-policy-block'").get() as Record<string, unknown>;
  assert.match(String(auditRow.payload_json), /missing-iam-envelope/);
  assert.match(String(auditRow.payload_json), /IAM_SUBAGENT_CONTRACT/);

  const allArtifacts = listFiles(join(base, ".hammer")).map((path) => rel(base, path));
  assert.ok(allArtifacts.every((path) => path.startsWith(".hammer/")));
  assert.equal(existsSync(join(base, ".gsd")), false, "rollup fixture must not create ignored .gsd state");
});
