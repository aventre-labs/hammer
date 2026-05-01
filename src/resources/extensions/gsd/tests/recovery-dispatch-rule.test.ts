/**
 * recovery-dispatch-rule.test.ts — M002/S03/T04
 *
 * Covers the pure decision helper `evaluateRecoveryTrigger` against every
 * skip reason and the dispatch path:
 *   (a) rule returns null when no lock exists           → skip "no-lock"
 *   (b) rule returns null when last unit completed      → skip "parent-completed"
 *   (c) rule returns null when last unit is recovery    → skip "anti-recursion"
 *   (d) rule returns null when counter >= cap (3)       → skip "cap-reached"
 *   (e) rule returns null for terminal IAMError kind    → skip "terminal-failure"
 *   (f) rule dispatches recovery for transient ErrorContext   → trigger
 *   (g) rule dispatches recovery for recoverable IAMError kind → trigger
 *
 * Plus drift-pin tests that hold `RECOVERY_FAILURE_CAP`,
 * `isAlreadyRecoveryUnit`, and `classifyRecoverability` aligned with the
 * recovery dispatcher's own copies — if anyone changes one and forgets the
 * other, this suite fails loudly.
 *
 * Pure leaf — no transitive imports of run-unit.ts or session-lock.ts so the
 * suite executes via raw `node --test` without a TypeScript resolver hook.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOVERY_FAILURE_CAP,
  classifyRecoverability,
  evaluateRecoveryTrigger,
  isAlreadyRecoveryUnit,
  type RecoveryLockSnapshot,
} from "../auto/recovery-dispatch-rule.ts";

const PARENT_UNIT_TYPE = "execute-task";
const PARENT_UNIT_ID = "M002/S03/T04";

function transientFailure() {
  return {
    category: "tooling-timeout",
    message: "tool-call exceeded 60s timeout",
    isTransient: true as const,
  };
}

function nonTransientFailure() {
  return {
    category: "module-resolution",
    message: "cannot find module ./does-not-exist",
    isTransient: false as const,
  };
}

function lock(counter: number): RecoveryLockSnapshot {
  return { consecutiveRecoveryFailures: counter };
}

// ─── Skip-path coverage (a)–(e) ─────────────────────────────────────────────

test("(a) no lock → skip with reason 'no-lock'", () => {
  const result = evaluateRecoveryTrigger({
    lock: null,
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: transientFailure(),
  });
  assert.deepEqual(result, { skip: true, reason: "no-lock" });
});

test("(b) parent unit completed → skip with reason 'parent-completed'", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(0),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: true,
    failure: transientFailure(),
  });
  assert.deepEqual(result, { skip: true, reason: "parent-completed" });
});

test("(c) parent unit IS a recovery unit → skip with reason 'anti-recursion'", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(1),
    parentUnitType: "recovery",
    parentUnitId: "execute-task/M002/S03/T04:recover-1",
    parentCompleted: false,
    failure: transientFailure(),
  });
  assert.deepEqual(result, { skip: true, reason: "anti-recursion" });
});

test("(d) counter at cap → skip with reason 'cap-reached'", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(RECOVERY_FAILURE_CAP),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: transientFailure(),
  });
  assert.deepEqual(result, { skip: true, reason: "cap-reached" });
});

test("(d') counter strictly above cap → also skip with 'cap-reached'", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(RECOVERY_FAILURE_CAP + 5),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: transientFailure(),
  });
  assert.equal(result.skip, true);
  if (result.skip) assert.equal(result.reason, "cap-reached");
});

test("(e) terminal IAMError kind → skip with reason 'terminal-failure'", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(0),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: {
      iamErrorKind: "rune-validation-failed",
      remediation: "fix rune name",
    },
  });
  assert.deepEqual(result, { skip: true, reason: "terminal-failure" });
});

test("(e') no failure provided → skip with reason 'no-failure'", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(0),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: null,
  });
  assert.deepEqual(result, { skip: true, reason: "no-failure" });
});

test("(e'') non-transient ErrorContext → skip with reason 'terminal-failure'", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(0),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: nonTransientFailure(),
  });
  assert.equal(result.skip, true);
  if (result.skip) assert.equal(result.reason, "terminal-failure");
});

// ─── Dispatch-path coverage (f), (g) ────────────────────────────────────────

test("(f) transient ErrorContext → dispatch trigger with attemptNumber=counter+1", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(1),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: transientFailure(),
  });
  assert.equal(result.skip, false);
  if (!result.skip) {
    assert.equal(result.trigger.parentUnitType, PARENT_UNIT_TYPE);
    assert.equal(result.trigger.parentUnitId, PARENT_UNIT_ID);
    assert.equal(result.trigger.attemptNumber, 2);
    assert.equal((result.trigger.failure as { isTransient?: boolean }).isTransient, true);
  }
});

test("(f') first attempt — counter 0 → attemptNumber=1", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(0),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: transientFailure(),
  });
  assert.equal(result.skip, false);
  if (!result.skip) assert.equal(result.trigger.attemptNumber, 1);
});

test("(g) recoverable IAMError kind 'audit-fail-closed' → dispatch trigger", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(0),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: {
      iamErrorKind: "audit-fail-closed",
      remediation: "retry the audit append after lock release",
    },
  });
  assert.equal(result.skip, false);
  if (!result.skip) {
    assert.equal(result.trigger.attemptNumber, 1);
    if ("iamErrorKind" in result.trigger.failure) {
      assert.equal(result.trigger.failure.iamErrorKind, "audit-fail-closed");
    } else {
      assert.fail("expected IAMError-shaped failure to round-trip");
    }
  }
});

test("(g') counter at cap-1 → still dispatches the LAST attempt before cap", () => {
  const result = evaluateRecoveryTrigger({
    lock: lock(RECOVERY_FAILURE_CAP - 1),
    parentUnitType: PARENT_UNIT_TYPE,
    parentUnitId: PARENT_UNIT_ID,
    parentCompleted: false,
    failure: transientFailure(),
  });
  assert.equal(result.skip, false);
  if (!result.skip) {
    assert.equal(result.trigger.attemptNumber, RECOVERY_FAILURE_CAP);
  }
});

// ─── Drift-pin tests — hold leaf duplicates aligned with recovery.ts ────────

test("RECOVERY_FAILURE_CAP is the agreed numeric cap", () => {
  assert.equal(RECOVERY_FAILURE_CAP, 3);
});

test("isAlreadyRecoveryUnit only returns true for the literal 'recovery' string", () => {
  assert.equal(isAlreadyRecoveryUnit("recovery"), true);
  assert.equal(isAlreadyRecoveryUnit("execute-task"), false);
  assert.equal(isAlreadyRecoveryUnit("plan-slice"), false);
  assert.equal(isAlreadyRecoveryUnit("Recovery"), false);
  assert.equal(isAlreadyRecoveryUnit(""), false);
});

test("classifyRecoverability matches research §2.6 partition exactly", () => {
  // Recoverable IAM kinds.
  for (const kind of [
    "omega-stage-failed",
    "executor-not-wired",
    "persistence-failed",
    "completion-evidence-missing",
    "audit-fail-closed",
    "gate-policy-missing",
  ] as const) {
    assert.equal(
      classifyRecoverability({ iamErrorKind: kind, remediation: "" }),
      "recoverable",
      `expected ${kind} → recoverable`,
    );
  }
  // Terminal IAM kinds.
  for (const kind of [
    "rune-validation-failed",
    "savesuccess-blind-spot",
    "invalid-stage-sequence",
    "unknown-rune",
    "context-envelope-invalid",
  ] as const) {
    assert.equal(
      classifyRecoverability({ iamErrorKind: kind, remediation: "" }),
      "terminal",
      `expected ${kind} → terminal`,
    );
  }
  // ErrorContext branch.
  assert.equal(
    classifyRecoverability({ category: "x", message: "y", isTransient: true }),
    "recoverable",
  );
  assert.equal(
    classifyRecoverability({ category: "x", message: "y", isTransient: false }),
    "terminal",
  );
  assert.equal(
    classifyRecoverability({ category: "x", message: "y" }),
    "unknown",
  );
});
