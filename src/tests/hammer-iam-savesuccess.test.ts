/**
 * src/tests/hammer-iam-savesuccess.test.ts
 *
 * Contract tests for the SAVESUCCESS pillar engine (savesuccess.ts).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SAVESUCCESS_PILLARS,
  validateSavesuccess,
  parseSavesuccessFrontmatter,
  formatSavesuccessReport,
} from "../../src/iam/savesuccess.js";

import type { SavesuccessScorecard } from "../../src/iam/types.js";

// ── Pillar definition ────────────────────────────────────────────────────────

test("SAVESUCCESS_PILLARS has exactly 10 pillars", () => {
  assert.equal(SAVESUCCESS_PILLARS.length, 10);
});

// ── validateSavesuccess ──────────────────────────────────────────────────────

/** Build a scorecard where all pillars share the same score. */
function uniformScorecard(score: number): SavesuccessScorecard {
  const sc: Record<string, number> = {};
  for (const p of SAVESUCCESS_PILLARS) sc[p] = score;
  return sc as SavesuccessScorecard;
}

test("validateSavesuccess with all scores at 0.8 returns success:true, blindSpots:[]", () => {
  const result = validateSavesuccess(uniformScorecard(0.8));
  assert.ok(result.success);
  assert.deepEqual(result.blindSpots, []);
});

test("validateSavesuccess with s:0.3 returns success:false, blindSpots includes 's'", () => {
  const sc = uniformScorecard(0.8);
  sc.s = 0.3;
  const result = validateSavesuccess(sc);
  assert.ok(!result.success);
  assert.ok(result.blindSpots.includes("s"), "expected 's' in blindSpots");
});

test("Multiple blind spots accumulate correctly", () => {
  const sc = uniformScorecard(0.8);
  sc.s = 0.3;
  sc.a = 0.2;
  sc.c2 = 0.1;
  const result = validateSavesuccess(sc);
  assert.ok(!result.success);
  assert.ok(result.blindSpots.includes("s"));
  assert.ok(result.blindSpots.includes("a"));
  assert.ok(result.blindSpots.includes("c2"));
  assert.equal(result.blindSpots.length, 3);
});

test("Score exactly at 0.5 is NOT a blind spot", () => {
  const sc = uniformScorecard(0.8);
  sc.u = 0.5;
  const result = validateSavesuccess(sc);
  assert.ok(!result.blindSpots.includes("u"), "0.5 should not be a blind spot");
});

test("Score at 0.4999 IS a blind spot (strictly < 0.5)", () => {
  const sc = uniformScorecard(0.8);
  sc.u = 0.4999;
  const result = validateSavesuccess(sc);
  assert.ok(result.blindSpots.includes("u"), "0.4999 should be a blind spot");
});

// ── parseSavesuccessFrontmatter ──────────────────────────────────────────────

const validFrontmatter = {
  s: 0.8,
  a: 0.9,
  v: 0.85,
  e: 0.9,
  s2: 0.7,
  u: 0.85,
  c: 0.85,
  c2: 0.8,
  e2: 0.9,
  s3: 0.85,
};

test("parseSavesuccessFrontmatter with valid object returns ok:true scorecard", () => {
  const result = parseSavesuccessFrontmatter(validFrontmatter);
  assert.ok(result.ok, "expected ok:true");
  assert.equal(result.value.s, 0.8);
  assert.equal(result.value.a, 0.9);
});

test("parseSavesuccessFrontmatter with value outside [0,1] returns ok:false", () => {
  const result = parseSavesuccessFrontmatter({ ...validFrontmatter, s: 1.5 });
  assert.ok(!result.ok, "expected ok:false for s:1.5");
});

test("parseSavesuccessFrontmatter with negative value returns ok:false", () => {
  const result = parseSavesuccessFrontmatter({ ...validFrontmatter, a: -0.1 });
  assert.ok(!result.ok, "expected ok:false for a:-0.1");
});

test("parseSavesuccessFrontmatter with missing key returns ok:false", () => {
  const partial = { ...validFrontmatter } as Record<string, unknown>;
  delete partial["s3"];
  const result = parseSavesuccessFrontmatter(partial);
  assert.ok(!result.ok, "expected ok:false for missing key s3");
});

// ── formatSavesuccessReport ──────────────────────────────────────────────────

test("formatSavesuccessReport returns non-empty string containing pillar names", () => {
  const sc = uniformScorecard(0.8);
  const result = validateSavesuccess(sc);
  const report = formatSavesuccessReport(result);
  assert.ok(report.length > 0);
  // Check a few pillar names from SAVESUCCESS_PILLAR_NAMES appear in the report
  assert.ok(report.includes("Serendipity"), "report missing Serendipity");
  assert.ok(report.includes("Sagacity"), "report missing Sagacity");
  assert.ok(report.includes("Clarity"), "report missing Clarity");
});
