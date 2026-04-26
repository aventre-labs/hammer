/**
 * src/tests/hammer-iam-rune-contract.test.ts
 *
 * Contract tests for the governance rune registry (rune-registry.ts).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  listRunes,
  getRune,
  validateRuneNames,
} from "../../src/iam/rune-registry.js";

// ── Registry completeness ────────────────────────────────────────────────────

test("listRunes returns exactly 12 runes", () => {
  assert.equal(listRunes().length, 12);
});

test("All 12 expected rune names are present", () => {
  const expected = [
    "RIGOR",
    "HUMAN",
    "FORGE",
    "IMAGINATION",
    "RISK",
    "STEWARDSHIP",
    "MEANING",
    "CLARITY",
    "INSIGHT",
    "GROUNDING",
    "CONVERGENCE",
    "PRAXIS",
  ];
  const names = listRunes().map((r) => r.runeName);
  for (const name of expected) {
    assert.ok(names.includes(name), `Missing rune: ${name}`);
  }
});

test("Each rune has non-empty obligation, primaryArtifact, minimumBar, exitCriteria", () => {
  for (const rune of listRunes()) {
    assert.ok(
      rune.obligation.length > 0,
      `${rune.runeName}: empty obligation`,
    );
    assert.ok(
      rune.primaryArtifact.length > 0,
      `${rune.runeName}: empty primaryArtifact`,
    );
    assert.ok(
      rune.minimumBar.length > 0,
      `${rune.runeName}: empty minimumBar`,
    );
    assert.ok(
      rune.exitCriteria.length > 0,
      `${rune.runeName}: empty exitCriteria`,
    );
  }
});

// ── Direct lookup ────────────────────────────────────────────────────────────

test("getRune('RIGOR') returns the RIGOR contract", () => {
  const rune = getRune("RIGOR");
  assert.equal(rune.runeName, "RIGOR");
});

// ── validateRuneNames ────────────────────────────────────────────────────────

test("validateRuneNames with valid names returns ok:true", () => {
  const result = validateRuneNames(["RIGOR", "HUMAN"]);
  assert.ok(result.ok);
  assert.deepEqual(result.value, ["RIGOR", "HUMAN"]);
});

test("validateRuneNames with unknown rune returns ok:false with unknown-rune", () => {
  const result = validateRuneNames(["UNKNOWN_RUNE"]);
  assert.ok(!result.ok);
  assert.equal(result.error.iamErrorKind, "unknown-rune");
});

test("validateRuneNames with 4 runes returns ok:false with rune-validation-failed", () => {
  const result = validateRuneNames(["RIGOR", "HUMAN", "FORGE", "RISK"]);
  assert.ok(!result.ok);
  assert.equal(result.error.iamErrorKind, "rune-validation-failed");
});

test("validateRuneNames with exactly 3 valid runes returns ok:true", () => {
  const result = validateRuneNames(["RIGOR", "HUMAN", "FORGE"]);
  assert.ok(result.ok);
  assert.equal(result.value.length, 3);
});
