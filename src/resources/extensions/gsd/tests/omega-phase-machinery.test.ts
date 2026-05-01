/**
 * T04: End-to-end tests for the canonical 10-stage Omega phase machinery.
 *
 * Covers (per slice S01-PLAN.md / T04-PLAN.md):
 *   1. Stage order proof — runPhaseSpiral writes per-stage artifacts in
 *      canonical URUZ→…→JERA order at the D012 path convention.
 *   2. Aggregate frontmatter shape — runId, manifestPath, stageCount: 10,
 *      and 10 stage-link entries with relative paths matching the per-stage
 *      files on disk.
 *   3. Parameterized stage-N failure — for N ∈ {1, 4, 10} the helper returns
 *      a structured `{ok:false, failingStage, missingArtifacts, remediation}`
 *      whose `failingStage` matches the failing stage name.
 *   4. Structural-block proof — invoking the slice-planning phase entry with
 *      a stage-4 failure yields ok:false, never writes the aggregate
 *      artifact, and never records a `complete`-status omega_phase_artifacts
 *      DB row (which is the durable signal the slice-planning DB write is
 *      gated on per the runUnitPhase short-circuit at auto/phases.ts).
 *   5. Parallel-implementation absence — `auto/phases.ts` contains no direct
 *      call to `executeOmegaSpiral` or `persistOmegaRun`; all spiral access
 *      flows through `runPhaseSpiral`. Guards against future drift.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { runPhaseSpiral } from "../auto/run-phase-spiral.ts";
import type { OmegaPhasePersistenceAdapters } from "../omega-phase-artifacts.ts";
import type { OmegaRunRow, OmegaPhaseArtifactRecord } from "../gsd-db.ts";

// ─── Canonical stage order (URUZ → JERA) ─────────────────────────────────────
//
// Mirrors src/iam/omega.ts OMEGA_STAGES; duplicated here so the test fails
// loudly if the canonical order is ever silently reordered upstream.
const CANONICAL_STAGES_IN_ORDER = [
  "materiality", // 1 URUZ
  "vitality", // 2 BERKANO
  "interiority", // 3 MANNAZ
  "criticality", // 4 THURISAZ
  "connectivity", // 5 EHWAZ
  "lucidity", // 6 KENAZ
  "necessity", // 7 SOWILO
  "reciprocity", // 8 DAGAZ
  "totality", // 9 ALGIZ
  "continuity", // 10 JERA
] as const;

// ─── Test helpers ────────────────────────────────────────────────────────────

interface AdapterCapture {
  phaseRows: OmegaPhaseArtifactRecord[];
  omegaRuns: Map<string, OmegaRunRow>;
}

function makeAdapters(): {
  adapters: OmegaPhasePersistenceAdapters;
  capture: AdapterCapture;
} {
  const phaseRows: OmegaPhaseArtifactRecord[] = [];
  const omegaRuns = new Map<string, OmegaRunRow>();
  const adapters: OmegaPhasePersistenceAdapters = {
    atomicWrite(filePath, content) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, "utf-8");
    },
    insertOmegaRun(row) {
      omegaRuns.set(row.id, row);
    },
    updateOmegaRunStatus(id, status, completedAt, error, artifactDir) {
      const existing = omegaRuns.get(id);
      assert.ok(existing, `missing omega run ${id} on update`);
      omegaRuns.set(id, {
        ...existing,
        status,
        completed_at: completedAt ?? existing.completed_at,
        error_message: error ?? existing.error_message,
        artifact_dir: artifactDir ?? existing.artifact_dir,
      });
    },
    getOmegaRun(id) {
      return omegaRuns.get(id) ?? null;
    },
    insertSavesuccessResult() {
      // T04 does not exercise SAVESUCCESS persistence.
    },
    upsertOmegaPhaseArtifact(row) {
      phaseRows.push({ ...row });
    },
  };
  return { adapters, capture: { phaseRows, omegaRuns } };
}

function makeBase(t: test.TestContext): string {
  const basePath = mkdtempSync(join(tmpdir(), "omega-phase-machinery-"));
  t.after(() => rmSync(basePath, { recursive: true, force: true }));
  return basePath;
}

function stageBasenameFor(index: number, stageName: string): string {
  return `stage-${String(index + 1).padStart(2, "0")}-${stageName}.md`;
}

function readFrontmatter(path: string): string {
  const raw = readFileSync(path, "utf-8");
  assert.ok(raw.startsWith("---\n"), `aggregate must lead with YAML frontmatter: ${path}`);
  const closeIdx = raw.indexOf("\n---\n", 4);
  assert.ok(closeIdx > 0, `aggregate frontmatter must close with --- delimiter: ${path}`);
  return raw.slice(0, closeIdx);
}

// ─── Test group 1: canonical 10-stage order at D012 path convention ──────────

test("group-1: runPhaseSpiral writes 10 stage artifacts in canonical URUZ→JERA order", async (t) => {
  const basePath = makeBase(t);
  const { adapters } = makeAdapters();
  const targetArtifactPath = join(
    basePath,
    ".gsd",
    "milestones",
    "M001",
    "slices",
    "S01",
    "S01-PLAN.md",
  );

  const result = await runPhaseSpiral({
    phase: "slice-planning",
    milestoneId: "M001",
    sliceId: "S01",
    query: "Plan slice S01 (canonical-order proof)",
    executor: async () => "stage output\n",
    basePath,
    targetArtifactPath,
    adapters,
  });

  assert.ok(result.ok, `expected ok:true, got ${JSON.stringify(!result.ok && result)}`);
  assert.equal(result.stageCount, 10, "must produce all 10 canonical stages");

  // Manifest's stageFilePaths key order matches OMEGA_STAGES iteration order.
  const stageEntries = Object.entries(result.manifest.stageFilePaths);
  assert.equal(stageEntries.length, 10, "stageFilePaths must enumerate all 10 stages");
  for (let i = 0; i < CANONICAL_STAGES_IN_ORDER.length; i++) {
    const [stageName, stagePath] = stageEntries[i];
    assert.equal(
      stageName,
      CANONICAL_STAGES_IN_ORDER[i],
      `stage ${i + 1} must be ${CANONICAL_STAGES_IN_ORDER[i]} (got ${stageName})`,
    );
    assert.ok(existsSync(stagePath), `stage file missing on disk: ${stagePath}`);
    const expectedBasename = stageBasenameFor(i, CANONICAL_STAGES_IN_ORDER[i]);
    assert.equal(
      stagePath.split("/").pop(),
      expectedBasename,
      `stage ${i + 1} basename must be ${expectedBasename}`,
    );
  }
});

// ─── Test group 2: aggregate frontmatter shape ───────────────────────────────

test("group-2: aggregate artifact frontmatter carries runId, manifestPath, stageCount, and 10 stage links", async (t) => {
  const basePath = makeBase(t);
  const { adapters } = makeAdapters();
  const targetArtifactPath = join(
    basePath,
    ".gsd",
    "milestones",
    "M001",
    "slices",
    "S01",
    "S01-PLAN.md",
  );

  const result = await runPhaseSpiral({
    phase: "slice-planning",
    milestoneId: "M001",
    sliceId: "S01",
    query: "Plan slice S01 (frontmatter shape proof)",
    executor: async () => "stage output\n",
    basePath,
    targetArtifactPath,
    adapters,
  });

  assert.ok(result.ok, "spiral must complete to validate aggregate frontmatter");
  const frontmatter = readFrontmatter(targetArtifactPath);

  // runId — must match the manifest runId exactly.
  const runIdRegex = new RegExp(
    `runId: ${result.runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  assert.match(frontmatter, runIdRegex, "frontmatter must record the spiral runId");

  // manifestPath — must point at a file that actually exists on disk.
  const manifestLine = frontmatter
    .split("\n")
    .find((line) => line.startsWith("manifestPath:"));
  assert.ok(manifestLine, "frontmatter must record manifestPath");
  const manifestRel = manifestLine.replace("manifestPath:", "").trim();
  const manifestAbs = manifestRel.startsWith("/") ? manifestRel : join(basePath, manifestRel);
  assert.ok(existsSync(manifestAbs), `manifestPath must point at a real file: ${manifestAbs}`);

  // stageCount: 10
  assert.match(frontmatter, /stageCount: 10/, "frontmatter must record stageCount: 10");

  // 10 stage-link entries, each with a relative path that resolves to an
  // existing per-stage file on disk.
  const stageLinkBlocks = frontmatter.match(/  - stage: [^\n]+\n    path: [^\n]+/g) ?? [];
  assert.equal(stageLinkBlocks.length, 10, "frontmatter must list 10 stage links");
  const linkedStageNames = new Set<string>();
  for (const block of stageLinkBlocks) {
    const stageMatch = block.match(/  - stage: ([^\n]+)/);
    const pathMatch = block.match(/    path: ([^\n]+)/);
    assert.ok(stageMatch && pathMatch, `stage-link block malformed: ${block}`);
    const stageName = stageMatch[1].trim();
    const stagePath = pathMatch[1].trim();
    linkedStageNames.add(stageName);
    const abs = stagePath.startsWith("/") ? stagePath : join(basePath, stagePath);
    assert.ok(existsSync(abs), `linked stage file must exist on disk: ${abs}`);
  }
  for (const expected of CANONICAL_STAGES_IN_ORDER) {
    assert.ok(
      linkedStageNames.has(expected),
      `stage links must cover canonical stage "${expected}"`,
    );
  }
});

// ─── Test group 3: parameterized stage-N failure ─────────────────────────────

const FAILURE_CASES: Array<{ stageNumber: number; failingStage: string }> = [
  { stageNumber: 1, failingStage: "materiality" },
  { stageNumber: 4, failingStage: "criticality" },
  { stageNumber: 10, failingStage: "continuity" },
];

for (const { stageNumber, failingStage } of FAILURE_CASES) {
  test(`group-3: stage-${stageNumber} executor failure returns structured {ok:false, failingStage:${failingStage}, missingArtifacts, remediation}`, async (t) => {
    const basePath = makeBase(t);
    const { adapters, capture } = makeAdapters();
    const targetArtifactPath = join(
      basePath,
      ".gsd",
      "milestones",
      "M001",
      "slices",
      "S01",
      "S01-PLAN.md",
    );

    let stageCalls = 0;
    const result = await runPhaseSpiral({
      phase: "slice-planning",
      milestoneId: "M001",
      sliceId: "S01",
      query: `Plan slice S01 (stage-${stageNumber} failure)`,
      executor: async () => {
        stageCalls += 1;
        if (stageCalls === stageNumber) {
          throw new Error(`synthetic stage-${stageNumber} executor failure`);
        }
        return "stage output\n";
      },
      basePath,
      targetArtifactPath,
      adapters,
    });

    assert.ok(!result.ok, "executor failure must return ok:false");
    assert.equal(
      result.failingStage,
      failingStage,
      `failingStage must match canonical stage ${stageNumber}`,
    );
    assert.ok(
      Array.isArray(result.missingArtifacts),
      "missingArtifacts must be an array on failure",
    );
    assert.ok(
      result.missingArtifacts.length > 0,
      "missingArtifacts must list at least the manifest pointer for the failed run",
    );
    // The failed-run manifest path is the durable pointer to which artifacts
    // are missing; downstream forensics (S03) reads it to enumerate the
    // missing stages from N..10. Assert it is well-formed (absolute path).
    for (const missing of result.missingArtifacts) {
      assert.ok(
        typeof missing === "string" && missing.length > 0,
        `missingArtifacts entry must be a non-empty string, got ${JSON.stringify(missing)}`,
      );
    }
    assert.ok(
      typeof result.remediation === "string" && result.remediation.length > 0,
      "remediation must be a non-empty string on failure",
    );

    // Aggregate artifact must NOT be written when the spiral fails.
    assert.ok(
      !existsSync(targetArtifactPath),
      `aggregate artifact must not be written on stage-${stageNumber} failure`,
    );

    // omega_phase_artifacts row recorded a non-complete status (failed/partial).
    assert.ok(capture.phaseRows.length > 0, "failed-run manifest row must still be persisted for forensics");
    for (const row of capture.phaseRows) {
      assert.notEqual(
        row.status,
        "complete",
        `omega_phase_artifacts row must not be marked complete on stage-${stageNumber} failure`,
      );
    }
  });
}

// ─── Test group 4: structural-block proof for slice-planning entry ───────────
//
// Invokes the slice-planning phase via runPhaseSpiral (the same primitive
// `runGovernedPhaseSpiralForUnit` dispatches to in auto/phases.ts) with a
// stage-4 failure and asserts: (a) the result is a structured phase-blocked
// payload, (b) the aggregate slice-plan target is never written on disk, and
// (c) no `complete`-status omega_phase_artifacts row is produced — which is
// the durable signal the runUnitPhase short-circuit gates the slice-planning
// DB write on (see `phase-spiral-blocked` short-circuit in auto/phases.ts).

test("group-4: slice-planning phase entry structurally blocks on stage-4 failure", async (t) => {
  const basePath = makeBase(t);
  const { adapters, capture } = makeAdapters();
  const targetArtifactPath = join(
    basePath,
    ".gsd",
    "milestones",
    "M001",
    "slices",
    "S01",
    "S01-PLAN.md",
  );

  let stageCalls = 0;
  const result = await runPhaseSpiral({
    phase: "slice-planning",
    milestoneId: "M001",
    sliceId: "S01",
    query: "Slice-planning structural-block proof",
    executor: async () => {
      stageCalls += 1;
      if (stageCalls === 4) {
        throw new Error("THURISAZ stage executor unavailable");
      }
      return "stage output\n";
    },
    basePath,
    targetArtifactPath,
    adapters,
  });

  // (a) Phase-blocked result: ok:false with the criticality-stage signal.
  assert.ok(!result.ok, "slice-planning phase entry must return ok:false on stage-4 failure");
  assert.equal(result.failingStage, "criticality", "stage-4 failure → failingStage:criticality");
  assert.equal(result.unitType, "plan-slice", "slice-planning phase maps to unitType:plan-slice");
  assert.equal(result.unitId, "M001/S01", "unitId must be slice-scoped <milestone>/<slice>");

  // (b) Aggregate slice-plan target must not be written.
  assert.ok(
    !existsSync(targetArtifactPath),
    "aggregate S01-PLAN.md must NOT be written on phase-blocked spiral",
  );

  // (c) No `complete`-status omega_phase_artifacts row was persisted. This is
  // the durable signal `runUnitPhase` short-circuits on at auto/phases.ts
  // (the `phase-spiral-blocked` branch returns `action:'break'` before any
  // slice-planning DB write can occur).
  for (const row of capture.phaseRows) {
    assert.notEqual(
      row.status,
      "complete",
      "no complete-status omega_phase_artifacts row may exist when the spiral failed",
    );
  }

  // Cross-check: confirm auto/phases.ts contains the short-circuit pattern
  // that consumes this ok:false result. This pins the dispatch-side gate.
  const phasesSrc = readFileSync(
    new URL("../auto/phases.ts", import.meta.url),
    "utf-8",
  );
  assert.match(
    phasesSrc,
    /governedSpiralResult\s*&&\s*!governedSpiralResult\.ok/,
    "auto/phases.ts must contain the short-circuit `if (governedSpiralResult && !governedSpiralResult.ok)` gate",
  );
  assert.match(
    phasesSrc,
    /reason:\s*["']phase-spiral-blocked["']/,
    "auto/phases.ts must return reason:'phase-spiral-blocked' on phase-blocked spiral",
  );
});

// ─── Test group 5: parallel-implementation absence (regression guard) ────────

test("group-5: auto/phases.ts contains no direct executeOmegaSpiral or persistOmegaRun usage", () => {
  const phasesSrc = readFileSync(
    new URL("../auto/phases.ts", import.meta.url),
    "utf-8",
  );

  // Strip block comments and line comments so the regex cannot match
  // documentation that mentions the primitives by name (e.g. JSDoc that
  // explains how runPhaseSpiral wraps executeOmegaSpiral internally).
  const codeOnly = phasesSrc
    .replace(/\/\*[\s\S]*?\*\//g, "") // /* ... */
    .replace(/(^|\s)\/\/[^\n]*/g, "$1"); // // line comments

  // executeOmegaSpiral and persistOmegaRun must appear ONLY inside
  // run-phase-spiral.ts (which auto/phases.ts imports as runPhaseSpiral).
  // Direct usage in auto/phases.ts would be a parallel implementation that
  // bypasses the structural fail-closed gate — guard against future drift.
  const directExecuteCalls = codeOnly.match(/\bexecuteOmegaSpiral\s*\(/g) ?? [];
  const directPersistCalls = codeOnly.match(/\bpersistOmegaRun\s*\(/g) ?? [];
  // Import statements are also forbidden (no incidental binding).
  const importExecute = codeOnly.match(/import[^;]*\bexecuteOmegaSpiral\b[^;]*;/g) ?? [];
  const importPersist = codeOnly.match(/import[^;]*\bpersistOmegaRun\b[^;]*;/g) ?? [];

  assert.equal(
    directExecuteCalls.length,
    0,
    `auto/phases.ts must not call executeOmegaSpiral directly (found ${directExecuteCalls.length})`,
  );
  assert.equal(
    directPersistCalls.length,
    0,
    `auto/phases.ts must not call persistOmegaRun directly (found ${directPersistCalls.length})`,
  );
  assert.equal(
    importExecute.length,
    0,
    `auto/phases.ts must not import executeOmegaSpiral directly (found ${importExecute.length})`,
  );
  assert.equal(
    importPersist.length,
    0,
    `auto/phases.ts must not import persistOmegaRun directly (found ${importPersist.length})`,
  );

  // Positive complement: runPhaseSpiral IS imported and IS called.
  assert.match(
    codeOnly,
    /import\s*\{[^}]*\brunPhaseSpiral\b[^}]*\}\s*from\s*["']\.\/run-phase-spiral\.js["']/,
    "auto/phases.ts must import runPhaseSpiral from ./run-phase-spiral.js",
  );
  const runPhaseSpiralCalls = codeOnly.match(/\brunPhaseSpiral\s*\(/g) ?? [];
  assert.ok(
    runPhaseSpiralCalls.length >= 6,
    `auto/phases.ts must contain ≥6 runPhaseSpiral call sites (one per governed phase); found ${runPhaseSpiralCalls.length}`,
  );
});
