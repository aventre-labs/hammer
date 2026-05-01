/**
 * T02 smoke test for runPhaseSpiral — verifies the helper writes 10
 * per-stage spiral artifacts plus an aggregate artifact whose YAML
 * frontmatter carries `runId`, `manifestPath`, and 10 stage links, and that
 * a mid-stage executor failure returns a structured failure payload.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { runPhaseSpiral } from "../auto/run-phase-spiral.ts";
import type { OmegaPhasePersistenceAdapters } from "../omega-phase-artifacts.ts";
import type { OmegaRunRow, OmegaPhaseArtifactRecord } from "../gsd-db.ts";

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
  const basePath = mkdtempSync(join(tmpdir(), "run-phase-spiral-"));
  t.after(() => rmSync(basePath, { recursive: true, force: true }));
  return basePath;
}

test("runPhaseSpiral writes 10 stage files plus aggregate frontmatter for slice-planning", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);
  const targetArtifactPath = join(basePath, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md");

  let stageCalls = 0;
  const result = await runPhaseSpiral({
    phase: "slice-planning",
    milestoneId: "M001",
    sliceId: "S01",
    query: "Plan slice S01",
    executor: async () => {
      stageCalls += 1;
      return `canned executor output ${stageCalls}`;
    },
    basePath,
    targetArtifactPath,
    adapters,
  });

  assert.ok(result.ok, `expected ok:true, got ${JSON.stringify(!result.ok && result)}`);
  assert.equal(stageCalls, 11, "ten canonical stages plus synthesis");
  assert.equal(result.unitType, "plan-slice");
  assert.equal(result.unitId, "M001/S01");
  assert.equal(result.stageCount, 10);

  // Per-stage artifacts must exist on disk.
  const stagePaths = Object.values(result.manifest.stageFilePaths);
  assert.equal(stagePaths.length, 10);
  for (const stagePath of stagePaths) {
    assert.ok(existsSync(stagePath), `stage file missing: ${stagePath}`);
  }
  assert.ok(existsSync(result.manifestPath), `phase manifest missing: ${result.manifestPath}`);

  // Aggregate artifact frontmatter must contain runId, manifestPath, 10 stage links.
  assert.ok(existsSync(targetArtifactPath), `aggregate artifact missing: ${targetArtifactPath}`);
  const aggregate = readFileSync(targetArtifactPath, "utf-8");
  assert.ok(aggregate.startsWith("---\n"), "aggregate must lead with YAML frontmatter");
  const frontmatterEnd = aggregate.indexOf("\n---\n", 4);
  assert.ok(frontmatterEnd > 0, "aggregate frontmatter must close with a --- delimiter");
  const frontmatter = aggregate.slice(0, frontmatterEnd);
  assert.match(frontmatter, new RegExp(`runId: ${result.runId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`), "frontmatter must record runId");
  assert.match(frontmatter, /manifestPath: /, "frontmatter must record manifestPath");
  const stageLinkMatches = frontmatter.match(/  - stage: /g) ?? [];
  assert.equal(stageLinkMatches.length, 10, "frontmatter must list 10 stage links");
});

test("runPhaseSpiral returns structured failure when executor fails mid-spiral", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);
  const targetArtifactPath = join(basePath, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md");

  let stageCalls = 0;
  const result = await runPhaseSpiral({
    phase: "slice-planning",
    milestoneId: "M001",
    sliceId: "S01",
    query: "Plan slice S01 (failure smoke)",
    executor: async () => {
      stageCalls += 1;
      if (stageCalls === 4) throw new Error("stage four executor unavailable");
      return `canned ${stageCalls}`;
    },
    basePath,
    targetArtifactPath,
    adapters,
  });

  assert.ok(!result.ok, "executor failure must return ok:false");
  assert.equal(result.failingStage, "criticality", "stage four is criticality");
  assert.ok(result.remediation.length > 0, "failure must carry a remediation string");
  assert.ok(!existsSync(targetArtifactPath), "aggregate artifact must not be written on failure");
});

test("runPhaseSpiral validates phase scope (slice-planning requires sliceId)", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);
  const targetArtifactPath = join(basePath, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md");

  const result = await runPhaseSpiral({
    phase: "slice-planning",
    milestoneId: "M001",
    // sliceId omitted on purpose
    query: "Plan slice without slice id",
    executor: async () => "should not run",
    basePath,
    targetArtifactPath,
    adapters,
  });

  assert.ok(!result.ok, "missing sliceId on slice-scoped phase must fail");
  assert.equal(result.failingStage, "unit-validation");
});

test("runPhaseSpiral writes aggregate for milestone-scoped roadmap-reassess phase", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);
  const targetArtifactPath = join(basePath, ".gsd", "milestones", "M001", "M001-ROADMAP.md");

  const result = await runPhaseSpiral({
    phase: "roadmap-reassess",
    milestoneId: "M001",
    query: "Reassess M001 roadmap",
    executor: async () => "ok",
    basePath,
    targetArtifactPath,
    adapters,
  });

  assert.ok(result.ok, `expected ok:true, got ${JSON.stringify(!result.ok && result)}`);
  assert.equal(result.unitType, "reassess-roadmap");
  assert.equal(result.unitId, "M001");
  assert.ok(existsSync(targetArtifactPath));
});
