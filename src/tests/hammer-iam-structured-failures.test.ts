/**
 * src/tests/hammer-iam-structured-failures.test.ts
 *
 * Structural guarantee tests for IAMError shape and failure paths across all
 * IAM kernel modules (omega.ts, rune-registry.ts, savesuccess.ts, persist.ts).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { executeOmegaSpiral } from "../../src/iam/omega.js";
import { validateRuneNames } from "../../src/iam/rune-registry.js";
import { parseSavesuccessFrontmatter } from "../../src/iam/savesuccess.js";
import { loadOmegaRun } from "../../src/iam/persist.js";

import type { IAMError } from "../../src/iam/types.js";

// ── Structural helper ────────────────────────────────────────────────────────

/** Assert that an IAMError has all mandatory fields populated. */
function assertValidIAMError(error: IAMError, context: string): void {
  assert.ok(
    typeof error.iamErrorKind === "string" && error.iamErrorKind.length > 0,
    `${context}: iamErrorKind must be a non-empty string`,
  );
  assert.ok(
    typeof error.remediation === "string" && error.remediation.length > 0,
    `${context}: remediation must be a non-empty string`,
  );
}

// ── omega-stage-failed ───────────────────────────────────────────────────────

test("executeOmegaSpiral with rejecting executor returns omega-stage-failed error", async () => {
  const failing = () => Promise.reject(new Error("simulated executor failure"));
  const result = await executeOmegaSpiral({
    query: "failure test",
    executor: failing,
  });

  assert.ok(!result.ok, "expected ok:false");
  assert.equal(result.error.iamErrorKind, "omega-stage-failed");
  assert.ok(
    result.error.stage !== undefined,
    "error.stage should be set when a specific stage fails",
  );
  assert.ok(
    typeof result.error.remediation === "string" && result.error.remediation.length > 0,
    "error.remediation should be non-empty",
  );
  assertValidIAMError(result.error, "executeOmegaSpiral failure");
});

// ── unknown-rune ─────────────────────────────────────────────────────────────

test("validateRuneNames(['FAKE']) returns unknown-rune error with runeName-like content and remediation", () => {
  const result = validateRuneNames(["FAKE"]);

  assert.ok(!result.ok, "expected ok:false");
  assert.equal(result.error.iamErrorKind, "unknown-rune");
  assert.ok(
    typeof result.error.remediation === "string" && result.error.remediation.length > 0,
    "error.remediation should be non-empty",
  );
  // The remediation text should mention the unknown rune name
  assert.ok(
    result.error.remediation.includes("FAKE"),
    "remediation should reference the unknown rune name FAKE",
  );
  assertValidIAMError(result.error, "validateRuneNames unknown-rune");
});

// ── savesuccess-blind-spot ───────────────────────────────────────────────────

test("parseSavesuccessFrontmatter with s:1.5 returns savesuccess-blind-spot error with remediation", () => {
  const result = parseSavesuccessFrontmatter({
    s: 1.5, a: 0.9, v: 0.85, e: 0.9,
    s2: 0.7, u: 0.85, c: 0.85, c2: 0.8,
    e2: 0.9, s3: 0.85,
  });

  assert.ok(!result.ok, "expected ok:false");
  assert.equal(result.error.iamErrorKind, "savesuccess-blind-spot");
  assert.ok(
    typeof result.error.remediation === "string" && result.error.remediation.length > 0,
    "error.remediation should be non-empty",
  );
  assertValidIAMError(result.error, "parseSavesuccessFrontmatter out-of-range");
});

// ── persistence-failed ───────────────────────────────────────────────────────

test("loadOmegaRun with non-existent id returns persistence-failed error with remediation", () => {
  const adapters = {
    getOmegaRun: (_id: string) => null,
  };

  const result = loadOmegaRun("nonexistent-id", "/tmp", adapters);

  assert.ok(!result.ok, "expected ok:false");
  assert.equal(result.error.iamErrorKind, "persistence-failed");
  assert.ok(
    typeof result.error.remediation === "string" && result.error.remediation.length > 0,
    "error.remediation should be non-empty",
  );
  assertValidIAMError(result.error, "loadOmegaRun not-found");
});

// ── Cross-module structural guarantee ────────────────────────────────────────

test("All IAMErrors sampled here include non-empty remediation (structural guarantee)", async () => {
  const errors: Array<{ source: string; error: IAMError }> = [];

  // 1. omega-stage-failed
  const omegaResult = await executeOmegaSpiral({
    query: "structural test",
    executor: () => Promise.reject(new Error("x")),
  });
  if (!omegaResult.ok) errors.push({ source: "omega", error: omegaResult.error });

  // 2. unknown-rune
  const runeResult = validateRuneNames(["NOT_A_RUNE"]);
  if (!runeResult.ok) errors.push({ source: "rune", error: runeResult.error });

  // 3. savesuccess-blind-spot (missing key)
  const ssResult = parseSavesuccessFrontmatter({ s: 0.8 });
  if (!ssResult.ok) errors.push({ source: "savesuccess", error: ssResult.error });

  // 4. persistence-failed
  const persistResult = loadOmegaRun("x", "/tmp", { getOmegaRun: () => null });
  if (!persistResult.ok) errors.push({ source: "persist", error: persistResult.error });

  // We expect exactly 4 errors
  assert.equal(errors.length, 4, "Expected exactly 4 errors from four failure paths");

  for (const { source, error } of errors) {
    assertValidIAMError(error, source);
  }
});
