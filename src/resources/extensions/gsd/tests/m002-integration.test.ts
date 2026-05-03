/**
 * m002-integration.test.ts — M002/S09/T03
 *
 * End-to-end integration coverage for the M002 governed-dispatch surface,
 * proving the assembled system survives one recoverable cycle (fix-applied →
 * counter intact, next non-recovery completion zeros it), one non-recoverable
 * cycle (3× give-up → cap-3, rule refuses to dispatch), one malformed verdict
 * (counts as a strike), and one canonical phase-Omega artifact round-trip
 * (10 stage files + synthesis + run-manifest + phase-manifest), with the
 * production observability surfaces (recovery-dispatch event log + phase
 * spiral journal) attested in their actual on-disk locations.
 *
 * Mode contract (T01-AUDIT §c):
 *   - Read-only on production source.
 *   - Read-only on the tracked fixture corpus at
 *     src/resources/extensions/gsd/tests/fixtures/m002-integration/.
 *   - All writes land inside per-test mkdtempSync tmpbases; never the fixture.
 *
 * The shape mirrors recovery-integration.test.ts (S03) and
 * iam-fail-closed-integration.test.ts (S05) for stylistic continuity. runUnit
 * is stubbed via the existing _setRunUnitForTest seam from auto/recovery.ts so
 * verdicts are deterministic; the rest of the production helpers
 * (dispatchRecovery, evaluateRecoveryTrigger, shouldResetRecoveryCounter,
 * runPhaseSpiral, persistPhaseOmegaRun, validatePhaseOmegaArtifacts) run real.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  dispatchRecovery,
  RECOVERY_FAILURE_CAP,
  _setRunUnitForTest,
  _setRecoveryTemplateForTest,
  type RecoveryDispatchTrigger,
} from "../auto/recovery.ts";
import {
  evaluateRecoveryTrigger,
  shouldResetRecoveryCounter,
} from "../auto/recovery-dispatch-rule.ts";
import type { UnitResult } from "../auto/types.ts";
import { readSessionLockData } from "../session-lock.ts";
import {
  persistPhaseOmegaRun,
  validatePhaseOmegaArtifacts,
  omegaPhaseManifestPath,
  type OmegaPhasePersistenceAdapters,
} from "../omega-phase-artifacts.ts";
import { runPhaseSpiral } from "../auto/run-phase-spiral.ts";
import { OMEGA_STAGES } from "../../../../iam/omega.ts";
import type { OmegaRunRow, OmegaPhaseArtifactRecord } from "../gsd-db.ts";

// ─── Fixture corpus pointer (read-only at test time per T01-AUDIT §c) ────

const FIXTURE_ROOT = new URL(
  "./fixtures/m002-integration/MILESTONE-INTEGRATION-DEMO/",
  import.meta.url,
).pathname;

// ─── Tmpbase + lock + adapter helpers ───────────────────────────────────

let tmpBase = "";

function makeTmpBase(label: string): string {
  const base = mkdtempSync(join(tmpdir(), `m002-integ-${label}-`));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  return base;
}

/**
 * Pre-write a session lock with the given recovery counter so
 * updateSessionLockFields and readSessionLockData (which short-circuit on a
 * missing file) have a target. Mirrors the seedLock helper in
 * recovery-integration.test.ts (S03).
 */
function seedLock(base: string, initial: number): void {
  const lock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    unitType: "task",
    unitId: "M002/S09/T99",
    unitStartedAt: new Date().toISOString(),
    consecutiveRecoveryFailures: initial,
  };
  writeFileSync(
    join(base, ".gsd", "auto.lock"),
    JSON.stringify(lock, null, 2),
    "utf-8",
  );
}

function makeUnitResult(messageStream: string): UnitResult {
  return {
    status: "completed",
    event: { messages: [messageStream] },
  };
}

/** Minimal AutoSession-shaped object — dispatcher only reads basePath. */
function makeSession(basePath: string): any {
  return { basePath };
}

const REAL_RECOVERY_TEMPLATE = readFileSync(
  new URL("../prompts/recovery.md", import.meta.url),
  "utf-8",
);

const CTX: any = {};
const PI: any = {};

const baseTrigger = (attemptNumber: number): RecoveryDispatchTrigger => ({
  parentUnitType: "task",
  parentUnitId: "M002/S09/T99",
  failure: {
    category: "tooling-timeout",
    message: "tool-call exceeded 60s timeout",
    isTransient: true,
  },
  attemptNumber,
});

/**
 * In-memory `OmegaPhasePersistenceAdapters` — mirrors the pattern in
 * omega-phase-artifacts.test.ts and run-phase-spiral.test.ts. The DB-backed
 * `gsd-db` adapters are out-of-scope for this integration suite per
 * T01-AUDIT §e (O5).
 */
function makeAdapters(
  rows: OmegaPhaseArtifactRecord[] = [],
): OmegaPhasePersistenceAdapters {
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
      assert.ok(existing, `missing in-memory omega row for ${id}`);
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
      // Not exercised in this suite.
    },
    upsertOmegaPhaseArtifact(row) {
      rows.push(row);
    },
  };
}

/** Read every line of every JSONL file in a directory; tolerate missing dirs. */
function readJsonlDir(dirPath: string): Array<Record<string, unknown>> {
  if (!existsSync(dirPath)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const name of readdirSync(dirPath)) {
    if (!name.endsWith(".jsonl")) continue;
    const raw = readFileSync(join(dirPath, name), "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Skip malformed lines — assertion failures in callers will name the
        // file path so a 3am operator can find the corruption directly.
      }
    }
  }
  return out;
}

/** Read a single JSONL file (e.g. .gsd/event-log.jsonl). */
function readJsonlFile(filePath: string): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Skip — see readJsonlDir.
    }
  }
  return out;
}

test.beforeEach(() => {
  _setRunUnitForTest(null);
  _setRecoveryTemplateForTest(REAL_RECOVERY_TEMPLATE);
});

test.afterEach(() => {
  _setRunUnitForTest(null);
  _setRecoveryTemplateForTest(null);
  if (tmpBase && existsSync(tmpBase)) {
    rmSync(tmpBase, { recursive: true, force: true });
  }
  tmpBase = "";
});

// ─── Case 1 — Omega artifact tree round-trips for one phase entry ───────

test("case-1: Omega artifact tree round-trips — 10 stage files + synthesis + run-manifest + phase-manifest", async () => {
  tmpBase = makeTmpBase("omega");
  const adapters = makeAdapters([]);

  // validatePhaseOmegaArtifacts requires the target artifact to exist on disk
  // (it is the aggregate file the spiral provenance frontmatter would attach
  // to). For a direct persistPhaseOmegaRun call the target is pre-written;
  // see omega-phase-artifacts.test.ts:51.
  const targetArtifactPath = join(
    tmpBase,
    ".gsd",
    "milestones",
    "M002",
    "slices",
    "S01-recoverable",
    "S01-PLAN.md",
  );
  mkdirSync(dirname(targetArtifactPath), { recursive: true });
  writeFileSync(targetArtifactPath, "# S01 plan body — Hammer integration fixture\n", "utf-8");

  let executorCalls = 0;
  const result = await persistPhaseOmegaRun({
    basePath: tmpBase,
    unitType: "plan-slice",
    unitId: "M002/S01-recoverable",
    query: "Drive S01 recoverable cycle for M002 integration",
    targetArtifactPath,
    executor: async () => `synthetic stage output ${++executorCalls}`,
    adapters,
  });

  assert.ok(
    result.ok,
    `persistPhaseOmegaRun must succeed; got ${JSON.stringify(!result.ok && result.error)}`,
  );
  const manifest = result.value;

  // 10 canonical stages + 1 synthesis prompt = 11 executor calls.
  assert.equal(
    executorCalls,
    11,
    "executor must be called once per canonical stage plus once for synthesis",
  );
  assert.equal(manifest.status, "complete");
  assert.equal(manifest.stageCount, 10);

  // Filesystem shape: every stage file in OMEGA_STAGES order, plus synthesis,
  // plus phase-manifest.json, plus run-manifest.json.
  for (const stage of OMEGA_STAGES) {
    const stagePath = manifest.stageFilePaths[stage.stageName];
    assert.ok(
      stagePath && existsSync(stagePath),
      `stage file missing for ${stage.stageName} (expected at ${stagePath})`,
    );
  }
  assert.ok(
    manifest.synthesisPath && existsSync(manifest.synthesisPath),
    `synthesis.md missing at ${manifest.synthesisPath}`,
  );
  assert.ok(
    existsSync(manifest.runManifestPath),
    `run-manifest.json missing at ${manifest.runManifestPath}`,
  );
  assert.equal(
    manifest.manifestPath,
    omegaPhaseManifestPath(manifest.artifactDir),
    "manifest path must round-trip through omegaPhaseManifestPath helper",
  );
  assert.ok(
    existsSync(manifest.manifestPath),
    `phase-manifest.json missing at ${manifest.manifestPath}`,
  );

  // Read-back gate: validatePhaseOmegaArtifacts is the structural fail-closed
  // surface that runPhaseSpiral consumes. It must accept the freshly persisted
  // tree without any diagnostics.
  const validation = validatePhaseOmegaArtifacts({
    manifestPath: manifest.manifestPath,
    expectedUnitType: "plan-slice",
    expectedUnitId: "M002/S01-recoverable",
    expectedRunId: manifest.runId,
    expectedTargetArtifactPath: targetArtifactPath,
  });
  assert.ok(
    validation.ok,
    `validatePhaseOmegaArtifacts must accept a freshly persisted tree; got ${JSON.stringify(!validation.ok && validation.error)}`,
  );
});

// ─── Case 2 — recoverable cycle: fix-applied + non-recovery completion ──

test("case-2: fix-applied keeps counter intact; next non-recovery completion zeros it", async () => {
  tmpBase = makeTmpBase("recover");

  // Project the tracked fixture corpus into the mutable tmpbase per T01-AUDIT
  // §c — proves the read-only-at-test-time contract for the fixture works.
  cpSync(FIXTURE_ROOT, join(tmpBase, ".gsd", "milestones", "M002"), {
    recursive: true,
  });
  assert.ok(
    existsSync(join(tmpBase, ".gsd", "milestones", "M002", "M002-CONTEXT.md")),
    "fixture corpus must project into tmpbase via cpSync",
  );

  seedLock(tmpBase, 0);

  // Step 1 — fix-applied verdict: counter delta = 0 per recovery.ts:255.
  _setRunUnitForTest(async () =>
    makeUnitResult(
      "Recovery subagent reapplied verification artifact.\n" +
        "RECOVERY_VERDICT: fix-applied; summary=patched the import path after fs flush race\n",
    ),
  );

  const r = await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(1));
  assert.equal(r.verdict.kind, "fix-applied");
  assert.equal(
    r.counterAfter,
    0,
    "fix-applied must not increment the recovery counter (research §4.2 delta = 0)",
  );

  const lockAfterFix = readSessionLockData(tmpBase);
  assert.ok(lockAfterFix, "lock must persist for read-back");
  assert.equal(lockAfterFix!.consecutiveRecoveryFailures, 0);
  assert.equal(
    lockAfterFix!.lastRecoveryVerdict,
    "fix-applied",
    "lock must record the most recent verdict so operators can grep",
  );

  // Step 2 — the loop's R030 reset gate fires when a non-recovery unit
  // completes. shouldResetRecoveryCounter is the production helper; assert
  // the contract directly so a future regression naming the helper rather
  // than the surrounding code is diagnosable.
  assert.equal(
    shouldResetRecoveryCounter("execute-task", "completed"),
    true,
    "non-recovery completed unit MUST trigger reset (R030)",
  );
  assert.equal(
    shouldResetRecoveryCounter("recovery", "completed"),
    false,
    "successful recovery itself MUST NOT reset (would mask cap-3 progress)",
  );
});

// ─── Case 3 — non-recoverable cycle: 3× give-up → cap-3 ─────────────────

test("case-3: three sequential give-ups trip the cap; evaluateRecoveryTrigger refuses with cap-reached", async () => {
  tmpBase = makeTmpBase("cap");
  seedLock(tmpBase, 0);

  _setRunUnitForTest(async () =>
    makeUnitResult(
      "Recovery subagent investigated and could not proceed.\n" +
        "RECOVERY_VERDICT: give-up; reason=Failure category terminal — Omega stage executor not wired in fixture sandbox\n",
    ),
  );

  for (let attempt = 1; attempt <= RECOVERY_FAILURE_CAP; attempt++) {
    const r = await dispatchRecovery(
      CTX,
      PI,
      makeSession(tmpBase),
      baseTrigger(attempt),
    );
    assert.equal(r.verdict.kind, "give-up", `attempt ${attempt} verdict`);
    assert.equal(
      r.counterAfter,
      attempt,
      `after attempt ${attempt}, counter must equal ${attempt}`,
    );
  }

  const lock = readSessionLockData(tmpBase);
  assert.ok(lock);
  assert.equal(
    lock!.consecutiveRecoveryFailures,
    RECOVERY_FAILURE_CAP,
    "after 3 give-ups the lock JSON shows counter=3",
  );
  assert.equal(lock!.lastRecoveryVerdict, "give-up");

  // The dispatch rule (auto-dispatch.ts + phases.ts) consults
  // evaluateRecoveryTrigger. At cap it MUST refuse to dispatch a 4th recovery
  // with the structured `cap-reached` skip — that is the reason string the
  // phase-spiral-blocked branch keys off to fall through to pauseAuto.
  const decision = evaluateRecoveryTrigger({
    lock: { consecutiveRecoveryFailures: lock!.consecutiveRecoveryFailures },
    parentUnitType: "task",
    parentUnitId: "M002/S09/T99",
    parentCompleted: false,
    failure: {
      category: "tooling-timeout",
      message: "still failing",
      isTransient: true,
    },
  });
  assert.deepEqual(
    decision,
    { skip: true, reason: "cap-reached" },
    "rule MUST skip with cap-reached so phases.ts falls through to pauseAuto",
  );
});

// ─── Case 4 — cap-3 pause carries structured remediation shape ──────────

test("case-4: cap-3 pause shape — RECOVERY_FAILURE_CAP===3, decision is the structured pauseAuto handoff", async () => {
  tmpBase = makeTmpBase("cap-shape");
  seedLock(tmpBase, RECOVERY_FAILURE_CAP);

  // Numerical drift pin — recovery.ts and recovery-dispatch-rule.ts both
  // declare RECOVERY_FAILURE_CAP. The rule mirror is asserted in the S03
  // recovery-dispatch-rule.test.ts; this case pins the dispatcher constant
  // that runs in production.
  assert.equal(
    RECOVERY_FAILURE_CAP,
    3,
    "RECOVERY_FAILURE_CAP must remain numerically 3 — change requires updating prompts/recovery.md <<CAP>> binding",
  );

  // The lock-after-cap shape is the structured remediation handoff a 3am
  // operator (or pauseAuto) reads to decide what to do. Assert each field
  // explicitly so a regression names the missing field, not a vague shape.
  const lock = readSessionLockData(tmpBase);
  assert.ok(lock);
  assert.equal(lock!.consecutiveRecoveryFailures, RECOVERY_FAILURE_CAP);

  // The decision payload is the contract that phases.ts consumes. `cap-reached`
  // is the only skip reason that maps to pauseAuto fallthrough; any other
  // reason represents a different control-flow branch.
  const decision = evaluateRecoveryTrigger({
    lock: { consecutiveRecoveryFailures: RECOVERY_FAILURE_CAP },
    parentUnitType: "task",
    parentUnitId: "M002/S09/T99",
    parentCompleted: false,
    failure: {
      category: "tooling-timeout",
      message: "would-be 4th attempt",
      isTransient: true,
    },
  });
  assert.equal(decision.skip, true);
  if (decision.skip) {
    assert.equal(
      decision.reason,
      "cap-reached",
      "skip reason must be cap-reached so the pauseAuto branch in phases.ts fires",
    );
  }

  // The dispatch-rule source documents the pauseAuto handoff in a comment so
  // operators reading the partition during incidents see it immediately.
  // This is a documentation-contract check: if the comment is removed the
  // handoff intent must be re-documented elsewhere or this assertion updated.
  const ruleSource = readFileSync(
    new URL("../auto/recovery-dispatch-rule.ts", import.meta.url),
    "utf-8",
  );
  assert.match(
    ruleSource,
    /pauseAuto/,
    "recovery-dispatch-rule.ts must document the pauseAuto handoff so the cap-reached contract is discoverable",
  );
});

// ─── Case 5 — observability: recovery + phase-spiral surfaces wired ─────

test("case-5: recovery-dispatch and phase-spiral events land in their canonical observability files", async () => {
  tmpBase = makeTmpBase("obs");
  seedLock(tmpBase, 0);

  // (a) Drive 1 fix-applied followed by 3 give-ups — 4 recovery dispatches
  //     total. Recovery dispatches use appendEvent (workflow-events.ts:42),
  //     which writes to .gsd/event-log.jsonl, NOT .gsd/journal/*.jsonl. The
  //     slice plan said "journal" loosely; the binding contract is what
  //     dispatchRecovery actually persists to (recovery.ts:269). Asserting
  //     both files keeps the observability surface unambiguous.
  _setRunUnitForTest(async () =>
    makeUnitResult(
      "Recovery subagent fixed it.\nRECOVERY_VERDICT: fix-applied; summary=patched\n",
    ),
  );
  await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(1));

  _setRunUnitForTest(async () =>
    makeUnitResult(
      "Recovery subagent gave up.\nRECOVERY_VERDICT: give-up; reason=stalled\n",
    ),
  );
  for (let attempt = 2; attempt <= 4; attempt++) {
    await dispatchRecovery(
      CTX,
      PI,
      makeSession(tmpBase),
      baseTrigger(attempt),
    );
  }

  // (b) Drive one phase spiral so phase-spiral-{started,completed} land on
  //     disk in .gsd/journal/<YYYY-MM-DD>.jsonl.
  const adapters = makeAdapters([]);
  const phaseTarget = join(
    tmpBase,
    ".gsd",
    "milestones",
    "M002",
    "slices",
    "S01-recoverable",
    "S01-PLAN.md",
  );
  const spiralResult = await runPhaseSpiral({
    phase: "slice-planning",
    milestoneId: "M002",
    sliceId: "S01-recoverable",
    query: "Plan slice S01 for observability assertion",
    executor: async () => "stage payload",
    basePath: tmpBase,
    targetArtifactPath: phaseTarget,
    adapters,
  });
  assert.ok(
    spiralResult.ok,
    `runPhaseSpiral must succeed for the observability assertion; got ${JSON.stringify(!spiralResult.ok && spiralResult)}`,
  );

  // ── Recovery surface — .gsd/event-log.jsonl ───────────────────────────
  const eventLogPath = join(tmpBase, ".gsd", "event-log.jsonl");
  const eventRows = readJsonlFile(eventLogPath);
  const recoveryRows = eventRows.filter((row) => row.cmd === "recovery-dispatch");
  assert.equal(
    recoveryRows.length,
    4,
    `expected 4 recovery-dispatch rows (1 fix-applied + 3 give-ups) at ${eventLogPath}; got ${recoveryRows.length}`,
  );
  const verdicts = recoveryRows.map(
    (row) => (row.params as Record<string, unknown> | undefined)?.verdict,
  );
  assert.deepEqual(
    verdicts,
    ["fix-applied", "give-up", "give-up", "give-up"],
    "recovery-dispatch verdict sequence must mirror the dispatch order",
  );

  // ── Phase-spiral surface — .gsd/journal/<date>.jsonl ──────────────────
  const journalDir = join(tmpBase, ".gsd", "journal");
  const journalRows = readJsonlDir(journalDir);
  const startedRows = journalRows.filter(
    (row) => row.eventType === "phase-spiral-started",
  );
  const completedRows = journalRows.filter(
    (row) => row.eventType === "phase-spiral-completed",
  );
  assert.equal(
    startedRows.length,
    1,
    `expected 1 phase-spiral-started journal row at ${journalDir}`,
  );
  assert.equal(
    completedRows.length,
    1,
    `expected 1 phase-spiral-completed journal row at ${journalDir}`,
  );
  const completedData = completedRows[0].data as Record<string, unknown>;
  assert.equal(completedData.unitId, "M002/S01-recoverable");
  assert.equal(completedData.runId, spiralResult.runId);
  assert.equal(completedData.stageCount, 10);
  assert.equal(completedData.verdict, "ok");
});

// ─── Case 6 — malformed verdict counts as failure ───────────────────────

test("case-6: missing RECOVERY_VERDICT trailer counts as malformed (counter +1, lastRecoveryVerdict='malformed')", async () => {
  tmpBase = makeTmpBase("malformed");
  seedLock(tmpBase, 0);

  _setRunUnitForTest(async () =>
    makeUnitResult(
      "Recovery subagent forgot to emit the wire trailer; ended on a freeform note.",
    ),
  );

  const r = await dispatchRecovery(CTX, PI, makeSession(tmpBase), baseTrigger(1));
  assert.equal(r.verdict.kind, "malformed");
  assert.equal(
    r.counterAfter,
    1,
    "malformed must count as a strike — same delta as give-up (recovery.ts:255)",
  );

  const lock = readSessionLockData(tmpBase);
  assert.ok(lock);
  assert.equal(lock!.consecutiveRecoveryFailures, 1);
  assert.equal(
    lock!.lastRecoveryVerdict,
    "malformed",
    "lock must record verdict kind even when the trailer was missing — operators grep this field",
  );
});
