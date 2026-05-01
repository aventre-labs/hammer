/**
 * recovery-dispatcher.test.ts — M002/S03/T03
 *
 * Covers `dispatchRecovery` orchestration semantics with a stubbed runUnit:
 *   (a) fix-applied → counter unchanged + lock updated
 *   (b) give-up → counter +1
 *   (c) malformed (no marker) → counter +1 + lastRecoveryVerdict="malformed"
 *   (d) blocker-filed → counter unchanged + verdict recorded
 *   (e) IAM_SUBAGENT_CONTRACT marker present in built prompt
 *   (f) classifyRecoverability partition matches research §2.6
 *
 * Also exercises `isAlreadyRecoveryUnit` for completeness.
 *
 * Runs under the resolve-ts.mjs loader because dispatchRecovery transitively
 * imports run-unit.ts (which imports the @gsd/pi-coding-agent type-only
 * surface) and the session-lock module.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  dispatchRecovery,
  classifyRecoverability,
  isAlreadyRecoveryUnit,
  RECOVERY_FAILURE_CAP,
  _setRunUnitForTest,
  _setRecoveryTemplateForTest,
  type RecoveryDispatchTrigger,
} from "../auto/recovery.ts";
import type { UnitResult } from "../auto/types.ts";
import { readSessionLockData } from "../session-lock.ts";

// ─── Test helpers ────────────────────────────────────────────────────────

function makeTmpBase(prefix: string): string {
  const base = mkdtempSync(join(tmpdir(), `recovery-disp-${prefix}-`));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  return base;
}

/**
 * Pre-write a session lock with `consecutiveRecoveryFailures = initial`.
 * `updateSessionLockFields` short-circuits if no lock file exists, so the
 * test must seed it before dispatching.
 */
function seedLock(base: string, initial: number): void {
  const lock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    unitType: "task",
    unitId: "M001/S01/T01",
    unitStartedAt: new Date().toISOString(),
    consecutiveRecoveryFailures: initial,
  };
  writeFileSync(join(base, ".gsd", "auto.lock"), JSON.stringify(lock, null, 2), "utf-8");
}

function makeUnitResult(messageStream: string): UnitResult {
  return {
    status: "completed",
    event: { messages: [messageStream] },
  };
}

/** Build a minimal AutoSession-shaped object — dispatcher only reads basePath. */
function makeSession(basePath: string): any {
  return { basePath };
}

// Use the real recovery template for substitution + marker tests.
const REAL_TEMPLATE = readFileSync(
  new URL("../prompts/recovery.md", import.meta.url),
  "utf-8",
);

const CTX: any = {};
const PI: any = {};

const baseTrigger = (
  attemptNumber: number,
): RecoveryDispatchTrigger => ({
  parentUnitType: "task",
  parentUnitId: "M002/S03/T99",
  failure: { category: "timeout", message: "unit hard timeout", isTransient: true },
  attemptNumber,
});

test.beforeEach(() => {
  _setRunUnitForTest(null);
  _setRecoveryTemplateForTest(null);
});

test.afterEach(() => {
  _setRunUnitForTest(null);
  _setRecoveryTemplateForTest(null);
});

// ─── (a) fix-applied → counter unchanged ────────────────────────────────

test("fix-applied verdict → counter unchanged + lock fields updated", async () => {
  const base = makeTmpBase("fix");
  try {
    seedLock(base, 1);
    _setRecoveryTemplateForTest(REAL_TEMPLATE);
    _setRunUnitForTest(async () =>
      makeUnitResult("Did the work.\nRECOVERY_VERDICT: fix-applied; summary=patched the import\n"),
    );

    const result = await dispatchRecovery(CTX, PI, makeSession(base), baseTrigger(1));

    assert.equal(result.verdict.kind, "fix-applied");
    assert.equal(result.counterAfter, 1, "counter must NOT increment on fix-applied");

    const lock = readSessionLockData(base);
    assert.ok(lock, "lock should still exist");
    assert.equal(lock!.consecutiveRecoveryFailures, 1);
    assert.equal(lock!.lastRecoveryVerdict, "fix-applied");
    assert.equal(lock!.lastRecoveryUnitId, "task/M002/S03/T99:recover-1");
    assert.ok(lock!.lastRecoveryAt, "lastRecoveryAt timestamp recorded");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ─── (b) give-up → counter +1 ───────────────────────────────────────────

test("give-up verdict → counter increments by 1", async () => {
  const base = makeTmpBase("give");
  try {
    seedLock(base, 1);
    _setRecoveryTemplateForTest(REAL_TEMPLATE);
    _setRunUnitForTest(async () =>
      makeUnitResult("RECOVERY_VERDICT: give-up; reason=cap reached\n"),
    );

    const result = await dispatchRecovery(CTX, PI, makeSession(base), baseTrigger(2));

    assert.equal(result.verdict.kind, "give-up");
    assert.equal(result.counterAfter, 2);

    const lock = readSessionLockData(base);
    assert.equal(lock!.consecutiveRecoveryFailures, 2);
    assert.equal(lock!.lastRecoveryVerdict, "give-up");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ─── (c) malformed → counter +1 + verdict="malformed" ───────────────────

test("malformed verdict (no marker in stream) → counter +1 + lastRecoveryVerdict='malformed'", async () => {
  const base = makeTmpBase("mal");
  try {
    seedLock(base, 0);
    _setRecoveryTemplateForTest(REAL_TEMPLATE);
    _setRunUnitForTest(async () =>
      makeUnitResult("I did some thinking but forgot to emit the verdict line.\n"),
    );

    const result = await dispatchRecovery(CTX, PI, makeSession(base), baseTrigger(1));

    assert.equal(result.verdict.kind, "malformed");
    assert.equal(result.counterAfter, 1);

    const lock = readSessionLockData(base);
    assert.equal(lock!.consecutiveRecoveryFailures, 1);
    assert.equal(lock!.lastRecoveryVerdict, "malformed");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ─── (d) blocker-filed → counter unchanged ──────────────────────────────

test("blocker-filed verdict (valid path) → counter unchanged + verdict recorded", async () => {
  const base = makeTmpBase("blk");
  try {
    seedLock(base, 2);
    _setRecoveryTemplateForTest(REAL_TEMPLATE);
    _setRunUnitForTest(async () =>
      makeUnitResult(
        "Filed the blocker.\nRECOVERY_VERDICT: blocker-filed; blockerPath=.gsd/milestones/M002/slices/S03/BLOCKER.md\n",
      ),
    );

    const result = await dispatchRecovery(CTX, PI, makeSession(base), baseTrigger(2));

    assert.equal(result.verdict.kind, "blocker-filed");
    assert.equal(result.counterAfter, 2, "blocker-filed must NOT increment counter");

    const lock = readSessionLockData(base);
    assert.equal(lock!.consecutiveRecoveryFailures, 2);
    assert.equal(lock!.lastRecoveryVerdict, "blocker-filed");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ─── (e) IAM_SUBAGENT_CONTRACT marker present in built prompt ───────────

test("built prompt contains IAM_SUBAGENT_CONTRACT marker on a recognised line", async () => {
  const base = makeTmpBase("env");
  try {
    seedLock(base, 0);
    _setRecoveryTemplateForTest(REAL_TEMPLATE);

    let capturedPrompt = "";
    let capturedUnitType = "";
    _setRunUnitForTest(async (_ctx, _pi, _s, unitType, _unitId, prompt) => {
      capturedUnitType = unitType;
      capturedPrompt = prompt;
      return makeUnitResult("RECOVERY_VERDICT: fix-applied; summary=ok\n");
    });

    const result = await dispatchRecovery(CTX, PI, makeSession(base), baseTrigger(1));

    assert.equal(capturedUnitType, "recovery", "runUnit must be called with unitType='recovery'");
    assert.equal(
      result.envelopeId,
      "task:M002/S03/T99:recover-1",
      "envelopeId is deterministic from parent + attempt",
    );

    // The marker must be the first non-empty line and use canonical syntax —
    // mirrors the recovery-role-registration test's MARKER_RE acceptance check.
    const expectedMarker = "IAM_SUBAGENT_CONTRACT: role=recovery; envelopeId=task:M002/S03/T99:recover-1";
    assert.ok(
      capturedPrompt.includes(expectedMarker),
      `prompt must include canonical marker — saw start: ${capturedPrompt.slice(0, 120)}`,
    );
    // And the marker should be recognised by the policy MARKER_RE — the regex
    // requires the line to start at string-start or after a newline.
    const policyMarkerRe =
      /(?:^|\n)\s*IAM_SUBAGENT_CONTRACT\s*:\s*role\s*=\s*([A-Za-z0-9_-]+)\s*;\s*envelopeId\s*=\s*([A-Za-z0-9._:/+-]+)\s*(?:\n|$)/;
    const match = capturedPrompt.match(policyMarkerRe);
    assert.ok(match, "policy MARKER_RE must accept the built prompt");
    assert.equal(match![1], "recovery");
    assert.equal(match![2], "task:M002/S03/T99:recover-1");

    // Placeholder substitution sanity — the cap and attempt should be rendered.
    assert.ok(
      capturedPrompt.includes(`Recovery attempt:    \`1\` of \`${RECOVERY_FAILURE_CAP}\``),
      "ATTEMPT_NUMBER + CAP placeholders must be substituted",
    );
    assert.ok(
      capturedPrompt.includes("Parent unit type:    `task`"),
      "PARENT_UNIT_TYPE placeholder must be substituted",
    );
    assert.ok(
      capturedPrompt.includes("Failure category:    `timeout`"),
      "FAILURE_CATEGORY (from ErrorContext) must be substituted",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ─── (f) classifyRecoverability partition ───────────────────────────────

test("classifyRecoverability matches research §2.6 partition", () => {
  // Terminal IAM kinds.
  assert.equal(
    classifyRecoverability({
      iamErrorKind: "rune-validation-failed",
      remediation: "fix the rune",
    }),
    "terminal",
  );
  // Recoverable IAM kinds.
  assert.equal(
    classifyRecoverability({
      iamErrorKind: "audit-fail-closed",
      remediation: "retry audit write",
    }),
    "recoverable",
  );
  // ErrorContext with isTransient=true → recoverable.
  assert.equal(
    classifyRecoverability({
      message: "provider timeout",
      category: "timeout",
      isTransient: true,
    }),
    "recoverable",
  );
  // ErrorContext without isTransient → unknown.
  assert.equal(
    classifyRecoverability({
      message: "unspecified",
      category: "unknown",
    }),
    "unknown",
  );
  // ErrorContext with isTransient=false → terminal.
  assert.equal(
    classifyRecoverability({
      message: "auth dead",
      category: "provider",
      isTransient: false,
    }),
    "terminal",
  );
});

// ─── isAlreadyRecoveryUnit ──────────────────────────────────────────────

test("isAlreadyRecoveryUnit only returns true for the literal 'recovery' string", () => {
  assert.equal(isAlreadyRecoveryUnit("recovery"), true);
  assert.equal(isAlreadyRecoveryUnit("task"), false);
  assert.equal(isAlreadyRecoveryUnit("Recovery"), false);
  assert.equal(isAlreadyRecoveryUnit(""), false);
});
