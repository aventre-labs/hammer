/**
 * gate-runner-iam.test.ts — M002/S02/T04
 *
 * Per T01-AUDIT §3 and the T04 task plan, this test file proves the four
 * cases for the gate-runner IAM provenance / IAMError reclassification
 * surface:
 *
 *   (a) unknown-gate-no-provenance → failureClass: "policy" with
 *       structured remediation containing the expected source path.
 *   (b) gate-throws-IAMError       → reclassified to failureClass:
 *       "policy"; iamErrorKind propagated into rationale/findings.
 *   (c) gate-throws-generic-Error  → retains failureClass: "unknown"
 *       (regression guard — non-IAM throws preserve legacy semantics).
 *   (d) audit-envelope payload contains iamErrorKind + provenanceSource
 *       only on policy outcomes; pass / non-IAM throws omit them.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, _getAdapter } from "../gsd-db.ts";
import {
  UokGateRunner,
  assertGatePolicyProvenance,
  isIAMErrorShaped,
  registerGatePolicyProvenance,
  clearGatePolicyProvenanceRegistry,
} from "../uok/gate-runner.ts";

let tmpBase = "";

test.beforeEach(() => {
  closeDatabase();
  const ok = openDatabase(":memory:");
  assert.equal(ok, true);
  // Each case starts from a clean provenance registry so registration
  // state can't leak between tests.
  clearGatePolicyProvenanceRegistry();
  tmpBase = mkdtempSync(join(tmpdir(), "gate-runner-iam-"));
  // gsdRoot() probes <basePath>/.hammer first; pre-creating it pins the
  // probe to our temp dir so audit events do not leak into the project's
  // real .hammer / .gsd directory during the test run.
  mkdirSync(join(tmpBase, ".hammer", "audit"), { recursive: true });
});

test.afterEach(() => {
  closeDatabase();
  clearGatePolicyProvenanceRegistry();
  if (tmpBase && existsSync(tmpBase)) {
    rmSync(tmpBase, { recursive: true, force: true });
  }
  tmpBase = "";
});

function readAuditEvents(basePath: string): Array<Record<string, unknown>> {
  // gsdRoot() resolves <basePath>/.hammer when present; we pre-create it
  // in beforeEach so this is the canonical audit-log location for tests.
  const path = join(basePath, ".hammer", "audit", "events.jsonl");
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Helper-level unit checks (cheap; exercise the predicates directly).
// ---------------------------------------------------------------------------

test("assertGatePolicyProvenance returns ok when a record is registered", () => {
  registerGatePolicyProvenance("Q3", "iam-subagent-runtime.ts:Q3");
  const result = assertGatePolicyProvenance("Q3");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provenanceSource, "iam-subagent-runtime.ts:Q3");
  }
});

test("assertGatePolicyProvenance returns structured remediation when absent", () => {
  const result = assertGatePolicyProvenance("ghost-gate");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failingStage, "policy-provenance-missing");
    assert.match(result.remediation, /No IAM provenance for gate id ghost-gate/);
    assert.match(result.remediation, /add it to .* or remove the call site/);
    assert.equal(result.missingArtifacts.length, 1);
    assert.match(result.missingArtifacts[0]!, /IAM provenance record for gate id "ghost-gate"/);
  }
});

test("isIAMErrorShaped detects iamErrorKind on the error directly", () => {
  const err = Object.assign(new Error("envelope missing"), {
    iamErrorKind: "context-envelope-invalid",
    remediation: "Provide envelopeId before invoking the gate.",
  });
  const shape = isIAMErrorShaped(err);
  assert.notEqual(shape, null);
  assert.equal(shape?.iamErrorKind, "context-envelope-invalid");
  assert.equal(shape?.remediation, "Provide envelopeId before invoking the gate.");
});

test("isIAMErrorShaped follows .cause for IAMError-shaped causes", () => {
  const cause = { iamErrorKind: "completion-evidence-missing", remediation: "remed" };
  const err = new Error("wrapper");
  (err as unknown as { cause: unknown }).cause = cause;
  const shape = isIAMErrorShaped(err);
  assert.equal(shape?.iamErrorKind, "completion-evidence-missing");
  assert.equal(shape?.remediation, "remed");
});

test("isIAMErrorShaped returns null for plain Error and non-error inputs", () => {
  assert.equal(isIAMErrorShaped(new Error("boom")), null);
  assert.equal(isIAMErrorShaped("string"), null);
  assert.equal(isIAMErrorShaped(undefined), null);
  assert.equal(isIAMErrorShaped(null), null);
  assert.equal(isIAMErrorShaped({ cause: { other: "x" } }), null);
});

// ---------------------------------------------------------------------------
// Case (a) — unknown-gate-no-provenance returns policy + structured remediation
// ---------------------------------------------------------------------------

test("case-a: unknown gate with no IAM provenance returns failureClass: policy with structured remediation", async () => {
  const runner = new UokGateRunner();
  const result = await runner.run("ghost-gate-a", {
    basePath: tmpBase,
    traceId: "trace-a",
    turnId: "turn-a",
  });

  assert.equal(result.outcome, "manual-attention");
  assert.equal(result.failureClass, "policy");
  assert.match(result.rationale ?? "", /No IAM provenance for gate id ghost-gate-a/);
  assert.match(result.findings ?? "", /iamErrorKind: gate-policy-missing/);
  assert.match(result.findings ?? "", /failingStage: policy-provenance-missing/);

  // DB row written with the new policy classification (regression guard).
  const adapter = _getAdapter();
  const rows = adapter
    ?.prepare("SELECT outcome, failure_class, rationale, findings FROM gate_runs WHERE gate_id = 'ghost-gate-a'")
    .all() ?? [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.["outcome"], "manual-attention");
  assert.equal(rows[0]?.["failure_class"], "policy");
});

// ---------------------------------------------------------------------------
// Case (b) — gate.execute throws IAMError-shaped → reclassify to policy
// ---------------------------------------------------------------------------

test("case-b: gate throws IAMError-shaped error → reclassified to failureClass: policy with iamErrorKind propagated", async () => {
  const runner = new UokGateRunner();

  // Pre-register provenance so the unknown-gate branch is bypassed and the
  // catch-block reclassification path is the one under test.
  registerGatePolicyProvenance("iam-throwing-gate", "iam-subagent-runtime.ts:iam-throwing-gate");

  runner.register({
    id: "iam-throwing-gate",
    type: "verification",
    execute: async () => {
      const err = Object.assign(new Error("envelope missing"), {
        iamErrorKind: "context-envelope-invalid",
        remediation: "Provide IAM_SUBAGENT_CONTRACT envelope before invoking gate.",
      });
      throw err;
    },
  });

  const result = await runner.run("iam-throwing-gate", {
    basePath: tmpBase,
    traceId: "trace-b",
    turnId: "turn-b",
  });

  assert.equal(result.outcome, "fail");
  assert.equal(result.failureClass, "policy");
  assert.match(
    result.rationale ?? "",
    /Provide IAM_SUBAGENT_CONTRACT envelope before invoking gate/,
  );
  assert.match(result.findings ?? "", /iamErrorKind: context-envelope-invalid/);
  assert.match(result.findings ?? "", /cause: envelope missing/);
  // RETRY_MATRIX["policy"] === 0 — must not retry.
  assert.equal(result.retryable, false);
  assert.equal(result.attempt, 1);
});

test("case-b-cause: IAMError-shape on err.cause is also recognized and reclassified", async () => {
  const runner = new UokGateRunner();
  registerGatePolicyProvenance("iam-cause-gate", "iam-subagent-runtime.ts");
  runner.register({
    id: "iam-cause-gate",
    type: "verification",
    execute: async () => {
      const err = new Error("wrapper");
      (err as unknown as { cause: unknown }).cause = {
        iamErrorKind: "completion-evidence-missing",
        remediation: "Attach SUMMARY anchor before completing task.",
      };
      throw err;
    },
  });

  const result = await runner.run("iam-cause-gate", {
    basePath: tmpBase,
    traceId: "trace-b2",
    turnId: "turn-b2",
  });

  assert.equal(result.failureClass, "policy");
  assert.match(result.findings ?? "", /iamErrorKind: completion-evidence-missing/);
});

// ---------------------------------------------------------------------------
// Case (c) — generic Error retains unknown classification
// ---------------------------------------------------------------------------

test("case-c: generic Error throw retains failureClass: unknown (regression guard)", async () => {
  const runner = new UokGateRunner();
  registerGatePolicyProvenance("generic-throwing-gate", "iam-subagent-runtime.ts");
  runner.register({
    id: "generic-throwing-gate",
    type: "verification",
    execute: async () => {
      throw new Error("plain runtime failure");
    },
  });

  const result = await runner.run("generic-throwing-gate", {
    basePath: tmpBase,
    traceId: "trace-c",
    turnId: "turn-c",
  });

  assert.equal(result.outcome, "fail");
  assert.equal(result.failureClass, "unknown");
  assert.equal(result.rationale, "plain runtime failure");
  // findings must not be populated with IAM metadata for non-IAM throws.
  assert.equal(result.findings ?? null, null);
});

// ---------------------------------------------------------------------------
// Case (d) — audit-envelope payload IAM fields appear only on policy outcomes
// ---------------------------------------------------------------------------

test("case-d: audit envelope payload contains iamErrorKind + provenanceSource only on policy outcomes", async () => {
  const runner = new UokGateRunner();

  // 1. Unknown-gate branch (no provenance) → policy classification → audit
  //    payload carries iamErrorKind + provenanceSource.
  await runner.run("ghost-gate-d", {
    basePath: tmpBase,
    traceId: "trace-d-policy",
    turnId: "turn-d-policy",
  });

  // 2. Generic throw → unknown classification → audit payload omits IAM
  //    metadata.
  registerGatePolicyProvenance("generic-d-gate", "iam-subagent-runtime.ts");
  runner.register({
    id: "generic-d-gate",
    type: "verification",
    execute: async () => {
      throw new Error("generic boom");
    },
  });
  await runner.run("generic-d-gate", {
    basePath: tmpBase,
    traceId: "trace-d-unknown",
    turnId: "turn-d-unknown",
  });

  // 3. Pass case → none classification → audit payload omits IAM metadata.
  registerGatePolicyProvenance("pass-d-gate", "iam-subagent-runtime.ts");
  runner.register({
    id: "pass-d-gate",
    type: "verification",
    execute: async () => ({ outcome: "pass", failureClass: "none" }),
  });
  await runner.run("pass-d-gate", {
    basePath: tmpBase,
    traceId: "trace-d-pass",
    turnId: "turn-d-pass",
  });

  const events = readAuditEvents(tmpBase);
  assert.ok(events.length >= 3, `expected at least 3 audit events, got ${events.length}`);

  const ghostEvents = events.filter(
    (event) => (event["payload"] as Record<string, unknown>)["gateId"] === "ghost-gate-d",
  );
  const genericEvents = events.filter(
    (event) => (event["payload"] as Record<string, unknown>)["gateId"] === "generic-d-gate",
  );
  const passEvents = events.filter(
    (event) => (event["payload"] as Record<string, unknown>)["gateId"] === "pass-d-gate",
  );

  assert.ok(ghostEvents.length >= 1);
  assert.ok(genericEvents.length >= 1);
  assert.ok(passEvents.length >= 1);

  const ghostPayload = ghostEvents[0]!["payload"] as Record<string, unknown>;
  assert.equal(ghostPayload["failureClass"], "policy");
  assert.equal(ghostPayload["iamErrorKind"], "gate-policy-missing");
  assert.equal(typeof ghostPayload["provenanceSource"], "string");
  assert.match(ghostPayload["provenanceSource"] as string, /iam-subagent-runtime/);

  const genericPayload = genericEvents[0]!["payload"] as Record<string, unknown>;
  assert.equal(genericPayload["failureClass"], "unknown");
  assert.equal(genericPayload["iamErrorKind"], undefined);
  assert.equal(genericPayload["provenanceSource"], undefined);

  const passPayload = passEvents[0]!["payload"] as Record<string, unknown>;
  assert.equal(passPayload["failureClass"], "none");
  assert.equal(passPayload["iamErrorKind"], undefined);
  assert.equal(passPayload["provenanceSource"], undefined);
});

test("case-d-iam-throw: audit payload for gate that throws IAMError-shape carries iamErrorKind + provenanceSource", async () => {
  const runner = new UokGateRunner();
  registerGatePolicyProvenance("iam-audit-gate", "iam-subagent-runtime.ts");
  runner.register({
    id: "iam-audit-gate",
    type: "verification",
    execute: async () => {
      const err = Object.assign(new Error("envelope missing"), {
        iamErrorKind: "context-envelope-invalid",
        remediation: "Provide envelope.",
      });
      throw err;
    },
  });

  await runner.run("iam-audit-gate", {
    basePath: tmpBase,
    traceId: "trace-d-iam",
    turnId: "turn-d-iam",
  });

  const events = readAuditEvents(tmpBase).filter(
    (event) => (event["payload"] as Record<string, unknown>)["gateId"] === "iam-audit-gate",
  );
  assert.ok(events.length >= 1);
  const payload = events[0]!["payload"] as Record<string, unknown>;
  assert.equal(payload["failureClass"], "policy");
  assert.equal(payload["iamErrorKind"], "context-envelope-invalid");
  assert.equal(payload["provenanceSource"], "gate.execute");
});
