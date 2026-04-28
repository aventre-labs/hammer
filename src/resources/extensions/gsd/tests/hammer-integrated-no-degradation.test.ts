import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import {
  buildLoopRemediationSteps,
  diagnoseExpectedArtifact,
  verifyExpectedArtifact,
} from "../auto-recovery.ts";
import { ensureDbOpen } from "../bootstrap/dynamic-tools.ts";
import { clearParseCache } from "../files.ts";
import {
  _getAdapter,
  closeDatabase,
  getOmegaRun,
  insertMilestone,
  insertOmegaRun,
  insertSavesuccessResult,
  insertSlice,
  openDatabase,
  updateOmegaRunStatus,
  upsertOmegaPhaseArtifact,
} from "../gsd-db.ts";
import {
  formatIAMSubagentPolicyBlockReason,
  formatIamSubagentPrompt,
  validateIAMSubagentPolicy,
} from "../iam-subagent-policy.ts";
import {
  clearIAMSubagentRuntimeForTest,
  recordIAMSubagentDispatch,
  recordIAMSubagentPolicyBlock,
  recordIAMSubagentToolResult,
} from "../iam-subagent-runtime.ts";
import {
  persistPhaseOmegaRun,
  validatePhaseOmegaArtifacts,
  type OmegaPhaseManifest,
} from "../omega-phase-artifacts.ts";
import { formatOmegaPhaseArtifactsForPrompt } from "../phase-anchor.ts";
import { _clearGsdRootCache, gsdRoot } from "../paths.ts";
import { setUnifiedAuditEnabled } from "../uok/audit-toggle.ts";
import type { SubagentsPolicy } from "../unit-context-manifest.ts";

const GATE_POLICY: SubagentsPolicy = {
  mode: "allowed",
  roles: ["gate-evaluator"],
  requireEnvelope: true,
  maxParallel: 2,
};

function makeHammerBase(t: test.TestContext): string {
  const base = mkdtempSync(join(tmpdir(), "hammer-no-degradation-"));
  mkdirSync(join(base, ".hammer"), { recursive: true });
  t.after(() => {
    try { closeDatabase(); } catch { /* ok */ }
    clearIAMSubagentRuntimeForTest();
    setUnifiedAuditEnabled(false);
    _clearGsdRootCache();
    clearParseCache();
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function seedMilestoneAndSlice(): void {
  insertMilestone({ id: "M777", title: "Hammer no-degradation", status: "active" });
  insertSlice({
    milestoneId: "M777",
    id: "S10",
    title: "No degradation",
    status: "pending",
    risk: "high",
    depends: [],
  });
}

function seedNormalPlanningArtifacts(base: string): { researchPath: string; planPath: string } {
  const sliceDir = join(gsdRoot(base), "milestones", "M777", "slices", "S10");
  const researchPath = join(sliceDir, "S10-RESEARCH.md");
  const planPath = join(sliceDir, "S10-PLAN.md");
  writeFile(researchPath, "# S10 Research\n\nNormal research alone is not sufficient for a governed Hammer phase.\n");
  writeFile(planPath, [
    "# S10: No degradation",
    "",
    "## Tasks",
    "",
    "- [ ] **T01: Prove gate** `est:10m`",
    "",
  ].join("\n"));
  writeFile(join(sliceDir, "tasks", "T01-PLAN.md"), "# T01 Plan\n");
  return { researchPath, planPath };
}

async function persistOmegaPhase(base: string, targetArtifactPath: string): Promise<OmegaPhaseManifest> {
  const result = await persistPhaseOmegaRun({
    basePath: base,
    unitType: "research-slice",
    unitId: "M777/S10",
    query: "Govern S10 with native Hammer Omega phase artifacts",
    targetArtifactPath,
    persona: "engineer",
    runes: ["RIGOR", "HUMAN"],
    executor: async (prompt) => `Native Hammer Omega output for ${prompt.match(/Stage\s+\d+\s*[:—-]\s*([^\n]+)/i)?.[1] ?? "synthesis"}.`,
  });
  assert.ok(result.ok, `Omega persistence should succeed: ${JSON.stringify(!result.ok && result.error)}`);
  return result.value;
}

function displayPath(base: string, path: string): string {
  return relative(base, path).replaceAll("\\", "/");
}

function readAuditEvents(base: string): Array<Record<string, unknown>> {
  const file = join(gsdRoot(base), "audit", "events.jsonl");
  assert.ok(existsSync(file), "audit events should be written under .hammer");
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function payloads(base: string, type: string): Array<Record<string, unknown>> {
  return readAuditEvents(base)
    .filter((event) => event.type === type)
    .map((event) => event.payload as Record<string, unknown>);
}

function assertRedactionSafe(payload: Record<string, unknown>): void {
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /sk-test-hammer-secret/);
  assert.doesNotMatch(serialized, /SECRET_TOKEN/);
  assert.doesNotMatch(serialized, /api_key/);
  assert.doesNotMatch(serialized, /Call gsd_save_gate_result/);
}

function validGatePrompt(): string {
  return formatIamSubagentPrompt({
    role: "gate-evaluator",
    envelopeId: "M777-S10-gates-Q5-env",
    parentUnit: "M777/S10/gates",
    objective: "Evaluate the S10 no-degradation gate without leaking prompt bodies.",
    mutationBoundary: "quality-gate-result-only",
    expectedArtifacts: [
      {
        id: "Q5-gate-result",
        kind: "gate-result",
        description: "Persist Q5 via gsd_save_gate_result.",
        toolName: "gsd_save_gate_result",
      },
      {
        id: "Q5-audit-event",
        kind: "audit-event",
        description: "Emit redaction-safe IAM audit diagnostics.",
        required: false,
      },
    ],
    provenanceSources: [
      {
        id: "S10-plan",
        kind: "slice-plan",
        source: "Hammer fixture slice plan",
        summary: "Gate evidence is bounded to the slice plan and expected artifacts.",
        path: ".hammer/milestones/M777/slices/S10/S10-PLAN.md",
      },
    ],
    allowedPaths: [],
    allowedToolCalls: ["gsd_save_gate_result"],
    graphMutation: "none",
    promptBody: "Call gsd_save_gate_result. SECRET_TOKEN=sk-test-hammer-secret-12345678901234567890",
  });
}

test("Hammer no-degradation fixture fails closed for normal artifacts, then accepts native Omega and IAM audit evidence", async (t) => {
  const base = makeHammerBase(t);
  assert.equal(await ensureDbOpen(base), true, "Hammer fixture DB should open under .hammer");
  assert.equal(gsdRoot(base), join(base, ".hammer"));
  seedMilestoneAndSlice();
  const { researchPath } = seedNormalPlanningArtifacts(base);

  assert.equal(
    verifyExpectedArtifact("research-slice", "M777/S10", base),
    false,
    "normal S10-RESEARCH.md without native Omega phase artifacts must fail governed verification",
  );
  const normalDiagnostic = diagnoseExpectedArtifact("research-slice", "M777/S10", base) ?? "";
  assert.match(normalDiagnostic, /Omega phase manifest/);
  assert.match(normalDiagnostic, /stage-01-materiality\.md/);
  const remediation = buildLoopRemediationSteps("research-slice", "M777/S10", base) ?? "";
  assert.match(remediation, /hammer_canonical_spiral/);
  assert.match(remediation, /targetArtifactPath/);

  const manifest = await persistOmegaPhase(base, researchPath);
  assert.equal(validatePhaseOmegaArtifacts({
    manifest,
    expectedUnitType: "research-slice",
    expectedUnitId: "M777/S10",
    expectedTargetArtifactPath: researchPath,
  }).ok, true);
  assert.equal(verifyExpectedArtifact("research-slice", "M777/S10", base), true, "valid native Omega artifacts unlock governed completion");
  assert.equal(displayPath(base, manifest.manifestPath).startsWith(".hammer/omega/phases/research-slice/M777__S10/"), true);

  const partialManifest = JSON.parse(JSON.stringify(manifest)) as OmegaPhaseManifest;
  partialManifest.stageFilePaths.materiality = join(dirname(partialManifest.stageFilePaths.materiality), "missing-stage-01-materiality.md");
  const partialValidation = validatePhaseOmegaArtifacts({
    manifest: partialManifest,
    expectedUnitType: "research-slice",
    expectedUnitId: "M777/S10",
    expectedTargetArtifactPath: researchPath,
  });
  assert.equal(partialValidation.ok, false, "partial Omega manifests must fail validation");
  assert.match(!partialValidation.ok ? partialValidation.error.validationGap ?? "" : "", /stage file missing for materiality/);
  assert.match(!partialValidation.ok ? partialValidation.error.remediation : "", /Rerun the governed phase/);

  const staleManifest = { ...manifest, targetArtifactPath: join(base, ".hammer", "milestones", "M777", "stale.md") };
  const staleValidation = validatePhaseOmegaArtifacts({
    manifest: staleManifest,
    expectedUnitType: "research-slice",
    expectedUnitId: "M777/S10",
    expectedTargetArtifactPath: researchPath,
  });
  assert.equal(staleValidation.ok, false, "stale Omega manifests must fail validation");
  assert.match(!staleValidation.ok ? staleValidation.error.validationGap ?? "" : "", /target artifact path mismatch/);

  const compactContext = formatOmegaPhaseArtifactsForPrompt(base, [{
    unitType: "research-slice",
    unitId: "M777/S10",
    expectedTargetArtifactPath: researchPath,
    label: "S10 research Omega",
  }]);
  assert.ok(compactContext, "compact Omega context should render");
  assert.match(compactContext!, /S10 research Omega/);
  assert.match(compactContext!, /Manifest path:/);
  assert.match(compactContext!, /Synthesis path:/);
  assert.match(compactContext!, /stage-01-materiality\.md/);
  assert.match(compactContext!, /stage-10-continuity\.md/);
  assert.match(compactContext!, /Full verbose Omega stage bodies are durable on disk/);
  assert.doesNotMatch(compactContext!, /## Prompt\n/);

  setUnifiedAuditEnabled(true);
  clearIAMSubagentRuntimeForTest();
  const prompt = validGatePrompt();
  const validation = validateIAMSubagentPolicy({
    toolName: "subagent",
    toolInput: { task: prompt },
    unitType: "gate-evaluate",
    parentUnit: "M777/S10/gates",
    policy: GATE_POLICY,
  });
  assert.equal(validation.ok, true, "valid gate-evaluator envelope should pass policy validation");
  assert.deepEqual(validation.accepted, [{ path: "task", role: "gate-evaluator", envelopeId: "M777-S10-gates-Q5-env" }]);

  recordIAMSubagentDispatch({
    basePath: base,
    traceId: "trace-hammer-no-degradation",
    turnId: "turn-dispatch",
    toolCallId: "call-valid-gate",
    toolName: "subagent",
    unitType: "gate-evaluate",
    parentUnit: "M777/S10/gates",
    toolInput: { task: prompt, api_key: "sk-test-hammer-secret-12345678901234567890" },
  });
  recordIAMSubagentToolResult({
    basePath: base,
    traceId: "trace-hammer-no-degradation",
    turnId: "turn-dispatch",
    toolCallId: "call-valid-gate",
    toolName: "subagent",
    unitType: "gate-evaluate",
    parentUnit: "M777/S10/gates",
    toolInput: { task: prompt },
    isError: false,
    result: { content: [{ type: "text", text: "role: gate-evaluator\nenvelopeId: M777-S10-gates-Q5-env\nexpectedArtifacts:\n  - id: Q5-gate-result\n    status: present" }] },
  });

  const markerless = validateIAMSubagentPolicy({
    toolName: "subagent",
    toolInput: { tasks: [{ task: "Evaluate Q5 without an IAM envelope. SECRET_TOKEN=sk-test-hammer-secret-12345678901234567890" }] },
    unitType: "gate-evaluate",
    parentUnit: "M777/S10/gates",
    policy: GATE_POLICY,
  });
  assert.equal(markerless.ok, false);
  assert.equal(markerless.violations[0]?.markerStatus, "missing");
  const markerlessReason = formatIAMSubagentPolicyBlockReason(markerless);
  assert.match(markerlessReason, /HARD BLOCK/);
  assert.match(markerlessReason, /expected artifact/i);
  assert.match(markerlessReason, /mutation boundary/i);
  recordIAMSubagentPolicyBlock({
    context: {
      basePath: base,
      traceId: "trace-hammer-no-degradation",
      turnId: "turn-block-missing",
      toolCallId: "call-markerless",
      toolName: "subagent",
      unitType: "gate-evaluate",
      parentUnit: "M777/S10/gates",
      toolInput: { tasks: [{ task: "Evaluate Q5 without an IAM envelope. SECRET_TOKEN=sk-test-hammer-secret-12345678901234567890" }] },
    },
    validation: markerless,
    reason: markerlessReason,
  });

  const mismatch = validateIAMSubagentPolicy({
    toolName: "subagent",
    toolInput: { task: validGatePrompt().replace("M777-S10-gates-Q5-env", "M999-S99-gates-Q5-env") },
    unitType: "gate-evaluate",
    parentUnit: "M777/S10/gates",
    policy: GATE_POLICY,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.violations[0]?.markerStatus, "mismatched-envelope");
  const mismatchReason = formatIAMSubagentPolicyBlockReason(mismatch);
  recordIAMSubagentPolicyBlock({
    context: {
      basePath: base,
      traceId: "trace-hammer-no-degradation",
      turnId: "turn-block-mismatch",
      toolCallId: "call-mismatch",
      toolName: "subagent",
      unitType: "gate-evaluate",
      parentUnit: "M777/S10/gates",
      toolInput: { task: validGatePrompt().replace("M777-S10-gates-Q5-env", "M999-S99-gates-Q5-env") },
    },
    validation: mismatch,
    reason: mismatchReason,
  });

  const dispatch = payloads(base, "iam-subagent-dispatch")[0];
  assert.ok(dispatch, "dispatch audit payload should be present");
  assert.equal(dispatch.role, "gate-evaluator");
  assert.equal(dispatch.envelopeId, "M777-S10-gates-Q5-env");
  assert.equal(dispatch.parentUnit, "M777/S10/gates");
  assert.equal(dispatch.mutationBoundary, "quality-gate-result-only");
  assert.equal(dispatch.graphMutationClaim, "none");
  assert.equal(dispatch.memoryMutationClaim, "none");
  assert.deepEqual(dispatch.expectedArtifactIds, ["Q5-gate-result", "Q5-audit-event"]);
  assertRedactionSafe(dispatch);

  const complete = payloads(base, "iam-subagent-complete")[0];
  assert.ok(complete, "completion audit payload should be present");
  assert.equal(complete.status, "completed");
  assert.equal((complete.actualArtifactStatus as Record<string, unknown>).status, "present");
  assertRedactionSafe(complete);

  const blocks = payloads(base, "iam-subagent-policy-block");
  assert.equal(blocks.length, 2, "markerless and mismatched-envelope policy blocks should both be audited");
  const missingBlock = blocks.find((block) => (block.violation as Record<string, unknown>).markerStatus === "missing");
  const mismatchBlock = blocks.find((block) => (block.violation as Record<string, unknown>).markerStatus === "mismatched-envelope");
  assert.ok(missingBlock, "markerless block audit should be present");
  assert.ok(mismatchBlock, "mismatched-envelope block audit should be present");
  assert.equal(missingBlock!.role, "<missing>");
  assert.equal(missingBlock!.envelopeId, "<missing>");
  assert.equal(missingBlock!.failureClass, "policy");
  assert.equal(missingBlock!.status, "policy-blocked");
  assert.equal(missingBlock!.mutationBoundary, "<missing>");
  assert.equal(missingBlock!.graphMutationClaim, "unknown");
  assert.equal(missingBlock!.memoryMutationClaim, "unknown");
  assert.deepEqual(missingBlock!.expectedArtifactIds, ["<missing>"]);
  assert.match(String(missingBlock!.blockReason), /expected artifact/i);
  assert.match(String(missingBlock!.blockReason), /mutation boundary/i);
  assert.match(String(missingBlock!.remediation), /IAM_SUBAGENT_CONTRACT/);
  assert.equal(mismatchBlock!.role, "gate-evaluator");
  assert.equal(mismatchBlock!.envelopeId, "M999-S99-gates-Q5-env");
  assert.match(String((mismatchBlock!.violation as Record<string, unknown>).reason), /parent unit M777\/S10\/gates/);
  assertRedactionSafe(missingBlock!);
  assertRedactionSafe(mismatchBlock!);

  const auditRel = displayPath(base, join(gsdRoot(base), "audit", "events.jsonl"));
  assert.equal(auditRel, ".hammer/audit/events.jsonl");
  assert.equal(existsSync(join(base, ".gsd")), false, "Hammer fixture must not create legacy .gsd");

  const adapter = _getAdapter();
  assert.ok(adapter, "DB adapter should remain open for SQLite observability checks");
  const omegaRunRow = getOmegaRun(manifest.runId);
  assert.equal(omegaRunRow?.status, "complete");
  assert.equal(displayPath(base, String(omegaRunRow?.artifact_dir)).startsWith(".hammer/omega/phases/research-slice/M777__S10/"), true);
  const phaseRows = adapter.prepare("SELECT unit_type, unit_id, stage_count, status, manifest_path FROM omega_phase_artifacts WHERE unit_type = 'research-slice' AND unit_id = 'M777/S10'").all() as Array<Record<string, unknown>>;
  assert.equal(phaseRows.length, 1);
  assert.equal(phaseRows[0]?.stage_count, 10);
  assert.equal(phaseRows[0]?.status, "complete");
  assert.equal(displayPath(base, String(phaseRows[0]?.manifest_path)).startsWith(".hammer/omega/phases/research-slice/M777__S10/"), true);
  const auditRows = adapter.prepare("SELECT type, payload_json FROM audit_events ORDER BY ts, event_id").all() as Array<{ type: string; payload_json: string }>;
  assert.ok(auditRows.some((row) => row.type === "iam-subagent-dispatch"));
  assert.ok(auditRows.some((row) => row.type === "iam-subagent-complete"));
  assert.ok(auditRows.some((row) => row.type === "iam-subagent-policy-block"));
  assert.doesNotMatch(JSON.stringify(auditRows.map((row) => JSON.parse(row.payload_json))), /sk-test-hammer-secret|SECRET_TOKEN|api_key/);
});

test("Hammer no-degradation fixture keeps partial Omega manifests observable in DB", (t) => {
  const base = makeHammerBase(t);
  const dbPath = join(gsdRoot(base), "gsd.db");
  assert.equal(openDatabase(dbPath), true, "Hammer DB should open under .hammer");
  const artifactDir = join(gsdRoot(base), "omega", "phases", "research-slice", "M777__S10", "manual-partial");
  mkdirSync(artifactDir, { recursive: true });
  const targetArtifactPath = join(gsdRoot(base), "milestones", "M777", "slices", "S10", "S10-RESEARCH.md");
  writeFile(targetArtifactPath, "# Research\n");
  const manifest: OmegaPhaseManifest = {
    schemaVersion: 1,
    unitType: "research-slice",
    unitId: "M777/S10",
    runId: "manual-partial",
    query: "partial fixture",
    targetArtifactPath,
    manifestPath: join(artifactDir, "phase-manifest.json"),
    artifactDir,
    runManifestPath: join(artifactDir, "run-manifest.json"),
    stageFilePaths: {} as OmegaPhaseManifest["stageFilePaths"],
    stageCount: 0,
    synthesisPath: null,
    status: "partial",
    diagnostics: ["stage files were not written"],
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:01.000Z",
    completedAt: null,
  };
  writeFile(manifest.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  insertOmegaRun({
    id: manifest.runId,
    query: manifest.query,
    persona: null,
    runes_applied: "[]",
    stages_requested: "[]",
    stage_count: 0,
    status: "running",
    artifact_dir: artifactDir,
    created_at: manifest.createdAt,
    completed_at: null,
    error_message: null,
  });
  updateOmegaRunStatus(manifest.runId, "failed", manifest.updatedAt, "partial fixture failure", artifactDir);
  upsertOmegaPhaseArtifact({
    unitType: manifest.unitType,
    unitId: manifest.unitId,
    runId: manifest.runId,
    targetArtifactPath: manifest.targetArtifactPath,
    manifestPath: manifest.manifestPath,
    artifactDir: manifest.artifactDir,
    runManifestPath: manifest.runManifestPath,
    synthesisPath: manifest.synthesisPath,
    stageCount: manifest.stageCount,
    status: manifest.status,
    diagnostics: manifest.diagnostics,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    completedAt: manifest.completedAt,
  });
  insertSavesuccessResult({
    id: "save-partial",
    target_path: targetArtifactPath,
    run_id: manifest.runId,
    s: null,
    a: null,
    v: null,
    e: null,
    s2: null,
    u: null,
    c: null,
    c2: null,
    e2: null,
    s3: null,
    success: 0,
    blind_spots: JSON.stringify(["omega-phase-artifacts"]),
    validated_at: manifest.updatedAt,
  });

  const validation = validatePhaseOmegaArtifacts({
    manifestPath: manifest.manifestPath,
    expectedUnitType: "research-slice",
    expectedUnitId: "M777/S10",
    expectedTargetArtifactPath: targetArtifactPath,
  });
  assert.equal(validation.ok, false, "manually persisted partial manifest remains fail-closed");
  assert.match(!validation.ok ? validation.error.validationGap ?? "" : "", /stageFilePaths|phase manifest status is partial|run manifest missing|synthesis path missing/);

  const adapter = _getAdapter();
  assert.ok(adapter);
  const phase = adapter.prepare("SELECT status, diagnostics_json FROM omega_phase_artifacts WHERE run_id = ?").get(manifest.runId) as { status: string; diagnostics_json: string };
  assert.equal(phase.status, "partial");
  assert.match(phase.diagnostics_json, /stage files were not written/);
  const run = adapter.prepare("SELECT status, error_message FROM omega_runs WHERE id = ?").get(manifest.runId) as { status: string; error_message: string };
  assert.equal(run.status, "failed");
  assert.match(run.error_message, /partial fixture failure/);
  const save = adapter.prepare("SELECT success, blind_spots FROM savesuccess_results WHERE id = ?").get("save-partial") as { success: number; blind_spots: string };
  assert.equal(save.success, 0);
  assert.match(save.blind_spots, /omega-phase-artifacts/);
  assert.equal(existsSync(join(base, ".gsd")), false, "partial observability fixture stays .hammer-only");
});
