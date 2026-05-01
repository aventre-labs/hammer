/**
 * recovery-verdict.test.ts — M002/S03/T02
 *
 * Covers every behavior bullet in the parseRecoveryVerdict contract:
 *   1. strict fix-applied
 *   2. strict blocker-filed (valid path)
 *   3. strict blocker-filed (invalid path — reclassifies as malformed)
 *   4. strict give-up
 *   5. no marker at all → malformed without raw
 *   6. loose marker without strict payload → malformed with raw
 *   7. loose marker with garbled payload → malformed with raw
 *   8. multiple strict verdicts → last wins
 *   9. oversized summary → truncated to 400 chars
 *  10. embedded in larger message stream with surrounding text
 *  11. leading + trailing whitespace tolerance
 *  12. unicode in summary preserved
 *
 * The parser has no external dependencies, so this test runs cleanly via
 * raw `node --test` without a TypeScript resolver hook.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRecoveryVerdict,
  type RecoveryVerdict,
} from "../auto/recovery-verdict.ts";

test("strict fix-applied → typed verdict with summary", () => {
  const stream = "RECOVERY_VERDICT: fix-applied; summary=Repaired the verifier guard\n";
  const result = parseRecoveryVerdict(stream);
  assert.deepEqual(result, {
    kind: "fix-applied",
    summary: "Repaired the verifier guard",
  });
});

test("strict blocker-filed with valid path → typed verdict with blockerPath", () => {
  const stream =
    "RECOVERY_VERDICT: blocker-filed; blockerPath=.gsd/milestones/M002/slices/S03/BLOCKER.md\n";
  const result = parseRecoveryVerdict(stream);
  assert.deepEqual(result, {
    kind: "blocker-filed",
    blockerPath: ".gsd/milestones/M002/slices/S03/BLOCKER.md",
  });
});

test("strict blocker-filed with invalid path → reclassifies as malformed with raw line", () => {
  const stream = "RECOVERY_VERDICT: blocker-filed; blockerPath=/tmp/random.md\n";
  const result = parseRecoveryVerdict(stream);
  assert.equal(result.kind, "malformed");
  assert.equal(
    (result as Extract<RecoveryVerdict, { kind: "malformed" }>).raw,
    "RECOVERY_VERDICT: blocker-filed; blockerPath=/tmp/random.md",
  );
});

test("strict give-up → typed verdict with reason", () => {
  const stream = "RECOVERY_VERDICT: give-up; reason=Cap reached, escalating to operator\n";
  const result = parseRecoveryVerdict(stream);
  assert.deepEqual(result, {
    kind: "give-up",
    reason: "Cap reached, escalating to operator",
  });
});

test("no marker at all → malformed without raw", () => {
  const stream = "Some agent prose with no verdict at all.\nNothing to see here.\n";
  const result = parseRecoveryVerdict(stream);
  assert.deepEqual(result, { kind: "malformed" });
});

test("loose marker without payload → malformed with raw line captured", () => {
  const stream = "I attempted recovery.\nRECOVERY_VERDICT:\nNo more to say.\n";
  const result = parseRecoveryVerdict(stream);
  assert.equal(result.kind, "malformed");
  assert.equal(
    (result as Extract<RecoveryVerdict, { kind: "malformed" }>).raw,
    "RECOVERY_VERDICT:",
  );
});

test("loose marker with garbled payload → malformed with raw line captured", () => {
  const stream = "RECOVERY_VERDICT: maybe-i-fixed-it (notes follow)\n";
  const result = parseRecoveryVerdict(stream);
  assert.equal(result.kind, "malformed");
  assert.equal(
    (result as Extract<RecoveryVerdict, { kind: "malformed" }>).raw,
    "RECOVERY_VERDICT: maybe-i-fixed-it (notes follow)",
  );
});

test("multiple strict verdicts → last wins", () => {
  const stream = [
    "RECOVERY_VERDICT: give-up; reason=draft attempt 1",
    "RECOVERY_VERDICT: fix-applied; summary=actually I fixed it",
    "",
  ].join("\n");
  const result = parseRecoveryVerdict(stream);
  assert.deepEqual(result, {
    kind: "fix-applied",
    summary: "actually I fixed it",
  });
});

test("oversized summary → no captured field exceeds the truncation cap", () => {
  // 2000 'x' chars on a single line exceeds the strict regex's {1,400} bound,
  // so the strict form does NOT match. The line still triggers the loose
  // marker branch, falling back to malformed-with-raw. The invariant we
  // assert is that no captured value (summary or raw) ever exceeds 400 chars.
  const big = "x".repeat(2000);
  const stream = `RECOVERY_VERDICT: fix-applied; summary=${big}\n`;
  const result = parseRecoveryVerdict(stream);

  if (result.kind === "fix-applied") {
    assert.ok(result.summary.length <= 400, "summary must be ≤ 400 chars");
  } else {
    assert.equal(result.kind, "malformed");
    const raw = (result as Extract<RecoveryVerdict, { kind: "malformed" }>).raw;
    assert.ok(raw !== undefined, "raw line must be captured for the marker line");
    assert.ok(raw!.length <= 400, "raw line must be ≤ 400 chars");
  }
});

test("embedded in larger message stream with surrounding text → strict match still wins", () => {
  const stream = [
    "## Recovery attempt 1",
    "I read the failing test, identified the wrong import path,",
    "and updated the source. Verification now passes locally.",
    "",
    "RECOVERY_VERDICT: fix-applied; summary=updated import path in module Y",
    "",
    "(end of recovery message)",
  ].join("\n");
  const result = parseRecoveryVerdict(stream);
  assert.deepEqual(result, {
    kind: "fix-applied",
    summary: "updated import path in module Y",
  });
});

test("leading + trailing whitespace tolerance around the marker line", () => {
  const stream = "\n\n   RECOVERY_VERDICT:   give-up ;  reason = Out of options   \n\n";
  const result = parseRecoveryVerdict(stream);
  assert.deepEqual(result, {
    kind: "give-up",
    reason: "Out of options",
  });
});

test("unicode in summary preserved verbatim", () => {
  const summary = "修复了 the regex — édge cäses 🛠️ ok";
  const stream = `RECOVERY_VERDICT: fix-applied; summary=${summary}\n`;
  const result = parseRecoveryVerdict(stream);
  assert.deepEqual(result, {
    kind: "fix-applied",
    summary,
  });
});

test("empty string input → malformed without raw", () => {
  const result = parseRecoveryVerdict("");
  assert.deepEqual(result, { kind: "malformed" });
});
