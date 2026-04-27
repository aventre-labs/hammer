export const TRINITY_LAYERS = ['social', 'knowledge', 'generative'] as const;
export type TrinityLayer = (typeof TRINITY_LAYERS)[number];

export const TRINITY_VECTOR_KEYS = [
  'factuality',
  'specificity',
  'continuity',
  'stability',
  'utility',
  'empathy',
  'reciprocity',
  'creativity',
  'generativity',
  'risk',
] as const;
export type TrinityVectorKey = (typeof TRINITY_VECTOR_KEYS)[number];
export type TrinityVector = Partial<Record<TrinityVectorKey, number>>;

export const VALID_TRINITY_SOURCE_RELATION_TYPES = [
  'derived_from',
  'observed_in',
  'supports',
  'contradicts',
  'supersedes',
  'elaborates',
  'related_to',
] as const;
export type TrinitySourceRelationType = (typeof VALID_TRINITY_SOURCE_RELATION_TYPES)[number];

export const VALID_TRINITY_VALIDATION_STATES = [
  'unvalidated',
  'validated',
  'contested',
  'deprecated',
] as const;
export type TrinityValidationState = (typeof VALID_TRINITY_VALIDATION_STATES)[number];

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

const TYPE_LAYER_DEFAULTS: Record<string, TrinityLayer> = {
  milestone: 'knowledge',
  slice: 'generative',
  task: 'generative',
  rule: 'knowledge',
  pattern: 'generative',
  lesson: 'knowledge',
  decision: 'knowledge',
  concept: 'knowledge',
  surprise: 'knowledge',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function layerForType(type: string): TrinityLayer {
  return TYPE_LAYER_DEFAULTS[type] ?? 'knowledge';
}

function scoreForConfidence(confidence: string): number {
  if (confidence === 'EXTRACTED') return 1;
  if (confidence === 'INFERRED') return 0.6;
  return 0.3;
}

function defaultValidationForConfidence(confidence: string): TrinityValidation {
  return {
    state: confidence === 'AMBIGUOUS' ? 'unvalidated' : 'validated',
    score: scoreForConfidence(confidence),
  };
}

export function clampTrinityScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 10_000) / 10_000;
}

export function normalizeGraphTrinityLayer(value: unknown, fallback: TrinityLayer): TrinityLayer {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return (TRINITY_LAYERS as readonly string[]).includes(normalized)
    ? (normalized as TrinityLayer)
    : fallback;
}

export function normalizeGraphTrinityVector(value: unknown): TrinityVector {
  if (!isPlainObject(value)) return {};
  const out: TrinityVector = {};
  for (const key of TRINITY_VECTOR_KEYS) {
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    out[key] = clampTrinityScore(raw);
  }
  return out;
}

function normalizeRelationType(value: unknown): TrinitySourceRelationType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (VALID_TRINITY_SOURCE_RELATION_TYPES as readonly string[]).includes(normalized)
    ? (normalized as TrinitySourceRelationType)
    : null;
}

function normalizeGraphTrinitySourceRelations(value: unknown): TrinitySourceRelation[] {
  if (!Array.isArray(value)) return [];
  const relations: TrinitySourceRelation[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const type = normalizeRelationType(entry.type);
    const targetId = optionalString(entry.targetId ?? entry.target_id ?? entry.id);
    if (!type || !targetId) continue;
    const targetKind = optionalString(entry.targetKind ?? entry.target_kind ?? entry.kind);
    const relation: TrinitySourceRelation = { type, targetId };
    if (targetKind) relation.targetKind = targetKind;
    if (typeof entry.weight === 'number' && Number.isFinite(entry.weight)) {
      relation.weight = clampTrinityScore(entry.weight);
    }
    relations.push(relation);
  }
  return relations;
}

export function normalizeGraphTrinityProvenance(
  value: unknown,
  fallback: Partial<TrinityProvenance> = {},
): TrinityProvenance {
  const raw = isPlainObject(value) ? value : {};
  const sourceUnitType = optionalString(raw.sourceUnitType ?? raw.source_unit_type) ?? fallback.sourceUnitType;
  const sourceUnitId = optionalString(raw.sourceUnitId ?? raw.source_unit_id) ?? fallback.sourceUnitId;
  const sourceId = optionalString(raw.sourceId ?? raw.source_id) ?? fallback.sourceId;
  const artifactPath = optionalString(raw.artifactPath ?? raw.artifact_path) ?? fallback.artifactPath;
  const sourceRelations = normalizeGraphTrinitySourceRelations(raw.sourceRelations ?? raw.source_relations);
  const fallbackRelations = Array.isArray(fallback.sourceRelations) ? fallback.sourceRelations : [];

  return {
    ...(sourceUnitType ? { sourceUnitType } : {}),
    ...(sourceUnitId ? { sourceUnitId } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(artifactPath ? { artifactPath } : {}),
    sourceRelations: sourceRelations.length > 0 ? sourceRelations : fallbackRelations,
  };
}

export function normalizeGraphTrinityValidation(value: unknown, confidence: string): TrinityValidation {
  const fallback = defaultValidationForConfidence(confidence);
  if (!isPlainObject(value)) return fallback;

  const rawState = value.state;
  const hasExplicitState = typeof rawState === 'string';
  const normalizedState = hasExplicitState ? rawState.trim().toLowerCase() : fallback.state;
  const state = (VALID_TRINITY_VALIDATION_STATES as readonly string[]).includes(normalizedState)
    ? (normalizedState as TrinityValidationState)
    : 'unvalidated';

  return {
    state,
    score: hasExplicitState || typeof value.score === 'number' ? clampTrinityScore(value.score) : fallback.score,
  };
}

interface GraphNodeTrinityInput {
  id: string;
  type: string;
  confidence: string;
  sourceFile?: string;
  trinity?: unknown;
  trinityLayer?: unknown;
  ity?: unknown;
  pathy?: unknown;
  provenance?: unknown;
  validation?: unknown;
  validationSummary?: unknown;
}

function buildFallbackProvenance(input: GraphNodeTrinityInput): TrinityProvenance {
  return {
    sourceId: input.id,
    ...(input.sourceFile ? { artifactPath: input.sourceFile } : {}),
    sourceRelations: input.sourceFile
      ? [{ type: 'derived_from', targetId: input.sourceFile, targetKind: 'artifact', weight: 1 }]
      : [],
  };
}

function trinityInputForNode(input: GraphNodeTrinityInput): Record<string, unknown> {
  if (isPlainObject(input.trinity)) return input.trinity;
  return {
    layer: input.trinityLayer,
    ity: input.ity,
    pathy: input.pathy,
    provenance: input.provenance,
    validation: input.validationSummary ?? input.validation,
  };
}

export function buildGraphNodeTrinity(input: GraphNodeTrinityInput): TrinityMetadata {
  const fallbackLayer = layerForType(input.type);
  const raw = trinityInputForNode(input);
  const fallbackProvenance = buildFallbackProvenance(input);

  return {
    layer: normalizeGraphTrinityLayer(raw.layer, fallbackLayer),
    ity: normalizeGraphTrinityVector(raw.ity),
    pathy: normalizeGraphTrinityVector(raw.pathy),
    provenance: normalizeGraphTrinityProvenance(raw.provenance, fallbackProvenance),
    validation: normalizeGraphTrinityValidation(raw.validation, input.confidence),
  };
}

export function withGraphNodeTrinity<T extends GraphNodeTrinityInput>(node: T): T & {
  trinity: TrinityMetadata;
  trinityLayer: TrinityLayer;
  ity: TrinityVector;
  pathy: TrinityVector;
  provenance: TrinityProvenance;
  validationSummary: TrinityValidation;
} {
  const trinity = buildGraphNodeTrinity(node);
  return {
    ...node,
    trinity,
    trinityLayer: trinity.layer,
    ity: trinity.ity,
    pathy: trinity.pathy,
    provenance: trinity.provenance,
    validationSummary: trinity.validation,
  };
}
