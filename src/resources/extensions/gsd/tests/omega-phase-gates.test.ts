import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildLoopRemediationSteps,
  diagnoseExpectedArtifact,
  verifyExpectedArtifact,
} from "../auto-recovery.ts";
import { persistPhaseOmegaRun } from "../omega-phase-artifacts.ts";
import { drainLogs, setStderrLoggingEnabled, _resetLogs } from "../workflow-logger.ts";
import type { OmegaPhasePersistenceAdapters, OmegaPhaseUnitType } from "../omega-phase-artifacts.ts";
import type { OmegaPhaseArtifactRecord, OmegaRunRow, SavesuccessResultRow } from "../gsd-db.ts";

const previousStderr = setStderrLoggingEnabled(false);
process.once("exit", () => setStderrLoggingEnabled(previousStderr));

function makeAdapters(): OmegaPhasePersistenceAdapters {
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
    upsertOmegaPhaseArtifact(_row: OmegaPhaseArtifactRecord) {},
  };
}

function makeBase(t: test.TestContext): string {
  const base = mkdtempSync(join(tmpdir(), "omega-phase-gates-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function artifactPath(base: string, unitType: string, unitId: string): string {
  if (unitType === "research-milestone") return join(base, ".gsd", "milestones", unitId, `${unitId}-RESEARCH.md`);
  if (unitType === "plan-milestone") return join(base, ".gsd", "milestones", unitId, `${unitId}-ROADMAP.md`);
  const [mid, sid] = unitId.split("/");
  if (!mid || !sid) throw new Error(`bad unit id ${unitId}`);
  if (unitType === "research-slice") return join(base, ".gsd", "milestones", mid, "slices", sid, `${sid}-RESEARCH.md`);
  if (unitType === "plan-slice" || unitType === "refine-slice") return join(base, ".gsd", "milestones", mid, "slices", sid, `${sid}-PLAN.md`);
  if (unitType === "replan-slice") return join(base, ".gsd", "milestones", mid, "slices", sid, `${sid}-REPLAN.md`);
  throw new Error(`unsupported unit type ${unitType}`);
}

function normalArtifactContent(unitType: string): string {
  if (unitType === "plan-milestone") {
    return [
      "# M001: Roadmap",
      "",
      "**Vision:** govern planning.",
      "",
      "## Slices",
      "",
      "- [ ] **S01: First slice** `risk:low` `depends:[]`",
      "  > After this: a real slice exists.",
      "",
    ].join("\n");
  }
  if (unitType === "plan-slice" || unitType === "refine-slice") {
    return [
      "# S01: Plan",
      "",
      "## Tasks",
      "",
      "- [ ] **T01: Do work** `est:10m`",
      "",
    ].join("\n");
  }
  if (unitType === "replan-slice") return "# Replan\n\nUpdated plan.\n";
  return "# Research\n\nFindings.\n";
}

function writeNormalArtifact(base: string, unitType: string, unitId: string): string {
  const path = artifactPath(base, unitType, unitId);
  writeFile(path, normalArtifactContent(unitType));
  if (unitType === "plan-slice" || unitType === "refine-slice") {
    const [mid, sid] = unitId.split("/");
    writeFile(join(base, ".gsd", "milestones", mid!, "slices", sid!, "tasks", "T01-PLAN.md"), "# T01 Plan\n");
  }
  return path;
}

async function writeValidOmega(base: string, unitType: string, unitId: string, targetArtifactPath: string): Promise<string> {
  const persisted = await persistPhaseOmegaRun({
    basePath: base,
    unitType: unitType as OmegaPhaseUnitType,
    unitId,
    query: `Govern ${unitType} ${unitId}`,
    targetArtifactPath,
    executor: async () => "omega stage output",
    adapters: makeAdapters(),
  });
  assert.ok(persisted.ok, `phase persistence should succeed: ${JSON.stringify(!persisted.ok && persisted.error)}`);
  return persisted.value.manifestPath;
}

async function assertGovernedPasses(unitType: string, unitId: string, t: test.TestContext): Promise<void> {
  const base = makeBase(t);
  const target = writeNormalArtifact(base, unitType, unitId);
  const manifestPath = await writeValidOmega(base, unitType, unitId, target);

  _resetLogs();
  assert.equal(verifyExpectedArtifact(unitType, unitId, base), true, `${unitType} should pass with target + Omega artifacts`);
  assert.equal(existsSync(manifestPath), true);
}

async function assertNormalArtifactAloneFails(unitType: string, unitId: string, t: test.TestContext): Promise<void> {
  const base = makeBase(t);
  writeNormalArtifact(base, unitType, unitId);

  _resetLogs();
  assert.equal(verifyExpectedArtifact(unitType, unitId, base), false, `${unitType} must fail without Omega manifest`);
  const message = drainLogs().map((entry) => entry.message).join("\n");
  assert.match(message, /Omega phase verification failed/);
  assert.match(message, /phase-manifest\.json|omega\/phases/);
}

test("governed milestone and slice phases fail when only normal artifacts exist", async (t) => {
  await assertNormalArtifactAloneFails("research-milestone", "M001", t);
  await assertNormalArtifactAloneFails("research-slice", "M001/S01", t);
  await assertNormalArtifactAloneFails("plan-milestone", "M001", t);
  await assertNormalArtifactAloneFails("plan-slice", "M001/S01", t);
});

test("complete target artifact plus valid Omega manifest and run artifacts passes governed verification", async (t) => {
  await assertGovernedPasses("research-milestone", "M001", t);
  await assertGovernedPasses("research-slice", "M001/S01", t);
  await assertGovernedPasses("plan-milestone", "M001", t);
  await assertGovernedPasses("plan-slice", "M001/S01", t);
});

test("governed verification fails with actionable diagnostics for stale and partial Omega artifacts", async (t) => {
  const base = makeBase(t);
  const target = writeNormalArtifact(base, "research-slice", "M001/S01");
  const manifestPath = await writeValidOmega(base, "research-slice", "M001/S01", target);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { stageFilePaths: Record<string, string>; unitId: string };
  unlinkSync(manifest.stageFilePaths.materiality!);

  _resetLogs();
  assert.equal(verifyExpectedArtifact("research-slice", "M001/S01", base), false);
  const missingStageLog = drainLogs().map((entry) => entry.message).join("\n");
  assert.match(missingStageLog, /stage file missing for materiality/);
  assert.match(missingStageLog, /run-manifest\.json/);
  assert.match(missingStageLog, /synthesis\.md/);

  manifest.unitId = "M001/S02";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  _resetLogs();
  assert.equal(verifyExpectedArtifact("research-slice", "M001/S01", base), false);
  const staleLog = drainLogs().map((entry) => entry.message).join("\n");
  assert.match(staleLog, /unit id mismatch/);
});

test("refine-slice and replan-slice are gated through their own Omega manifests", async (t) => {
  const refineBase = makeBase(t);
  const refineTarget = writeNormalArtifact(refineBase, "refine-slice", "M001/S01");
  _resetLogs();
  assert.equal(verifyExpectedArtifact("refine-slice", "M001/S01", refineBase), false, "refine-slice normal PLAN alone fails");
  await writeValidOmega(refineBase, "refine-slice", "M001/S01", refineTarget);
  assert.equal(verifyExpectedArtifact("refine-slice", "M001/S01", refineBase), true, "refine-slice accepts valid refine-slice Omega manifest");

  const replanBase = makeBase(t);
  const replanTarget = writeNormalArtifact(replanBase, "replan-slice", "M001/S01");
  _resetLogs();
  assert.equal(verifyExpectedArtifact("replan-slice", "M001/S01", replanBase), false, "replan-slice normal REPLAN alone fails");
  await writeValidOmega(replanBase, "replan-slice", "M001/S01", replanTarget);
  assert.equal(verifyExpectedArtifact("replan-slice", "M001/S01", replanBase), true, "replan-slice accepts valid replan-slice Omega manifest targeting REPLAN");
});

test("parallel research requires every ready slice to have research and a valid Omega manifest", async (t) => {
  const base = makeBase(t);
  writeFile(join(base, ".gsd", "milestones", "M001", "M001-ROADMAP.md"), [
    "# M001: Parallel",
    "",
    "## Slices",
    "",
    "- [ ] **S01: Alpha** `risk:low` `depends:[]`",
    "- [ ] **S02: Beta** `risk:low` `depends:[]`",
    "",
  ].join("\n"));

  const s01Target = writeNormalArtifact(base, "research-slice", "M001/S01");
  const s02Target = writeNormalArtifact(base, "research-slice", "M001/S02");
  await writeValidOmega(base, "research-slice", "M001/S01", s01Target);
  _resetLogs();
  assert.equal(verifyExpectedArtifact("research-slice", "M001/parallel-research", base), false, "missing S02 Omega manifest fails sentinel");
  assert.match(drainLogs().map((entry) => entry.message).join("\n"), /slice S02 Omega phase verification failed/);

  await writeValidOmega(base, "research-slice", "M001/S02", s02Target);
  assert.equal(verifyExpectedArtifact("research-slice", "M001/parallel-research", base), true, "each ready slice has research + Omega manifest");
});

test("parallel research placeholder blockers do not satisfy governed completion", (t) => {
  const base = makeBase(t);
  writeFile(join(base, ".gsd", "milestones", "M001", "M001-ROADMAP.md"), [
    "# M001: Parallel",
    "",
    "## Slices",
    "",
    "- [ ] **S01: Alpha** `risk:low` `depends:[]`",
    "- [ ] **S02: Beta** `risk:low` `depends:[]`",
    "",
  ].join("\n"));
  writeFile(join(base, ".gsd", "milestones", "M001", "M001-PARALLEL-BLOCKER.md"), "# BLOCKER — timeout\n");

  _resetLogs();
  assert.equal(verifyExpectedArtifact("research-slice", "M001/parallel-research", base), false);
  assert.match(drainLogs().map((entry) => entry.message).join("\n"), /PARALLEL-BLOCKER.*not.*governed completion/i);
});

test("diagnostics and remediation name Omega manifest/run/stage requirements", (t) => {
  const base = makeBase(t);
  writeNormalArtifact(base, "plan-slice", "M001/S01");

  const diagnostic = diagnoseExpectedArtifact("plan-slice", "M001/S01", base);
  assert.match(diagnostic ?? "", /Omega phase manifest/);
  assert.match(diagnostic ?? "", /phase-manifest\.json/);
  assert.match(diagnostic ?? "", /run-manifest\.json/);
  assert.match(diagnostic ?? "", /stage-01-materiality\.md/);
  assert.match(diagnostic ?? "", /synthesis\.md/);

  const remediation = buildLoopRemediationSteps("plan-slice", "M001/S01", base);
  assert.match(remediation ?? "", /hammer_canonical_spiral/);
  assert.match(remediation ?? "", /unitType.*plan-slice/s);
  assert.match(remediation ?? "", /targetArtifactPath/);
  assert.match(remediation ?? "", /gsd_plan_slice/);
  assert.match(remediation ?? "", /phase-manifest\.json/);
});

test("manifest paths are lightweight and path-based for many ready slices", async (t) => {
  const base = makeBase(t);
  const roadmapLines = ["# M001: Many", "", "## Slices", ""];
  for (let index = 1; index <= 12; index += 1) {
    const sid = `S${String(index).padStart(2, "0")}`;
    roadmapLines.push(`- [ ] **${sid}: Slice ${index}** \`risk:low\` \`depends:[]\``);
    const target = writeNormalArtifact(base, "research-slice", `M001/${sid}`);
    await writeValidOmega(base, "research-slice", `M001/${sid}`, target);
  }
  writeFile(join(base, ".gsd", "milestones", "M001", "M001-ROADMAP.md"), roadmapLines.join("\n"));

  assert.equal(verifyExpectedArtifact("research-slice", "M001/parallel-research", base), true);
  const omegaRoot = join(base, ".gsd", "omega", "phases", "research-slice");
  assert.equal(relative(base, omegaRoot).startsWith(".gsd"), true);
});
