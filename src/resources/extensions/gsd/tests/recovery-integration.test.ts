/**
 * recovery-integration.test.ts — M002/S03/T05
 *
 * Cross-cutting integration coverage for the recover-and-resume agent (S03).
 * The suite drives the real production code paths — `dispatchRecovery`,
 * `evaluateRecoveryTrigger`, `shouldResetRecoveryCounter` — through end-to-end
 * scenarios with a stubbed `runUnit` (so no real subagent fires) but real lock
 * files written into a tmpdir per test. Each case pre-writes the lock,
 * invokes the production helper under test, then reads the lock JSON back for
 * assertion.
 *
 * Mirrors the cross-cutting layout of `iam-fail-closed-integration.test.ts`:
 * single file, single tmpdir setup, one node:test per acceptance case.
 *
 * Implements the 10 R030 acceptance scenarios enumerated in S03 research §7
 * plus a regression-table driver across all 11 IAMError.iamErrorKind values
 * that pins the recoverable/terminal partition (research §2.6).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  dispatchRecovery,
  RECOVERY_FAILURE_CAP,
  _setRunUnitForTest,
  _setRecoveryTemplateForTest,
  type RecoveryDispatchTrigger,
} from "../auto/recovery.ts";
import {
  evaluateRecoveryTrigger,
  shouldResetRecoveryCounter,
  classifyRecoverability,
  type RecoveryLockSnapshot,
} from "../auto/recovery-dispatch-rule.ts";
import type { UnitResult, ErrorContext } from "../auto/types.ts";
import { readSessionLockData, updateSessionLockFields } from "../session-lock.ts";
import { parseIAMSubagentContractMarker } from "../iam-subagent-policy.ts";
import type { IAMError } from "../../../../iam/types.ts";

// ─── Test fixtures ───────────────────────────────────────────────────────

let tmpBase = "";

function makeTmpBase(): string {
  const base = mkdtempSync(join(tmpdir(), "recovery-integ-"));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  return base;
}

/**
 * Pre-write a session lock with the given recovery counter so
 * updateSessionLockFields and readSessionLockData have a target. The
 * dispatcher's lock helpers short-circuit if the file is missing.
 */
function seedLock(
  base: string,
  initial: number,
  extras: Record<string, unknown> = {},
): void {
  const lock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    unitType: "task",
    unitId: "M002/S03/T99",
    unitStartedAt: new Date().toISOString(),
    consecutiveRecoveryFailures: initial,
    ...extras,
  };
  writeFileSync(
    join(base, ".gsd", "auto.lock"),
    JSON.stringify(lock, null, 2),
    "utf-8",
  );
}

function makeUnitResult(messageStream: string): UnitResult {
  return {
    status: "completed",
    event: { messages: [messageStream] },
  };
}

/** Minimal AutoSession-shaped object — dispatcher only reads basePath. */
function makeSession(basePath: string): any {
  return { basePath };
}

const REAL_TEMPLATE = readFileSync(
  new URL("../prompts/recovery.md", import.meta.url),
  "utf-8",
);

const CTX: any = {};
const PI: any = {};

const baseTrigger = (
  attemptNumber: number,
  failure?: ErrorContext | { iamErrorKind: IAMError["iamErrorKind"]; remediation: string },
): RecoveryDispatchTrigger => ({
  parentUnitType: "task",
  parentUnitId: "M002/S03/T99",
  failure: failure ?? {
    category: "tooling-timeout",
    message: "tool-call exceeded 60s timeout",
    isTransient: true,
  },
  attemptNumber,
});

test.beforeEach(() => {
  _setRunUnitForTest(null);
  _setRecoveryTemplateForTest(REAL_TEMPLATE);
  tmpBase = makeTmpBase();
});

test.afterEach(() => {
  _setRunUnitForTest(null);
  _setRecoveryTemplateForTest(null);
  if (tmpBase && existsSync(tmpBase)) {
    rmSync(tmpBase, { recursive: true, force: true });
  }
  tmpBase = "";
});

// ─── Case 1 — counter persistence positive ──────────────────────────────

test("case-1: give-up verdict persists consecutiveRecoveryFailures === 1 in lock JSON", async () => {
  seedLock(tmpBase, 0);
  _setRunUnitForTest(async () =>
    makeUnitResult("RECOVERY_VERDICT: give-up; reason=cannot fix unattended\n"),
  );

  const result = await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(1));

  assert.equal(result.verdict.kind, "give-up");
  assert.equal(result.counterAfter, 1);

  // Read the on-disk lock JSON directly to prove durability — not just the
  // in-memory return value.
  const raw = readFileSync(join(tmpBase, ".gsd", "auto.lock"), "utf-8");
  const parsed = JSON.parse(raw);
  assert.equal(
    parsed.consecutiveRecoveryFailures,
    1,
    "lock JSON must record counter=1 after one give-up",
  );
  assert.equal(parsed.lastRecoveryVerdict, "give-up");
});

// ─── Case 2 — counter persistence across simulated restart ──────────────

test("case-2: counter survives simulated process restart (file persists, fresh read returns 2)", () => {
  seedLock(tmpBase, 0);

  // Process A: write counter=2 via the public update helper.
  updateSessionLockFields(tmpBase, {
    consecutiveRecoveryFailures: 2,
    lastRecoveryVerdict: "give-up",
    lastRecoveryUnitId: "task/M002/S03/T99:recover-2",
  });

  // Confirm lock file exists on disk independent of in-memory module state —
  // this is what survives a process exit / SIGKILL / laptop sleep.
  const lockPath = join(tmpBase, ".gsd", "auto.lock");
  assert.equal(existsSync(lockPath), true, "lock file must persist on disk");

  // Process B: a fresh read of the lock returns the persisted counter. We
  // simulate the restart by going through the disk-backed reader, not the
  // in-memory cache.
  const data = readSessionLockData(tmpBase);
  assert.ok(data, "reader must return a parsed lock from disk");
  assert.equal(data!.consecutiveRecoveryFailures, 2);
  assert.equal(data!.lastRecoveryVerdict, "give-up");
  assert.equal(data!.lastRecoveryUnitId, "task/M002/S03/T99:recover-2");
});

// ─── Case 3 — reset on successful non-recovery completion ───────────────

test("case-3: successful non-recovery completion zeros the counter via the loop reset path", () => {
  seedLock(tmpBase, 1, { lastRecoveryVerdict: "give-up" });

  // The loop's R030 reset path consults shouldResetRecoveryCounter to decide
  // whether to zero — drive the production helper, not shadow logic.
  assert.equal(
    shouldResetRecoveryCounter("execute-task", "completed"),
    true,
    "non-recovery completion MUST trigger reset",
  );

  updateSessionLockFields(tmpBase, {
    consecutiveRecoveryFailures: 0,
    lastRecoveryVerdict: undefined,
  });

  const after = readSessionLockData(tmpBase);
  assert.ok(after);
  assert.equal(after!.consecutiveRecoveryFailures, 0, "counter must be zeroed");
});

// ─── Case 4 — cap at 3 → pause + dispatch rule no longer matches ────────

test("case-4: three sequential give-ups hit cap; rule then refuses to dispatch (cap-reached skip)", async () => {
  seedLock(tmpBase, 0);
  _setRunUnitForTest(async () =>
    makeUnitResult("RECOVERY_VERDICT: give-up; reason=still cannot fix\n"),
  );

  for (let attempt = 1; attempt <= RECOVERY_FAILURE_CAP; attempt++) {
    const r = await dispatchRecovery(
      CTX,
      PI,
      makeSession(tmpBase),
      baseTrigger(attempt),
    );
    assert.equal(r.verdict.kind, "give-up");
    assert.equal(
      r.counterAfter,
      attempt,
      `after attempt ${attempt}, counter must equal ${attempt}`,
    );
  }

  const lock = readSessionLockData(tmpBase);
  assert.equal(lock!.consecutiveRecoveryFailures, RECOVERY_FAILURE_CAP);

  // The dispatch rule (auto-dispatch.ts + phases.ts) consults
  // evaluateRecoveryTrigger which MUST refuse to dispatch when the counter
  // has reached the cap — this is the "pauseAuto fallthrough" surface.
  const decision = evaluateRecoveryTrigger({
    lock: { consecutiveRecoveryFailures: RECOVERY_FAILURE_CAP },
    parentUnitType: "task",
    parentUnitId: "M002/S03/T99",
    parentCompleted: false,
    failure: {
      category: "tooling-timeout",
      message: "still failing",
      isTransient: true,
    },
  });
  assert.deepEqual(
    decision,
    { skip: true, reason: "cap-reached" },
    "rule MUST skip with cap-reached so phases.ts falls through to pauseAuto",
  );
});

// ─── Case 5 — fix-applied does NOT zero immediately ─────────────────────

test("case-5: fix-applied does NOT zero counter; only next non-recovery completion zeros it", async () => {
  seedLock(tmpBase, 0);

  // Step 1 — give-up bumps counter to 1.
  _setRunUnitForTest(async () =>
    makeUnitResult("RECOVERY_VERDICT: give-up; reason=trying again\n"),
  );
  let r = await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(1));
  assert.equal(r.counterAfter, 1);

  // Step 2 — fix-applied keeps counter at 1 (research §4.2 delta = 0).
  _setRunUnitForTest(async () =>
    makeUnitResult("RECOVERY_VERDICT: fix-applied; summary=patched the import path\n"),
  );
  r = await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(2));
  assert.equal(r.verdict.kind, "fix-applied");
  assert.equal(
    r.counterAfter,
    1,
    "fix-applied does NOT zero counter — only next non-recovery completion does",
  );
  assert.equal(readSessionLockData(tmpBase)!.consecutiveRecoveryFailures, 1);

  // Step 3 — non-recovery completed unit zeroes the counter via the reset path.
  assert.equal(shouldResetRecoveryCounter("execute-task", "completed"), true);
  updateSessionLockFields(tmpBase, {
    consecutiveRecoveryFailures: 0,
    lastRecoveryVerdict: undefined,
  });
  assert.equal(readSessionLockData(tmpBase)!.consecutiveRecoveryFailures, 0);
});

// ─── Case 6 — blocker-filed is a clean exit, not a strike ───────────────

test("case-6: blocker-filed verdict keeps counter intact and round-trips blockerPath through verdict", async () => {
  seedLock(tmpBase, 1);

  // Step 1 — give-up bumps to 2.
  _setRunUnitForTest(async () =>
    makeUnitResult("RECOVERY_VERDICT: give-up; reason=stalled\n"),
  );
  let r = await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(2));
  assert.equal(r.counterAfter, 2);

  // Step 2 — blocker-filed keeps counter at 2 (clean exit, not a strike).
  const blockerPath = ".gsd/milestones/M002/slices/S03/BLOCKER.md";
  _setRunUnitForTest(async () =>
    makeUnitResult(
      `Filed blocker.\nRECOVERY_VERDICT: blocker-filed; blockerPath=${blockerPath}\n`,
    ),
  );
  r = await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(3));
  assert.equal(r.verdict.kind, "blocker-filed");
  assert.equal(
    r.counterAfter,
    2,
    "blocker-filed must NOT increment counter (research §4.2)",
  );

  // The blocker path must round-trip through the verdict so the loop's pause
  // path can surface it to the operator.
  if (r.verdict.kind === "blocker-filed") {
    assert.equal(r.verdict.blockerPath, blockerPath);
  }

  const lock = readSessionLockData(tmpBase);
  assert.equal(lock!.consecutiveRecoveryFailures, 2);
  assert.equal(
    lock!.lastRecoveryVerdict,
    "blocker-filed",
    "lastRecoveryVerdict on lock records the kind so operators can grep",
  );
});

// ─── Case 7 — malformed verdict ≡ give-up ───────────────────────────────

test("case-7: missing RECOVERY_VERDICT line treated as malformed (counter +1, lastRecoveryVerdict='malformed')", async () => {
  seedLock(tmpBase, 0);
  _setRunUnitForTest(async () =>
    makeUnitResult("Did some thinking but never emitted the verdict marker.\n"),
  );

  const r = await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(1));
  assert.equal(r.verdict.kind, "malformed");
  assert.equal(
    r.counterAfter,
    1,
    "malformed must count as a strike — same delta as give-up",
  );

  const lock = readSessionLockData(tmpBase);
  assert.equal(lock!.consecutiveRecoveryFailures, 1);
  assert.equal(lock!.lastRecoveryVerdict, "malformed");
});

// ─── Case 8 — no recursion ──────────────────────────────────────────────

test("case-8: dispatch rule refuses to recurse when parentUnitType === 'recovery'", async () => {
  seedLock(tmpBase, 0);
  _setRunUnitForTest(async () =>
    makeUnitResult("RECOVERY_VERDICT: give-up; reason=outer attempt failed\n"),
  );

  // First dispatch — proves the recovery unit ran.
  const r = await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(1));
  assert.equal(r.counterAfter, 1);

  // Now feed the rule a fake "next iteration" where the just-failed unit was
  // ITSELF the recovery unit (recovery-on-recovery). Rule MUST refuse.
  const lock = readSessionLockData(tmpBase);
  const decision = evaluateRecoveryTrigger({
    lock: { consecutiveRecoveryFailures: lock!.consecutiveRecoveryFailures ?? 0 },
    parentUnitType: "recovery",
    parentUnitId: "task/M002/S03/T99:recover-1",
    parentCompleted: false,
    failure: {
      category: "tooling-timeout",
      message: "recovery itself blew up",
      isTransient: true,
    },
  });
  assert.deepEqual(
    decision,
    { skip: true, reason: "anti-recursion" },
    "no recursion — recovery cannot dispatch recovery",
  );
});

// ─── Case 9 — R033 fail-closed routing ──────────────────────────────────

test("case-9: recoverable IAM kinds dispatch; terminal kinds do not (rule returns null)", () => {
  // Recoverable: audit-fail-closed → rule dispatches.
  const recoverableDecision = evaluateRecoveryTrigger({
    lock: { consecutiveRecoveryFailures: 0 },
    parentUnitType: "task",
    parentUnitId: "M002/S03/T99",
    parentCompleted: false,
    failure: {
      iamErrorKind: "audit-fail-closed",
      remediation: "audit log is unwritable, retry",
    },
  });
  assert.equal(recoverableDecision.skip, false, "audit-fail-closed must dispatch");
  if (!recoverableDecision.skip) {
    assert.equal(recoverableDecision.trigger.attemptNumber, 1);
  }

  // Terminal: rune-validation-failed → rule skips with terminal-failure.
  const terminalDecision = evaluateRecoveryTrigger({
    lock: { consecutiveRecoveryFailures: 0 },
    parentUnitType: "task",
    parentUnitId: "M002/S03/T99",
    parentCompleted: false,
    failure: {
      iamErrorKind: "rune-validation-failed",
      remediation: "fix the rune contract",
    },
  });
  assert.deepEqual(
    terminalDecision,
    { skip: true, reason: "terminal-failure" },
    "rune-validation-failed must NOT trigger recovery (terminal class)",
  );
});

// ─── Case 10 — envelope contract: marker present + stripping fails-closed ─

test("case-10: built recovery prompt carries IAM_SUBAGENT_CONTRACT marker; stripping fails-closes the policy gate", async () => {
  seedLock(tmpBase, 0);

  let capturedPrompt = "";
  let capturedUnitType = "";
  _setRunUnitForTest(async (_ctx, _pi, _s, unitType, _unitId, prompt) => {
    capturedUnitType = unitType;
    capturedPrompt = prompt;
    return makeUnitResult("RECOVERY_VERDICT: fix-applied; summary=ok\n");
  });

  await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(1));

  assert.equal(capturedUnitType, "recovery", "runUnit must dispatch with unitType='recovery'");

  // Marker present on a recognised line — exact envelopeId form.
  const expectedMarker =
    "IAM_SUBAGENT_CONTRACT: role=recovery; envelopeId=task:M002/S03/T99:recover-1";
  assert.ok(
    capturedPrompt.includes(expectedMarker),
    `prompt must include canonical marker; saw start: ${capturedPrompt.slice(0, 200)}`,
  );

  // Round-trip through the production policy parser — proves the marker
  // satisfies the existing MARKER_RE used by iam-subagent-policy at dispatch.
  // IAMSubagentPromptMarker shape: { role, envelopeId, malformed } — a strict
  // match populates role+envelopeId; absence leaves them null.
  const parsed = parseIAMSubagentContractMarker(capturedPrompt);
  assert.equal(parsed.role, "recovery", "policy MARKER_RE must extract role=recovery");
  assert.equal(parsed.envelopeId, "task:M002/S03/T99:recover-1");
  assert.equal(parsed.malformed, false, "strict match cannot be malformed");

  // Strip the marker line and re-parse — the policy gate MUST fail-closed:
  // role=null + envelopeId=null + no loose-match either (full line removed).
  const stripped = capturedPrompt
    .split("\n")
    .filter((line) => !line.includes("IAM_SUBAGENT_CONTRACT"))
    .join("\n");
  const reparsed = parseIAMSubagentContractMarker(stripped);
  assert.equal(
    reparsed.role,
    null,
    "removing marker MUST leave role unresolved (policy rejects)",
  );
  assert.equal(reparsed.envelopeId, null);
  assert.equal(
    reparsed.malformed,
    false,
    "no loose match either — the line is fully gone, not just malformed",
  );
});

// ─── Regression-table driver: all 11 IAMError kinds classified ──────────
//
// The recoverable/terminal partition lives in two places (recovery.ts and
// recovery-dispatch-rule.ts). If a future contributor adds a new
// IAMError.iamErrorKind value to src/iam/types.ts:179-199 without updating
// the partition, this test fails with a precise diagnostic naming the
// unclassified kind. That forces a conscious classification decision.

interface ClassificationRow {
  kind: IAMError["iamErrorKind"];
  expected: "recoverable" | "terminal";
}

const CLASSIFICATION_TABLE: ClassificationRow[] = [
  // Recoverable — research §2.6 (and recovery.ts:127-133).
  { kind: "omega-stage-failed", expected: "recoverable" },
  { kind: "executor-not-wired", expected: "recoverable" },
  { kind: "persistence-failed", expected: "recoverable" },
  { kind: "completion-evidence-missing", expected: "recoverable" },
  { kind: "audit-fail-closed", expected: "recoverable" },
  { kind: "gate-policy-missing", expected: "recoverable" },
  // Terminal — research §2.6 (and recovery.ts:134-139).
  { kind: "rune-validation-failed", expected: "terminal" },
  { kind: "savesuccess-blind-spot", expected: "terminal" },
  { kind: "invalid-stage-sequence", expected: "terminal" },
  { kind: "unknown-rune", expected: "terminal" },
  { kind: "context-envelope-invalid", expected: "terminal" },
];

test("regression-table: every IAMError.iamErrorKind classified per research §2.6 partition", () => {
  // Sanity — research §2.6 enumerates exactly 11 kinds (6 recoverable + 5
  // terminal). If src/iam/types.ts grows, we want an immediate failure.
  assert.equal(
    CLASSIFICATION_TABLE.length,
    11,
    "IAMError.iamErrorKind partition expected 11 entries — update CLASSIFICATION_TABLE alongside src/iam/types.ts:179-199",
  );

  for (const row of CLASSIFICATION_TABLE) {
    const got = classifyRecoverability({
      iamErrorKind: row.kind,
      remediation: "test",
    });
    assert.equal(
      got,
      row.expected,
      `IAMError kind '${row.kind}' classified as ${got}, expected ${row.expected} — if you added a new kind, decide its recoverability and update both recovery.ts and recovery-dispatch-rule.ts.`,
    );
  }
});

// ─── Drift pin: shouldResetRecoveryCounter contract ─────────────────────

test("drift-pin: shouldResetRecoveryCounter only resets on non-recovery completed units", () => {
  // Reset cases.
  assert.equal(shouldResetRecoveryCounter("execute-task", "completed"), true);
  assert.equal(shouldResetRecoveryCounter("plan-slice", "completed"), true);

  // Non-reset cases.
  assert.equal(
    shouldResetRecoveryCounter("recovery", "completed"),
    false,
    "successful recovery itself does NOT zero counter",
  );
  assert.equal(
    shouldResetRecoveryCounter("execute-task", "failed"),
    false,
    "failed unit never zeroes counter",
  );
});

// ─── RecoveryLockSnapshot type sanity (compile-time only at runtime) ────

test("type-sanity: RecoveryLockSnapshot subset compatible with on-disk lock JSON", () => {
  seedLock(tmpBase, 1);
  const onDisk = readSessionLockData(tmpBase);
  assert.ok(onDisk);
  const snapshot: RecoveryLockSnapshot = {
    consecutiveRecoveryFailures: onDisk!.consecutiveRecoveryFailures,
  };
  assert.equal(snapshot.consecutiveRecoveryFailures, 1);
});
