/**
 * src/iam/trinity.ts
 *
 * Pure Trinity Graph metadata contracts and normalization helpers. This module
 * deliberately has no extension-tree imports so IAM types and public tool
 * adapters can share one runtime-independent interpretation of Trinity state.
 */

export const TRINITY_LAYERS = ["social", "knowledge", "generative"] as const;
export type TrinityLayer = (typeof TRINITY_LAYERS)[number];

export const TRINITY_VECTOR_KEYS = [
  "factuality",
  "specificity",
  "continuity",
  "stability",
  "utility",
  "empathy",
  "reciprocity",
  "creativity",
  "generativity",
  "risk",
] as const;
export type TrinityVectorKey = (typeof TRINITY_VECTOR_KEYS)[number];
export type TrinityVector = Partial<Record<TrinityVectorKey, number>>;

export const VALID_TRINITY_SOURCE_RELATION_TYPES = [
  "derived_from",
  "observed_in",
  "supports",
  "contradicts",
  "supersedes",
  "elaborates",
  "related_to",
] as const;
export type TrinitySourceRelationType = (typeof VALID_TRINITY_SOURCE_RELATION_TYPES)[number];

export interface TrinitySourceRelation {
  type: TrinitySourceRelationType;
  targetId: string;
  targetKind?: string;
  weight?: number;
}

export interface TrinityProvenance {
  sourceUnitType?: string;
  sourceUnitId?: string;
  sourceId?: string;
  artifactPath?: string;
  sourceRelations: TrinitySourceRelation[];
}

export const VALID_TRINITY_VALIDATION_STATES = [
  "unvalidated",
  "validated",
  "contested",
  "deprecated",
] as const;
export type TrinityValidationState = (typeof VALID_TRINITY_VALIDATION_STATES)[number];

export interface TrinityValidation {
  state: TrinityValidationState;
  score: number;
}

export interface TrinityMetadata {
  layer: TrinityLayer;
  ity: TrinityVector;
  pathy: TrinityVector;
  provenance: TrinityProvenance;
  validation: TrinityValidation;
}

export interface BuildDefaultTrinityMetadataInput {
  category?: string | null;
  sourceUnitType?: string | null;
  sourceUnitId?: string | null;
  sourceRelations?: unknown;
  provenance?: unknown;
  validation?: unknown;
  layer?: unknown;
  ity?: unknown;
  pathy?: unknown;
}

export const TRINITY_CATEGORY_LAYER_DEFAULTS: Record<string, TrinityLayer> = {
  preference: "social",
  convention: "social",
  environment: "knowledge",
  gotcha: "knowledge",
  architecture: "knowledge",
  pattern: "generative",
};

const DEFAULT_VALIDATION: TrinityValidation = {
  state: "unvalidated",
  score: 0,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeTrinityLayer(value: unknown, fallback: TrinityLayer = "knowledge"): TrinityLayer {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return (TRINITY_LAYERS as readonly string[]).includes(normalized)
    ? (normalized as TrinityLayer)
    : fallback;
}

export function layerForMemoryCategory(category: unknown): TrinityLayer {
  if (typeof category !== "string") return "knowledge";
  return TRINITY_CATEGORY_LAYER_DEFAULTS[category.trim().toLowerCase()] ?? "knowledge";
}

export function clampTrinityScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 10_000) / 10_000;
}

export function normalizeTrinityVector(value: unknown): TrinityVector {
  if (!isPlainObject(value)) return {};
  const out: TrinityVector = {};
  for (const key of TRINITY_VECTOR_KEYS) {
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out[key] = clampTrinityScore(raw);
  }
  return out;
}

function normalizeRelationType(value: unknown): TrinitySourceRelationType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (VALID_TRINITY_SOURCE_RELATION_TYPES as readonly string[]).includes(normalized)
    ? (normalized as TrinitySourceRelationType)
    : null;
}

export function normalizeTrinitySourceRelations(value: unknown): TrinitySourceRelation[] {
  if (!Array.isArray(value)) return [];
  const out: TrinitySourceRelation[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const type = normalizeRelationType(entry.type);
    const targetId = normalizeOptionalString(entry.targetId ?? entry.target_id ?? entry.id);
    if (!type || !targetId) continue;
    const targetKind = normalizeOptionalString(entry.targetKind ?? entry.target_kind ?? entry.kind);
    const relation: TrinitySourceRelation = { type, targetId };
    if (targetKind) relation.targetKind = targetKind;
    if (typeof entry.weight === "number" && Number.isFinite(entry.weight)) {
      relation.weight = clampTrinityScore(entry.weight);
    }
    out.push(relation);
  }
  return out;
}

export function normalizeTrinityProvenance(
  value: unknown,
  fallback: Partial<TrinityProvenance> = {},
): TrinityProvenance {
  const raw = isPlainObject(value) ? value : {};
  const sourceUnitType = normalizeOptionalString(raw.sourceUnitType ?? raw.source_unit_type) ?? fallback.sourceUnitType;
  const sourceUnitId = normalizeOptionalString(raw.sourceUnitId ?? raw.source_unit_id) ?? fallback.sourceUnitId;
  const sourceId = normalizeOptionalString(raw.sourceId ?? raw.source_id) ?? fallback.sourceId;
  const artifactPath = normalizeOptionalString(raw.artifactPath ?? raw.artifact_path) ?? fallback.artifactPath;
  const sourceRelations = normalizeTrinitySourceRelations(raw.sourceRelations ?? raw.source_relations);
  const fallbackRelations = Array.isArray(fallback.sourceRelations) ? fallback.sourceRelations : [];

  return {
    ...(sourceUnitType ? { sourceUnitType } : {}),
    ...(sourceUnitId ? { sourceUnitId } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(artifactPath ? { artifactPath } : {}),
    sourceRelations: sourceRelations.length > 0 ? sourceRelations : fallbackRelations,
  };
}

export function normalizeTrinityValidation(value: unknown): TrinityValidation {
  const raw = isPlainObject(value) ? value : {};
  const stateRaw = typeof raw.state === "string" ? raw.state.trim().toLowerCase() : DEFAULT_VALIDATION.state;
  const state = (VALID_TRINITY_VALIDATION_STATES as readonly string[]).includes(stateRaw)
    ? (stateRaw as TrinityValidationState)
    : DEFAULT_VALIDATION.state;
  return {
    state,
    score: clampTrinityScore(raw.score),
  };
}

export function buildDefaultTrinityMetadata(input: BuildDefaultTrinityMetadataInput = {}): TrinityMetadata {
  const fallbackLayer = layerForMemoryCategory(input.category);
  const sourceUnitType = normalizeOptionalString(input.sourceUnitType);
  const sourceUnitId = normalizeOptionalString(input.sourceUnitId);
  const fallbackProvenance: Partial<TrinityProvenance> = {
    ...(sourceUnitType ? { sourceUnitType } : {}),
    ...(sourceUnitId ? { sourceUnitId } : {}),
    sourceRelations: normalizeTrinitySourceRelations(input.sourceRelations),
  };

  return normalizeTrinityMetadata({
    layer: input.layer ?? fallbackLayer,
    ity: input.ity,
    pathy: input.pathy,
    provenance: input.provenance,
    validation: input.validation,
  }, fallbackLayer, fallbackProvenance);
}

export function normalizeTrinityMetadata(
  value: unknown,
  fallbackLayer: TrinityLayer = "knowledge",
  fallbackProvenance: Partial<TrinityProvenance> = {},
): TrinityMetadata {
  const raw = isPlainObject(value) ? value : {};
  return {
    layer: normalizeTrinityLayer(raw.layer, fallbackLayer),
    ity: normalizeTrinityVector(raw.ity),
    pathy: normalizeTrinityVector(raw.pathy),
    provenance: normalizeTrinityProvenance(raw.provenance, fallbackProvenance),
    validation: normalizeTrinityValidation(raw.validation),
  };
}

export function parseTrinityJson(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toStableJsonValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => [key, toStableJsonValue(entryValue)]),
  );
}

export function serializeTrinityJson(value: unknown): string {
  return JSON.stringify(toStableJsonValue(isPlainObject(value) ? value : {}));
}

export function trinityVectorDot(left: unknown, right: unknown): number {
  const a = normalizeTrinityVector(left);
  const b = normalizeTrinityVector(right);
  let score = 0;
  for (const key of TRINITY_VECTOR_KEYS) {
    score += (a[key] ?? 0) * (b[key] ?? 0);
  }
  return Math.round(score * 10_000) / 10_000;
}
