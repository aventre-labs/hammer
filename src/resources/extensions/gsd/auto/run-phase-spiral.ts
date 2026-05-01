/**
 * runPhaseSpiral — phase-aware Omega spiral helper.
 *
 * Wraps the IAM kernel's `executeOmegaSpiral` (`src/iam/omega.ts`),
 * `persistPhaseOmegaRun` / `validatePhaseOmegaArtifacts`
 * (`src/resources/extensions/gsd/omega-phase-artifacts.ts`) into a single
 * phase-aware invocation surface for the six governed dispatch phases:
 *
 *   - milestone-discuss   → unitType `discuss-milestone`,   milestoneId
 *   - milestone-planning  → unitType `plan-milestone`,      milestoneId
 *   - slice-planning      → unitType `plan-slice`,          milestoneId/sliceId
 *   - replanning          → unitType `replan-slice`,        milestoneId/sliceId
 *   - roadmap-reassess    → unitType `reassess-roadmap`,    milestoneId
 *   - verification        → unitType `validate-milestone`,  milestoneId
 *
 * Behavior:
 *   1. Emit `phase-spiral-started` journal event.
 *   2. Validate inputs and derive unitType/unitId from phase.
 *   3. Run all 10 canonical stages via `persistPhaseOmegaRun` (which itself
 *      composes `executeOmegaSpiral` + `persistOmegaRun`).
 *   4. Validate the persisted manifest via `validatePhaseOmegaArtifacts`
 *      (read-back from disk; structural fail-closed gate).
 *   5. Write or update the aggregate artifact at `targetArtifactPath` with
 *      YAML frontmatter that links `runId`, `manifestPath`, the 10 per-stage
 *      relative paths, the optional `envelopeId`, and IAM provenance.
 *   6. Emit `phase-spiral-completed` (success) or `phase-spiral-failed`
 *      (any incomplete state) journal events.
 *
 * Never throws — every failure path returns a structured
 * `{ ok: false, failingStage, missingArtifacts, remediation }` payload that
 * matches the fail-closed shapes used at
 * `src/resources/extensions/gsd/bootstrap/iam-tools.ts` and
 * `src/resources/extensions/gsd/bootstrap/write-gate.ts`.
 *
 * NOTE: T02 only delivers this helper. T03 wires it into the dispatch rules
 * in `auto-dispatch.ts` and `auto-direct-dispatch.ts`. T04 lands smoke
 * coverage and any final journal-event polish.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

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
  persistPhaseOmegaRun,
  validatePhaseOmegaArtifacts,
  type OmegaPhaseManifest,
  type OmegaPhasePersistenceAdapters,
  type OmegaPhaseUnitType,
} from "../omega-phase-artifacts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The six governed dispatch phases that must run a canonical Omega spiral. */
export type PhaseSpiralPhase =
  | "milestone-discuss"
  | "milestone-planning"
  | "slice-planning"
  | "replanning"
  | "roadmap-reassess"
  | "verification";

interface PhaseDescriptor {
  unitType: OmegaPhaseUnitType;
  /** When true, the unitId is `<milestoneId>/<sliceId>`; otherwise just `<milestoneId>`. */
  sliceScoped: boolean;
}

const PHASE_DESCRIPTORS: Record<PhaseSpiralPhase, PhaseDescriptor> = {
  "milestone-discuss":   { unitType: "discuss-milestone",   sliceScoped: false },
  "milestone-planning":  { unitType: "plan-milestone",      sliceScoped: false },
  "slice-planning":      { unitType: "plan-slice",          sliceScoped: true  },
  "replanning":          { unitType: "replan-slice",        sliceScoped: true  },
  "roadmap-reassess":    { unitType: "reassess-roadmap",    sliceScoped: false },
  "verification":        { unitType: "validate-milestone",  sliceScoped: false },
};

export interface RunPhaseSpiralOptions {
  /** Which governed dispatch phase is requesting the spiral. */
  phase: PhaseSpiralPhase;
  /** Milestone identifier (e.g. `M001` or `M001-r5jzab`). */
  milestoneId: string;
  /** Slice identifier (e.g. `S01`); required for slice-scoped phases. */
  sliceId?: string;
  /** Phase research / planning question that the spiral must govern. */
  query: string;
  /** LLM executor; one prompt per stage plus one final synthesis prompt. */
  executor: OmegaExecutor;
  /** Project base path; all relative artifact paths resolve against this. */
  basePath: string;
  /**
   * Target aggregate artifact path (e.g. `S01-PLAN.md`, `M001-DISCUSS.md`).
   * The helper writes / updates this file's YAML frontmatter to link the
   * spiral artifacts. Caller (T03 dispatch consumer) supplies the body.
   */
  targetArtifactPath: string;
  /** Optional Omega persona lens. */
  persona?: OmegaPersona;
  /** Optional governance rune annotations. */
  runes?: RuneName[];
  /**
   * Optional context envelope id from the calling dispatch unit; recorded
   * in the aggregate frontmatter for IAM provenance.
   */
  envelopeId?: string;
  /**
   * Optional flow id for the journal events. When omitted a fresh UUID is
   * generated so the helper can stand alone in tests.
   */
  flowId?: string;
  /**
   * Optional persistence adapter override. When omitted,
   * `persistPhaseOmegaRun` uses the default DB-backed adapters. Tests
   * inject in-memory adapters so the helper can run without a live DB.
   */
  adapters?: OmegaPhasePersistenceAdapters;
}

/**
 * Where in the run the helper failed. `unit-validation` is "input rejected
 * before the spiral started"; `executor` / `<stage>` are propagated from
 * `executeOmegaSpiral`; `persistence` is a write or DB failure;
 * `validation` is the fail-closed structural gate after persistence;
 * `aggregate-write` is an aggregate frontmatter write failure.
 */
export type PhaseSpiralFailingStage =
  | "unit-validation"
  | "executor"
  | OmegaStageName
  | "persistence"
  | "validation"
  | "aggregate-write";

export interface RunPhaseSpiralSuccess {
  ok: true;
  phase: PhaseSpiralPhase;
  unitType: OmegaPhaseUnitType;
  unitId: string;
  runId: string;
  manifestPath: string;
  artifactDir: string;
  aggregateArtifactPath: string;
  stageCount: number;
  manifest: OmegaPhaseManifest;
  durationMs: number;
}

export interface RunPhaseSpiralFailure {
  ok: false;
  phase: PhaseSpiralPhase;
  unitType: OmegaPhaseUnitType | string;
  unitId: string;
  failingStage: PhaseSpiralFailingStage;
  missingArtifacts: string[];
  remediation: string;
  iamError?: IAMError;
  durationMs: number;
}

export type RunPhaseSpiralResult = RunPhaseSpiralSuccess | RunPhaseSpiralFailure;

// ─── Public entrypoint ───────────────────────────────────────────────────────

/**
 * Run the canonical 10-stage Omega spiral for a governed dispatch phase,
 * persist per-stage + manifest artifacts, validate the structural gate, and
 * stamp the aggregate artifact's frontmatter with spiral provenance.
 *
 * Never throws. On any incomplete state returns a structured failure
 * payload AND emits a `phase-spiral-failed` journal event so downstream
 * forensics tooling (S03) can diagnose without re-deriving cause.
 */
export async function runPhaseSpiral(
  options: RunPhaseSpiralOptions,
): Promise<RunPhaseSpiralResult> {
  const startedAt = Date.now();
  const flowId = options.flowId ?? randomUUID();
  const descriptor = PHASE_DESCRIPTORS[options.phase];

  // Slice-scoped phases require sliceId; milestone-scoped phases must NOT
  // receive one (so the unitId pattern is unambiguous).
  if (descriptor.sliceScoped && !options.sliceId) {
    return inputFailure({
      phase: options.phase,
      unitType: descriptor.unitType,
      unitId: options.milestoneId,
      basePath: options.basePath,
      flowId,
      startedAt,
      remediation: `Phase "${options.phase}" is slice-scoped; provide sliceId (e.g. "S01").`,
    });
  }
  if (!descriptor.sliceScoped && options.sliceId) {
    return inputFailure({
      phase: options.phase,
      unitType: descriptor.unitType,
      unitId: options.milestoneId,
      basePath: options.basePath,
      flowId,
      startedAt,
      remediation: `Phase "${options.phase}" is milestone-scoped; do not pass sliceId.`,
    });
  }

  const unitId = descriptor.sliceScoped
    ? `${options.milestoneId}/${options.sliceId}`
    : options.milestoneId;
  const { unitType } = descriptor;
  const targetArtifactPath = normalizePath(options.basePath, options.targetArtifactPath);

  // Emit started event up-front so a crashed executor still leaves a trace.
  emitJournalEvent(options.basePath, {
    ts: new Date().toISOString(),
    flowId,
    seq: 0,
    eventType: "phase-spiral-started",
    data: {
      phase: options.phase,
      unitType,
      unitId,
      milestoneId: options.milestoneId,
      sliceId: options.sliceId ?? null,
      targetArtifactPath: relativeFromBase(options.basePath, targetArtifactPath),
      ...(options.envelopeId ? { envelopeId: options.envelopeId } : {}),
    },
  });

  // 1. Run + persist the spiral. persistPhaseOmegaRun composes
  //    executeOmegaSpiral + persistOmegaRun and writes phase-manifest.json.
  const persistResult = await persistPhaseOmegaRun({
    basePath: options.basePath,
    unitType,
    unitId,
    query: options.query,
    targetArtifactPath,
    executor: options.executor,
    ...(options.persona ? { persona: options.persona } : {}),
    ...(options.runes ? { runes: options.runes } : {}),
    ...(options.adapters ? { adapters: options.adapters } : {}),
  });

  if (!persistResult.ok) {
    const failingStage = mapErrorToFailingStage(persistResult.error);
    const missingArtifacts = collectMissingArtifactsFromError(
      persistResult.error,
      options.basePath,
      unitType,
      unitId,
    );
    return emitFailure({
      phase: options.phase,
      unitType,
      unitId,
      failingStage,
      missingArtifacts,
      remediation: persistResult.error.remediation,
      iamError: persistResult.error,
      basePath: options.basePath,
      flowId,
      startedAt,
    });
  }

  const manifest = persistResult.value;

  // 2. Write / update aggregate artifact frontmatter so the read-back gate
  //    (which requires the target artifact to exist) can pass.
  const aggregateWrite = writeAggregateArtifact({
    basePath: options.basePath,
    targetArtifactPath,
    phase: options.phase,
    unitType,
    unitId,
    manifest,
    envelopeId: options.envelopeId,
    persona: options.persona,
    runes: options.runes ?? [],
  });

  if (!aggregateWrite.ok) {
    return emitFailure({
      phase: options.phase,
      unitType,
      unitId,
      failingStage: "aggregate-write",
      missingArtifacts: [targetArtifactPath],
      remediation: aggregateWrite.remediation,
      basePath: options.basePath,
      flowId,
      startedAt,
    });
  }

  // 3. Read-back validation — fail-closed structural gate on disk.
  const validation = validatePhaseOmegaArtifacts({
    manifestPath: manifest.manifestPath,
    expectedUnitType: unitType,
    expectedUnitId: unitId,
    expectedRunId: manifest.runId,
    expectedTargetArtifactPath: targetArtifactPath,
  });

  if (!validation.ok) {
    return emitFailure({
      phase: options.phase,
      unitType,
      unitId,
      failingStage: "validation",
      missingArtifacts: extractMissingPathsFromGap(validation.error.validationGap ?? ""),
      remediation: validation.error.remediation,
      iamError: validation.error,
      basePath: options.basePath,
      flowId,
      startedAt,
    });
  }

  const validatedManifest = validation.value;

  // 4. Success event.
  const durationMs = Date.now() - startedAt;
  emitJournalEvent(options.basePath, {
    ts: new Date().toISOString(),
    flowId,
    seq: 1,
    eventType: "phase-spiral-completed",
    data: {
      phase: options.phase,
      unitType,
      unitId,
      milestoneId: extractMilestoneId(unitId),
      sliceId: options.sliceId ?? null,
      runId: validatedManifest.runId,
      manifestPath: relativeFromBase(options.basePath, validatedManifest.manifestPath),
      stageCount: validatedManifest.stageCount,
      durationMs,
      verdict: "ok",
    },
  });

  return {
    ok: true,
    phase: options.phase,
    unitType,
    unitId,
    runId: validatedManifest.runId,
    manifestPath: validatedManifest.manifestPath,
    artifactDir: validatedManifest.artifactDir,
    aggregateArtifactPath: targetArtifactPath,
    stageCount: validatedManifest.stageCount,
    manifest: validatedManifest,
    durationMs,
  };
}

// ─── Aggregate artifact frontmatter ──────────────────────────────────────────

interface WriteAggregateOptions {
  basePath: string;
  targetArtifactPath: string;
  phase: PhaseSpiralPhase;
  unitType: OmegaPhaseUnitType;
  unitId: string;
  manifest: OmegaPhaseManifest;
  envelopeId?: string;
  persona?: OmegaPersona;
  runes: RuneName[];
}

interface WriteAggregateResult {
  ok: boolean;
  remediation: string;
}

function writeAggregateArtifact(opts: WriteAggregateOptions): WriteAggregateResult {
  try {
    const stageLinks = Object.entries(opts.manifest.stageFilePaths)
      .map(([stage, path]) => ({
        stage,
        path: relativeFromBase(opts.basePath, path),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    const frontmatterFields: Record<string, unknown> = {
      phase: opts.phase,
      unitType: opts.unitType,
      unitId: opts.unitId,
      runId: opts.manifest.runId,
      manifestPath: relativeFromBase(opts.basePath, opts.manifest.manifestPath),
      artifactDir: relativeFromBase(opts.basePath, opts.manifest.artifactDir),
      runManifestPath: relativeFromBase(opts.basePath, opts.manifest.runManifestPath),
      synthesisPath: opts.manifest.synthesisPath
        ? relativeFromBase(opts.basePath, opts.manifest.synthesisPath)
        : null,
      stageCount: opts.manifest.stageCount,
      iamProvenance: {
        source: "runPhaseSpiral",
        spiralStatus: opts.manifest.status,
        ...(opts.persona ? { persona: opts.persona } : {}),
        ...(opts.runes.length > 0 ? { runes: opts.runes } : {}),
      },
      ...(opts.envelopeId ? { envelopeId: opts.envelopeId } : {}),
      stageLinks,
      generatedAt: opts.manifest.updatedAt,
    };

    const frontmatter = renderYamlFrontmatter(frontmatterFields);
    const existingBody = readBodyPreservingExisting(opts.targetArtifactPath);
    const next = `${frontmatter}${existingBody ?? defaultAggregateBody(opts)}`;

    mkdirSync(dirname(opts.targetArtifactPath), { recursive: true });
    atomicWriteSync(opts.targetArtifactPath, next);
    return { ok: true, remediation: "" };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      remediation: `Failed to write aggregate artifact at ${opts.targetArtifactPath}: ${message}. Inspect parent-directory permissions and rerun the governed phase.`,
    };
  }
}

function defaultAggregateBody(opts: WriteAggregateOptions): string {
  return [
    `# ${opts.phase} aggregate (${opts.unitType} ${opts.unitId})`,
    "",
    "<!--",
    "Body populated by the phase consumer (see auto-dispatch.ts in T03).",
    "Spiral provenance and per-stage artifact links live in the YAML frontmatter above.",
    "-->",
    "",
  ].join("\n");
}

/**
 * Read the existing target file, strip a leading YAML frontmatter block if
 * present, and return the body. Returns `null` if the file does not exist
 * (caller substitutes a default body).
 */
function readBodyPreservingExisting(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return raw;
  const closeIdx = raw.indexOf("\n---\n", 4);
  const closeIdxCrlf = raw.indexOf("\r\n---\r\n", 4);
  const idx =
    closeIdx >= 0 && (closeIdxCrlf < 0 || closeIdx < closeIdxCrlf)
      ? closeIdx + "\n---\n".length
      : closeIdxCrlf >= 0
        ? closeIdxCrlf + "\r\n---\r\n".length
        : -1;
  if (idx < 0) return raw;
  return raw.slice(idx);
}

/** Minimal YAML emitter for the small, controlled frontmatter shape. */
function renderYamlFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    appendYamlValue(lines, key, value, 0);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function appendYamlValue(
  lines: string[],
  key: string,
  value: unknown,
  indent: number,
): void {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) {
    lines.push(`${pad}${key}: null`);
    return;
  }
  if (typeof value === "string") {
    lines.push(`${pad}${key}: ${yamlScalar(value)}`);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    lines.push(`${pad}${key}: ${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad}${key}: []`);
      return;
    }
    lines.push(`${pad}${key}:`);
    for (const item of value) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length === 0) {
          lines.push(`${pad}  - {}`);
          continue;
        }
        const [firstKey, firstVal] = entries[0];
        lines.push(`${pad}  - ${firstKey}: ${yamlInline(firstVal)}`);
        for (const [k, v] of entries.slice(1)) {
          lines.push(`${pad}    ${k}: ${yamlInline(v)}`);
        }
      } else {
        lines.push(`${pad}  - ${yamlInline(item)}`);
      }
    }
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      lines.push(`${pad}${key}: {}`);
      return;
    }
    lines.push(`${pad}${key}:`);
    for (const [k, v] of entries) {
      appendYamlValue(lines, k, v, indent + 2);
    }
    return;
  }
  lines.push(`${pad}${key}: ${yamlScalar(String(value))}`);
}

function yamlInline(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return yamlScalar(String(value));
}

function yamlScalar(value: string): string {
  // Quote when the value contains characters that would otherwise be parsed
  // as YAML structure, or when it could be misread as a non-string scalar.
  if (value === "") return '""';
  if (/^[A-Za-z0-9_./-]+$/.test(value) && !/^(true|false|null|yes|no)$/i.test(value)) {
    return value;
  }
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// ─── Failure helpers ─────────────────────────────────────────────────────────

interface InputFailureArgs {
  phase: PhaseSpiralPhase;
  unitType: OmegaPhaseUnitType;
  unitId: string;
  basePath: string;
  flowId: string;
  startedAt: number;
  remediation: string;
}

function inputFailure(args: InputFailureArgs): RunPhaseSpiralFailure {
  return emitFailure({
    phase: args.phase,
    unitType: args.unitType,
    unitId: args.unitId,
    failingStage: "unit-validation",
    missingArtifacts: [],
    remediation: args.remediation,
    basePath: args.basePath,
    flowId: args.flowId,
    startedAt: args.startedAt,
  });
}

interface EmitFailureArgs {
  phase: PhaseSpiralPhase;
  unitType: OmegaPhaseUnitType | string;
  unitId: string;
  failingStage: PhaseSpiralFailingStage;
  missingArtifacts: string[];
  remediation: string;
  iamError?: IAMError;
  basePath: string;
  flowId: string;
  startedAt: number;
}

function emitFailure(args: EmitFailureArgs): RunPhaseSpiralFailure {
  const durationMs = Date.now() - args.startedAt;
  emitJournalEvent(args.basePath, {
    ts: new Date().toISOString(),
    flowId: args.flowId,
    seq: 1,
    eventType: "phase-spiral-failed",
    data: {
      phase: args.phase,
      unitType: args.unitType,
      unitId: args.unitId,
      milestoneId: extractMilestoneId(args.unitId),
      failingStage: args.failingStage,
      missingArtifacts: args.missingArtifacts,
      remediation: args.remediation,
      durationMs,
      verdict: "fail",
    },
  });

  const failure: RunPhaseSpiralFailure = {
    ok: false,
    phase: args.phase,
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

function mapErrorToFailingStage(error: IAMError): PhaseSpiralFailingStage {
  if (error.iamErrorKind === "omega-stage-failed") {
    if (error.stage) return error.stage;
    return "executor";
  }
  if (error.iamErrorKind === "executor-not-wired") return "executor";
  if (error.iamErrorKind === "persistence-failed") return "persistence";
  return "persistence";
}

/**
 * Best-effort extraction of missing-artifact paths from a structured IAM
 * error. The IAMError shape carries `target` (single path) for write-side
 * failures; `validationGap` may carry a multi-line list from
 * `validatePhaseOmegaArtifacts`. The unit dir is included as a
 * directory-level hint for forensics consumers.
 */
function collectMissingArtifactsFromError(
  error: IAMError,
  _basePath: string,
  _unitType: OmegaPhaseUnitType,
  _unitId: string,
): string[] {
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
    // Patterns from validatePhaseOmegaArtifacts diagnostics, e.g.
    //   "stage file missing for materiality: /tmp/.../stage-01-materiality.md"
    //   "synthesis file missing: /tmp/.../synthesis.md"
    //   "target artifact missing: /tmp/.../S01-PLAN.md"
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

function extractMilestoneId(unitId: string): string {
  const slash = unitId.indexOf("/");
  return slash >= 0 ? unitId.slice(0, slash) : unitId;
}

// ─── Path helpers ────────────────────────────────────────────────────────────

function normalizePath(basePath: string, path: string): string {
  return isAbsolute(path) ? path : resolve(basePath, path);
}

function relativeFromBase(basePath: string, path: string): string {
  const rel = relative(basePath, path);
  if (rel && !rel.startsWith("..") && rel !== ".") return rel;
  return path;
}
