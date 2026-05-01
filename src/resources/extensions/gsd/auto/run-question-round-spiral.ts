/**
 * runQuestionRoundSpiral — per-question-round Omega spiral helper for the
 * three guided-flow discuss surfaces (`guided-discuss-milestone.md`,
 * `guided-discuss-slice.md`, `discuss.md`).
 *
 * Composes the IAM kernel's `executeOmegaSpiral` (`src/iam/omega.ts`) with
 * `persistPhaseOmegaRun` + `validatePhaseOmegaArtifacts`
 * (`src/resources/extensions/gsd/omega-phase-artifacts.ts`) at per-round
 * granularity. Per the T01 audit (section e), routing uses the new
 * `discuss-question-round` `OmegaPhaseUnitType`; `omegaPhaseUnitDir` redirects
 * its artifacts under the milestone (or slice) tree at:
 *
 *   - milestone-discuss: `<gsdRoot>/milestones/<MID>/discuss/round-<N>/omega/<runId>/`
 *   - slice-discuss:     `<gsdRoot>/milestones/<MID>/slices/<SID>/discuss/round-<N>/omega/<runId>/`
 *
 * Behavior (mirrors run-phase-spiral structure):
 *   1. Validate inputs (milestoneId, roundIndex, conversationState). On reject
 *      emit `question-round-spiral-failed` and return failingStage:
 *      "unit-validation" — no artifacts written.
 *   2. Construct unitId `<MID>/round-<N>` (milestone) or `<MID>/<SID>/round-<N>`
 *      (slice).
 *   3. Emit `question-round-spiral-started` journal event up-front so a
 *      crashed executor still leaves a trace.
 *   4. Run all 10 canonical stages (URUZ→…→JERA) plus synthesis via
 *      `persistPhaseOmegaRun`. The same writers used by `runPhaseSpiral` are
 *      reused — no parallel implementation.
 *   5. Read-back validate the persisted artifacts via
 *      `validatePhaseOmegaArtifacts`. On any miss return a structured
 *      `{ ok: false, failingStage, missingArtifacts, remediation }` payload
 *      whose shape matches `runPhaseSpiral`'s failure shape.
 *   6. Emit `question-round-spiral-completed` (success) or
 *      `question-round-spiral-failed` (any incomplete state).
 *
 * Never throws — every failure path returns a structured payload AND emits
 * a `question-round-spiral-failed` journal event. R037 honored: no
 * abbreviation flag, no skip-on-trivial heuristic, no preference override.
 *
 * NOTE: This helper does not wire itself into prompts or add the
 * fail-closed gate inside `ask_user_questions.execute` — that is T03.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";

import type {
  IAMError,
  OmegaExecutor,
  OmegaPersona,
  OmegaStageName,
  RuneName,
} from "../../../../iam/types.js";
import { atomicWriteSync } from "../atomic-write.js";
import { emitJournalEvent } from "../journal.js";
import {
  omegaPhaseUnitDir,
  omegaSynthesisPath,
  persistPhaseOmegaRun,
  validatePhaseOmegaArtifacts,
  type OmegaPhaseManifest,
  type OmegaPhasePersistenceAdapters,
} from "../omega-phase-artifacts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunQuestionRoundSpiralOptions {
  /** Milestone identifier (e.g. `M001` or `M001-r5jzab`). Required. */
  milestoneId: string;
  /** Slice identifier (e.g. `S01`); required for slice-discuss, omitted for milestone-discuss. */
  sliceId?: string;
  /**
   * 1-based per-(milestone, slice?) round counter. The discuss-flow gate
   * (T03) enforces strict monotonic increase by enumerating existing
   * `round-<N>` directories on disk.
   */
  roundIndex: number;
  /**
   * Conversation state markdown the spiral governs — concise summary of what
   * the user has said so far, what is still unknown, what the next round is
   * targeting. Becomes the Omega query.
   */
  conversationState: string;
  /** LLM executor; one prompt per stage plus one final synthesis prompt. */
  executor: OmegaExecutor;
  /** Project base path; relative artifact paths resolve against this. */
  basePath: string;
  /** Optional Omega persona lens. */
  persona?: OmegaPersona;
  /** Optional governance rune annotations. */
  runes?: RuneName[];
  /**
   * Optional context envelope id from the calling discuss dispatch unit;
   * recorded on the journal events for IAM provenance.
   */
  envelopeId?: string;
  /**
   * Optional flow id for the journal events. When omitted a fresh UUID is
   * generated so the helper can stand alone in tests.
   */
  flowId?: string;
  /**
   * Optional persistence adapter override. When omitted,
   * `persistPhaseOmegaRun` uses the default DB-backed adapters. Tests inject
   * in-memory adapters so the helper can run without a live DB.
   */
  adapters?: OmegaPhasePersistenceAdapters;
}

/**
 * Where in the run the helper failed. `unit-validation` is "input rejected
 * before the spiral started"; `executor` / `<stage>` are propagated from
 * `executeOmegaSpiral`; `persistence` is a write or DB failure;
 * `validation` is the fail-closed structural gate after persistence.
 */
export type QuestionRoundSpiralFailingStage =
  | "unit-validation"
  | "executor"
  | OmegaStageName
  | "persistence"
  | "validation";

export interface RunQuestionRoundSpiralSuccess {
  ok: true;
  unitType: "discuss-question-round";
  unitId: string;
  runId: string;
  manifestPath: string;
  artifactDir: string;
  /** Always non-null on success — the structural gate requires it. */
  synthesisPath: string;
  stageCount: 10;
  manifest: OmegaPhaseManifest;
  durationMs: number;
}

export interface RunQuestionRoundSpiralFailure {
  ok: false;
  unitType: "discuss-question-round" | string;
  unitId: string;
  failingStage: QuestionRoundSpiralFailingStage;
  missingArtifacts: string[];
  remediation: string;
  iamError?: IAMError;
  durationMs: number;
}

export type RunQuestionRoundSpiralResult =
  | RunQuestionRoundSpiralSuccess
  | RunQuestionRoundSpiralFailure;

// ─── Public entrypoint ───────────────────────────────────────────────────────

/**
 * Run the canonical 10-stage Omega spiral over per-round conversation state,
 * persist per-stage + manifest artifacts under the per-round milestone (or
 * slice) tree, validate the structural gate, and emit lifecycle journal
 * events. Never throws.
 */
export async function runQuestionRoundSpiral(
  options: RunQuestionRoundSpiralOptions,
): Promise<RunQuestionRoundSpiralResult> {
  const startedAt = Date.now();
  const flowId = options.flowId ?? randomUUID();
  const unitType = "discuss-question-round" as const;

  // ─── Input validation ─────────────────────────────────────────────────
  const milestoneId = typeof options.milestoneId === "string" ? options.milestoneId.trim() : "";
  const sliceId = typeof options.sliceId === "string" ? options.sliceId.trim() : undefined;
  const conversationState = typeof options.conversationState === "string" ? options.conversationState.trim() : "";
  const roundIndex = options.roundIndex;

  if (!milestoneId) {
    return inputFailure(options, flowId, startedAt, unitType, milestoneId, sliceId, "missing milestoneId", "Provide milestoneId (e.g. M001).");
  }
  if (!Number.isInteger(roundIndex) || roundIndex < 1) {
    return inputFailure(options, flowId, startedAt, unitType, milestoneId, sliceId, "invalid roundIndex", "Provide a positive integer roundIndex (1-based).");
  }
  if (!conversationState) {
    return inputFailure(options, flowId, startedAt, unitType, milestoneId, sliceId, "missing conversationState", "Provide a non-empty conversationState markdown summary the Omega spiral can govern.");
  }
  if (typeof options.executor !== "function") {
    return inputFailure(options, flowId, startedAt, unitType, milestoneId, sliceId, "missing executor", "Provide an OmegaExecutor function (one prompt per stage plus synthesis).");
  }
  if (typeof options.basePath !== "string" || options.basePath.length === 0) {
    return inputFailure(options, flowId, startedAt, unitType, milestoneId, sliceId, "missing basePath", "Provide a non-empty basePath; relative artifact paths resolve against it.");
  }

  const unitId = sliceId
    ? `${milestoneId}/${sliceId}/round-${roundIndex}`
    : `${milestoneId}/round-${roundIndex}`;

  // ─── Started event ────────────────────────────────────────────────────
  emitJournalEvent(options.basePath, {
    ts: new Date().toISOString(),
    flowId,
    seq: 0,
    eventType: "question-round-spiral-started",
    data: {
      milestoneId,
      sliceId: sliceId ?? null,
      roundIndex,
      unitType,
      unitId,
      ...(options.envelopeId ? { envelopeId: options.envelopeId } : {}),
    },
  });

  // ─── Resolve target artifact path (synthesis.md inside the per-round dir) ──
  // The runId is minted by persistOmegaRun, so we cannot pre-compute the
  // <runId>/synthesis.md path. Instead, target the unit-dir-level
  // synthesis.md placeholder; persistPhaseOmegaRun normalizes targetArtifactPath
  // through the shared helpers, and validatePhaseOmegaArtifacts only requires
  // existsSync(targetArtifactPath). We post-write the placeholder before the
  // read-back validation — same pattern run-phase-spiral uses for aggregates.
  const unitDir = omegaPhaseUnitDir(options.basePath, unitType, unitId);
  const targetArtifactPath = omegaSynthesisPath(unitDir);

  // ─── Run + persist the spiral ─────────────────────────────────────────
  const persistResult = await persistPhaseOmegaRun({
    basePath: options.basePath,
    unitType,
    unitId,
    query: conversationState,
    targetArtifactPath,
    executor: options.executor,
    ...(options.persona ? { persona: options.persona } : {}),
    ...(options.runes ? { runes: options.runes } : {}),
    ...(options.adapters ? { adapters: options.adapters } : {}),
  });

  if (!persistResult.ok) {
    const failingStage = mapErrorToFailingStage(persistResult.error);
    const missingArtifacts = collectMissingArtifactsFromError(persistResult.error);
    return emitFailure({
      basePath: options.basePath,
      flowId,
      startedAt,
      unitType,
      unitId,
      milestoneId,
      sliceId,
      roundIndex,
      failingStage,
      missingArtifacts,
      remediation: persistResult.error.remediation,
      iamError: persistResult.error,
    });
  }

  const manifest = persistResult.value;

  // ─── Stamp the unit-dir synthesis.md placeholder so the read-back gate
  //     for `targetArtifactPath` passes. The runId-scoped synthesis.md is
  //     written by persistOmegaRun. ────────────────────────────────────────
  const placeholderWrite = writeSynthesisPlaceholder({
    basePath: options.basePath,
    targetArtifactPath,
    manifest,
    options,
    adapters: options.adapters,
  });
  if (!placeholderWrite.ok) {
    return emitFailure({
      basePath: options.basePath,
      flowId,
      startedAt,
      unitType,
      unitId,
      milestoneId,
      sliceId,
      roundIndex,
      failingStage: "persistence",
      missingArtifacts: [targetArtifactPath],
      remediation: placeholderWrite.remediation,
    });
  }

  // ─── Read-back structural validation ──────────────────────────────────
  const validation = validatePhaseOmegaArtifacts({
    manifestPath: manifest.manifestPath,
    expectedUnitType: unitType,
    expectedUnitId: unitId,
    expectedRunId: manifest.runId,
    expectedTargetArtifactPath: targetArtifactPath,
  });

  if (!validation.ok) {
    return emitFailure({
      basePath: options.basePath,
      flowId,
      startedAt,
      unitType,
      unitId,
      milestoneId,
      sliceId,
      roundIndex,
      failingStage: "validation",
      missingArtifacts: extractMissingPathsFromGap(validation.error.validationGap ?? ""),
      remediation: validation.error.remediation,
      iamError: validation.error,
    });
  }

  const validatedManifest = validation.value;
  const durationMs = Date.now() - startedAt;

  emitJournalEvent(options.basePath, {
    ts: new Date().toISOString(),
    flowId,
    seq: 1,
    eventType: "question-round-spiral-completed",
    data: {
      milestoneId,
      sliceId: sliceId ?? null,
      roundIndex,
      unitType,
      unitId,
      runId: validatedManifest.runId,
      manifestPath: relativeFromBase(options.basePath, validatedManifest.manifestPath),
      stageCount: validatedManifest.stageCount,
      durationMs,
      verdict: "ok",
      ...(options.envelopeId ? { envelopeId: options.envelopeId } : {}),
    },
  });

  // synthesisPath is non-null on success — validation requires it.
  const synthesisPath = validatedManifest.synthesisPath ?? targetArtifactPath;

  return {
    ok: true,
    unitType,
    unitId,
    runId: validatedManifest.runId,
    manifestPath: validatedManifest.manifestPath,
    artifactDir: validatedManifest.artifactDir,
    synthesisPath,
    stageCount: 10,
    manifest: validatedManifest,
    durationMs,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface WritePlaceholderOptions {
  basePath: string;
  targetArtifactPath: string;
  manifest: OmegaPhaseManifest;
  options: RunQuestionRoundSpiralOptions;
  adapters?: OmegaPhasePersistenceAdapters;
}

interface WritePlaceholderResult {
  ok: boolean;
  remediation: string;
}

/**
 * Write a thin synthesis placeholder at the unit-dir level so
 * `validatePhaseOmegaArtifacts` finds the targetArtifactPath that
 * persistPhaseOmegaRun was told about. The canonical per-stage + run-scoped
 * synthesis.md still lives under `artifactDir/<runId>/synthesis.md` and is
 * written by persistOmegaRun unchanged.
 */
function writeSynthesisPlaceholder(opts: WritePlaceholderOptions): WritePlaceholderResult {
  try {
    const lines = [
      "---",
      `unitType: ${opts.manifest.unitType}`,
      `unitId: ${opts.manifest.unitId}`,
      `runId: ${opts.manifest.runId}`,
      `manifestPath: ${relativeFromBase(opts.basePath, opts.manifest.manifestPath)}`,
      `artifactDir: ${relativeFromBase(opts.basePath, opts.manifest.artifactDir)}`,
      `runManifestPath: ${relativeFromBase(opts.basePath, opts.manifest.runManifestPath)}`,
      `synthesisPath: ${opts.manifest.synthesisPath ? relativeFromBase(opts.basePath, opts.manifest.synthesisPath) : "null"}`,
      `stageCount: ${opts.manifest.stageCount}`,
      `roundIndex: ${opts.options.roundIndex}`,
      ...(opts.options.envelopeId ? [`envelopeId: ${opts.options.envelopeId}`] : []),
      `generatedAt: ${opts.manifest.updatedAt}`,
      "---",
      "",
      `# discuss-question-round synthesis pointer (${opts.manifest.unitId})`,
      "",
      "<!--",
      "Per-round Omega spiral artifacts live under the artifactDir referenced above.",
      "The canonical 10 stage files plus the spiral-side synthesis.md sit inside",
      "<artifactDir>; this file is the unit-dir-level pointer the structural",
      "validatePhaseOmegaArtifacts gate reads back to confirm the round is complete.",
      "-->",
      "",
    ];
    const content = lines.join("\n");

    // Use the same atomic-write adapter the rest of phase persistence uses so
    // tests can inject an in-memory writer; fall back to the canonical
    // on-disk writer when no adapter override is provided.
    mkdirSync(dirname(opts.targetArtifactPath), { recursive: true });
    if (opts.adapters?.atomicWrite) {
      opts.adapters.atomicWrite(opts.targetArtifactPath, content);
    } else {
      atomicWriteSync(opts.targetArtifactPath, content);
    }
    return { ok: true, remediation: "" };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      remediation: `Failed to write per-round synthesis pointer at ${opts.targetArtifactPath}: ${message}. Inspect parent-directory permissions and rerun the question-round spiral.`,
    };
  }
}

function inputFailure(
  options: RunQuestionRoundSpiralOptions,
  flowId: string,
  startedAt: number,
  unitType: "discuss-question-round",
  milestoneId: string,
  sliceId: string | undefined,
  validationGap: string,
  remediation: string,
): RunQuestionRoundSpiralFailure {
  // Best-effort unitId for diagnostics; may be partial on input rejection.
  const partialRound = Number.isInteger(options.roundIndex) ? options.roundIndex : "?";
  const unitId = milestoneId
    ? sliceId
      ? `${milestoneId}/${sliceId}/round-${partialRound}`
      : `${milestoneId}/round-${partialRound}`
    : "<invalid>";
  return emitFailure({
    basePath: typeof options.basePath === "string" && options.basePath ? options.basePath : process.cwd(),
    flowId,
    startedAt,
    unitType,
    unitId,
    milestoneId: milestoneId || null,
    sliceId,
    roundIndex: typeof options.roundIndex === "number" ? options.roundIndex : null,
    failingStage: "unit-validation",
    missingArtifacts: [],
    remediation: `${validationGap}: ${remediation}`,
  });
}

interface EmitFailureArgs {
  basePath: string;
  flowId: string;
  startedAt: number;
  unitType: "discuss-question-round" | string;
  unitId: string;
  milestoneId: string | null;
  sliceId: string | undefined;
  roundIndex: number | null;
  failingStage: QuestionRoundSpiralFailingStage;
  missingArtifacts: string[];
  remediation: string;
  iamError?: IAMError;
}

function emitFailure(args: EmitFailureArgs): RunQuestionRoundSpiralFailure {
  const durationMs = Date.now() - args.startedAt;
  emitJournalEvent(args.basePath, {
    ts: new Date().toISOString(),
    flowId: args.flowId,
    seq: 1,
    eventType: "question-round-spiral-failed",
    data: {
      milestoneId: args.milestoneId,
      sliceId: args.sliceId ?? null,
      roundIndex: args.roundIndex,
      unitType: args.unitType,
      unitId: args.unitId,
      failingStage: args.failingStage,
      missingArtifacts: args.missingArtifacts,
      remediation: args.remediation,
      durationMs,
      verdict: "fail",
    },
  });

  const failure: RunQuestionRoundSpiralFailure = {
    ok: false,
    unitType: args.unitType,
    unitId: args.unitId,
    failingStage: args.failingStage,
    missingArtifacts: args.missingArtifacts,
    remediation: args.remediation,
    durationMs,
  };
  if (args.iamError) failure.iamError = args.iamError;
  return failure;
}

function mapErrorToFailingStage(error: IAMError): QuestionRoundSpiralFailingStage {
  if (error.iamErrorKind === "omega-stage-failed") {
    if (error.stage) return error.stage;
    return "executor";
  }
  if (error.iamErrorKind === "executor-not-wired") return "executor";
  if (error.iamErrorKind === "persistence-failed") return "persistence";
  return "persistence";
}

function collectMissingArtifactsFromError(error: IAMError): string[] {
  const out: string[] = [];
  if (error.target) out.push(error.target);
  if (error.validationGap) out.push(...extractMissingPathsFromGap(error.validationGap));
  return Array.from(new Set(out));
}

function extractMissingPathsFromGap(gap: string): string[] {
  if (!gap) return [];
  const lines = gap.split("\n").map((l) => l.trim()).filter(Boolean);
  const paths: string[] = [];
  for (const line of lines) {
    const colonIdx = line.lastIndexOf(": ");
    if (colonIdx > 0) {
      const candidate = line.slice(colonIdx + 2).trim();
      if (candidate.startsWith("/") || /^[A-Za-z]:[\\/]/.test(candidate)) {
        paths.push(candidate);
      }
    }
  }
  return paths;
}

function relativeFromBase(basePath: string, path: string): string {
  if (!isAbsolute(path)) return path;
  const rel = relative(basePath, path);
  if (rel && !rel.startsWith("..") && rel !== ".") return rel;
  return path;
}

