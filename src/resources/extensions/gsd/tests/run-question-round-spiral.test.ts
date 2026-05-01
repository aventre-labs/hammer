/**
 * T02 smoke tests for runQuestionRoundSpiral — verifies:
 *   (i)   full-success path writes 10 stage files + manifest + synthesis
 *         pointer at the per-round milestone tree path,
 *   (ii)  executor failure at stage 4 returns
 *         { ok: false, failingStage: "criticality" } with no synthesis
 *         pointer written,
 *   (iii) input validation (missing roundIndex / conversationState) returns
 *         failingStage "unit-validation" without writing any artifacts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { runQuestionRoundSpiral } from "../auto/run-question-round-spiral.ts";
import type { OmegaPhasePersistenceAdapters, OmegaPhaseArtifactRecord } from "../omega-phase-artifacts.ts";
import type { OmegaRunRow } from "../gsd-db.ts";
import { gsdRoot } from "../paths.ts";

function makeAdapters(rows: OmegaPhaseArtifactRecord[] = []): OmegaPhasePersistenceAdapters {
  const omegaRows = new Map<string, OmegaRunRow>();
  return {
    atomicWrite(filePath, content) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, "utf-8");
    },
    insertOmegaRun(row) {
      omegaRows.set(row.id, row);
    },
    updateOmegaRunStatus(id, status, completedAt, error, artifactDir) {
      const existing = omegaRows.get(id);
      assert.ok(existing, `missing omega row ${id}`);
      omegaRows.set(id, {
        ...existing,
        status,
        completed_at: completedAt ?? existing.completed_at,
        error_message: error ?? existing.error_message,
        artifact_dir: artifactDir ?? existing.artifact_dir,
      });
    },
    getOmegaRun(id) {
      return omegaRows.get(id) ?? null;
    },
    insertSavesuccessResult() {
      // smoke test does not exercise SAVESUCCESS persistence
    },
    upsertOmegaPhaseArtifact(row) {
      rows.push(row);
    },
  };
}

function makeBase(t: test.TestContext): string {
  const basePath = mkdtempSync(join(tmpdir(), "run-question-round-spiral-"));
  t.after(() => rmSync(basePath, { recursive: true, force: true }));
  return basePath;
}

test("runQuestionRoundSpiral writes 10 stage files plus per-round synthesis pointer (milestone-discuss)", async (t) => {
  const basePath = makeBase(t);
  const rows: OmegaPhaseArtifactRecord[] = [];
  const adapters = makeAdapters(rows);

  let stageCalls = 0;
  const result = await runQuestionRoundSpiral({
    milestoneId: "M001",
    roundIndex: 1,
    conversationState: "User asked about authentication. Unknown: which provider. Round targets: provider preference.",
    executor: async () => {
      stageCalls += 1;
      return `canned executor output ${stageCalls}`;
    },
    basePath,
    adapters,
  });

  assert.ok(result.ok, `expected ok:true, got ${JSON.stringify(!result.ok && result)}`);
  assert.equal(stageCalls, 11, "ten canonical stages plus synthesis");
  assert.equal(result.unitType, "discuss-question-round");
  assert.equal(result.unitId, "M001/round-1");
  assert.equal(result.stageCount, 10);

  // All 10 per-stage artifacts must exist on disk under the per-round tree.
  const stagePaths = Object.values(result.manifest.stageFilePaths);
  assert.equal(stagePaths.length, 10);
  for (const stagePath of stagePaths) {
    assert.ok(existsSync(stagePath), `stage file missing: ${stagePath}`);
  }
  assert.ok(existsSync(result.manifestPath), `phase manifest missing: ${result.manifestPath}`);
  assert.ok(existsSync(result.synthesisPath), `synthesis pointer missing: ${result.synthesisPath}`);

  // Per-round path must land under the milestone tree, not the generic
  // omega/phases/<unitType>/<unitId> root. gsdRoot() resolves to .gsd or
  // .hammer depending on project layout — use it so the test works in both.
  const expectedUnitDir = join(gsdRoot(basePath), "milestones", "M001", "discuss", "round-1", "omega");
  assert.ok(
    result.artifactDir.startsWith(expectedUnitDir + "/") || result.artifactDir.startsWith(expectedUnitDir + "\\"),
    `artifactDir should sit under ${expectedUnitDir}, got ${result.artifactDir}`,
  );

  // Compact DB row must have been recorded.
  assert.equal(rows.length, 1, "expected one omega_phase_artifacts row");
  assert.equal(rows[0].unitType, "discuss-question-round");
  assert.equal(rows[0].unitId, "M001/round-1");
  assert.equal(rows[0].status, "complete");
});

test("runQuestionRoundSpiral writes per-round artifacts under the slice tree when sliceId is provided", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);

  const result = await runQuestionRoundSpiral({
    milestoneId: "M001",
    sliceId: "S01",
    roundIndex: 2,
    conversationState: "Slice discussion: contract surface for auth helper. Round targets: error envelope shape.",
    executor: async () => "ok",
    basePath,
    adapters,
  });

  assert.ok(result.ok, `expected ok:true, got ${JSON.stringify(!result.ok && result)}`);
  assert.equal(result.unitId, "M001/S01/round-2");
  const expectedUnitDir = join(gsdRoot(basePath), "milestones", "M001", "slices", "S01", "discuss", "round-2", "omega");
  assert.ok(
    result.artifactDir.startsWith(expectedUnitDir + "/") || result.artifactDir.startsWith(expectedUnitDir + "\\"),
    `artifactDir should sit under ${expectedUnitDir}, got ${result.artifactDir}`,
  );
});

test("runQuestionRoundSpiral returns structured failure when executor fails at stage 4 (criticality)", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);

  let stageCalls = 0;
  const result = await runQuestionRoundSpiral({
    milestoneId: "M001",
    roundIndex: 1,
    conversationState: "User asked about deployment. Round targets: target environment.",
    executor: async () => {
      stageCalls += 1;
      if (stageCalls === 4) throw new Error("stage four executor unavailable");
      return `canned ${stageCalls}`;
    },
    basePath,
    adapters,
  });

  assert.ok(!result.ok, "executor failure must return ok:false");
  assert.equal(result.failingStage, "criticality", "stage four is criticality");
  assert.ok(result.remediation.length > 0, "failure must carry a remediation string");
  assert.equal(result.unitId, "M001/round-1");

  // Synthesis pointer must NOT have been written when the spiral did not complete.
  const expectedSynthesisPath = join(gsdRoot(basePath), "milestones", "M001", "discuss", "round-1", "omega", "synthesis.md");
  assert.ok(!existsSync(expectedSynthesisPath), "per-round synthesis pointer must not be written on stage failure");
});

test("runQuestionRoundSpiral input validation rejects missing conversationState without writing artifacts", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);

  const result = await runQuestionRoundSpiral({
    milestoneId: "M001",
    roundIndex: 1,
    conversationState: "   ", // whitespace-only — should be treated as missing
    executor: async () => "should not run",
    basePath,
    adapters,
  });

  assert.ok(!result.ok, "empty conversationState must reject");
  assert.equal(result.failingStage, "unit-validation");
  assert.ok(/conversationState/i.test(result.remediation), "remediation should mention conversationState");

  // No artifacts must exist on disk for the would-be unit dir.
  const wouldBeUnitDir = join(gsdRoot(basePath), "milestones", "M001", "discuss", "round-1", "omega");
  assert.ok(!existsSync(wouldBeUnitDir), "no per-round artifact dir should be created on input rejection");
});

test("runQuestionRoundSpiral input validation rejects non-positive roundIndex without writing artifacts", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);

  const result = await runQuestionRoundSpiral({
    milestoneId: "M001",
    roundIndex: 0,
    conversationState: "Round 0 should not be allowed.",
    executor: async () => "should not run",
    basePath,
    adapters,
  });

  assert.ok(!result.ok, "roundIndex 0 must reject");
  assert.equal(result.failingStage, "unit-validation");
  assert.ok(/roundIndex/i.test(result.remediation), "remediation should mention roundIndex");
});
