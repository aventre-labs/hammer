import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadPhaseOmegaManifest,
  persistPhaseOmegaRun,
  validatePhaseOmegaArtifacts,
  type OmegaPhasePersistenceAdapters,
} from "../omega-phase-artifacts.ts";
import type { OmegaRunRow, SavesuccessResultRow, OmegaPhaseArtifactRecord } from "../gsd-db.ts";

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
    insertSavesuccessResult(_row: SavesuccessResultRow) {},
    upsertOmegaPhaseArtifact(row) {
      rows.push(row);
    },
  };
}

function makeBase(t: test.TestContext): { basePath: string; targetArtifactPath: string } {
  const basePath = mkdtempSync(join(tmpdir(), "omega-phase-artifacts-"));
  t.after(() => rmSync(basePath, { recursive: true, force: true }));
  const targetArtifactPath = join(basePath, ".gsd", "milestones", "M001", "M001-RESEARCH.md");
  mkdirSync(join(basePath, ".gsd", "milestones", "M001"), { recursive: true });
  writeFileSync(targetArtifactPath, "# Research\n", "utf-8");
  return { basePath, targetArtifactPath };
}

async function createCompleteManifest(t: test.TestContext) {
  const { basePath, targetArtifactPath } = makeBase(t);
  const phaseRows: OmegaPhaseArtifactRecord[] = [];
  const adapters = makeAdapters(phaseRows);
  let calls = 0;
  const result = await persistPhaseOmegaRun({
    basePath,
    unitType: "research-milestone",
    unitId: "M001",
    query: "Research M001",
    targetArtifactPath,
    executor: async () => `executor response ${++calls}`,
    adapters,
  });
  assert.ok(result.ok, `expected ok:true, got ${JSON.stringify(!result.ok && result.error)}`);
  return { manifest: result.value, targetArtifactPath, phaseRows, calls };
}

test("persistPhaseOmegaRun writes complete phase manifest and validatePhaseOmegaArtifacts accepts it", async (t) => {
  const { manifest, targetArtifactPath, phaseRows, calls } = await createCompleteManifest(t);

  assert.equal(calls, 11, "ten canonical stages plus synthesis should run");
  assert.equal(manifest.status, "complete");
  assert.equal(Object.keys(manifest.stageFilePaths).length, 10);
  assert.ok(existsSync(manifest.manifestPath));
  assert.ok(existsSync(manifest.runManifestPath));
  assert.ok(manifest.synthesisPath && existsSync(manifest.synthesisPath));
  assert.equal(phaseRows.length, 1);
  assert.equal(phaseRows[0].unitType, "research-milestone");
  assert.equal(phaseRows[0].unitId, "M001");
  assert.equal(phaseRows[0].runId, manifest.runId);

  const validation = validatePhaseOmegaArtifacts({
    manifestPath: manifest.manifestPath,
    expectedUnitType: "research-milestone",
    expectedUnitId: "M001",
    expectedTargetArtifactPath: targetArtifactPath,
  });
  assert.ok(validation.ok, `expected validation ok:true, got ${JSON.stringify(!validation.ok && validation.error)}`);
});

test("validatePhaseOmegaArtifacts fails closed when required artifacts are missing or stale", async (t) => {
  const { manifest, targetArtifactPath } = await createCompleteManifest(t);

  assert.ok(manifest.synthesisPath, "synthesis path should exist");
  unlinkSync(manifest.synthesisPath);
  const missingSynthesis = validatePhaseOmegaArtifacts({ manifestPath: manifest.manifestPath });
  assert.ok(!missingSynthesis.ok, "missing synthesis should fail validation");
  assert.equal(missingSynthesis.error.iamErrorKind, "persistence-failed");
  assert.match(missingSynthesis.error.validationGap ?? "", /synthesis file missing/);

  const parsed = JSON.parse(readFileSync(manifest.manifestPath, "utf-8"));
  const typedParsed = parsed as { targetArtifactPath: string };
  typedParsed.targetArtifactPath = join(targetArtifactPath, "stale.md");
  writeFileSync(manifest.manifestPath, `${JSON.stringify(typedParsed, null, 2)}\n`, "utf-8");
  const staleTarget = validatePhaseOmegaArtifacts({
    manifestPath: manifest.manifestPath,
    expectedTargetArtifactPath: targetArtifactPath,
  });
  assert.ok(!staleTarget.ok, "stale target path should fail validation");
  assert.match(staleTarget.error.validationGap ?? "", /target artifact path mismatch/);
});

test("persistPhaseOmegaRun records failed middle-stage runs as inspectable failed manifests", async (t) => {
  const { basePath, targetArtifactPath } = makeBase(t);
  const phaseRows: OmegaPhaseArtifactRecord[] = [];
  const adapters = makeAdapters(phaseRows);
  let calls = 0;
  const result = await persistPhaseOmegaRun({
    basePath,
    unitType: "research-milestone",
    unitId: "M001",
    query: "Research M001 failure",
    targetArtifactPath,
    executor: async () => {
      calls += 1;
      if (calls === 5) throw new Error("stage five unavailable");
      return `ok ${calls}`;
    },
    adapters,
  });

  assert.ok(!result.ok, "stage failure should return ok:false");
  assert.equal(result.error.iamErrorKind, "omega-stage-failed");
  assert.equal(phaseRows.length, 1, "failed phase row should be inspectable");
  assert.equal(phaseRows[0].status, "failed");
  assert.ok(existsSync(phaseRows[0].manifestPath));
  assert.ok(existsSync(phaseRows[0].artifactDir));
  assert.ok(existsSync(join(phaseRows[0].artifactDir, "stage-01-materiality.md")));
  assert.ok(existsSync(join(phaseRows[0].artifactDir, "stage-04-criticality.md")));
  assert.ok(!existsSync(join(phaseRows[0].artifactDir, "stage-05-connectivity.md")));

  const loaded = loadPhaseOmegaManifest(phaseRows[0].manifestPath);
  assert.ok(loaded.ok, `failed manifest should still load: ${JSON.stringify(!loaded.ok && loaded.error)}`);
  assert.equal(loaded.value.status, "failed");
  assert.match(loaded.value.diagnostics.join("\n"), /connectivity|stage five unavailable/);
});

test("persistPhaseOmegaRun rejects malformed unit metadata and executor responses", async (t) => {
  const { basePath, targetArtifactPath } = makeBase(t);
  const adapters = makeAdapters([]);

  const unknown = await persistPhaseOmegaRun({
    basePath,
    unitType: "execute-task",
    unitId: "M001/S01/T01",
    query: "bad unit",
    targetArtifactPath,
    executor: async () => "ok",
    adapters,
  });
  assert.ok(!unknown.ok, "unknown unit type should fail");
  assert.equal(unknown.error.iamErrorKind, "persistence-failed");

  const malformed = await persistPhaseOmegaRun({
    basePath,
    unitType: "research-slice",
    unitId: "S01",
    query: "bad id",
    targetArtifactPath,
    executor: async () => "ok",
    adapters,
  });
  assert.ok(!malformed.ok, "malformed unit id should fail");

  let calls = 0;
  const emptyStage = await persistPhaseOmegaRun({
    basePath,
    unitType: "research-milestone",
    unitId: "M001",
    query: "empty stage",
    targetArtifactPath,
    executor: async () => {
      calls += 1;
      return calls === 3 ? "" : "ok";
    },
    adapters: makeAdapters([]),
  });
  assert.ok(!emptyStage.ok, "empty stage response should fail");
  assert.equal(emptyStage.error.iamErrorKind, "omega-stage-failed");
  assert.match(String(emptyStage.error.cause), /interiority|non-empty string/);
});

test("loadPhaseOmegaManifest reports unreadable manifest JSON", (t) => {
  const { basePath } = makeBase(t);
  const manifestPath = join(basePath, ".gsd", "omega", "bad-manifest.json");
  mkdirSync(join(basePath, ".gsd", "omega"), { recursive: true });
  writeFileSync(manifestPath, "{not-json", "utf-8");

  const loaded = loadPhaseOmegaManifest(manifestPath);
  assert.ok(!loaded.ok, "unreadable JSON should fail");
  assert.equal(loaded.error.iamErrorKind, "persistence-failed");
  assert.equal(loaded.error.persistenceStatus, "partial");
});
