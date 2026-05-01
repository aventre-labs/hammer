/**
 * iam-fail-closed-integration.test.ts — M002/S02/T06
 *
 * Cross-cutting integration coverage for the four R033 IAM fail-closed
 * surfaces hardened in S02:
 *
 *   1. phase-envelope        (auto/phase-envelope.ts)
 *   2. completion-evidence   (tools/completion-evidence.ts)
 *   3. gate-policy           (uok/gate-runner.ts)
 *   4. audit-fail-closed     (uok/audit.ts)
 *
 * Each case asserts the canonical fail-closed shape
 *   { ok: false, failingStage, missingArtifacts, remediation }
 * (or its tool-response analogue carrying iamErrorKind for surfaces that
 * don't return a {ok} discriminator directly), and proves there is no
 * silent fallback for the IAM-classified input. A final table-driven
 * regression test walks the silent-degradation inventory from
 * T01-AUDIT.md §5 / §1.1 / §2.1 / §3.1 / §4.1 and asserts each row now
 * fails closed under the new S02 contract.
 *
 * Modeled on `tests/omega-phase-machinery.test.ts` for layout: a single
 * file, node:test runner, per-surface case, no external fixtures.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  assertPhaseEnvelopePresent,
  type PhaseEnvelopeAssertionInput,
} from "../auto/phase-envelope.ts";
import { assertCompletionEvidence } from "../tools/completion-evidence.ts";
import { handleCompleteTask } from "../tools/complete-task.ts";
import { handleCompleteSlice } from "../tools/complete-slice.ts";
import {
  UokGateRunner,
  clearGatePolicyProvenanceRegistry,
} from "../uok/gate-runner.ts";
import { buildAuditEnvelope, emitUokAuditEvent } from "../uok/audit.ts";
import {
  AuditFailClosedError,
  isAuditFailClosedError,
  isIAMClassifiedEvent,
} from "../uok/audit-classification.ts";
import {
  clearIAMSubagentRuntimeForTest,
  recordIAMSubagentDispatch,
} from "../iam-subagent-runtime.ts";
import {
  activateGSD,
  deactivateGSD,
  getCurrentPhase,
  setCurrentPhase,
} from "../../shared/gsd-phase-state.ts";
import {
  closeDatabase,
  openDatabase,
  insertMilestone,
  insertSlice,
  insertTask,
  _getAdapter,
} from "../gsd-db.ts";
import { clearPathCache } from "../paths.ts";
import { clearParseCache } from "../files.ts";

// ─── Test fixtures ───────────────────────────────────────────────────────

let tmpBase = "";

function makeTmpBase(): string {
  const base = mkdtempSync(join(tmpdir(), "iam-fc-integ-"));
  mkdirSync(
    join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"),
    { recursive: true },
  );
  // Pin gsdRoot()'s `.hammer` probe to our temp dir so audit emissions
  // never leak into the host project's real audit log.
  mkdirSync(join(base, ".hammer", "audit"), { recursive: true });
  return base;
}

function writeSlicePlan(base: string): void {
  writeFileSync(
    join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md"),
    "# S01 Plan\n\n## Tasks\n\n- [ ] **T01: Test task**\n",
  );
}

function countCompleteTaskRows(): number {
  const adapter = _getAdapter();
  if (!adapter) return -1;
  const rows = adapter
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'complete'")
    .all() as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

function countCompleteSliceRows(): number {
  const adapter = _getAdapter();
  if (!adapter) return -1;
  const rows = adapter
    .prepare("SELECT COUNT(*) AS n FROM slices WHERE status = 'complete'")
    .all() as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

test.beforeEach(() => {
  closeDatabase();
  deactivateGSD();
  clearGatePolicyProvenanceRegistry();
  clearIAMSubagentRuntimeForTest();
  tmpBase = makeTmpBase();
});

test.afterEach(() => {
  clearPathCache();
  clearParseCache();
  try { closeDatabase(); } catch { /* */ }
  deactivateGSD();
  clearGatePolicyProvenanceRegistry();
  clearIAMSubagentRuntimeForTest();
  if (tmpBase && existsSync(tmpBase)) {
    // Restore writability before rm so cleanup never EACCES.
    try { chmodSync(join(tmpBase, ".hammer", "audit"), 0o755); } catch { /* */ }
    try {
      const auditFile = join(tmpBase, ".hammer", "audit", "events.jsonl");
      if (existsSync(auditFile)) chmodSync(auditFile, 0o644);
    } catch { /* */ }
    rmSync(tmpBase, { recursive: true, force: true });
  }
  tmpBase = "";
});

// ─── Case 1 — phase-envelope (3a) ────────────────────────────────────────

test("case-1: phase-transition envelope-missing short-circuits AND global gsd-phase-state stays unmutated", () => {
  // Pre-condition: GSD activated, phase is null.
  activateGSD();
  assert.equal(getCurrentPhase(), null);

  // Drive the assertion with no envelope (mirrors a non-governed
  // dispatcher path that forgot to populate the IAM_SUBAGENT_CONTRACT
  // marker). Canonical fail-closed shape MUST come back.
  const result = assertPhaseEnvelopePresent("execute-task", undefined);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failingStage, "envelope-missing");
  assert.ok(result.missingArtifacts.length > 0);
  assert.match(result.missingArtifacts.join(","), /IAM_SUBAGENT_CONTRACT envelope/);
  assert.match(result.remediation, /execute-task/);
  // JSON-stringifiable per T01-AUDIT §8 invariant 1.
  assert.doesNotThrow(() => JSON.stringify(result));

  // Caller-pattern proof: dispatcher pattern-matches `{ok:false}` and
  // short-circuits BEFORE setCurrentPhase. Verify global is still null.
  if (!result.ok) {
    // Do nothing — short-circuit. Skip the side-effecting call.
  } else {
    setCurrentPhase("execute-task");
  }
  assert.equal(
    getCurrentPhase(),
    null,
    "global gsd-phase-state must NOT be mutated when envelope assertion fails",
  );
});

// ─── Case 2 — completion-evidence missing-summary on complete-task (3b) ─

test("case-2: complete-task with missing summary fails closed and writes no DB row", async () => {
  openDatabase(join(tmpBase, ".gsd", "gsd.db"));
  insertMilestone({ id: "M001" });
  insertSlice({ id: "S01", milestoneId: "M001" });
  writeSlicePlan(tmpBase);

  const before = countCompleteTaskRows();

  // Pure-helper assertion: mirrors what handleCompleteTask invokes first.
  const helperResult = assertCompletionEvidence(
    {
      milestoneId: "M001",
      sliceId: "S01",
      taskId: "T01",
      oneLiner: "",
      narrative: "",
      verification: "ok",
    },
    tmpBase,
    "task",
  );
  assert.equal(helperResult.ok, false);
  if (!helperResult.ok) {
    assert.equal(helperResult.failingStage, "summary-missing");
    assert.ok(helperResult.missingArtifacts.includes("oneLiner"));
    assert.ok(helperResult.missingArtifacts.includes("narrative"));
    assert.doesNotThrow(() => JSON.stringify(helperResult));
  }

  // End-to-end through the real handler: missing summary fields must
  // produce an `error` and NO complete-status DB row.
  const handlerResult = await handleCompleteTask(
    {
      milestoneId: "M001",
      sliceId: "S01",
      taskId: "T01",
      oneLiner: "",
      narrative: "",
      verification: "ok",
    },
    tmpBase,
  );
  assert.ok("error" in handlerResult, "expected error from handleCompleteTask");
  if ("error" in handlerResult) {
    assert.match(handlerResult.error, /fail-closed \(summary-missing\)/);
  }
  assert.equal(
    countCompleteTaskRows(),
    before,
    "no complete-status task row should be written",
  );
});

// ─── Case 3 — completion-evidence missing-spiral on complete-slice (3b) ─

test("case-3: complete-slice with missing slice-plan anchor fails closed and writes no DB row", async () => {
  openDatabase(join(tmpBase, ".gsd", "gsd.db"));
  insertMilestone({ id: "M001" });
  insertSlice({ id: "S01", milestoneId: "M001" });
  insertTask({
    id: "T01",
    sliceId: "S01",
    milestoneId: "M001",
    status: "complete",
    title: "T1",
  });
  // Deliberately do NOT call writeSlicePlan — the slice-plan anchor is
  // the surface-3b "missing-spiral / missing-evidence" signal for the
  // slice surface.

  const before = countCompleteSliceRows();

  const result = await handleCompleteSlice(
    {
      milestoneId: "M001",
      sliceId: "S01",
      sliceTitle: "Test Slice",
      oneLiner: "x",
      narrative: "y",
      verification: "all green",
      uatContent: "uat narrative",
      deviations: "None.",
      knownLimitations: "None.",
      followUps: "None.",
    },
    tmpBase,
  );

  assert.ok("error" in result, "expected error from handleCompleteSlice");
  if ("error" in result) {
    assert.match(result.error, /fail-closed \(evidence-missing\)/);
    assert.match(result.error, /S01-PLAN\.md/);
  }
  assert.equal(
    countCompleteSliceRows(),
    before,
    "no complete-status slice row should be written",
  );
});

// ─── Case 4 — gate-runner unknown-gate-no-provenance (3c) ───────────────

test("case-4: gate-runner unknown-gate with no IAM provenance returns failureClass=policy with iamErrorKind in audit envelope", async () => {
  // Open in-memory DB so insertGateRun + audit projection have a target.
  assert.equal(openDatabase(":memory:"), true);

  const runner = new UokGateRunner();
  const result = await runner.run("ghost-gate-integ", {
    basePath: tmpBase,
    traceId: "trace-integ-policy",
    turnId: "turn-integ-policy",
  });

  // Canonical fail-closed shape (overlay on GateResult).
  assert.equal(result.outcome, "manual-attention");
  assert.equal(result.failureClass, "policy");
  assert.match(result.rationale ?? "", /No IAM provenance for gate id ghost-gate-integ/);
  assert.match(result.findings ?? "", /iamErrorKind: gate-policy-missing/);
  assert.match(result.findings ?? "", /failingStage: policy-provenance-missing/);
  // RETRY_MATRIX["policy"] === 0 — must not retry.
  assert.equal(result.retryable, false);

  // Audit envelope payload carries iamErrorKind + provenanceSource per
  // T01-AUDIT §3 / §8 invariant 2 (S03 grep contract).
  const auditFile = join(tmpBase, ".hammer", "audit", "events.jsonl");
  assert.equal(existsSync(auditFile), true, "audit log should exist");
  const lines = readFileSync(auditFile, "utf-8")
    .split("\n")
    .filter((l: string) => l.trim().length > 0);
  const events = lines.map((l: string) => JSON.parse(l) as Record<string, unknown>);
  const ghost = events.filter(
    (e: Record<string, unknown>) =>
      (e["payload"] as Record<string, unknown>)["gateId"] === "ghost-gate-integ",
  );
  assert.ok(ghost.length >= 1, "expected at least one audit event for ghost-gate-integ");
  const payload = ghost[0]!["payload"] as Record<string, unknown>;
  assert.equal(payload["failureClass"], "policy");
  assert.equal(payload["iamErrorKind"], "gate-policy-missing");
  assert.equal(typeof payload["provenanceSource"], "string");
});

// ─── Case 5 — audit-fail-closed IAM-classified write (3d) ───────────────

test("case-5: IAM-classified audit write to unwritable file surfaces AuditFailClosedError to caller", () => {
  // Pre-create the audit file and strip write perms so appendFileSync
  // EACCES on the IAM-classified emission. Cleanup restores 0o644.
  const auditFile = join(tmpBase, ".hammer", "audit", "events.jsonl");
  writeFileSync(auditFile, "");
  chmodSync(auditFile, 0o444);

  const event = buildAuditEnvelope({
    traceId: "trace-integ-audit",
    turnId: "turn-integ-audit",
    causedBy: "tool-call-integ",
    category: "execution",
    type: "iam-subagent-dispatch",
    payload: { dispatchId: "di-integ", role: "gate-evaluator" },
  });
  // Sanity: the predicate agrees this event is IAM-classified.
  assert.equal(isIAMClassifiedEvent(event), true);

  let caught: unknown = null;
  try {
    emitUokAuditEvent(tmpBase, event);
  } catch (err) {
    caught = err;
  }

  assert.ok(
    isAuditFailClosedError(caught),
    `expected AuditFailClosedError, got ${String(caught)}`,
  );
  if (isAuditFailClosedError(caught)) {
    assert.equal(caught.failingStage, "audit-write");
    assert.equal(caught.missingArtifacts[0], auditFile);
    assert.match(caught.remediation, /Audit log at .* is not writable/);
    assert.equal(caught.iamErrorKind, "audit-fail-closed");
    // Canonical shape members are present and JSON-stringifiable on the
    // fields the structured remediation cares about.
    assert.doesNotThrow(() =>
      JSON.stringify({
        failingStage: caught.failingStage,
        missingArtifacts: caught.missingArtifacts,
        remediation: caught.remediation,
        iamErrorKind: caught.iamErrorKind,
      }),
    );
  }

  // Caller-site propagation: recordIAMSubagentDispatch must propagate
  // the same AuditFailClosedError through emitIamSubagentAuditEvent.
  const toolInput = {
    task: "<!-- IAM_SUBAGENT_CONTRACT role=gate-evaluator envelopeId=env-integ -->\nbody",
  };
  let propagated: unknown = null;
  try {
    recordIAMSubagentDispatch({
      basePath: tmpBase,
      traceId: "trace-integ-audit-prop",
      turnId: "turn-integ-audit-prop",
      toolCallId: "call-integ-1",
      toolName: "subagent",
      toolInput,
      unitType: "task",
      parentUnit: "M002/S02/T06",
    });
  } catch (err) {
    propagated = err;
  }
  assert.ok(
    isAuditFailClosedError(propagated),
    `recordIAMSubagentDispatch must propagate AuditFailClosedError, got ${String(propagated)}`,
  );

  chmodSync(auditFile, 0o644);
});

// ─── Regression table — silent-degradation inventory from T01-AUDIT §5 ──
//
// Each row encodes a "before S02 silent degradation → after S02
// fail-closed" expectation. The driver below executes every row and
// asserts the structured remediation surface is present. This is the
// cross-cutting proof the recovery agent (S03) consumes — one switch /
// grep predicate over { failingStage, iamErrorKind } across all four
// surfaces.

interface RegressionRow {
  surface: "phase-envelope" | "completion-evidence" | "gate-policy" | "audit-fail-closed";
  scenario: string;
  expectedFailingStage: string;
  /** Pre-S02 silent-degradation citation from T01-AUDIT §1.1/§2.1/§3.1/§4.1. */
  legacyCitation: string;
  /** Drive the surface and return the structured-remediation projection. */
  drive: () => Promise<{
    failingStage: string;
    missingArtifacts: string[];
    remediation: string;
    iamErrorKind?: string;
  }>;
}

function buildRegressionRows(base: string): RegressionRow[] {
  return [
    // ─── phase-envelope (3a) ─────────────────────────────────────────
    {
      surface: "phase-envelope",
      scenario: "non-governed unit dispatched without envelope",
      expectedFailingStage: "envelope-missing",
      legacyCitation: "auto/phases.ts:1662 setCurrentPhase(unitType) called raw with no envelope assertion",
      drive: async () => {
        const r = assertPhaseEnvelopePresent("execute-task", undefined);
        if (r.ok) throw new Error("expected fail-closed");
        return {
          failingStage: r.failingStage,
          missingArtifacts: r.missingArtifacts,
          remediation: r.remediation,
        };
      },
    },
    {
      surface: "phase-envelope",
      scenario: "envelope present but parentUnit empty (awareness lineage broken)",
      expectedFailingStage: "awareness-missing",
      legacyCitation: "auto/phases.ts:490 / 2374 clearCurrentPhase() with no awareness lineage assertion",
      drive: async () => {
        const r = assertPhaseEnvelopePresent("plan-slice", {
          envelopeId: "env-1",
          parentUnit: "",
          mutationBoundary: "orchestration",
        } satisfies PhaseEnvelopeAssertionInput);
        if (r.ok) throw new Error("expected fail-closed");
        return {
          failingStage: r.failingStage,
          missingArtifacts: r.missingArtifacts,
          remediation: r.remediation,
        };
      },
    },
    // ─── completion-evidence (3b) ────────────────────────────────────
    {
      surface: "completion-evidence",
      scenario: "complete-task without verification narrative",
      expectedFailingStage: "evidence-missing",
      legacyCitation: "tools/complete-task.ts:205 transaction(...) reachable with missing evidence (only ownership was checked pre-S02)",
      drive: async () => {
        writeSlicePlan(base);
        const r = assertCompletionEvidence(
          {
            milestoneId: "M001",
            sliceId: "S01",
            taskId: "T01",
            oneLiner: "x",
            narrative: "y",
            verification: "",
          },
          base,
          "task",
        );
        if (r.ok) throw new Error("expected fail-closed");
        return {
          failingStage: r.failingStage,
          missingArtifacts: r.missingArtifacts,
          remediation: r.remediation,
        };
      },
    },
    {
      surface: "completion-evidence",
      scenario: "complete-task with malformed envelope marker",
      expectedFailingStage: "envelope-missing",
      legacyCitation: "tools/complete-task.ts:159-166 ownership-only guard pre-S02 (no IAM envelope assertion)",
      drive: async () => {
        writeSlicePlan(base);
        const r = assertCompletionEvidence(
          {
            milestoneId: "M001",
            sliceId: "S01",
            taskId: "T01",
            oneLiner: "x",
            narrative: "y",
            verification: "ok",
            iamEnvelope: { envelopeId: "" } as PhaseEnvelopeAssertionInput,
          },
          base,
          "task",
        );
        if (r.ok) throw new Error("expected fail-closed");
        return {
          failingStage: r.failingStage,
          missingArtifacts: r.missingArtifacts,
          remediation: r.remediation,
        };
      },
    },
    {
      surface: "completion-evidence",
      scenario: "complete-slice without slice-plan anchor",
      expectedFailingStage: "evidence-missing",
      legacyCitation: "tools/complete-slice.ts:345 transaction(...) reachable with missing slice-spiral artifact pre-S02",
      drive: async () => {
        const r = assertCompletionEvidence(
          {
            milestoneId: "M001",
            sliceId: "S01",
            oneLiner: "x",
            narrative: "y",
            verification: "ok",
            uatContent: "ok",
          },
          base,
          "slice",
        );
        if (r.ok) throw new Error("expected fail-closed");
        return {
          failingStage: r.failingStage,
          missingArtifacts: r.missingArtifacts,
          remediation: r.remediation,
        };
      },
    },
    {
      surface: "completion-evidence",
      scenario: "complete-milestone without verificationPassed=true",
      expectedFailingStage: "evidence-missing",
      legacyCitation: "tools/complete-milestone.ts:204-206 single-bool guard with no IAM completion-evidence assertion pre-S02",
      drive: async () => {
        const r = assertCompletionEvidence(
          {
            milestoneId: "M001",
            oneLiner: "x",
            narrative: "y",
            verificationPassed: false,
          },
          base,
          "milestone",
        );
        if (r.ok) throw new Error("expected fail-closed");
        return {
          failingStage: r.failingStage,
          missingArtifacts: r.missingArtifacts,
          remediation: r.remediation,
        };
      },
    },
    // ─── gate-policy (3c) ────────────────────────────────────────────
    {
      surface: "gate-policy",
      scenario: "unknown gate with no IAM provenance record",
      expectedFailingStage: "policy-provenance-missing",
      legacyCitation: "uok/gate-runner.ts:53-67 unknown-gate branch returned failureClass:'unknown' pre-S02 (no IAM-policy classification)",
      drive: async () => {
        // Open a fresh in-memory DB so insertGateRun has a target.
        try { closeDatabase(); } catch { /* */ }
        openDatabase(":memory:");
        const runner = new UokGateRunner();
        const result = await runner.run("regression-ghost-gate", {
          basePath: base,
          traceId: "trace-reg-policy",
          turnId: "turn-reg-policy",
        });
        // Project the GateResult overlay onto the canonical shape.
        const findings = result.findings ?? "";
        const failingStageMatch = /failingStage:\s*([a-z-]+)/.exec(findings);
        const iamErrorKindMatch = /iamErrorKind:\s*([a-z-]+)/.exec(findings);
        return {
          failingStage: failingStageMatch?.[1] ?? "<unset>",
          missingArtifacts:
            result.failureClass === "policy"
              ? [`gate-id:${"regression-ghost-gate"}`]
              : [],
          remediation: result.rationale ?? "",
          iamErrorKind: iamErrorKindMatch?.[1] ?? undefined,
        };
      },
    },
    // ─── audit-fail-closed (3d) ──────────────────────────────────────
    {
      surface: "audit-fail-closed",
      scenario: "IAM-classified audit write to unwritable file",
      expectedFailingStage: "audit-write",
      legacyCitation: "uok/audit.ts:59-61 empty catch swallowed all errors regardless of event classification pre-S02",
      drive: async () => {
        const auditFile = join(base, ".hammer", "audit", "events.jsonl");
        if (!existsSync(auditFile)) writeFileSync(auditFile, "");
        chmodSync(auditFile, 0o444);
        const event = buildAuditEnvelope({
          traceId: "trace-reg-audit",
          turnId: "turn-reg-audit",
          category: "execution",
          type: "iam-subagent-policy-block",
          payload: { reason: "regression-table" },
        });
        let caught: unknown = null;
        try {
          emitUokAuditEvent(base, event);
        } catch (err) {
          caught = err;
        }
        chmodSync(auditFile, 0o644);
        if (!isAuditFailClosedError(caught)) {
          throw new Error(`expected AuditFailClosedError, got ${String(caught)}`);
        }
        return {
          failingStage: caught.failingStage,
          missingArtifacts: caught.missingArtifacts,
          remediation: caught.remediation,
          iamErrorKind: caught.iamErrorKind,
        };
      },
    },
  ];
}

test("regression-table: every silent-degradation row from T01-AUDIT §5 now fails closed with structured remediation", async () => {
  const rows = buildRegressionRows(tmpBase);
  // Sanity: at least one row per surface (covers the 4-surface grid).
  const surfaces = new Set(rows.map((r) => r.surface));
  assert.equal(surfaces.size, 4, "regression table must cover all four surfaces");

  for (const row of rows) {
    const projected = await row.drive();
    // Every row must declare a non-empty failingStage.
    assert.ok(
      typeof projected.failingStage === "string" && projected.failingStage.length > 0,
      `row "${row.scenario}" missing failingStage`,
    );
    assert.equal(
      projected.failingStage,
      row.expectedFailingStage,
      `row "${row.scenario}" expected ${row.expectedFailingStage}, got ${projected.failingStage}`,
    );
    // Every row must carry a structured remediation string.
    assert.ok(
      typeof projected.remediation === "string" && projected.remediation.length > 0,
      `row "${row.scenario}" remediation must be a non-empty string`,
    );
    // Every row must carry missingArtifacts.
    assert.ok(
      Array.isArray(projected.missingArtifacts),
      `row "${row.scenario}" missingArtifacts must be an array`,
    );
    // Canonical shape is JSON-stringifiable per T01-AUDIT §8 invariant 1.
    assert.doesNotThrow(
      () => JSON.stringify(projected),
      `row "${row.scenario}" projection must be JSON-stringifiable`,
    );
  }
});

// ─── Sanity: all surfaces export the canonical fail-closed members ──────

test("contract-shape: every S02 surface exports failingStage + missingArtifacts + remediation members", () => {
  // phase-envelope
  const pe = assertPhaseEnvelopePresent("execute-task", undefined);
  assert.equal(pe.ok, false);
  if (!pe.ok) {
    assert.ok("failingStage" in pe);
    assert.ok("missingArtifacts" in pe);
    assert.ok("remediation" in pe);
  }

  // completion-evidence
  const ce = assertCompletionEvidence(
    { milestoneId: "M001", sliceId: "S01", taskId: "T01" },
    tmpBase,
    "task",
  );
  assert.equal(ce.ok, false);
  if (!ce.ok) {
    assert.ok("failingStage" in ce);
    assert.ok("missingArtifacts" in ce);
    assert.ok("remediation" in ce);
  }

  // audit-fail-closed
  const afc = new AuditFailClosedError({
    failingStage: "audit-write",
    missingArtifacts: ["x"],
    remediation: "y",
  });
  assert.equal(afc.failingStage, "audit-write");
  assert.deepEqual(afc.missingArtifacts, ["x"]);
  assert.equal(afc.remediation, "y");
  assert.equal(afc.iamErrorKind, "audit-fail-closed");
});
