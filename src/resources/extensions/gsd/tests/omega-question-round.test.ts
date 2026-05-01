/**
 * T04 — Slice S04 verification tests for the per-question-round Omega spiral
 * stack: per-round artifact persistence, fail-closed bypass-attempt gate,
 * round-counter discovery, prompt-side heuristic absence.
 *
 * Eight named cases (per S04 plan):
 *   (1) per-round artifact persistence (milestone)
 *   (2) per-round artifact persistence (slice)
 *   (3) bypass-attempt fail-closed (milestone)
 *   (4) bypass-attempt fail-closed (slice)
 *   (5) round-counter increment across sequential rounds 1, 2, 3
 *   (6) regex-guard heuristic absence in the three discuss prompts
 *   (7) regex-guard `gsd_question_round_spiral` reference in the three prompts
 *   (8) non-discuss caller is unaffected by the gate
 *
 * Note (intentional plan deviation): the S04 plan listed the canonical-order
 * runes as URUZ→BERKANO→MANNAZ→THURISAZ→EHWAZ→KENAZ→SOWILO→DAGAZ→ALGIZ→JERA,
 * but the actual `OMEGA_STAGES` (`src/iam/omega.ts`) at positions 7 and 8 are
 * NAUTHIZ (necessity) and GEBO (reciprocity) — not SOWILO and ALGIZ. The
 * tests assert the on-disk `stage-NN-<name>.md` filenames against the real
 * stage names so they verify what the helper actually writes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { runQuestionRoundSpiral } from "../auto/run-question-round-spiral.ts";
import type {
  OmegaPhasePersistenceAdapters,
  OmegaPhaseArtifactRecord,
} from "../omega-phase-artifacts.ts";
import type { OmegaRunRow } from "../gsd-db.ts";
import { gsdRoot } from "../paths.ts";
import { writeUnitRuntimeRecord } from "../unit-runtime.ts";
import AskUserQuestions, {
  resetAskUserQuestionsCache,
} from "../../ask-user-questions.ts";

// ─── In-memory persistence adapters (mirrors run-question-round-spiral.test.ts) ─

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
      if (!existing) return;
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
      // not exercised here
    },
    upsertOmegaPhaseArtifact(row) {
      rows.push(row);
    },
  };
}

function makeBase(t: test.TestContext): string {
  const basePath = mkdtempSync(join(tmpdir(), "omega-question-round-"));
  t.after(() => rmSync(basePath, { recursive: true, force: true }));
  return basePath;
}

// ─── ask_user_questions tool capture (mirrors ask-user-freetext.test.ts) ─────

interface CapturedTool {
  name: string;
  execute: (
    toolCallId: string,
    params: { questions: unknown[] },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{
    content: { type: "text"; text: string }[];
    details: { cancelled?: boolean; questions?: unknown[]; response?: unknown };
  }>;
}

function captureAskUserQuestionsTool(): CapturedTool {
  let captured: CapturedTool | null = null;
  const fakePi = {
    registerTool(tool: unknown) {
      const t = tool as { name: string; execute: CapturedTool["execute"] };
      captured = { name: t.name, execute: t.execute };
    },
  };
  AskUserQuestions(fakePi as never);
  if (!captured) throw new Error("AskUserQuestions did not register a tool");
  return captured;
}

const SAMPLE_QUESTIONS = [
  {
    id: "scope",
    header: "Scope",
    question: "Which scope?",
    options: [
      { label: "All", description: "Everything in scope" },
      { label: "Subset", description: "A focused subset" },
    ],
  },
];

// Canonical OMEGA stage order — the real on-disk filenames produced by
// persistOmegaRun are `stage-NN-<stageName>.md` (see src/iam/persist.ts:82).
const CANONICAL_STAGE_NAMES = [
  "materiality",
  "vitality",
  "interiority",
  "criticality",
  "connectivity",
  "lucidity",
  "necessity",
  "reciprocity",
  "totality",
  "continuity",
] as const;

function expectedStageFilenames(): string[] {
  return CANONICAL_STAGE_NAMES.map(
    (name, idx) => `stage-${String(idx + 1).padStart(2, "0")}-${name}.md`,
  );
}

/** Subdirectories of `parent` (filters out the unit-dir-level synthesis.md placeholder). */
function listSubdirs(parent: string): string[] {
  return readdirSync(parent).filter((entry) => {
    try {
      return statSync(join(parent, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// (1) Per-round persistence (milestone discuss)
test("(1) per-round persistence — milestone-discuss writes 10 canonical stage files plus phase-manifest, run-manifest, and synthesis under round-N", async (t) => {
  const basePath = makeBase(t);
  const rows: OmegaPhaseArtifactRecord[] = [];
  const adapters = makeAdapters(rows);

  // Round 1
  const round1 = await runQuestionRoundSpiral({
    milestoneId: "M999",
    roundIndex: 1,
    conversationState: "Test conversation state for round 1.",
    executor: async () => "canned executor output",
    basePath,
    adapters,
  });
  assert.ok(round1.ok, `round 1 must succeed, got ${JSON.stringify(round1)}`);

  const round1Parent = join(gsdRoot(basePath), "milestones", "M999", "discuss", "round-1", "omega");
  const round1Runs = listSubdirs(round1Parent);
  assert.equal(round1Runs.length, 1, "exactly one runId dir under round-1/omega/");
  const round1RunDir = join(round1Parent, round1Runs[0]);

  // 10 canonical-order stage files present
  const expectedNames = expectedStageFilenames();
  for (const name of expectedNames) {
    assert.ok(existsSync(join(round1RunDir, name)), `missing per-stage file: ${name}`);
  }

  // phase-manifest.json, run-manifest.json, synthesis.md all present
  assert.ok(existsSync(join(round1RunDir, "phase-manifest.json")), "phase-manifest.json missing");
  assert.ok(existsSync(join(round1RunDir, "run-manifest.json")), "run-manifest.json missing");
  assert.ok(existsSync(join(round1RunDir, "synthesis.md")), "synthesis.md missing");

  // stageFilePaths in the helper-returned manifest must be 10 and exist
  assert.equal(Object.keys(round1.manifest.stageFilePaths).length, 10);
  for (const stagePath of Object.values(round1.manifest.stageFilePaths)) {
    assert.ok(existsSync(stagePath), `stageFilePath missing on disk: ${stagePath}`);
  }

  // Round 2 writes under round-2/, separate from round-1
  const round2 = await runQuestionRoundSpiral({
    milestoneId: "M999",
    roundIndex: 2,
    conversationState: "Test conversation state for round 2.",
    executor: async () => "canned executor output round 2",
    basePath,
    adapters,
  });
  assert.ok(round2.ok, `round 2 must succeed, got ${JSON.stringify(round2)}`);
  const round2Parent = join(gsdRoot(basePath), "milestones", "M999", "discuss", "round-2", "omega");
  assert.ok(existsSync(round2Parent), "round-2/omega/ should exist after round 2");
  assert.notEqual(round1.runId, round2.runId, "round 1 and round 2 must have distinct runIds");
});

// (2) Per-round persistence (slice discuss)
test("(2) per-round persistence — slice-discuss writes 10 canonical stage files under slices/<SID>/discuss/round-N", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);

  const result = await runQuestionRoundSpiral({
    milestoneId: "M999",
    sliceId: "S99",
    roundIndex: 1,
    conversationState: "Slice-level discuss conversation state for round 1.",
    executor: async () => "canned",
    basePath,
    adapters,
  });
  assert.ok(result.ok, `slice-discuss round 1 must succeed, got ${JSON.stringify(result)}`);

  const expectedParent = join(
    gsdRoot(basePath),
    "milestones", "M999", "slices", "S99", "discuss", "round-1", "omega",
  );
  assert.ok(existsSync(expectedParent), `expected per-round artifact parent missing: ${expectedParent}`);

  const runDirs = listSubdirs(expectedParent);
  assert.equal(runDirs.length, 1, "exactly one runId dir under slice round-1/omega");
  const runDir = join(expectedParent, runDirs[0]);

  for (const name of expectedStageFilenames()) {
    assert.ok(existsSync(join(runDir, name)), `slice path missing per-stage file: ${name}`);
  }
  assert.ok(existsSync(join(runDir, "phase-manifest.json")), "phase-manifest.json missing (slice)");
  assert.ok(existsSync(join(runDir, "run-manifest.json")), "run-manifest.json missing (slice)");
  assert.ok(existsSync(join(runDir, "synthesis.md")), "synthesis.md missing (slice)");

  assert.equal(result.unitId, "M999/S99/round-1");
});

// (3) Bypass-attempt fail-closed (milestone)
test("(3) bypass-attempt fail-closed — milestone discuss-* unitType with no per-round manifest blocks ask_user_questions and never reaches showInterviewRound", async (t) => {
  const basePath = makeBase(t);
  resetAskUserQuestionsCache();

  // Seed an active discuss-milestone runtime record on disk; no per-round
  // omega artifacts exist, so the gate must block.
  writeUnitRuntimeRecord(basePath, "discuss-milestone", "M999", Date.now());

  const tool = captureAskUserQuestionsTool();
  let selectCalls = 0;
  let inputCalls = 0;
  const ctx = {
    cwd: basePath,
    hasUI: true,
    ui: {
      custom: () => undefined,
      select: async () => { selectCalls += 1; return "All"; },
      input: async () => { inputCalls += 1; return ""; },
    },
  };

  const result = await tool.execute("call-bypass-milestone", { questions: SAMPLE_QUESTIONS }, undefined, undefined, ctx);

  const text = result.content[0]?.text ?? "";
  assert.ok(
    /missing per-round Omega manifest|gsd_question_round_spiral/i.test(text),
    `gate-block message did not match expected pattern; got: ${text}`,
  );
  assert.equal(result.details.cancelled, true, "details.cancelled must be true on gate block");
  assert.equal(selectCalls, 0, "ctx.ui.select must NOT be called — showInterviewRound was never reached");
  assert.equal(inputCalls, 0, "ctx.ui.input must NOT be called — showInterviewRound was never reached");

  // The bypass-blocked journal event should have been written.
  const journalDir = join(gsdRoot(basePath), "journal");
  assert.ok(existsSync(journalDir), "journal dir must exist after gate block");
  const journalFiles = readdirSync(journalDir).filter((f) => f.endsWith(".jsonl"));
  assert.ok(journalFiles.length > 0, "expected at least one journal file");
  const journalContents = journalFiles
    .map((f) => readFileSync(join(journalDir, f), "utf-8"))
    .join("\n");
  assert.ok(
    journalContents.includes("question-round-bypass-blocked"),
    "journal must contain a question-round-bypass-blocked event",
  );
});

// (4) Bypass-attempt fail-closed (slice)
test("(4) bypass-attempt fail-closed — slice discuss-* unitType with no per-round manifest blocks ask_user_questions and never reaches showInterviewRound", async (t) => {
  const basePath = makeBase(t);
  resetAskUserQuestionsCache();

  writeUnitRuntimeRecord(basePath, "discuss-slice", "M999/S99", Date.now());

  const tool = captureAskUserQuestionsTool();
  let selectCalls = 0;
  const ctx = {
    cwd: basePath,
    hasUI: true,
    ui: {
      custom: () => undefined,
      select: async () => { selectCalls += 1; return "All"; },
      input: async () => "",
    },
  };

  const result = await tool.execute("call-bypass-slice", { questions: SAMPLE_QUESTIONS }, undefined, undefined, ctx);

  const text = result.content[0]?.text ?? "";
  assert.ok(
    /missing per-round Omega manifest|gsd_question_round_spiral/i.test(text),
    `gate-block message did not match expected pattern; got: ${text}`,
  );
  assert.equal(result.details.cancelled, true, "details.cancelled must be true on slice gate block");
  assert.equal(selectCalls, 0, "ctx.ui.select must NOT be called on slice gate block");

  // Block message should reference the slice scope explicitly so the
  // recovery agent can branch on it.
  assert.ok(/M999\/S99/.test(text), `block message should mention slice scope M999/S99; got: ${text}`);
});

// (5) Round-counter increment across sequential rounds 1, 2, 3
test("(5) round-counter increment — sequential rounds 1, 2, 3 produce three round-N dirs whose runIds differ", async (t) => {
  const basePath = makeBase(t);
  const adapters = makeAdapters([]);

  const runIds: string[] = [];
  for (const round of [1, 2, 3]) {
    const result = await runQuestionRoundSpiral({
      milestoneId: "M999",
      roundIndex: round,
      conversationState: `Conversation state for round ${round}.`,
      executor: async () => `canned-${round}`,
      basePath,
      adapters,
    });
    assert.ok(result.ok, `round ${round} must succeed, got ${JSON.stringify(result)}`);
    runIds.push(result.runId);

    const parentDir = join(gsdRoot(basePath), "milestones", "M999", "discuss", `round-${round}`, "omega");
    assert.ok(existsSync(parentDir), `round-${round}/omega dir must exist`);
    const runDirs = listSubdirs(parentDir);
    assert.equal(runDirs.length, 1, `exactly one runId dir under round-${round}/omega/`);

    const manifestPath = join(parentDir, runDirs[0], "phase-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    assert.equal(
      manifest.unitId,
      `M999/round-${round}`,
      `manifest unitId for round ${round} must encode the round counter`,
    );
  }

  const uniqueRunIds = new Set(runIds);
  assert.equal(uniqueRunIds.size, 3, "all three rounds must have distinct runIds");
});

// (6) Regex-guard: heuristic "1-3 questions" wording is absent from the three discuss prompts
test("(6) heuristic absence — none of the three discuss prompt files contain the legacy `1-3 questions` heuristic", () => {
  const promptFiles = [
    "src/resources/extensions/gsd/prompts/guided-discuss-milestone.md",
    "src/resources/extensions/gsd/prompts/guided-discuss-slice.md",
    "src/resources/extensions/gsd/prompts/discuss.md",
  ];
  // Match both ASCII hyphen and en-dash forms: "1-3 questions" / "1–3 questions"
  const heuristicRegex = /1[-\u2013]3 questions/g;

  for (const rel of promptFiles) {
    const content = readFileSync(rel, "utf-8");
    const matches = content.match(heuristicRegex) ?? [];
    assert.equal(
      matches.length,
      0,
      `${rel} must not contain the "1-3 questions" heuristic; found ${matches.length} match(es)`,
    );
  }
});

// (7) Regex-guard: each discuss prompt references gsd_question_round_spiral at least once
test("(7) prompt-tool reference — each of the three discuss prompts references `gsd_question_round_spiral` at least once", () => {
  const promptFiles = [
    "src/resources/extensions/gsd/prompts/guided-discuss-milestone.md",
    "src/resources/extensions/gsd/prompts/guided-discuss-slice.md",
    "src/resources/extensions/gsd/prompts/discuss.md",
  ];
  for (const rel of promptFiles) {
    const content = readFileSync(rel, "utf-8");
    assert.ok(
      content.includes("gsd_question_round_spiral"),
      `${rel} must reference gsd_question_round_spiral at least once`,
    );
  }
});

// (8) Non-discuss caller is unaffected by the gate
test("(8) non-discuss caller unaffected — ctx with no discuss-* runtime record skips the gate and proceeds to routing", async (t) => {
  const basePath = makeBase(t);
  resetAskUserQuestionsCache();

  // Seed an unrelated unit-runtime record (execute-task) so the runtime
  // dir exists but contains no discuss-* records — the gate must proceed.
  writeUnitRuntimeRecord(basePath, "execute-task", "M999/S99/T01", Date.now());

  const tool = captureAskUserQuestionsTool();
  let selectCalls = 0;
  const ctx = {
    cwd: basePath,
    hasUI: true,
    ui: {
      custom: () => undefined,
      select: async () => { selectCalls += 1; return "All"; },
      input: async () => "",
    },
  };

  const result = await tool.execute("call-noop-gate", { questions: SAMPLE_QUESTIONS }, undefined, undefined, ctx);

  // Routing must have reached the local-UI fallback that uses ctx.ui.select
  // (one call per question, plus the message must be valid answer JSON, NOT
  // the gate-block error).
  assert.equal(selectCalls, SAMPLE_QUESTIONS.length, "ctx.ui.select must be called once per question (gate did not block)");
  const text = result.content[0]?.text ?? "";
  assert.ok(
    !/missing per-round Omega manifest/i.test(text),
    `non-discuss caller must not see a gate-block message; got: ${text}`,
  );
  // Result should be valid answer JSON shape, not an error
  const parsed = JSON.parse(text) as { answers: Record<string, { answers: string[] }> };
  assert.ok(parsed.answers && parsed.answers.scope, "non-discuss caller should receive structured answer JSON");
});
