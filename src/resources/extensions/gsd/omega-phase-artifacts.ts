/**
 * Phase-scoped Omega artifacts.
 *
 * Extension-side bridge from the pure IAM Omega kernel to Hammer/GSD state.
 * The pure kernel stays in src/iam; this module owns phase semantics, paths,
 * filesystem persistence, and the compact DB mapping from phase units to runs.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import {
  executeOmegaSpiral,
  OMEGA_STAGES,
} from "../../../iam/omega.js";
import {
  persistOmegaRun,
  persistSavesuccessResult,
  type IAMPersistAdapters,
  type OmegaRunRow,
  type SavesuccessResultRow,
} from "../../../iam/persist.js";
import type {
  IAMError,
  IAMResult,
  OmegaExecutor,
  OmegaPersona,
  OmegaRun,
  OmegaStageName,
  OmegaStageResult,
  RuneName,
  SavesuccessResult,
} from "../../../iam/types.js";

import { atomicWriteSync } from "./atomic-write.js";
import {
  getOmegaRun,
  insertOmegaRun,
  insertSavesuccessResult,
  updateOmegaRunStatus,
  upsertOmegaPhaseArtifact,
  type OmegaPhaseArtifactRecord,
} from "./gsd-db.js";
import { gsdRoot } from "./paths.js";

export const OMEGA_PHASE_MANIFEST_VERSION = 1;

export type OmegaPhaseUnitType =
  | "research-milestone"
  | "plan-milestone"
  | "research-slice"
  | "plan-slice"
  | "refine-slice"
  | "replan-slice";

export type OmegaPhaseManifestStatus = "running" | "complete" | "failed" | "partial";

export type OmegaPhaseStageFilePaths = Record<OmegaStageName, string>;

export interface OmegaPhaseManifest {
  schemaVersion: number;
  unitType: OmegaPhaseUnitType;
  unitId: string;
  runId: string;
  query: string;
  targetArtifactPath: string;
  manifestPath: string;
  artifactDir: string;
  runManifestPath: string;
  stageFilePaths: OmegaPhaseStageFilePaths;
  stageCount: number;
  synthesisPath: string | null;
  status: OmegaPhaseManifestStatus;
  diagnostics: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Camel-case compact DB row shape used by gsd-db helpers. */
export type { OmegaPhaseArtifactRecord } from "./gsd-db.js";

export interface OmegaPhasePersistenceAdapters extends IAMPersistAdapters {
  upsertOmegaPhaseArtifact: (row: OmegaPhaseArtifactRecord) => void;
}

export interface PersistPhaseOmegaRunOptions {
  basePath: string;
  unitType: OmegaPhaseUnitType | string;
  unitId: string;
  query: string;
  targetArtifactPath: string;
  executor: OmegaExecutor;
  persona?: OmegaPersona;
  runes?: RuneName[];
  savesuccess?: {
    result: SavesuccessResult;
    target?: string;
  };
  adapters?: OmegaPhasePersistenceAdapters;
  now?: () => string;
}

export interface ValidatePhaseOmegaArtifactsOptions {
  manifestPath?: string;
  manifest?: OmegaPhaseManifest;
  expectedUnitType?: OmegaPhaseUnitType | string;
  expectedUnitId?: string;
  expectedRunId?: string;
  expectedTargetArtifactPath?: string;
}

const CANONICAL_STAGE_NAMES = OMEGA_STAGES.map((stage) => stage.stageName) as OmegaStageName[];
const OMEGA_PHASE_UNIT_TYPES: readonly OmegaPhaseUnitType[] = [
  "research-milestone",
  "plan-milestone",
  "research-slice",
  "plan-slice",
  "refine-slice",
  "replan-slice",
] as const;

function defaultAdapters(): OmegaPhasePersistenceAdapters {
  return {
    atomicWrite: atomicWriteSync,
    insertOmegaRun,
    updateOmegaRunStatus,
    getOmegaRun,
    insertSavesuccessResult,
    upsertOmegaPhaseArtifact,
  };
}

export function isOmegaPhaseUnitType(value: string): value is OmegaPhaseUnitType {
  return (OMEGA_PHASE_UNIT_TYPES as readonly string[]).includes(value);
}

export function validateOmegaPhaseUnit(unitType: string, unitId: string): IAMResult<OmegaPhaseUnitType> {
  if (!isOmegaPhaseUnitType(unitType)) {
    return failure("persistence-failed", `Unknown Omega phase unit type "${unitType}".`, {
      remediation: "Use one of research-milestone, plan-milestone, research-slice, plan-slice, refine-slice, or replan-slice.",
      persistenceStatus: "not-attempted",
    });
  }

  const milestonePattern = /^M\d{3}(?:-[A-Za-z0-9]+)?$/;
  const slicePattern = /^M\d{3}(?:-[A-Za-z0-9]+)?\/S\d{2}(?:-[A-Za-z0-9]+)?$/;
  const pattern = unitType.endsWith("-milestone") ? milestonePattern : slicePattern;
  if (!pattern.test(unitId)) {
    return failure("persistence-failed", `Malformed Omega phase unit id "${unitId}" for ${unitType}.`, {
      remediation: unitType.endsWith("-milestone")
        ? "Use a milestone unit id such as M001."
        : "Use a slice unit id such as M001/S01.",
      persistenceStatus: "not-attempted",
    });
  }

  return { ok: true, value: unitType };
}

export function omegaPhaseArtifactsRoot(basePath: string): string {
  return join(gsdRoot(basePath), "omega", "phases");
}

export function omegaPhaseUnitDir(basePath: string, unitType: OmegaPhaseUnitType, unitId: string): string {
  return join(omegaPhaseArtifactsRoot(basePath), unitType, sanitizePathSegment(unitId));
}

export function omegaPhaseRunBaseDir(basePath: string, unitType: OmegaPhaseUnitType, unitId: string): string {
  return omegaPhaseUnitDir(basePath, unitType, unitId);
}

export function omegaPhaseArtifactDir(
  basePath: string,
  unitType: OmegaPhaseUnitType,
  unitId: string,
  runId: string,
): string {
  return join(omegaPhaseRunBaseDir(basePath, unitType, unitId), runId);
}

export function omegaPhaseManifestPath(artifactDir: string): string {
  return join(artifactDir, "phase-manifest.json");
}

export function omegaRunManifestPath(artifactDir: string): string {
  return join(artifactDir, "run-manifest.json");
}

export function omegaSynthesisPath(artifactDir: string): string {
  return join(artifactDir, "synthesis.md");
}

export function omegaStageFilePaths(artifactDir: string): OmegaPhaseStageFilePaths {
  return Object.fromEntries(
    OMEGA_STAGES.map((stage) => [
      stage.stageName,
      join(artifactDir, stageFileName(stage.stageNumber, stage.stageName)),
    ]),
  ) as OmegaPhaseStageFilePaths;
}

export function renderPhaseOmegaManifest(manifest: OmegaPhaseManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function loadPhaseOmegaManifest(manifestPath: string): IAMResult<OmegaPhaseManifest> {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
    const normalized = normalizePhaseOmegaManifest(parsed, manifestPath);
    if (!normalized.ok) return normalized;
    return { ok: true, value: normalized.value };
  } catch (cause) {
    return failure("persistence-failed", `Omega phase manifest JSON is unreadable at ${manifestPath}.`, {
      remediation: "Inspect the manifest file for truncation or invalid JSON, then rerun the governed phase.",
      persistenceStatus: "partial",
      cause,
      target: manifestPath,
    });
  }
}

export function validatePhaseOmegaArtifacts(
  options: ValidatePhaseOmegaArtifactsOptions,
): IAMResult<OmegaPhaseManifest> {
  const loaded = options.manifest
    ? ({ ok: true, value: options.manifest } as const)
    : options.manifestPath
      ? loadPhaseOmegaManifest(options.manifestPath)
      : failure("persistence-failed", "No Omega phase manifest path or object was supplied.", {
          remediation: "Pass a phase manifest path returned by persistPhaseOmegaRun.",
          persistenceStatus: "not-attempted",
        });

  if (!loaded.ok) return loaded;

  const manifest = loaded.value;
  const diagnostics: string[] = [];

  if (options.manifestPath && !samePath(manifest.manifestPath, options.manifestPath)) {
    diagnostics.push(`phase manifest path mismatch: manifest=${manifest.manifestPath} expected=${options.manifestPath}`);
  }
  if (options.expectedUnitType && manifest.unitType !== options.expectedUnitType) {
    diagnostics.push(`unit type mismatch: manifest=${manifest.unitType} expected=${options.expectedUnitType}`);
  }
  if (options.expectedUnitId && manifest.unitId !== options.expectedUnitId) {
    diagnostics.push(`unit id mismatch: manifest=${manifest.unitId} expected=${options.expectedUnitId}`);
  }
  if (options.expectedRunId && manifest.runId !== options.expectedRunId) {
    diagnostics.push(`run id mismatch: manifest=${manifest.runId} expected=${options.expectedRunId}`);
  }
  if (options.expectedTargetArtifactPath && !samePath(manifest.targetArtifactPath, options.expectedTargetArtifactPath)) {
    diagnostics.push(`target artifact path mismatch: manifest=${manifest.targetArtifactPath} expected=${options.expectedTargetArtifactPath}`);
  }

  if (manifest.status !== "complete") {
    diagnostics.push(`phase manifest status is ${manifest.status}; expected complete`);
  }
  if (!existsSync(manifest.targetArtifactPath)) diagnostics.push(`target artifact missing: ${manifest.targetArtifactPath}`);
  if (!existsSync(manifest.manifestPath)) diagnostics.push(`phase manifest missing: ${manifest.manifestPath}`);
  if (!existsSync(manifest.artifactDir)) diagnostics.push(`artifact directory missing: ${manifest.artifactDir}`);
  if (!existsSync(manifest.runManifestPath)) diagnostics.push(`run manifest missing: ${manifest.runManifestPath}`);

  const runManifest = readJsonObject(manifest.runManifestPath);
  if (!runManifest.ok) {
    diagnostics.push(`run manifest unreadable: ${manifest.runManifestPath}: ${runManifest.error}`);
  } else {
    validateRunManifestConsistency(manifest, runManifest.value, diagnostics);
  }

  const stageKeys = Object.keys(manifest.stageFilePaths);
  if (stageKeys.length !== CANONICAL_STAGE_NAMES.length) {
    diagnostics.push(`phase manifest stage file count is ${stageKeys.length}; expected ${CANONICAL_STAGE_NAMES.length}`);
  }
  for (const stage of OMEGA_STAGES) {
    const stagePath = manifest.stageFilePaths[stage.stageName];
    if (!stagePath) {
      diagnostics.push(`missing stage path for ${stage.stageName}`);
      continue;
    }
    const expectedName = stageFileName(stage.stageNumber, stage.stageName);
    if (basename(stagePath) !== expectedName) {
      diagnostics.push(`stage path mismatch for ${stage.stageName}: expected basename ${expectedName}, got ${basename(stagePath)}`);
    }
    if (!existsSync(stagePath)) diagnostics.push(`stage file missing for ${stage.stageName}: ${stagePath}`);
  }

  if (!manifest.synthesisPath) {
    diagnostics.push("synthesis path missing from phase manifest");
  } else if (!existsSync(manifest.synthesisPath)) {
    diagnostics.push(`synthesis file missing: ${manifest.synthesisPath}`);
  }

  if (diagnostics.length > 0) {
    return failure("persistence-failed", diagnostics.join("\n"), {
      remediation: "Rerun the governed phase so the target artifact, phase manifest, Omega run manifest, all ten stage files, and synthesis file are regenerated consistently.",
      persistenceStatus: manifest.status === "complete" || manifest.status === "running" || manifest.status === "partial" ? "partial" : "complete",
      target: manifest.manifestPath,
    });
  }

  return { ok: true, value: manifest };
}

export async function persistPhaseOmegaRun(
  options: PersistPhaseOmegaRunOptions,
): Promise<IAMResult<OmegaPhaseManifest>> {
  const now = options.now ?? (() => new Date().toISOString());
  const adapters = options.adapters ?? defaultAdapters();
  const unit = validateOmegaPhaseUnit(options.unitType, options.unitId);
  if (!unit.ok) return unit;
  if (typeof options.query !== "string" || options.query.trim().length === 0) {
    return failure("persistence-failed", "Omega phase query must be a non-empty string.", {
      remediation: "Provide the phase research or planning question that the Omega spiral must govern.",
      persistenceStatus: "not-attempted",
    });
  }
  if (typeof options.targetArtifactPath !== "string" || options.targetArtifactPath.trim().length === 0) {
    return failure("persistence-failed", "Omega phase target artifact path must be a non-empty string.", {
      remediation: "Provide the normal phase artifact path (for example M001-RESEARCH.md or S01-PLAN.md).",
      persistenceStatus: "not-attempted",
    });
  }

  const unitType = unit.value;
  const query = options.query.trim();
  const targetArtifactPath = normalizePath(options.basePath, options.targetArtifactPath);
  const phaseRunBaseDir = omegaPhaseRunBaseDir(options.basePath, unitType, options.unitId);
  const stageResults: OmegaStageResult[] = [];
  const startedAt = now();
  let callIndex = 0;

  const executor = wrapPhaseExecutor(options.executor, () => callIndex++);
  const runResult = await executeOmegaSpiral(
    {
      query,
      executor,
      persona: options.persona,
      runes: options.runes,
      stages: CANONICAL_STAGE_NAMES,
    },
    (stage) => stageResults.push(stage),
  );

  if (!runResult.ok) {
    const failedRunId = makeFailedRunId();
    const failedRun: OmegaRun = {
      id: failedRunId,
      query,
      persona: options.persona,
      runes: options.runes ?? [],
      stages: CANONICAL_STAGE_NAMES,
      stageResults,
      status: "failed",
      createdAt: startedAt,
      completedAt: now(),
      error: formatIamError(runResult.error),
    };
    const persisted = await persistOmegaRun(failedRun, phaseRunBaseDir, adapters);
    if (!persisted.ok) return persisted;

    const manifest = buildManifest({
      basePath: options.basePath,
      unitType,
      unitId: options.unitId,
      run: failedRun,
      targetArtifactPath,
      artifactDir: persisted.value,
      status: "failed",
      diagnostics: [formatIamError(runResult.error)],
      updatedAt: now(),
    });
    const manifestResult = persistPhaseManifestAndRow(manifest, adapters);
    if (!manifestResult.ok) return manifestResult;
    return { ok: false, error: { ...runResult.error, target: manifest.manifestPath } };
  }

  const run = runResult.value;
  const persisted = await persistOmegaRun(run, phaseRunBaseDir, adapters);
  if (!persisted.ok) {
    const partialManifest = buildManifest({
      basePath: options.basePath,
      unitType,
      unitId: options.unitId,
      run,
      targetArtifactPath,
      artifactDir: omegaPhaseArtifactDir(options.basePath, unitType, options.unitId, run.id),
      status: "partial",
      diagnostics: [formatIamError(persisted.error)],
      updatedAt: now(),
    });
    persistPhaseManifestAndRow(partialManifest, adapters);
    return persisted;
  }

  const manifest = buildManifest({
    basePath: options.basePath,
    unitType,
    unitId: options.unitId,
    run,
    targetArtifactPath,
    artifactDir: persisted.value,
    status: "complete",
    diagnostics: [],
    updatedAt: now(),
  });

  const manifestResult = persistPhaseManifestAndRow(manifest, adapters);
  if (!manifestResult.ok) {
    const partialManifest = { ...manifest, status: "partial" as const, diagnostics: [formatIamError(manifestResult.error)], updatedAt: now() };
    persistPhaseManifestAndRow(partialManifest, adapters);
    return manifestResult;
  }

  if (options.savesuccess) {
    const saved = persistSavesuccessResult(
      options.savesuccess.result,
      options.savesuccess.target ?? targetArtifactPath,
      adapters,
      run.id,
    );
    if (!saved.ok) {
      const partialManifest = { ...manifest, status: "partial" as const, diagnostics: [formatIamError(saved.error)], updatedAt: now() };
      persistPhaseManifestAndRow(partialManifest, adapters);
      return saved;
    }
  }

  return { ok: true, value: manifest };
}

function buildManifest(args: {
  basePath: string;
  unitType: OmegaPhaseUnitType;
  unitId: string;
  run: OmegaRun;
  targetArtifactPath: string;
  artifactDir: string;
  status: OmegaPhaseManifestStatus;
  diagnostics: string[];
  updatedAt: string;
}): OmegaPhaseManifest {
  const stageFilePaths = omegaStageFilePaths(args.artifactDir);
  const synthesisPath = args.run.synthesis ? omegaSynthesisPath(args.artifactDir) : null;
  return {
    schemaVersion: OMEGA_PHASE_MANIFEST_VERSION,
    unitType: args.unitType,
    unitId: args.unitId,
    runId: args.run.id,
    query: args.run.query,
    targetArtifactPath: args.targetArtifactPath,
    manifestPath: omegaPhaseManifestPath(args.artifactDir),
    artifactDir: args.artifactDir,
    runManifestPath: omegaRunManifestPath(args.artifactDir),
    stageFilePaths,
    stageCount: args.run.stageResults.length,
    synthesisPath,
    status: args.status,
    diagnostics: args.diagnostics,
    createdAt: args.run.createdAt,
    updatedAt: args.updatedAt,
    completedAt: args.run.completedAt ?? null,
  };
}

function persistPhaseManifestAndRow(
  manifest: OmegaPhaseManifest,
  adapters: OmegaPhasePersistenceAdapters,
): IAMResult<OmegaPhaseManifest> {
  try {
    adapters.atomicWrite(manifest.manifestPath, renderPhaseOmegaManifest(manifest));
    adapters.upsertOmegaPhaseArtifact(manifestToRecord(manifest));
    return { ok: true, value: manifest };
  } catch (cause) {
    return failure("persistence-failed", `Failed to persist Omega phase manifest or DB mapping for ${manifest.unitType} ${manifest.unitId}.`, {
      remediation: "Inspect the phase artifact directory and omega_phase_artifacts DB row, then rerun the governed phase.",
      persistenceStatus: "partial",
      target: manifest.manifestPath,
      cause,
    });
  }
}

function manifestToRecord(manifest: OmegaPhaseManifest): OmegaPhaseArtifactRecord {
  return {
    unitType: manifest.unitType,
    unitId: manifest.unitId,
    runId: manifest.runId,
    targetArtifactPath: manifest.targetArtifactPath,
    manifestPath: manifest.manifestPath,
    artifactDir: manifest.artifactDir,
    runManifestPath: manifest.runManifestPath,
    synthesisPath: manifest.synthesisPath,
    stageCount: manifest.stageCount,
    status: manifest.status,
    diagnostics: manifest.diagnostics,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    completedAt: manifest.completedAt,
  };
}

function normalizePhaseOmegaManifest(raw: unknown, sourcePath: string): IAMResult<OmegaPhaseManifest> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return failure("persistence-failed", `Omega phase manifest at ${sourcePath} is not a JSON object.`, {
      remediation: "Rerun the governed phase to regenerate phase-manifest.json.",
      persistenceStatus: "partial",
      target: sourcePath,
    });
  }
  const obj = raw as Record<string, unknown>;
  const diagnostics: string[] = [];

  const unitType = readString(obj, "unitType", diagnostics);
  const unitId = readString(obj, "unitId", diagnostics);
  const validatedUnit = unitType && unitId ? validateOmegaPhaseUnit(unitType, unitId) : null;
  if (validatedUnit && !validatedUnit.ok) diagnostics.push(validatedUnit.error.remediation);

  const stageFilePaths = normalizeStageFilePaths(obj.stageFilePaths, diagnostics);
  const statusRaw = readString(obj, "status", diagnostics);
  const status = normalizeStatus(statusRaw, diagnostics);
  const manifestPath = readString(obj, "manifestPath", diagnostics);
  const targetArtifactPath = readString(obj, "targetArtifactPath", diagnostics);
  const artifactDir = readString(obj, "artifactDir", diagnostics);
  const runManifestPath = readString(obj, "runManifestPath", diagnostics);
  const runId = readString(obj, "runId", diagnostics);
  const query = readString(obj, "query", diagnostics);
  const createdAt = readString(obj, "createdAt", diagnostics);
  const updatedAt = readString(obj, "updatedAt", diagnostics);
  const completedAt = typeof obj.completedAt === "string" ? obj.completedAt : null;
  const synthesisPath = typeof obj.synthesisPath === "string" ? obj.synthesisPath : null;
  const manifestDiagnostics = Array.isArray(obj.diagnostics)
    ? obj.diagnostics.filter((item): item is string => typeof item === "string")
    : [];
  const stageCount = typeof obj.stageCount === "number" && Number.isFinite(obj.stageCount)
    ? Math.max(0, Math.min(CANONICAL_STAGE_NAMES.length, Math.floor(obj.stageCount)))
    : Object.keys(stageFilePaths).length;

  if (diagnostics.length > 0 || !validatedUnit?.ok) {
    return failure("persistence-failed", diagnostics.join("\n") || `Omega phase manifest at ${sourcePath} is invalid.`, {
      remediation: "Regenerate the phase manifest with persistPhaseOmegaRun so all required paths and unit metadata are present.",
      persistenceStatus: "partial",
      target: sourcePath,
    });
  }

  return {
    ok: true,
    value: {
      schemaVersion: typeof obj.schemaVersion === "number" ? obj.schemaVersion : OMEGA_PHASE_MANIFEST_VERSION,
      unitType: validatedUnit.value,
      unitId,
      runId,
      query,
      targetArtifactPath,
      manifestPath,
      artifactDir,
      runManifestPath,
      stageFilePaths,
      stageCount,
      synthesisPath,
      status,
      diagnostics: manifestDiagnostics,
      createdAt,
      updatedAt,
      completedAt,
    },
  };
}

function normalizeStageFilePaths(raw: unknown, diagnostics: string[]): OmegaPhaseStageFilePaths {
  const value: Partial<OmegaPhaseStageFilePaths> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push("stageFilePaths must be an object keyed by canonical Omega stage name");
    return value as OmegaPhaseStageFilePaths;
  }
  const obj = raw as Record<string, unknown>;
  for (const stage of CANONICAL_STAGE_NAMES) {
    if (typeof obj[stage] === "string" && obj[stage].length > 0) {
      value[stage] = obj[stage];
    } else {
      diagnostics.push(`stageFilePaths.${stage} is required`);
    }
  }
  return value as OmegaPhaseStageFilePaths;
}

function validateRunManifestConsistency(
  manifest: OmegaPhaseManifest,
  runManifest: Record<string, unknown>,
  diagnostics: string[],
): void {
  if (runManifest.id !== manifest.runId) diagnostics.push(`run manifest id mismatch: ${String(runManifest.id)} !== ${manifest.runId}`);
  if (runManifest.status !== "complete") diagnostics.push(`run manifest status is ${String(runManifest.status)}; expected complete`);
  if (typeof runManifest.artifactDir === "string" && !samePath(runManifest.artifactDir, manifest.artifactDir)) {
    diagnostics.push(`run manifest artifactDir mismatch: ${runManifest.artifactDir} !== ${manifest.artifactDir}`);
  }

  const stages = Array.isArray(runManifest.stages) ? runManifest.stages : [];
  if (stages.length !== CANONICAL_STAGE_NAMES.length) {
    diagnostics.push(`run manifest stages length is ${stages.length}; expected ${CANONICAL_STAGE_NAMES.length}`);
  } else {
    for (let i = 0; i < CANONICAL_STAGE_NAMES.length; i++) {
      if (stages[i] !== CANONICAL_STAGE_NAMES[i]) diagnostics.push(`run manifest stage ${i + 1} is ${String(stages[i])}; expected ${CANONICAL_STAGE_NAMES[i]}`);
    }
  }

  if (runManifest.stageCount !== CANONICAL_STAGE_NAMES.length) {
    diagnostics.push(`run manifest stageCount is ${String(runManifest.stageCount)}; expected ${CANONICAL_STAGE_NAMES.length}`);
  }
  const stageResults = Array.isArray(runManifest.stageResults) ? runManifest.stageResults : [];
  if (stageResults.length !== CANONICAL_STAGE_NAMES.length) {
    diagnostics.push(`run manifest stageResults length is ${stageResults.length}; expected ${CANONICAL_STAGE_NAMES.length}`);
  }
}

function wrapPhaseExecutor(executor: OmegaExecutor, nextIndex: () => number): OmegaExecutor {
  return async (prompt: string) => {
    const index = nextIndex();
    const stageName = index < OMEGA_STAGES.length ? OMEGA_STAGES[index].stageName : "synthesis";
    const response = await executor(prompt);
    if (typeof response !== "string" || response.trim().length === 0) {
      throw new Error(`Omega executor returned malformed ${stageName} response: expected non-empty string.`);
    }
    return response;
  };
}

function readJsonObject(filePath: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "not an object" };
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeStatus(raw: string, diagnostics: string[]): OmegaPhaseManifestStatus {
  if (raw === "running" || raw === "complete" || raw === "failed" || raw === "partial") return raw;
  diagnostics.push(`status must be one of running, complete, failed, or partial; got ${raw}`);
  return "partial";
}

function readString(obj: Record<string, unknown>, key: string, diagnostics: string[]): string {
  const value = obj[key];
  if (typeof value === "string" && value.length > 0) return value;
  diagnostics.push(`${key} must be a non-empty string`);
  return "";
}

function stageFileName(stageNumber: number, stageName: string): string {
  return `stage-${String(stageNumber).padStart(2, "0")}-${stageName}.md`;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "__");
}

function normalizePath(basePath: string, path: string): string {
  return isAbsolute(path) ? path : resolve(basePath, path);
}

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

function makeFailedRunId(): string {
  return `run-failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatIamError(error: IAMError): string {
  const parts: string[] = [error.iamErrorKind];
  if (error.stage) parts.push(`stage=${error.stage}`);
  if (error.validationGap) parts.push(`gap=${error.validationGap}`);
  parts.push(error.remediation);
  if (error.cause instanceof Error) parts.push(error.cause.message);
  else if (error.cause !== undefined) parts.push(String(error.cause));
  return parts.join(": ");
}

function failure(
  kind: IAMError["iamErrorKind"],
  message: string,
  fields: Omit<Partial<IAMError>, "iamErrorKind" | "validationGap"> & { remediation: string },
): IAMResult<never> {
  return {
    ok: false,
    error: {
      iamErrorKind: kind,
      validationGap: message,
      remediation: fields.remediation,
      ...(fields.stage ? { stage: fields.stage } : {}),
      ...(fields.runeName ? { runeName: fields.runeName } : {}),
      ...(fields.target ? { target: fields.target } : {}),
      ...(fields.persistenceStatus ? { persistenceStatus: fields.persistenceStatus } : {}),
      ...(fields.cause !== undefined ? { cause: fields.cause } : {}),
    },
  };
}
