/**
 * src/tests/hammer-iam-persistence.test.ts
 *
 * Persistence tests for the IAM layer (persist.ts).
 * All DB access is replaced by stub adapters — no real database is opened.
 * Filesystem writes go to a mkdtemp temporary directory and are cleaned up
 * in t.after().
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  persistOmegaRun,
  loadOmegaRun,
  persistSavesuccessResult,
} from "../../src/iam/persist.js";

import type {
  IAMPersistAdapters,
  OmegaRunRow,
  SavesuccessResultRow,
} from "../../src/iam/persist.js";

import type { OmegaRun } from "../../src/iam/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal no-op adapter that performs real synchronous filesystem writes. */
function makeRealFsAdapters(): IAMPersistAdapters {
  return {
    atomicWrite(filePath: string, content: string) {
      writeFileSync(filePath, content, "utf-8");
    },
    insertOmegaRun(_row: OmegaRunRow) {},
    updateOmegaRunStatus(_id: string, _status: string) {},
    getOmegaRun(_id: string) { return null; },
    insertSavesuccessResult(_row: SavesuccessResultRow) {},
  };
}

/** Build a minimal complete OmegaRun for testing. */
function makeRun(overrides: Partial<OmegaRun> = {}): OmegaRun {
  return {
    id: "test-run-001",
    query: "What is the IAM kernel?",
    runes: [],
    stages: ["materiality"],
    stageResults: [
      {
        stage: {
          stageName: "materiality",
          stageNumber: 1,
          runeName: "URUZ",
          archetypeName: "The Aurochs",
          phaseLabel: "The Grounding",
          archetypePromptTemplate: "Template {query} {previous_output}",
        },
        prompt: "Built prompt",
        response: "Stage response text",
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    status: "complete",
    synthesis: "The synthesis result",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

// ── persistOmegaRun filesystem tests ────────────────────────────────────────

test("persistOmegaRun creates artifact directory and returns ok:true", async (t) => {
  const baseDir = mkdtempSync(join(tmpdir(), "iam-persist-test-"));
  t.after(() => rmSync(baseDir, { recursive: true, force: true }));

  const run = makeRun();
  const result = await persistOmegaRun(run, baseDir, makeRealFsAdapters());
  assert.ok(result.ok, `expected ok:true, got: ${JSON.stringify(!result.ok && result.error)}`);

  const artifactDir = join(baseDir, run.id);
  assert.ok(existsSync(artifactDir), "artifact directory was not created");
});

test("run-manifest.json is parseable JSON with id, query, and status:complete", async (t) => {
  const baseDir = mkdtempSync(join(tmpdir(), "iam-persist-manifest-"));
  t.after(() => rmSync(baseDir, { recursive: true, force: true }));

  const run = makeRun();
  await persistOmegaRun(run, baseDir, makeRealFsAdapters());

  const manifestPath = join(baseDir, run.id, "run-manifest.json");
  assert.ok(existsSync(manifestPath), "run-manifest.json not found");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.id, run.id);
  assert.equal(manifest.query, run.query);
  assert.equal(manifest.status, "complete");
});

test("Per-stage file stage-01-materiality.md is written", async (t) => {
  const baseDir = mkdtempSync(join(tmpdir(), "iam-persist-stages-"));
  t.after(() => rmSync(baseDir, { recursive: true, force: true }));

  const run = makeRun();
  await persistOmegaRun(run, baseDir, makeRealFsAdapters());

  const stagePath = join(baseDir, run.id, "stage-01-materiality.md");
  assert.ok(existsSync(stagePath), "stage-01-materiality.md not found");
});

test("synthesis.md is written when run.synthesis is set", async (t) => {
  const baseDir = mkdtempSync(join(tmpdir(), "iam-persist-synthesis-"));
  t.after(() => rmSync(baseDir, { recursive: true, force: true }));

  const run = makeRun({ synthesis: "The final synthesis text" });
  await persistOmegaRun(run, baseDir, makeRealFsAdapters());

  const synthPath = join(baseDir, run.id, "synthesis.md");
  assert.ok(existsSync(synthPath), "synthesis.md not found");
});

// ── loadOmegaRun ─────────────────────────────────────────────────────────────

test("loadOmegaRun with a stub adapter that returns a row returns ok:true OmegaArtifact", () => {
  const fakeRow: OmegaRunRow = {
    id: "run-fake-001",
    query: "fake query",
    persona: null,
    runes_applied: "[]",
    stages_requested: '["materiality"]',
    stage_count: 1,
    status: "complete",
    artifact_dir: "/tmp/fake",
    created_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:01:00.000Z",
    error_message: null,
  };

  const adapters = {
    getOmegaRun: (_id: string) => fakeRow,
  };

  const result = loadOmegaRun("run-fake-001", "/tmp", adapters);
  assert.ok(result.ok, `expected ok:true, got: ${JSON.stringify(!result.ok && result.error)}`);
  assert.equal(result.value.id, "run-fake-001");
  assert.equal(result.value.status, "complete");
});

test("loadOmegaRun with a stub that returns null returns persistence-failed", () => {
  const adapters = {
    getOmegaRun: (_id: string) => null,
  };

  const result = loadOmegaRun("nonexistent", "/tmp", adapters);
  assert.ok(!result.ok, "expected ok:false");
  assert.equal(result.error.iamErrorKind, "persistence-failed");
});

// ── persistSavesuccessResult ─────────────────────────────────────────────────

test("persistSavesuccessResult calls insertSavesuccessResult with expected fields", () => {
  const inserted: SavesuccessResultRow[] = [];
  const adapters = {
    insertSavesuccessResult: (row: SavesuccessResultRow) => {
      inserted.push(row);
    },
  };

  const scorecard = {
    s: 0.8, a: 0.9, v: 0.85, e: 0.9,
    s2: 0.7, u: 0.85, c: 0.85, c2: 0.8,
    e2: 0.9, s3: 0.85,
  };
  const savesuccessResult = {
    scorecard,
    blindSpots: [] as never[],
    success: true,
    validatedAt: "2026-01-01T00:00:00.000Z",
  };

  const result = persistSavesuccessResult(savesuccessResult, "target-path", adapters);
  assert.ok(result.ok, "expected ok:true");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].target_path, "target-path");
  assert.equal(inserted[0].success, 1);
  assert.equal(inserted[0].s, 0.8);
});
