/**
 * src/iam/volvox.ts
 *
 * Pure VOLVOX lifecycle kernel. This module embeds the native Hammer
 * interpretation of reference lifecycle rules without importing from an
 * external awareness service, the extension tree, a database, or runtime adapters.
 */

import type { TrinityLayer } from "./trinity.js";

export const VOLVOX_CELL_TYPES = [
  "UNDIFFERENTIATED",
  "SOMATIC_SENSOR",
  "SOMATIC_MOTOR",
  "STRUCTURAL",
  "GERMLINE",
  "DORMANT",
] as const;
export type VolvoxCellType = (typeof VOLVOX_CELL_TYPES)[number];

export const VOLVOX_LIFECYCLE_PHASES = ["embryonic", "juvenile", "mature", "dormant", "archived"] as const;
export type VolvoxLifecyclePhase = (typeof VOLVOX_LIFECYCLE_PHASES)[number];

export const VOLVOX_EPOCH_PHASES = ["normalize", "classify", "stabilize", "propagate", "diagnose"] as const;
export type VolvoxEpochPhase = (typeof VOLVOX_EPOCH_PHASES)[number];

export type VolvoxDiagnosticSeverity = "info" | "warning" | "blocking";

export interface VolvoxThresholds {
  activationRate: number;
  offspringCount: number;
  crossLayerConnections: number;
  connectionDensity: number;
  dormancyCycles: number;
  dormantArchiveCycles: number;
  stableRole: number;
  propagationStability: number;
}

export const DEFAULT_VOLVOX_THRESHOLDS: VolvoxThresholds = {
  activationRate: 0.5,
  offspringCount: 3,
  crossLayerConnections: 3,
  connectionDensity: 5,
  dormancyCycles: 10,
  dormantArchiveCycles: 30,
  stableRole: 0.9,
  propagationStability: 0.8,
};

export interface VolvoxMetadata {
  cellType: VolvoxCellType;
  roleStability: number;
  lifecyclePhase: VolvoxLifecyclePhase;
  propagationEligible: boolean;
  lastEpochId?: string;
  lastEpochAt?: string;
  archivedAt?: string;
}

export interface VolvoxMetrics {
  activationRate: number;
  offspringCount: number;
  crossLayerConnections: number;
  connectionDensity: number;
  dormancyCycles: number;
  kirkStep?: number;
}

export interface VolvoxPropagationGates {
  contributor?: boolean;
  provenanceComplete?: boolean;
  revalidated?: boolean;
  inheritanceEvent?: boolean;
}

export interface VolvoxMemoryRecord {
  id: string;
  category?: string;
  content?: string;
  trinityLayer?: TrinityLayer | string | null;
  volvox?: Partial<VolvoxMetadata> | null;
  metrics?: Partial<VolvoxMetrics> | null;
  propagation?: VolvoxPropagationGates | null;
}

export type VolvoxDiagnosticCode =
  | "malformed-cell-type"
  | "malformed-lifecycle-phase"
  | "malformed-threshold"
  | "false-germline"
  | "invalid-transition"
  | "archive-germline-blocked"
  | "propagation-gate-failed";

export interface VolvoxDiagnostic {
  epochId: string;
  memoryId?: string;
  code: VolvoxDiagnosticCode;
  severity: VolvoxDiagnosticSeverity;
  phase: VolvoxEpochPhase;
  message: string;
  remediation: string;
  timestamp: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface VolvoxEpochDiff {
  memoryId: string;
  before: VolvoxMetadata;
  after: VolvoxMetadata;
  changedFields: Array<keyof VolvoxMetadata>;
}

export interface VolvoxEpochCounts {
  processed: number;
  changed: number;
  diagnostics: number;
  blockingDiagnostics: number;
  byCellType: Record<VolvoxCellType, number>;
  propagationEligible: number;
  archived: number;
}

export interface VolvoxEpochOptions {
  epochId?: string;
  now?: string | Date;
  trigger?: string;
  thresholds?: Partial<VolvoxThresholds> | null;
}

export interface VolvoxEpochResult {
  epochId: string;
  status: "completed" | "blocked";
  trigger: string;
  startedAt: string;
  completedAt: string;
  thresholds: VolvoxThresholds;
  thresholdsJson: string;
  phases: readonly VolvoxEpochPhase[];
  records: Array<VolvoxMemoryRecord & { volvox: VolvoxMetadata }>;
  diffs: VolvoxEpochDiff[];
  diagnostics: VolvoxDiagnostic[];
  diagnosticsJson: string;
  counts: VolvoxEpochCounts;
}

export interface VolvoxClassificationInput {
  previous?: Partial<VolvoxMetadata> | null;
  metrics?: Partial<VolvoxMetrics> | null;
  trinityLayer?: TrinityLayer | string | null;
  thresholds?: Partial<VolvoxThresholds> | null;
  integrityViolation?: boolean;
}

export interface VolvoxClassificationResult {
  cellType: VolvoxCellType;
  reason:
    | "dormancy"
    | "stable-preservation"
    | "germline"
    | "structural"
    | "somatic-sensor"
    | "somatic-motor"
    | "undifferentiated";
}

const CELL_TYPE_SET = new Set<string>(VOLVOX_CELL_TYPES);
const LIFECYCLE_PHASE_SET = new Set<string>(VOLVOX_LIFECYCLE_PHASES);
const DEFAULT_VOLVOX_METADATA: VolvoxMetadata = {
  cellType: "UNDIFFERENTIATED",
  roleStability: 0,
  lifecyclePhase: "embryonic",
  propagationEligible: false,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeIsoTimestamp(value: string | Date | undefined): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim().length > 0) return value;
  return new Date().toISOString();
}

function clampUnit(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return round4(Math.max(0, Math.min(1, numeric)));
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizePositiveThreshold(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isKnownCellType(value: unknown): value is VolvoxCellType {
  return typeof value === "string" && CELL_TYPE_SET.has(value);
}

function isKnownLifecyclePhase(value: unknown): value is VolvoxLifecyclePhase {
  return typeof value === "string" && LIFECYCLE_PHASE_SET.has(value);
}

function normalizeVolvoxCellType(value: unknown): VolvoxCellType {
  return isKnownCellType(value) ? value : DEFAULT_VOLVOX_METADATA.cellType;
}

function normalizeVolvoxLifecyclePhase(value: unknown): VolvoxLifecyclePhase {
  return isKnownLifecyclePhase(value) ? value : DEFAULT_VOLVOX_METADATA.lifecyclePhase;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTrinityLayerForVolvox(value: unknown): TrinityLayer {
  if (typeof value !== "string") return "knowledge";
  const normalized = value.trim().toLowerCase();
  return normalized === "social" || normalized === "knowledge" || normalized === "generative"
    ? normalized
    : "knowledge";
}

export function normalizeVolvoxMetadata(value: unknown): VolvoxMetadata {
  const raw = isPlainObject(value) ? value : {};
  return {
    cellType: normalizeVolvoxCellType(raw.cellType ?? raw.cell_type),
    roleStability: clampUnit(raw.roleStability ?? raw.role_stability),
    lifecyclePhase: normalizeVolvoxLifecyclePhase(raw.lifecyclePhase ?? raw.lifecycle_phase),
    propagationEligible: typeof (raw.propagationEligible ?? raw.propagation_eligible) === "boolean"
      ? Boolean(raw.propagationEligible ?? raw.propagation_eligible)
      : DEFAULT_VOLVOX_METADATA.propagationEligible,
    ...(normalizeOptionalString(raw.lastEpochId ?? raw.last_epoch_id)
      ? { lastEpochId: normalizeOptionalString(raw.lastEpochId ?? raw.last_epoch_id) }
      : {}),
    ...(normalizeOptionalString(raw.lastEpochAt ?? raw.last_epoch_at)
      ? { lastEpochAt: normalizeOptionalString(raw.lastEpochAt ?? raw.last_epoch_at) }
      : {}),
    ...(normalizeOptionalString(raw.archivedAt ?? raw.archived_at)
      ? { archivedAt: normalizeOptionalString(raw.archivedAt ?? raw.archived_at) }
      : {}),
  };
}

export function normalizeVolvoxMetrics(value: unknown): VolvoxMetrics {
  const raw = isPlainObject(value) ? value : {};
  const kirkStepRaw = raw.kirkStep ?? raw.kirk_step;
  return {
    activationRate: clampUnit(raw.activationRate ?? raw.activation_rate),
    offspringCount: nonNegativeInteger(raw.offspringCount ?? raw.offspring_count),
    crossLayerConnections: nonNegativeInteger(raw.crossLayerConnections ?? raw.cross_layer_connections),
    connectionDensity: nonNegativeInteger(raw.connectionDensity ?? raw.connection_density),
    dormancyCycles: nonNegativeInteger(raw.dormancyCycles ?? raw.dormancy_cycles),
    ...(typeof kirkStepRaw === "number" && Number.isFinite(kirkStepRaw) ? { kirkStep: Math.floor(kirkStepRaw) } : {}),
  };
}

export function normalizeVolvoxThresholds(value: unknown): VolvoxThresholds {
  const raw = isPlainObject(value) ? value : {};
  return {
    activationRate: normalizePositiveThreshold(raw.activationRate ?? raw.activation_rate, DEFAULT_VOLVOX_THRESHOLDS.activationRate),
    offspringCount: normalizePositiveThreshold(raw.offspringCount ?? raw.offspring_count, DEFAULT_VOLVOX_THRESHOLDS.offspringCount),
    crossLayerConnections: normalizePositiveThreshold(
      raw.crossLayerConnections ?? raw.cross_layer_connections,
      DEFAULT_VOLVOX_THRESHOLDS.crossLayerConnections,
    ),
    connectionDensity: normalizePositiveThreshold(
      raw.connectionDensity ?? raw.connection_density,
      DEFAULT_VOLVOX_THRESHOLDS.connectionDensity,
    ),
    dormancyCycles: normalizePositiveThreshold(raw.dormancyCycles ?? raw.dormancy_cycles, DEFAULT_VOLVOX_THRESHOLDS.dormancyCycles),
    dormantArchiveCycles: normalizePositiveThreshold(
      raw.dormantArchiveCycles ?? raw.dormant_archive_cycles,
      DEFAULT_VOLVOX_THRESHOLDS.dormantArchiveCycles,
    ),
    stableRole: clampUnit(raw.stableRole ?? raw.stable_role, DEFAULT_VOLVOX_THRESHOLDS.stableRole),
    propagationStability: clampUnit(
      raw.propagationStability ?? raw.propagation_stability,
      DEFAULT_VOLVOX_THRESHOLDS.propagationStability,
    ),
  };
}

export function mapKirkStepToLifecyclePhase(kirkStep: unknown): VolvoxLifecyclePhase {
  if (typeof kirkStep !== "number" || !Number.isFinite(kirkStep)) return "embryonic";
  const step = Math.floor(kirkStep);
  if (step <= 4) return "embryonic";
  if (step <= 9) return "juvenile";
  return "mature";
}

export function classifyVolvoxCell(input: VolvoxClassificationInput): VolvoxClassificationResult {
  const thresholds = normalizeVolvoxThresholds(input.thresholds ?? undefined);
  const metrics = normalizeVolvoxMetrics(input.metrics ?? undefined);
  const previous = normalizeVolvoxMetadata(input.previous ?? undefined);
  const trinityLayer = normalizeTrinityLayerForVolvox(input.trinityLayer);
  const integrityViolation = input.integrityViolation === true;

  if (metrics.dormancyCycles > thresholds.dormancyCycles) {
    if (previous.cellType === "GERMLINE" && previous.roleStability >= thresholds.stableRole && !integrityViolation) {
      return { cellType: "GERMLINE", reason: "stable-preservation" };
    }
    return { cellType: "DORMANT", reason: "dormancy" };
  }

  if (previous.roleStability >= thresholds.stableRole && !integrityViolation) {
    return { cellType: previous.cellType, reason: "stable-preservation" };
  }

  if (metrics.offspringCount > thresholds.offspringCount) {
    return { cellType: "GERMLINE", reason: "germline" };
  }

  if (metrics.crossLayerConnections > thresholds.crossLayerConnections) {
    return { cellType: "STRUCTURAL", reason: "structural" };
  }

  if (metrics.activationRate > thresholds.activationRate) {
    return { cellType: "SOMATIC_SENSOR", reason: "somatic-sensor" };
  }

  if (metrics.connectionDensity > thresholds.connectionDensity && trinityLayer === "generative") {
    return { cellType: "SOMATIC_MOTOR", reason: "somatic-motor" };
  }

  return { cellType: "UNDIFFERENTIATED", reason: "undifferentiated" };
}

export function reconcileVolvoxRoleStability(
  previousCellType: unknown,
  nextCellType: unknown,
  previousRoleStability: unknown,
): number {
  const previous = normalizeVolvoxCellType(previousCellType);
  const next = normalizeVolvoxCellType(nextCellType);
  const stability = clampUnit(previousRoleStability);
  return previous === next ? round4(Math.min(1, stability + 0.05)) : 0.1;
}

export function scoreVolvoxFitness(metricsInput: unknown, metadataInput: unknown): number {
  const metrics = normalizeVolvoxMetrics(metricsInput);
  const metadata = normalizeVolvoxMetadata(metadataInput);
  const activation = metrics.activationRate * 0.3;
  const propagation = Math.min(metrics.offspringCount / 10, 1) * 0.25;
  const connectivity = Math.min((metrics.crossLayerConnections + metrics.connectionDensity) / 20, 1) * 0.25;
  const stability = metadata.roleStability * 0.2;
  const dormancyPenalty = metrics.dormancyCycles > DEFAULT_VOLVOX_THRESHOLDS.dormancyCycles ? 0.2 : 0;
  return clampUnit(activation + propagation + connectivity + stability - dormancyPenalty);
}

export function isVolvoxPropagationEligible(
  metadataInput: unknown,
  gatesInput: unknown = {},
  thresholdsInput: unknown = {},
): boolean {
  const metadata = normalizeVolvoxMetadata(metadataInput);
  const thresholds = normalizeVolvoxThresholds(thresholdsInput);
  const gates = isPlainObject(gatesInput) ? gatesInput : {};
  const contributorOk = hasOwn(gates, "contributor") ? gates.contributor === true : true;
  const provenanceOk = hasOwn(gates, "provenanceComplete") || hasOwn(gates, "provenance_complete")
    ? (gates.provenanceComplete ?? gates.provenance_complete) === true
    : true;

  return metadata.cellType === "GERMLINE"
    && metadata.roleStability >= thresholds.propagationStability
    && lifecycleRank(metadata.lifecyclePhase) >= lifecycleRank("juvenile")
    && contributorOk
    && provenanceOk;
}

export function deterministicVolvoxMutation(seed: string, metricsInput: unknown): VolvoxMetrics {
  const metrics = normalizeVolvoxMetrics(metricsInput);
  const activationDelta = seededCenteredUnit(`${seed}:activation`) * 0.1;
  const offspringDelta = seededInteger(`${seed}:offspring`, -1, 1);
  const crossLayerDelta = seededInteger(`${seed}:cross-layer`, -1, 1);
  const densityDelta = seededInteger(`${seed}:density`, -1, 1);
  const dormancyDelta = seededInteger(`${seed}:dormancy`, -1, 1);
  return {
    activationRate: clampUnit(metrics.activationRate + activationDelta),
    offspringCount: Math.max(0, metrics.offspringCount + offspringDelta),
    crossLayerConnections: Math.max(0, metrics.crossLayerConnections + crossLayerDelta),
    connectionDensity: Math.max(0, metrics.connectionDensity + densityDelta),
    dormancyCycles: Math.max(0, metrics.dormancyCycles + dormancyDelta),
    ...(metrics.kirkStep === undefined ? {} : { kirkStep: metrics.kirkStep }),
  };
}

export function runVolvoxEpoch(records: VolvoxMemoryRecord[], options: VolvoxEpochOptions = {}): VolvoxEpochResult {
  const timestamp = normalizeIsoTimestamp(options.now);
  const epochId = options.epochId ?? `volvox-${stableHash(`${timestamp}:${records.length}`).toString(16)}`;
  const thresholds = normalizeVolvoxThresholds(options.thresholds ?? undefined);
  const diagnostics: VolvoxDiagnostic[] = [];

  addMalformedThresholdDiagnostics(options.thresholds, thresholds, diagnostics, epochId, timestamp);

  const normalized = [...records]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => processRecord(record, { epochId, timestamp, thresholds, diagnostics }));

  const diffs = normalized
    .map(({ record, before, after }) => buildDiff(record.id, before, after))
    .filter((diff) => diff.changedFields.length > 0);
  const outputRecords = normalized.map(({ record, after }) => ({ ...record, volvox: after }));
  const counts = buildEpochCounts(outputRecords, diffs, diagnostics);
  const status = counts.blockingDiagnostics > 0 ? "blocked" : "completed";

  return {
    epochId,
    status,
    trigger: normalizeOptionalString(options.trigger) ?? "manual",
    startedAt: timestamp,
    completedAt: timestamp,
    thresholds,
    thresholdsJson: stableJson(thresholds),
    phases: VOLVOX_EPOCH_PHASES,
    records: outputRecords,
    diffs,
    diagnostics,
    diagnosticsJson: stableJson(diagnostics),
    counts,
  };
}

type ProcessContext = {
  epochId: string;
  timestamp: string;
  thresholds: VolvoxThresholds;
  diagnostics: VolvoxDiagnostic[];
};

function processRecord(record: VolvoxMemoryRecord, context: ProcessContext): {
  record: VolvoxMemoryRecord;
  before: VolvoxMetadata;
  after: VolvoxMetadata;
} {
  const before = normalizeVolvoxMetadata(record.volvox ?? undefined);
  addMalformedStateDiagnostics(record, context, before);
  const metrics = normalizeVolvoxMetrics(record.metrics ?? undefined);
  const lifecycleFromKirk = mapKirkStepToLifecyclePhase(metrics.kirkStep);
  const stableGermlineDormancy = before.cellType === "GERMLINE"
    && before.roleStability >= context.thresholds.stableRole
    && metrics.dormancyCycles > context.thresholds.dormancyCycles;
  const classification = classifyVolvoxCell({
    previous: before,
    metrics,
    trinityLayer: record.trinityLayer,
    thresholds: context.thresholds,
  });
  const cellType = stableGermlineDormancy ? "GERMLINE" : classification.cellType;
  const roleStability = reconcileVolvoxRoleStability(before.cellType, cellType, before.roleStability);
  const lifecyclePhase = settleLifecyclePhase({
    before,
    cellType,
    roleStability,
    metrics,
    lifecycleFromKirk,
    record,
    context,
  });
  const candidate: VolvoxMetadata = {
    cellType,
    roleStability,
    lifecyclePhase,
    propagationEligible: false,
    lastEpochId: context.epochId,
    lastEpochAt: context.timestamp,
  };
  const archivedAt = archivedAtFor({ before, candidate, metrics, record, context });
  if (archivedAt) candidate.archivedAt = archivedAt;
  const propagationEligible = isVolvoxPropagationEligible(candidate, record.propagation ?? undefined, context.thresholds);
  candidate.propagationEligible = propagationEligible;
  addPropagationDiagnostics(record, before, candidate, context);
  addInvalidTransitionDiagnostics(record, before, candidate, context);
  return { record, before, after: candidate };
}

function settleLifecyclePhase(input: {
  before: VolvoxMetadata;
  cellType: VolvoxCellType;
  roleStability: number;
  metrics: VolvoxMetrics;
  lifecycleFromKirk: VolvoxLifecyclePhase;
  record: VolvoxMemoryRecord;
  context: ProcessContext;
}): VolvoxLifecyclePhase {
  if (input.cellType === "DORMANT") {
    return input.metrics.dormancyCycles > input.context.thresholds.dormantArchiveCycles ? "archived" : "dormant";
  }
  if (input.before.cellType === "GERMLINE" && input.cellType === "GERMLINE") {
    return maxLifecyclePhase(input.before.lifecyclePhase, input.lifecycleFromKirk);
  }
  return input.lifecycleFromKirk;
}

function archivedAtFor(input: {
  before: VolvoxMetadata;
  candidate: VolvoxMetadata;
  metrics: VolvoxMetrics;
  record: VolvoxMemoryRecord;
  context: ProcessContext;
}): string | undefined {
  if (input.candidate.cellType === "GERMLINE") {
    if (input.metrics.dormancyCycles > input.context.thresholds.dormantArchiveCycles) {
      input.context.diagnostics.push(buildDiagnostic({
        epochId: input.context.epochId,
        memoryId: input.record.id,
        code: "archive-germline-blocked",
        severity: "blocking",
        phase: "diagnose",
        message: "GERMLINE memory met dormancy archive threshold but germline archival is blocked.",
        remediation: "Revalidate or explicitly demote the memory before archival; do not archive GERMLINE state implicitly.",
        timestamp: input.context.timestamp,
        metadata: {
          cellType: input.candidate.cellType,
          dormancyCycles: input.metrics.dormancyCycles,
          dormantArchiveCycles: input.context.thresholds.dormantArchiveCycles,
        },
      }));
    }
    return undefined;
  }
  if (input.candidate.lifecyclePhase === "archived") return input.before.archivedAt ?? input.context.timestamp;
  return undefined;
}

function addMalformedStateDiagnostics(record: VolvoxMemoryRecord, context: ProcessContext, _normalized: VolvoxMetadata): void {
  const raw = isPlainObject(record.volvox) ? record.volvox as Record<string, unknown> : {};
  const rawCell = raw.cellType ?? raw.cell_type;
  if (rawCell !== undefined && !isKnownCellType(rawCell)) {
    context.diagnostics.push(buildDiagnostic({
      epochId: context.epochId,
      memoryId: record.id,
      code: "malformed-cell-type",
      severity: "warning",
      phase: "normalize",
      message: "Unknown VOLVOX cell type normalized to UNDIFFERENTIATED.",
      remediation: "Write one of the canonical uppercase VOLVOX cell type strings before persisting state.",
      timestamp: context.timestamp,
      metadata: { category: record.category ?? null },
    }));
  }
  const rawPhase = raw.lifecyclePhase ?? raw.lifecycle_phase;
  if (rawPhase !== undefined && !isKnownLifecyclePhase(rawPhase)) {
    context.diagnostics.push(buildDiagnostic({
      epochId: context.epochId,
      memoryId: record.id,
      code: "malformed-lifecycle-phase",
      severity: "warning",
      phase: "normalize",
      message: "Unknown VOLVOX lifecycle phase normalized to embryonic.",
      remediation: "Write one of embryonic, juvenile, mature, dormant, or archived before persisting state.",
      timestamp: context.timestamp,
      metadata: { category: record.category ?? null },
    }));
  }
}

function addMalformedThresholdDiagnostics(
  rawThresholds: unknown,
  _thresholds: VolvoxThresholds,
  diagnostics: VolvoxDiagnostic[],
  epochId: string,
  timestamp: string,
): void {
  if (!isPlainObject(rawThresholds)) return;
  for (const [key, raw] of Object.entries(rawThresholds)) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) continue;
    diagnostics.push(buildDiagnostic({
      epochId,
      code: "malformed-threshold",
      severity: "warning",
      phase: "normalize",
      message: `Malformed VOLVOX threshold ${key} normalized to a safe value.`,
      remediation: "Use finite positive threshold values; stability thresholds are clamped into [0,1].",
      timestamp,
      metadata: { threshold: key },
    }));
  }
}

function addPropagationDiagnostics(
  record: VolvoxMemoryRecord,
  before: VolvoxMetadata,
  after: VolvoxMetadata,
  context: ProcessContext,
): void {
  if (before.propagationEligible && after.cellType !== "GERMLINE") {
    context.diagnostics.push(buildDiagnostic({
      epochId: context.epochId,
      memoryId: record.id,
      code: "false-germline",
      severity: "blocking",
      phase: "diagnose",
      message: "Memory claimed propagation eligibility without GERMLINE classification.",
      remediation: "Clear propagation eligibility or supply offspring/provenance evidence that classifies the memory as GERMLINE.",
      timestamp: context.timestamp,
      metadata: {
        category: record.category ?? null,
        previousCellType: before.cellType,
        nextCellType: after.cellType,
      },
    }));
  }

  if (after.cellType === "GERMLINE" && !after.propagationEligible) {
    context.diagnostics.push(buildDiagnostic({
      epochId: context.epochId,
      memoryId: record.id,
      code: "propagation-gate-failed",
      severity: "warning",
      phase: "propagate",
      message: "GERMLINE memory is not propagation eligible because a stability, lifecycle, contributor, or provenance gate failed.",
      remediation: "Check role stability, juvenile-or-later lifecycle, contributor status, and provenance completeness before propagation.",
      timestamp: context.timestamp,
      metadata: {
        cellType: after.cellType,
        roleStability: after.roleStability,
        lifecyclePhase: after.lifecyclePhase,
      },
    }));
  }
}

function addInvalidTransitionDiagnostics(
  record: VolvoxMemoryRecord,
  before: VolvoxMetadata,
  after: VolvoxMetadata,
  context: ProcessContext,
): void {
  const gates = isPlainObject(record.propagation) ? record.propagation : {};
  const hasRevalidation = gates.revalidated === true || gates.inheritanceEvent === true;
  if (before.lifecyclePhase === "mature" && lifecycleRank(after.lifecyclePhase) < lifecycleRank("mature") && !hasRevalidation) {
    context.diagnostics.push(buildDiagnostic({
      epochId: context.epochId,
      memoryId: record.id,
      code: "invalid-transition",
      severity: "blocking",
      phase: "diagnose",
      message: "Mature VOLVOX lifecycle regressed without a revalidation or inheritance event.",
      remediation: "Provide a revalidated/inheritance propagation gate or keep mature lifecycle state stable.",
      timestamp: context.timestamp,
      metadata: {
        previousLifecyclePhase: before.lifecyclePhase,
        nextLifecyclePhase: after.lifecyclePhase,
      },
    }));
  }

  if (before.cellType === "GERMLINE" && after.cellType !== "GERMLINE" && !hasRevalidation) {
    context.diagnostics.push(buildDiagnostic({
      epochId: context.epochId,
      memoryId: record.id,
      code: "invalid-transition",
      severity: "blocking",
      phase: "diagnose",
      message: "GERMLINE memory transitioned to a non-GERMLINE role without revalidation or inheritance evidence.",
      remediation: "Supply revalidation/inheritance evidence or preserve GERMLINE until explicit demotion is safe.",
      timestamp: context.timestamp,
      metadata: {
        previousCellType: before.cellType,
        nextCellType: after.cellType,
      },
    }));
  }
}

function buildDiagnostic(input: VolvoxDiagnostic): VolvoxDiagnostic {
  return input;
}

function buildDiff(memoryId: string, before: VolvoxMetadata, after: VolvoxMetadata): VolvoxEpochDiff {
  const changedFields: Array<keyof VolvoxMetadata> = [];
  const keys: Array<keyof VolvoxMetadata> = [
    "cellType",
    "roleStability",
    "lifecyclePhase",
    "propagationEligible",
    "lastEpochId",
    "lastEpochAt",
    "archivedAt",
  ];
  for (const key of keys) {
    if (before[key] !== after[key]) changedFields.push(key);
  }
  return { memoryId, before, after, changedFields };
}

function buildEpochCounts(
  records: Array<VolvoxMemoryRecord & { volvox: VolvoxMetadata }>,
  diffs: VolvoxEpochDiff[],
  diagnostics: VolvoxDiagnostic[],
): VolvoxEpochCounts {
  const byCellType = Object.fromEntries(VOLVOX_CELL_TYPES.map((cellType) => [cellType, 0])) as Record<VolvoxCellType, number>;
  let propagationEligible = 0;
  let archived = 0;
  for (const record of records) {
    byCellType[record.volvox.cellType] += 1;
    if (record.volvox.propagationEligible) propagationEligible += 1;
    if (record.volvox.archivedAt || record.volvox.lifecyclePhase === "archived") archived += 1;
  }
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "blocking").length;
  return {
    processed: records.length,
    changed: diffs.length,
    diagnostics: diagnostics.length,
    blockingDiagnostics,
    byCellType,
    propagationEligible,
    archived,
  };
}

function lifecycleRank(phase: VolvoxLifecyclePhase): number {
  switch (phase) {
    case "embryonic":
      return 0;
    case "juvenile":
      return 1;
    case "mature":
      return 2;
    case "dormant":
      return 3;
    case "archived":
      return 4;
  }
}

function maxLifecyclePhase(left: VolvoxLifecyclePhase, right: VolvoxLifecyclePhase): VolvoxLifecyclePhase {
  return lifecycleRank(left) >= lifecycleRank(right) ? left : right;
}

function seededCenteredUnit(seed: string): number {
  return (stableHash(seed) / 0xffffffff) - 0.5;
}

function seededInteger(seed: string, min: number, max: number): number {
  const unit = stableHash(seed) / 0xffffffff;
  return Math.floor(unit * (max - min + 1)) + min;
}

function stableHash(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableJson(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toStableJsonValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, toStableJsonValue(entryValue)]),
  );
}
