import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { formatOmegaPhaseArtifactsForPrompt } from "../phase-anchor.ts";
import { persistPhaseOmegaRun, type OmegaPhasePersistenceAdapters, type OmegaPhaseUnitType } from "../omega-phase-artifacts.ts";
import type { OmegaPhaseArtifactRecord, OmegaRunRow, SavesuccessResultRow } from "../gsd-db.ts";
import { buildPlanMilestonePrompt, buildPlanSlicePrompt, buildReplanSlicePrompt } from "../auto-prompts.ts";

function makeAdapters(rows: OmegaPhaseArtifactRecord[] = []): OmegaPhasePersistenceAdapters {
  const omegaRows = new Map<string, OmegaRunRow>();
  return {
    atomicWrite(filePath, content) {
      mkdirSync(filePath.replace(/\/[^/]+$/, ""), { recursive: true });
      writeFileSync(filePath, content, "utf-8");
    },
    insertOmegaRun(row) { omegaRows.set(row.id, row); },
    updateOmegaRunStatus(id, status, completedAt, error, artifactDir) {
      const existing = omegaRows.get(id);
      assert.ok(existing);
      omegaRows.set(id, { ...existing, status, completed_at: completedAt ?? existing.completed_at, error_message: error ?? existing.error_message, artifact_dir: artifactDir ?? existing.artifact_dir });
    },
    getOmegaRun(id) { return omegaRows.get(id) ?? null; },
    insertSavesuccessResult(_row: SavesuccessResultRow) {},
    upsertOmegaPhaseArtifact(row) { rows.push(row); },
  };
}

function makeBase(t: test.TestContext): string {
  const base = mkdtempSync(join(tmpdir(), "omega-phase-context-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
  writeFileSync(join(base, ".gsd", "milestones", "M001", "M001-CONTEXT.md"), "# Context\n", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "M001-RESEARCH.md"), "# Research\n", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "M001-ROADMAP.md"), "# Roadmap\n\n## Slices\n\n- [ ] **S01: First** `risk:low` `depends:[]`\n", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-RESEARCH.md"), "# Slice Research\n", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md"), "# Slice Plan\n\n### T01: Task\n", "utf-8");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks", "T01-SUMMARY.md"), "---\nid: T01\nblocker_discovered: true\n---\n# Blocker\n", "utf-8");
  return base;
}

async function writeOmega(base: string, unitType: OmegaPhaseUnitType, unitId: string, targetArtifactPath: string): Promise<string> {
  const result = await persistPhaseOmegaRun({
    basePath: base,
    unitType,
    unitId,
    query: `Govern ${unitType}`,
    targetArtifactPath,
    executor: async () => "native omega output",
    adapters: makeAdapters(),
  });
  assert.ok(result.ok, JSON.stringify(!result.ok && result.error));
  return result.value.manifestPath;
}

test("compact Omega routing includes synthesis and stage paths without stage bodies", async (t) => {
  const base = makeBase(t);
  const target = join(base, ".gsd", "milestones", "M001", "M001-RESEARCH.md");
  const manifestPath = await writeOmega(base, "research-milestone", "M001", target);

  const block = formatOmegaPhaseArtifactsForPrompt(base, [{ unitType: "research-milestone", unitId: "M001", expectedTargetArtifactPath: target }]);
  assert.ok(block);
  assert.match(block!, /Omega Phase Artifact Context/);
  assert.match(block!, /Run ID:/);
  assert.match(block!, /Manifest path:/);
  assert.match(block!, /Target artifact path:/);
  assert.match(block!, /Synthesis path:/);
  assert.match(block!, /stage-01-materiality\.md/);
  assert.match(block!, /stage-10-continuity\.md/);
  assert.match(block!, /native omega output/);
  assert.match(block!, /Full verbose Omega stage bodies are durable on disk/);
  assert.ok(block!.includes(manifestPath.replace(`${base}/`, "")));
  assert.ok(!block!.includes("## materiality"), "full stage markdown body must not be inlined");
});

test("compact Omega routing emits diagnostics for missing or malformed manifests", async (t) => {
  const base = makeBase(t);
  const target = join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-RESEARCH.md");

  const missing = formatOmegaPhaseArtifactsForPrompt(base, [{ unitType: "research-slice", unitId: "M001/S01", expectedTargetArtifactPath: target }]);
  assert.match(missing ?? "", /omitted — no upstream Omega phase manifest was found/);

  const manifestPath = await writeOmega(base, "research-slice", "M001/S01", target);
  rmSync(manifestPath.replace(/phase-manifest\.json$/, "synthesis.md"), { force: true });
  const malformed = formatOmegaPhaseArtifactsForPrompt(base, [{ unitType: "research-slice", unitId: "M001/S01", expectedTargetArtifactPath: target }]);
  assert.match(malformed ?? "", /omitted — upstream Omega phase manifest is malformed or stale/);
  assert.match(malformed ?? "", /synthesis file missing/);
});

test("planning prompt builders route upstream Omega context compactly", async (t) => {
  const base = makeBase(t);
  await writeOmega(base, "research-milestone", "M001", join(base, ".gsd", "milestones", "M001", "M001-RESEARCH.md"));
  await writeOmega(base, "research-slice", "M001/S01", join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-RESEARCH.md"));
  await writeOmega(base, "plan-slice", "M001/S01", join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md"));

  const milestonePrompt = await buildPlanMilestonePrompt("M001", "Test", base, "minimal");
  assert.match(milestonePrompt, /Milestone research Omega/);
  assert.match(milestonePrompt, /stage-01-materiality\.md/);
  assert.ok(!milestonePrompt.includes("## materiality"));

  const slicePrompt = await buildPlanSlicePrompt("M001", "Test", "S01", "First", base, "minimal");
  assert.match(slicePrompt, /Slice research Omega/);
  assert.match(slicePrompt, /stage-10-continuity\.md/);
  assert.ok(!slicePrompt.includes("## continuity"));

  const replanPrompt = await buildReplanSlicePrompt("M001", "Test", "S01", "First", base);
  assert.match(replanPrompt, /Current slice plan Omega/);
  assert.match(replanPrompt, /stage-01-materiality\.md/);
});
