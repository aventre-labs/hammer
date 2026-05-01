/**
 * audit-fail-closed.test.ts — M002/S02/T05
 *
 * Per `T01-AUDIT.md` §4 and the T05 task plan, this test file proves the
 * four cases for surface 3d (IAM-classified audit fail-closed):
 *
 *   (a) IAM-classified write to an unwritable audit dir surfaces
 *       AuditFailClosedError with failingStage="audit-write" and the
 *       audit log path in missingArtifacts.
 *   (b) IAM-classified DB-insert failure surfaces
 *       failingStage="audit-projection".
 *   (c) Non-IAM event write failure remains silent (regression guard —
 *       the orchestration-safety promise on the file-write catch is
 *       preserved for non-IAM events).
 *   (d) recordIAMSubagentDispatch propagates AuditFailClosedError to
 *       its caller rather than swallowing it.
 *
 * Test boundary notes:
 *  - Each test uses a fresh tmpdir; the audit log lives under the
 *    canonical `<basePath>/.hammer/audit/events.jsonl` path resolved by
 *    `gsdRoot()` when `<basePath>/.hammer` exists.
 *  - Case (a) makes the audit dir read-only AFTER pre-creating the file
 *    so the lock acquisition path is exercised.
 *  - Case (b) injects a throwing `insertAuditEvent` via a fake DB
 *    adapter (openDatabase + closeDatabase coordinate adapter state).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, _getAdapter } from "../gsd-db.ts";
import { buildAuditEnvelope, emitUokAuditEvent } from "../uok/audit.ts";
import { AuditFailClosedError, isAuditFailClosedError, isIAMClassifiedEvent } from "../uok/audit-classification.ts";
import {
  clearIAMSubagentRuntimeForTest,
  recordIAMSubagentDispatch,
} from "../iam-subagent-runtime.ts";

let tmpBase = "";

test.beforeEach(() => {
  closeDatabase();
  // Pin gsdRoot() probe to our temp dir.
  tmpBase = mkdtempSync(join(tmpdir(), "audit-fail-closed-"));
  mkdirSync(join(tmpBase, ".hammer", "audit"), { recursive: true });
  clearIAMSubagentRuntimeForTest();
});

test.afterEach(() => {
  closeDatabase();
  clearIAMSubagentRuntimeForTest();
  if (tmpBase && existsSync(tmpBase)) {
    // Restore writability before rm so cleanup never EACCES.
    try {
      chmodSync(join(tmpBase, ".hammer", "audit"), 0o755);
    } catch { /* ignore */ }
    rmSync(tmpBase, { recursive: true, force: true });
  }
  tmpBase = "";
});

function iamClassifiedEvent(extra: Partial<{ type: string; eventId: string }> = {}) {
  return buildAuditEnvelope({
    traceId: "trace-x",
    turnId: "turn-x",
    causedBy: "tool-call-x",
    category: "execution",
    type: extra.type ?? "iam-subagent-dispatch",
    payload: { dispatchId: extra.eventId ?? "dx-1", role: "gate-evaluator" },
  });
}

function nonIamEvent() {
  return buildAuditEnvelope({
    traceId: "trace-non-iam",
    turnId: "turn-non-iam",
    category: "gate",
    type: "gate-run",
    payload: { gateId: "Q3", outcome: "pass" },
  });
}

// ---------------------------------------------------------------------------
// Predicate / class unit checks (cheap; no I/O).
// ---------------------------------------------------------------------------

test("isIAMClassifiedEvent matches all four iam-subagent-* execution types", () => {
  for (const type of [
    "iam-subagent-dispatch",
    "iam-subagent-policy-block",
    "iam-subagent-complete",
    "iam-subagent-failed",
  ]) {
    const event = buildAuditEnvelope({
      traceId: "t",
      category: "execution",
      type,
      payload: {},
    });
    assert.equal(isIAMClassifiedEvent(event), true, `${type} should be IAM-classified`);
  }
});

test("isIAMClassifiedEvent rejects non-execution categories and non-iam types", () => {
  assert.equal(
    isIAMClassifiedEvent(buildAuditEnvelope({
      traceId: "t",
      category: "gate",
      type: "iam-subagent-dispatch", // wrong category
      payload: {},
    })),
    false,
  );
  assert.equal(
    isIAMClassifiedEvent(buildAuditEnvelope({
      traceId: "t",
      category: "execution",
      type: "tool-result", // not iam-subagent-*
      payload: {},
    })),
    false,
  );
});

test("AuditFailClosedError carries failingStage, missingArtifacts, remediation, iamErrorKind", () => {
  const err = new AuditFailClosedError({
    failingStage: "audit-write",
    missingArtifacts: ["/tmp/audit/events.jsonl"],
    remediation: "Restore write perms.",
    cause: new Error("EACCES"),
  });
  assert.equal(err.failingStage, "audit-write");
  assert.deepEqual(err.missingArtifacts, ["/tmp/audit/events.jsonl"]);
  assert.equal(err.remediation, "Restore write perms.");
  assert.equal(err.iamErrorKind, "audit-fail-closed");
  assert.equal(err.name, "AuditFailClosedError");
  assert.equal(isAuditFailClosedError(err), true);
  assert.equal(isAuditFailClosedError(new Error("plain")), false);
  assert.match(err.message, /audit fail-closed \(audit-write\)/);
  // .cause is preserved via Error.cause semantics.
  assert.equal((err as unknown as { cause: Error }).cause.message, "EACCES");
});

// ---------------------------------------------------------------------------
// Case (a) — IAM-classified write to unwritable audit dir → audit-write
// ---------------------------------------------------------------------------

test("case-a: IAM-classified write to read-only audit dir surfaces AuditFailClosedError with failingStage=audit-write", () => {
  const auditDir = join(tmpBase, ".hammer", "audit");
  // Pre-create the events.jsonl so the lock acquisition path runs and we
  // exercise the appendFileSync write specifically. Then strip dir write
  // perms so the file open / lockfile-side write fails with EACCES.
  const auditFile = join(auditDir, "events.jsonl");
  writeFileSync(auditFile, "");
  // Make the file itself read-only — appendFileSync will EACCES.
  chmodSync(auditFile, 0o444);

  let caught: unknown = null;
  try {
    emitUokAuditEvent(tmpBase, iamClassifiedEvent());
  } catch (err) {
    caught = err;
  }

  assert.ok(isAuditFailClosedError(caught), `expected AuditFailClosedError, got ${caught}`);
  if (isAuditFailClosedError(caught)) {
    assert.equal(caught.failingStage, "audit-write");
    assert.equal(caught.missingArtifacts.length, 1);
    assert.equal(caught.missingArtifacts[0], auditFile);
    assert.match(caught.remediation, /Audit log at .* is not writable/);
    assert.match(caught.remediation, /resolve filesystem permissions/);
    assert.equal(caught.iamErrorKind, "audit-fail-closed");
  }

  // Restore writability so afterEach cleanup succeeds.
  chmodSync(auditFile, 0o644);
});

// ---------------------------------------------------------------------------
// Case (b) — IAM-classified DB-insert failure → audit-projection
// ---------------------------------------------------------------------------

test("case-b: IAM-classified DB-insert failure surfaces AuditFailClosedError with failingStage=audit-projection", () => {
  // Open an in-memory DB so isDbAvailable() returns true, then force the
  // insertAuditEvent path to throw by closing the table. Simpler: drop
  // the audit_events table after openDatabase, so the next insert fails.
  assert.equal(openDatabase(":memory:"), true);
  const adapter = _getAdapter();
  assert.ok(adapter);
  adapter!.exec("DROP TABLE IF EXISTS audit_events");

  let caught: unknown = null;
  try {
    emitUokAuditEvent(tmpBase, iamClassifiedEvent({ eventId: "evt-projection" }));
  } catch (err) {
    caught = err;
  }

  assert.ok(isAuditFailClosedError(caught), `expected AuditFailClosedError, got ${caught}`);
  if (isAuditFailClosedError(caught)) {
    assert.equal(caught.failingStage, "audit-projection");
    assert.equal(caught.missingArtifacts.length, 1);
    assert.match(caught.missingArtifacts[0]!, /audit_events DB row/);
    assert.match(caught.remediation, /Audit DB projection failed/);
    assert.equal(caught.iamErrorKind, "audit-fail-closed");
  }
});

// ---------------------------------------------------------------------------
// Case (c) — Non-IAM event write failure remains silent (regression guard)
// ---------------------------------------------------------------------------

test("case-c: non-IAM event write failure remains silent (regression guard for orchestration-safety promise)", () => {
  const auditFile = join(tmpBase, ".hammer", "audit", "events.jsonl");
  writeFileSync(auditFile, "");
  chmodSync(auditFile, 0o444);

  // Must NOT throw: non-IAM events preserve the best-effort comment promise
  // at uok/audit.ts (orchestration must not break on audit-write failure).
  assert.doesNotThrow(() => {
    emitUokAuditEvent(tmpBase, nonIamEvent());
  });

  chmodSync(auditFile, 0o644);
});

test("case-c-projection: non-IAM event DB-projection failure remains silent", () => {
  assert.equal(openDatabase(":memory:"), true);
  const adapter = _getAdapter();
  assert.ok(adapter);
  adapter!.exec("DROP TABLE IF EXISTS audit_events");

  // Non-IAM event: DB-insert failure must NOT throw (preserves legacy
  // best-effort projection comment in audit.ts).
  assert.doesNotThrow(() => {
    emitUokAuditEvent(tmpBase, nonIamEvent());
  });
});

// ---------------------------------------------------------------------------
// Case (d) — recordIAMSubagentDispatch propagates AuditFailClosedError
// ---------------------------------------------------------------------------

test("case-d: recordIAMSubagentDispatch propagates AuditFailClosedError to its caller (does not swallow)", () => {
  // Force a write failure for an IAM-classified event so emitUokAuditEvent
  // throws AuditFailClosedError through the emitIamSubagentAuditEvent
  // helper and on through recordIAMSubagentDispatch.
  const auditFile = join(tmpBase, ".hammer", "audit", "events.jsonl");
  writeFileSync(auditFile, "");
  chmodSync(auditFile, 0o444);

  // Build a minimal IAM-subagent tool input: extractIAMSubagentPromptEntries
  // accepts a top-level `task` string. We just need ONE emission to occur so
  // the propagation path through emitIamSubagentAuditEvent is exercised.
  const toolInput = {
    task: "<!-- IAM_SUBAGENT_CONTRACT role=gate-evaluator envelopeId=env-1 -->\nfoo",
  };

  let caught: unknown = null;
  try {
    recordIAMSubagentDispatch({
      basePath: tmpBase,
      traceId: "trace-d",
      turnId: "turn-d",
      toolCallId: "call-d-1",
      toolName: "subagent",
      toolInput,
      unitType: "task",
      parentUnit: "M002/S02/T05",
    });
  } catch (err) {
    caught = err;
  }

  assert.ok(
    isAuditFailClosedError(caught),
    `recordIAMSubagentDispatch must propagate AuditFailClosedError, got ${caught}`,
  );
  if (isAuditFailClosedError(caught)) {
    assert.equal(caught.failingStage, "audit-write");
  }

  chmodSync(auditFile, 0o644);
});

// ---------------------------------------------------------------------------
// Happy path regression: IAM-classified event with a writable audit dir
// must NOT throw and must persist a JSONL line.
// ---------------------------------------------------------------------------

test("happy-path: IAM-classified event with writable audit dir persists and does not throw", () => {
  emitUokAuditEvent(tmpBase, iamClassifiedEvent({ eventId: "happy-1" }));
  const file = join(tmpBase, ".hammer", "audit", "events.jsonl");
  assert.equal(existsSync(file), true);
  const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(event["category"], "execution");
  assert.equal(event["type"], "iam-subagent-dispatch");
});
