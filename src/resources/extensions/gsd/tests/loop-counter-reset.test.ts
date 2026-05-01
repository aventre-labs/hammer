/**
 * loop-counter-reset.test.ts — M002/S03/T04
 *
 * Covers the pure predicate `shouldResetRecoveryCounter` per the slice plan
 * R030 semantics:
 *   (a) successful non-recovery unit  → reset (true)
 *   (b) successful recovery unit      → DO NOT reset (false)
 *   (c) failed unit                   → DO NOT reset (false)
 *
 * Plus extra coverage for unrecognised statuses and empty unitType strings to
 * pin down the predicate's contract: only the exact pair
 * `(unitType !== "recovery", status === "completed")` resets.
 *
 * Pure leaf — runs under raw `node --test` without a TypeScript resolver hook.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { shouldResetRecoveryCounter } from "../auto/recovery-dispatch-rule.ts";

// ─── R030 acceptance cases (a)–(c) ──────────────────────────────────────────

test("(a) successful non-recovery unit → reset (true)", () => {
  assert.equal(shouldResetRecoveryCounter("execute-task", "completed"), true);
  assert.equal(shouldResetRecoveryCounter("plan-slice", "completed"), true);
  assert.equal(shouldResetRecoveryCounter("complete-slice", "completed"), true);
});

test("(b) successful recovery unit → DO NOT reset (false)", () => {
  assert.equal(shouldResetRecoveryCounter("recovery", "completed"), false);
});

test("(c) failed unit → DO NOT reset (false)", () => {
  assert.equal(shouldResetRecoveryCounter("execute-task", "failed"), false);
  assert.equal(shouldResetRecoveryCounter("plan-slice", "failed"), false);
  assert.equal(shouldResetRecoveryCounter("recovery", "failed"), false);
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

test("unrecognised status string → DO NOT reset (defensive)", () => {
  assert.equal(shouldResetRecoveryCounter("execute-task", "running"), false);
  assert.equal(shouldResetRecoveryCounter("execute-task", "skipped"), false);
  assert.equal(shouldResetRecoveryCounter("execute-task", ""), false);
});

test("empty unitType is treated as non-recovery → still reset on completion", () => {
  // Empty unitType is unexpected but if we get here with a "completed" status
  // we should still zero the counter — not treating empty as a recovery
  // unit avoids accidentally pinning the cap on instrumentation glitches.
  assert.equal(shouldResetRecoveryCounter("", "completed"), true);
});

test("unitType case-sensitivity — 'Recovery' is NOT recovery (only literal 'recovery')", () => {
  assert.equal(shouldResetRecoveryCounter("Recovery", "completed"), true);
  assert.equal(shouldResetRecoveryCounter("RECOVERY", "completed"), true);
  assert.equal(shouldResetRecoveryCounter("recovery", "completed"), false);
});
