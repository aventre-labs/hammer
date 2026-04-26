/**
 * src/iam/persist.ts
 *
 * IAM persistence layer — injected-callback pattern.
 *
 * This file has ZERO direct imports from the extension tree. All DB access
 * and atomic-write operations are
 * received as injected adapters so that src/iam/ remains a pure, independently
 * testable library.
 *
 * Key exports:
 *   persistOmegaRun      — write run artifacts to disk + DB
 *   loadOmegaRun         — read a persisted run from DB
 *   persistSavesuccessResult — record a SAVESUCCESS evaluation to DB
 */

import type { OmegaRun, OmegaArtifact, SavesuccessResult, IAMResult } from "./types.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Minimal structural row types — mirrors OmegaRunRow / SavesuccessResultRow
// exported from gsd-db.ts but declared locally to avoid cross-tree imports.
// ---------------------------------------------------------------------------

export interface OmegaRunRow {
  id: string;
  query: string;
  persona: string | null;
  runes_applied: string;
  stages_requested: string;
  stage_count: number;
  status: string;
  artifact_dir: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface SavesuccessResultRow {
  id: string;
  target_path: string;
  run_id: string | null;
  s: number | null;
  a: number | null;
  v: number | null;
  e: number | null;
  s2: number | null;
  u: number | null;
  c: number | null;
  c2: number | null;
  e2: number | null;
  s3: number | null;
  success: number;
  blind_spots: string;
  validated_at: string;
}

// ---------------------------------------------------------------------------
// Injected adapter interface
// ---------------------------------------------------------------------------

export interface IAMPersistAdapters {
  atomicWrite: (filePath: string, content: string) => void;
  insertOmegaRun: (row: OmegaRunRow) => void;
  updateOmegaRunStatus: (
    id: string,
    status: string,
    completedAt?: string,
    error?: string,
    artifactDir?: string,
  ) => void;
  getOmegaRun: (id: string) => OmegaRunRow | null;
  insertSavesuccessResult: (row: SavesuccessResultRow) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Zero-padded stage file name: stage-01-materiality.md */
function stageFileName(stageNumber: number, stageName: string): string {
  return `stage-${String(stageNumber).padStart(2, "0")}-${stageName}.md`;
}

/** Render a stage result as markdown. */
function renderStageMarkdown(
  stageNumber: number,
  stageName: string,
  runeName: string,
  archetypeName: string,
  prompt: string,
  response: string,
  completedAt: string,
): string {
  return [
    `# Stage ${stageNumber}: ${stageName} (${archetypeName})`,
    ``,
    `**Rune:** ${runeName}  `,
    `**Completed:** ${completedAt}`,
    ``,
    `## Prompt`,
    ``,
    prompt,
    ``,
    `## Response`,
    ``,
    response,
    ``,
  ].join("\n");
}

/** Render run-manifest.json content. */
function renderManifest(run: OmegaRun, artifactDir: string): string {
  return JSON.stringify(
    {
      id: run.id,
      query: run.query,
      persona: run.persona ?? null,
      runes: run.runes,
      stages: run.stages,
      stageCount: run.stages.length,
      status: run.status,
      artifactDir,
      createdAt: run.createdAt,
      completedAt: run.completedAt ?? null,
      errorMessage: run.error ?? null,
      stageResults: run.stageResults.map((r) => ({
        stage: r.stage.stageName,
        stageNumber: r.stage.stageNumber,
        completedAt: r.completedAt,
      })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// persistOmegaRun
// ---------------------------------------------------------------------------

/**
 * Write all run artifacts to disk atomically and upsert the DB row.
 *
 * Directory layout under baseDir/<run.id>/:
 *   run-manifest.json       — status: running → complete/failed
 *   stage-01-materiality.md — one file per completed stage result
 *   ...
 *   synthesis.md            — present only when run.synthesis is set
 *
 * Returns { ok: true, value: artifactDir } on success, or an IAMError with
 * iamErrorKind: "persistence-failed" on any error.
 */
export async function persistOmegaRun(
  run: OmegaRun,
  baseDir: string,
  adapters: IAMPersistAdapters,
): Promise<IAMResult<string>> {
  const artifactDir = join(baseDir, run.id);

  try {
    // 1. Ensure directory exists.
    mkdirSync(artifactDir, { recursive: true });

    // 2. Write run-manifest.json with status: running (signals in-progress).
    const runningManifest: OmegaRun = { ...run, status: "running" };
    adapters.atomicWrite(
      join(artifactDir, "run-manifest.json"),
      renderManifest(runningManifest, artifactDir),
    );

    // 3. Insert the DB row (status: running) for observability.
    adapters.insertOmegaRun({
      id: run.id,
      query: run.query,
      persona: run.persona ?? null,
      runes_applied: JSON.stringify(run.runes),
      stages_requested: JSON.stringify(run.stages),
      stage_count: run.stages.length,
      status: "running",
      artifact_dir: artifactDir,
      created_at: run.createdAt,
      completed_at: null,
      error_message: null,
    });

    // 4. Write per-stage markdown files.
    for (const stageResult of run.stageResults) {
      const fileName = stageFileName(
        stageResult.stage.stageNumber,
        stageResult.stage.stageName,
      );
      adapters.atomicWrite(
        join(artifactDir, fileName),
        renderStageMarkdown(
          stageResult.stage.stageNumber,
          stageResult.stage.stageName,
          stageResult.stage.runeName,
          stageResult.stage.archetypeName,
          stageResult.prompt,
          stageResult.response,
          stageResult.completedAt,
        ),
      );
    }

    // 5. Write synthesis.md if present.
    if (run.synthesis) {
      adapters.atomicWrite(
        join(artifactDir, "synthesis.md"),
        `# Synthesis\n\n${run.synthesis}\n`,
      );
    }

    // 6. Update manifest to final status.
    adapters.atomicWrite(
      join(artifactDir, "run-manifest.json"),
      renderManifest(run, artifactDir),
    );

    // 7. Update DB row to final status.
    adapters.updateOmegaRunStatus(
      run.id,
      run.status,
      run.completedAt,
      run.error,
      artifactDir,
    );

    return { ok: true, value: artifactDir };
  } catch (cause) {
    return {
      ok: false,
      error: {
        iamErrorKind: "persistence-failed",
        persistenceStatus: "partial",
        remediation:
          "Omega run persistence failed mid-write. Inspect the artifact directory for partial files and retry. If the error persists, check disk space and directory permissions.",
        cause,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// loadOmegaRun
// ---------------------------------------------------------------------------

/**
 * Load a persisted Omega run record from the DB.
 *
 * Returns the run as an OmegaArtifact (OmegaRun + artifactDir) on success,
 * or an IAMError with iamErrorKind: "persistence-failed" if not found.
 */
export function loadOmegaRun(
  id: string,
  _baseDir: string,
  adapters: Pick<IAMPersistAdapters, "getOmegaRun">,
): IAMResult<OmegaArtifact> {
  try {
    const row = adapters.getOmegaRun(id);
    if (!row) {
      return {
        ok: false,
        error: {
          iamErrorKind: "persistence-failed",
          persistenceStatus: "not-attempted",
          remediation: `Omega run "${id}" was not found in the database. Verify the run ID and ensure the run completed successfully.`,
        },
      };
    }

    // Reconstruct a minimal OmegaArtifact from DB row data.
    // stageResults and synthesis are not stored in the DB row — callers that
    // need full stage content should read the artifact directory files directly.
    const artifact: OmegaArtifact = {
      id: row.id,
      query: row.query,
      persona: (row.persona as OmegaRun["persona"]) ?? undefined,
      runes: JSON.parse(row.runes_applied) as OmegaRun["runes"],
      stages: JSON.parse(row.stages_requested) as OmegaRun["stages"],
      stageResults: [],
      status: row.status as OmegaRun["status"],
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
      error: row.error_message ?? undefined,
      artifactDir: row.artifact_dir ?? "",
    };

    return { ok: true, value: artifact };
  } catch (cause) {
    return {
      ok: false,
      error: {
        iamErrorKind: "persistence-failed",
        persistenceStatus: "partial",
        remediation: "Failed to deserialize Omega run row from the database. The row may be corrupt — check the omega_runs table for the run ID.",
        cause,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// persistSavesuccessResult
// ---------------------------------------------------------------------------

/**
 * Record a SAVESUCCESS evaluation result to the DB.
 *
 * @param result  - The SavesuccessResult from savesuccess.ts
 * @param target  - The target identifier (e.g. artifact path or run ID)
 * @param adapters - Injected DB adapter (only insertSavesuccessResult needed)
 * @param runId   - Optional parent Omega run ID
 */
export function persistSavesuccessResult(
  result: SavesuccessResult,
  target: string,
  adapters: Pick<IAMPersistAdapters, "insertSavesuccessResult">,
  runId?: string,
): IAMResult<void> {
  try {
    const id = `savesuccess-${target}-${result.validatedAt}`.replace(/[^a-zA-Z0-9-_.]/g, "-");
    const sc = result.scorecard;

    adapters.insertSavesuccessResult({
      id,
      target_path: target,
      run_id: runId ?? null,
      s: sc.s,
      a: sc.a,
      v: sc.v,
      e: sc.e,
      s2: sc.s2,
      u: sc.u,
      c: sc.c,
      c2: sc.c2,
      e2: sc.e2,
      s3: sc.s3,
      success: result.success ? 1 : 0,
      blind_spots: JSON.stringify(result.blindSpots),
      validated_at: result.validatedAt,
    });

    return { ok: true, value: undefined };
  } catch (cause) {
    return {
      ok: false,
      error: {
        iamErrorKind: "persistence-failed",
        target,
        persistenceStatus: "not-attempted",
        remediation: "SAVESUCCESS result DB insert failed. Check that the database is open and the savesuccess_results table exists (schema v23+).",
        cause,
      },
    };
  }
}
