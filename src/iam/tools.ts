/**
 * src/iam/tools.ts
 *
 * Pure executor functions for the public IAM tool surface. This module has no
 * extension-tree imports and performs all memory/graph work through injected
 * adapters so it can be tested without a live Hammer database.
 */

import { getRune, listRunes, validateRuneNames } from "./rune-registry.js";
import { validateSavesuccess, formatSavesuccessReport } from "./savesuccess.js";
import {
  TRINITY_LAYERS,
  TRINITY_VECTOR_KEYS,
  buildDefaultTrinityMetadata,
  normalizeTrinityMetadata,
  normalizeTrinityVector,
} from "./trinity.js";
import {
  VOLVOX_CELL_TYPES,
  VOLVOX_LIFECYCLE_PHASES,
  normalizeVolvoxMetadata,
} from "./volvox.js";
import type { TrinityLayer, TrinityMetadata, TrinityVectorKey } from "./trinity.js";
import type { VolvoxCellType, VolvoxEpochResult, VolvoxLifecyclePhase } from "./volvox.js";
import type {
  GraphNode,
  IAMActiveMemoryEntry,
  IAMError,
  IAMMemoryListEntry,
  IAMMemoryQueryOptions,
  IAMResult,
  IAMToolAdapters,
  IAMToolOutput,
  IAMTrinityLens,
  RuneName,
  SavesuccessScorecard,
} from "./types.js";

export const IAM_PUBLIC_TOOL_NAMES = [
  "recall",
  "refract",
  "quick",
  "spiral",
  "canonical_spiral",
  "explore",
  "bridge",
  "compare",
  "cluster",
  "landscape",
  "tension",
  "rune",
  "validate",
  "assess",
  "compile",
  "harvest",
  "remember",
  "provenance",
  "check",
  "volvox_epoch",
  "volvox_status",
  "volvox_diagnose",
] as const;

const SPIRAL_DEFERRED_REASON = "Omega spiral requires LLM executor not yet wired";
const SPIRAL_DEFERRED_GUIDANCE =
  "Use the research phase commands (Omega Protocol) to invoke a full spiral. Direct tool wiring arrives in S06.";

const DB_UNAVAILABLE_ERROR: IAMError = {
  iamErrorKind: "persistence-failed",
  remediation:
    "Hammer database is unavailable. Ensure the DB is open before calling memory tools.",
  persistenceStatus: "not-attempted",
};

type TrinityQueryParams = {
  trinityLayer?: unknown;
  trinityLens?: unknown;
  volvoxCellType?: unknown;
  volvoxLifecyclePhase?: unknown;
  propagationEligible?: unknown;
  includeDormant?: unknown;
};

type TrinityRememberParams = {
  category: string;
  trinity?: unknown;
  trinityLayer?: unknown;
  trinityIty?: unknown;
  trinityPathy?: unknown;
  trinityProvenance?: unknown;
  trinityValidationState?: unknown;
  trinityValidationScore?: unknown;
};

function ok(value: IAMToolOutput): IAMResult<IAMToolOutput> {
  return { ok: true, value };
}

function persistenceFailed(remediation: string, cause?: unknown): IAMResult<IAMToolOutput> {
  return {
    ok: false,
    error: {
      iamErrorKind: "persistence-failed",
      remediation,
      persistenceStatus: "not-attempted",
      ...(cause === undefined ? {} : { cause }),
    },
  };
}

function requireDb(adapters: IAMToolAdapters): IAMResult<IAMToolOutput> | null {
  if (adapters.isDbAvailable()) {
    return null;
  }

  return {
    ok: false,
    error: DB_UNAVAILABLE_ERROR,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function clampLimit(value: unknown, fallback: number, max = 100): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 1) return 1;
  if (value > max) return max;
  return Math.floor(value);
}

function clampDepth(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 5) return 5;
  return Math.floor(value);
}

function normalizeOptionalTrinityLayer(value: unknown): TrinityLayer | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return (TRINITY_LAYERS as readonly string[]).includes(normalized)
    ? (normalized as TrinityLayer)
    : undefined;
}

function normalizeIAMTrinityLens(value: unknown): IAMTrinityLens | undefined {
  if (!isRecord(value)) return undefined;
  const ity = normalizeTrinityVector(value.ity);
  const pathy = normalizeTrinityVector(value.pathy);
  const lens: IAMTrinityLens = {};
  if (Object.keys(ity).length > 0) lens.ity = ity;
  if (Object.keys(pathy).length > 0) lens.pathy = pathy;
  return lens.ity || lens.pathy ? lens : undefined;
}

function normalizeQueryOptions(params: TrinityQueryParams): IAMMemoryQueryOptions | undefined {
  const options: IAMMemoryQueryOptions = {};
  const trinityLayer = normalizeOptionalTrinityLayer(params.trinityLayer);
  const trinityLens = normalizeIAMTrinityLens(params.trinityLens);
  const volvoxCellType = normalizeOptionalVolvoxCellType(params.volvoxCellType);
  const volvoxLifecyclePhase = normalizeOptionalVolvoxLifecyclePhase(params.volvoxLifecyclePhase);
  if (trinityLayer) options.trinityLayer = trinityLayer;
  if (trinityLens) options.trinityLens = trinityLens;
  if (volvoxCellType) options.volvoxCellType = volvoxCellType;
  if (volvoxLifecyclePhase) options.volvoxLifecyclePhase = volvoxLifecyclePhase;
  if (typeof params.propagationEligible === "boolean") options.propagationEligible = params.propagationEligible;
  if (typeof params.includeDormant === "boolean") options.includeDormant = params.includeDormant;
  return Object.keys(options).length > 0 ? options : undefined;
}

function normalizeOptionalVolvoxCellType(value: unknown): VolvoxCellType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return (VOLVOX_CELL_TYPES as readonly string[]).includes(normalized)
    ? (normalized as VolvoxCellType)
    : undefined;
}

function normalizeOptionalVolvoxLifecyclePhase(value: unknown): VolvoxLifecyclePhase | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return (VOLVOX_LIFECYCLE_PHASES as readonly string[]).includes(normalized)
    ? (normalized as VolvoxLifecyclePhase)
    : undefined;
}

function validateVolvoxQueryParams(params: TrinityQueryParams): IAMResult<IAMToolOutput> | null {
  if (params.volvoxCellType !== undefined && !normalizeOptionalVolvoxCellType(params.volvoxCellType)) {
    return persistenceFailed(
      `Invalid volvoxCellType filter. Use one of: ${VOLVOX_CELL_TYPES.join(", ")}.`,
    );
  }
  if (params.volvoxLifecyclePhase !== undefined && !normalizeOptionalVolvoxLifecyclePhase(params.volvoxLifecyclePhase)) {
    return persistenceFailed(
      `Invalid volvoxLifecyclePhase filter. Use one of: ${VOLVOX_LIFECYCLE_PHASES.join(", ")}.`,
    );
  }
  if (params.propagationEligible !== undefined && typeof params.propagationEligible !== "boolean") {
    return persistenceFailed("Invalid propagationEligible filter. Use a boolean true/false value.");
  }
  if (params.includeDormant !== undefined && typeof params.includeDormant !== "boolean") {
    return persistenceFailed("Invalid includeDormant filter. Use a boolean true/false value.");
  }
  return null;
}

function normalizeEntryTrinity<T extends { category: string; trinity?: unknown }>(entry: T): T {
  if (!hasOwn(entry, "trinity")) return entry;
  const fallbackLayer = buildDefaultTrinityMetadata({ category: entry.category }).layer;
  return {
    ...entry,
    trinity: normalizeTrinityMetadata(entry.trinity, fallbackLayer),
  };
}

function normalizeEntryVolvox<T extends { volvox?: unknown }>(entry: T): T {
  if (!hasOwn(entry, "volvox")) return entry;
  return {
    ...entry,
    volvox: normalizeVolvoxMetadata(entry.volvox),
  };
}

function normalizeMemoryEntry<T extends { category: string; trinity?: unknown; volvox?: unknown }>(entry: T): T {
  return normalizeEntryVolvox(normalizeEntryTrinity(entry));
}

function normalizeGraphNode(node: GraphNode): GraphNode {
  const normalized = normalizeMemoryEntry(node);
  if (!normalized.trinity) return normalized;
  return {
    ...normalized,
    provenanceSummary: normalized.provenanceSummary ?? buildProvenanceSummary(normalized.trinity),
  };
}

function buildProvenanceSummary(metadata: TrinityMetadata): NonNullable<GraphNode["provenanceSummary"]> {
  const provenance = metadata.provenance;
  return {
    ...(provenance.sourceUnitType ? { sourceUnitType: provenance.sourceUnitType } : {}),
    ...(provenance.sourceUnitId ? { sourceUnitId: provenance.sourceUnitId } : {}),
    ...(provenance.sourceId ? { sourceId: provenance.sourceId } : {}),
    ...(provenance.artifactPath ? { artifactPath: provenance.artifactPath } : {}),
    sourceRelationCount: provenance.sourceRelations.length,
    sourceRelations: provenance.sourceRelations,
  };
}

function normalizeRememberTrinity(params: TrinityRememberParams): TrinityMetadata {
  const raw = isRecord(params.trinity) ? params.trinity : {};
  const rawValidation = isRecord(raw.validation) ? raw.validation : {};
  const fallback = buildDefaultTrinityMetadata({ category: params.category, sourceUnitType: "iam-tool" });
  return normalizeTrinityMetadata(
    {
      layer: params.trinityLayer ?? raw.layer ?? fallback.layer,
      ity: params.trinityIty ?? raw.ity,
      pathy: params.trinityPathy ?? raw.pathy,
      provenance: params.trinityProvenance ?? raw.provenance,
      validation: {
        ...rawValidation,
        ...(params.trinityValidationState === undefined ? {} : { state: params.trinityValidationState }),
        ...(params.trinityValidationScore === undefined ? {} : { score: params.trinityValidationScore }),
      },
    },
    fallback.layer,
    fallback.provenance,
  );
}

function countByCategory(
  memories: Array<{ category: string }>,
): Record<string, number> {
  const categories: Record<string, number> = {};
  for (const memory of memories) {
    categories[memory.category] = (categories[memory.category] ?? 0) + 1;
  }
  return categories;
}

function activeMemoryToListEntry(memory: IAMActiveMemoryEntry): IAMMemoryListEntry {
  return normalizeMemoryEntry({
    id: memory.id,
    content: memory.content,
    score: memory.confidence,
    category: memory.category,
    ...(hasOwn(memory, "trinity") ? { trinity: memory.trinity } : {}),
    ...(hasOwn(memory, "volvox") ? { volvox: memory.volvox } : {}),
  });
}

function countByLayer(
  memories: Array<{ category: string; trinity?: unknown }>,
): Record<string, number> {
  const layers: Record<string, number> = {};
  for (const memory of memories) {
    const fallbackLayer = buildDefaultTrinityMetadata({ category: memory.category }).layer;
    const layer = hasOwn(memory, "trinity")
      ? normalizeTrinityMetadata(memory.trinity, fallbackLayer).layer
      : fallbackLayer;
    layers[layer] = (layers[layer] ?? 0) + 1;
  }
  return layers;
}

function countByVolvoxCellType(
  memories: Array<{ volvox?: unknown }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const memory of memories) {
    const cellType = hasOwn(memory, "volvox")
      ? normalizeVolvoxMetadata(memory.volvox).cellType
      : "UNDIFFERENTIATED";
    counts[cellType] = (counts[cellType] ?? 0) + 1;
  }
  return counts;
}

function countByVolvoxLifecycle(
  memories: Array<{ volvox?: unknown }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const memory of memories) {
    const phase = hasOwn(memory, "volvox")
      ? normalizeVolvoxMetadata(memory.volvox).lifecyclePhase
      : "embryonic";
    counts[phase] = (counts[phase] ?? 0) + 1;
  }
  return counts;
}

function countVolvoxEligible(
  memories: Array<{ volvox?: unknown }>,
): number {
  return memories.filter((memory) => hasOwn(memory, "volvox") && normalizeVolvoxMetadata(memory.volvox).propagationEligible).length;
}

function memoryPassesVolvoxOptions(memory: { volvox?: unknown }, options: IAMMemoryQueryOptions | undefined): boolean {
  if (!options) return true;
  const metadata = normalizeVolvoxMetadata(memory.volvox);
  if (options.volvoxCellType && metadata.cellType !== options.volvoxCellType) return false;
  if (options.volvoxLifecyclePhase && metadata.lifecyclePhase !== options.volvoxLifecyclePhase) return false;
  if (options.propagationEligible !== undefined && metadata.propagationEligible !== options.propagationEligible) return false;
  if (options.includeDormant === false && (metadata.cellType === "DORMANT" || metadata.lifecyclePhase === "dormant" || metadata.lifecyclePhase === "archived")) return false;
  return true;
}

function formatCategorySummary(
  categories: Record<string, number>,
  total: number,
): string {
  const parts = Object.entries(categories)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => `${category}:${count}`);
  return `total=${total}; categories=${parts.join(",") || "none"}`;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function containsAny(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function buildSavesuccessScorecard(
  text: string,
  target: string,
): SavesuccessScorecard {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9]+(?:[-'][a-z0-9]+)?/g) ?? [];
  const uniqueWords = new Set(words);
  const sentenceCount = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const paragraphCount = text
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean).length;
  const targetWords = target
    .toLowerCase()
    .match(/[a-z0-9]+(?:[-'][a-z0-9]+)?/g) ?? [];
  const targetMentions = targetWords.filter((word) => word.length > 3 && normalized.includes(word)).length;

  const lengthScore = clampScore(words.length / 120);
  const structureScore = clampScore((sentenceCount / 6 + paragraphCount / 4) / 2);
  const vocabularyScore = clampScore(uniqueWords.size / Math.max(1, words.length) + words.length / 400);
  const targetScore = clampScore(targetMentions / Math.max(1, Math.min(3, targetWords.length)));
  const evidenceScore = containsAny(normalized, [
    "because",
    "evidence",
    "example",
    "data",
    "metric",
    "proof",
    "observed",
    "verified",
  ])
    ? 0.8
    : clampScore(words.length / 180);
  const utilityScore = containsAny(normalized, [
    "should",
    "must",
    "next",
    "action",
    "use",
    "apply",
    "recommend",
  ])
    ? 0.8
    : clampScore(words.length / 200);
  const criticalScore = containsAny(normalized, [
    "risk",
    "tradeoff",
    "limitation",
    "unknown",
    "assumption",
    "caveat",
  ])
    ? 0.8
    : clampScore(sentenceCount / 10);
  const engagementScore = containsAny(normalized, [
    "question",
    "audience",
    "reader",
    "user",
    "why",
    "how",
  ])
    ? 0.8
    : clampScore(uniqueWords.size / 160);
  const synthesisScore = containsAny(normalized, [
    "therefore",
    "summary",
    "synthesis",
    "conclusion",
    "so",
    "overall",
  ])
    ? 0.8
    : clampScore((structureScore + evidenceScore + utilityScore) / 3);

  return {
    s: clampScore((lengthScore + vocabularyScore) / 2),
    a: clampScore((targetScore + engagementScore) / 2),
    v: clampScore((utilityScore + synthesisScore) / 2),
    e: evidenceScore,
    s2: structureScore,
    u: utilityScore,
    c: clampScore((structureScore + vocabularyScore) / 2),
    c2: criticalScore,
    e2: engagementScore,
    s3: synthesisScore,
  };
}

function spiralDeferred(): IAMResult<IAMToolOutput> {
  return ok({
    kind: "spiral-deferred",
    reason: SPIRAL_DEFERRED_REASON,
    guidance: SPIRAL_DEFERRED_GUIDANCE,
  });
}

// ---------------------------------------------------------------------------
// Group 1 — Omega spiral tools deferred until executor wiring lands in S06
// ---------------------------------------------------------------------------

export async function executeIAMSpiral(
  _adapters: IAMToolAdapters,
  _params: { query: string; stages?: string[] },
): Promise<IAMResult<IAMToolOutput>> {
  return spiralDeferred();
}

export async function executeIAMCanonicalSpiral(
  _adapters: IAMToolAdapters,
  _params: { query: string },
): Promise<IAMResult<IAMToolOutput>> {
  return spiralDeferred();
}

// ---------------------------------------------------------------------------
// Group 2 — Memory/knowledge tools
// ---------------------------------------------------------------------------

export async function executeIAMRecall(
  adapters: IAMToolAdapters,
  params: { query: string; k?: number; category?: string; trinityLayer?: unknown; trinityLens?: unknown; volvoxCellType?: unknown; volvoxLifecyclePhase?: unknown; propagationEligible?: unknown; includeDormant?: unknown },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;
  const invalidVolvox = validateVolvoxQueryParams(params);
  if (invalidVolvox) return invalidVolvox;

  const memories = adapters
    .queryMemories(params.query, clampLimit(params.k, 10), params.category, normalizeQueryOptions(params))
    .map(normalizeMemoryEntry);
  return ok({ kind: "memory-list", memories });
}

export async function executeIAMQuick(
  adapters: IAMToolAdapters,
  params: { query: string; volvoxCellType?: unknown; volvoxLifecyclePhase?: unknown; propagationEligible?: unknown; includeDormant?: unknown },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;
  const invalidVolvox = validateVolvoxQueryParams(params);
  if (invalidVolvox) return invalidVolvox;

  const memories = adapters.queryMemories(params.query, 1, undefined, normalizeQueryOptions(params)).slice(0, 1).map(normalizeMemoryEntry);
  return ok({ kind: "memory-list", memories });
}

export async function executeIAMRefract(
  adapters: IAMToolAdapters,
  params: { query: string; lens: string },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const memories = adapters.queryMemories(params.query, 5).map((memory) => ({
    ...normalizeMemoryEntry(memory),
    content: `[${params.lens} lens] ${memory.content}`,
  }));
  return ok({ kind: "memory-list", memories });
}

export async function executeIAMRemember(
  adapters: IAMToolAdapters,
  params: {
    category: string;
    content: string;
    confidence?: number;
    trinity?: unknown;
    trinityLayer?: unknown;
    trinityIty?: unknown;
    trinityPathy?: unknown;
    trinityProvenance?: unknown;
    trinityValidationState?: unknown;
    trinityValidationScore?: unknown;
  },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const trinity = normalizeRememberTrinity(params);
  const id = adapters.createMemory({
    category: params.category,
    content: params.content,
    confidence: params.confidence,
    source_unit_type: "iam-tool",
    structuredFields: { iam_tool: "remember" },
    trinity,
  });

  if (!id) {
    return persistenceFailed(
      "Hammer failed to persist the IAM memory. Ensure the database is writable and retry hammer_remember.",
    );
  }

  return ok({
    kind: "memory-created",
    id,
    content: params.content,
    category: params.category,
    trinity,
    volvox: normalizeVolvoxMetadata(null),
  });
}

export async function executeIAMHarvest(
  adapters: IAMToolAdapters,
  params: { limit?: number; category?: string; trinityLayer?: unknown; volvoxCellType?: unknown; volvoxLifecyclePhase?: unknown; propagationEligible?: unknown; includeDormant?: unknown },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;
  const invalidVolvox = validateVolvoxQueryParams(params);
  if (invalidVolvox) return invalidVolvox;

  const trinityLayer = normalizeOptionalTrinityLayer(params.trinityLayer);
  const active = adapters
    .getActiveMemories(clampLimit(params.limit, 30), normalizeQueryOptions(params))
    .map(normalizeMemoryEntry)
    .filter((memory) => !params.category || memory.category === params.category)
    .filter((memory) => !trinityLayer || normalizeTrinityMetadata(memory.trinity, buildDefaultTrinityMetadata({ category: memory.category }).layer).layer === trinityLayer)
    .filter((memory) => memoryPassesVolvoxOptions(memory, normalizeQueryOptions(params)));
  const categories = countByCategory(active);
  const summary = formatCategorySummary(categories, active.length);
  const memories = active.map((memory) => ({
    ...activeMemoryToListEntry(memory),
    content: `[harvest ${summary}] ${memory.content}`,
  }));

  return ok({ kind: "memory-list", memories });
}

export async function executeIAMCluster(
  adapters: IAMToolAdapters,
  params: { query: string; k?: number; trinityLayer?: unknown; trinityLens?: unknown; volvoxCellType?: unknown; volvoxLifecyclePhase?: unknown; propagationEligible?: unknown; includeDormant?: unknown },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;
  const invalidVolvox = validateVolvoxQueryParams(params);
  if (invalidVolvox) return invalidVolvox;

  const memories = adapters
    .queryMemories(params.query, clampLimit(params.k, 20), undefined, normalizeQueryOptions(params))
    .map(normalizeMemoryEntry);
  return ok({
    kind: "knowledge-map",
    categories: countByCategory(memories),
    layers: countByLayer(memories),
    volvox: {
      cellTypes: countByVolvoxCellType(memories),
      lifecyclePhases: countByVolvoxLifecycle(memories),
      propagationEligible: countVolvoxEligible(memories),
    },
    total: memories.length,
  });
}

export async function executeIAMLandscape(
  adapters: IAMToolAdapters,
  params: { limit?: number; trinityLayer?: unknown; volvoxCellType?: unknown; volvoxLifecyclePhase?: unknown; propagationEligible?: unknown; includeDormant?: unknown },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;
  const invalidVolvox = validateVolvoxQueryParams(params);
  if (invalidVolvox) return invalidVolvox;

  const trinityLayer = normalizeOptionalTrinityLayer(params.trinityLayer);
  const memories = adapters
    .getActiveMemories(clampLimit(params.limit, 50), normalizeQueryOptions(params))
    .map(normalizeMemoryEntry)
    .filter((memory) => !trinityLayer || normalizeTrinityMetadata(memory.trinity, buildDefaultTrinityMetadata({ category: memory.category }).layer).layer === trinityLayer)
    .filter((memory) => memoryPassesVolvoxOptions(memory, normalizeQueryOptions(params)));
  return ok({
    kind: "knowledge-map",
    categories: countByCategory(memories),
    layers: countByLayer(memories),
    volvox: {
      cellTypes: countByVolvoxCellType(memories),
      lifecyclePhases: countByVolvoxLifecycle(memories),
      propagationEligible: countVolvoxEligible(memories),
    },
    total: memories.length,
  });
}

export async function executeIAMBridge(
  adapters: IAMToolAdapters,
  params: { queryA: string; queryB: string; k?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const limit = clampLimit(params.k, 10);
  const combined = new Map<string, IAMMemoryListEntry>();
  for (const memory of adapters.queryMemories(params.queryA, limit).map(normalizeMemoryEntry)) {
    combined.set(memory.id, memory);
  }
  for (const memory of adapters.queryMemories(params.queryB, limit).map(normalizeMemoryEntry)) {
    if (!combined.has(memory.id)) {
      combined.set(memory.id, memory);
    }
  }

  return ok({ kind: "memory-list", memories: Array.from(combined.values()) });
}

export async function executeIAMCompare(
  adapters: IAMToolAdapters,
  params: { queryA: string; queryB: string; k?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const limit = clampLimit(params.k, 10);
  const memoriesA = adapters.queryMemories(params.queryA, limit).map((memory) => ({
    ...normalizeMemoryEntry(memory),
    id: `A:${memory.id}`,
    content: `[A:${params.queryA}] ${memory.content}`,
  }));
  const memoriesB = adapters.queryMemories(params.queryB, limit).map((memory) => ({
    ...normalizeMemoryEntry(memory),
    id: `B:${memory.id}`,
    content: `[B:${params.queryB}] ${memory.content}`,
  }));

  return ok({ kind: "memory-list", memories: [...memoriesA, ...memoriesB] });
}

export async function executeIAMProvenance(
  adapters: IAMToolAdapters,
  params: { memoryId: string; depth?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const memoryId = params.memoryId.trim();
  if (!memoryId) {
    return persistenceFailed("A memoryId is required before IAM provenance can traverse the memory graph.");
  }

  const graph = adapters.traverseGraph(memoryId, clampDepth(params.depth, 3));
  return ok({ kind: "graph-walk", nodes: graph.nodes.map(normalizeGraphNode), edges: graph.edges });
}

export async function executeIAMExplore(
  adapters: IAMToolAdapters,
  params: { memoryId: string; depth?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const memoryId = params.memoryId.trim();
  if (!memoryId) {
    return persistenceFailed("A memoryId is required before IAM explore can traverse the memory graph.");
  }

  const graph = adapters.traverseGraph(memoryId, clampDepth(params.depth, 2));
  return ok({ kind: "graph-walk", nodes: graph.nodes.map(normalizeGraphNode), edges: graph.edges });
}

function trinityTensionSignals(memory: IAMMemoryListEntry): { score: number; reasons: string[] } {
  const fallbackLayer = buildDefaultTrinityMetadata({ category: memory.category }).layer;
  const metadata = hasOwn(memory, "trinity")
    ? normalizeTrinityMetadata(memory.trinity, fallbackLayer)
    : null;
  const reasons: string[] = [];
  let score = 0;

  if (metadata) {
    const validation = metadata.validation;
    if (validation.state === "contested") {
      score += 4;
      reasons.push("contested");
    } else if (validation.state === "deprecated") {
      score += 2.5;
      reasons.push("deprecated");
    } else if (validation.state === "unvalidated") {
      score += 0.75;
      reasons.push("unvalidated");
    }

    if (validation.score < 0.5) {
      score += Math.round((0.5 - validation.score) * 2 * 100) / 100;
      reasons.push("low-validation");
    }

    const opposition = trinityVectorOpposition(metadata);
    if (opposition > 0) {
      score += opposition;
      reasons.push(`vector-opposition:${formatScore(opposition)}`);
    }
  }

  if (memory.category === "gotcha" || memory.category === "risk") {
    score += 0.5;
    reasons.push(`category:${memory.category}`);
  }

  if (reasons.length === 0) reasons.push("no-trinity-tension-signals");
  return { score: Math.round(score * 100) / 100, reasons };
}

function trinityVectorOpposition(metadata: TrinityMetadata): number {
  let score = 0;
  for (const key of TRINITY_VECTOR_KEYS) {
    const vectorKey = key as TrinityVectorKey;
    const ity = metadata.ity[vectorKey] ?? 0;
    const pathy = metadata.pathy[vectorKey] ?? 0;
    const diff = Math.abs(ity - pathy);
    if (diff >= 0.5 && Math.max(ity, pathy) >= 0.6) {
      score += diff;
    }
  }

  const risk = Math.max(metadata.ity.risk ?? 0, metadata.pathy.risk ?? 0);
  const stability = Math.max(metadata.ity.stability ?? 0, metadata.pathy.stability ?? 0);
  if (risk >= 0.6 && stability <= 0.4) {
    score += risk - stability;
  }

  return Math.round(score * 100) / 100;
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export async function executeIAMTension(
  adapters: IAMToolAdapters,
  params: { query: string; k?: number; trinityLayer?: unknown; trinityLens?: unknown; volvoxCellType?: unknown; volvoxLifecyclePhase?: unknown; propagationEligible?: unknown; includeDormant?: unknown },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;
  const invalidVolvox = validateVolvoxQueryParams(params);
  if (invalidVolvox) return invalidVolvox;

  const memories = adapters
    .queryMemories(params.query, clampLimit(params.k, 10), undefined, normalizeQueryOptions(params))
    .map(normalizeMemoryEntry)
    .map((memory, index) => {
      const tension = trinityTensionSignals(memory);
      return {
        memory: {
          ...memory,
          content: `[tension score=${formatScore(tension.score)} reasons=${tension.reasons.join(",")}] ${memory.content}`,
        },
        index,
        tension,
      };
    })
    .sort((a, b) => {
      if (b.tension.score !== a.tension.score) return b.tension.score - a.tension.score;
      return a.index - b.index;
    })
    .map((entry) => entry.memory);
  return ok({ kind: "memory-list", memories });
}

export async function executeIAMVolvoxEpoch(
  adapters: IAMToolAdapters,
  params: { trigger?: unknown; dryRun?: unknown; thresholds?: unknown; now?: unknown } = {},
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;
  if (!adapters.runVolvoxEpoch) return executorNotWired("hammer_volvox_epoch");
  if (params.thresholds !== undefined && (params.thresholds == null || typeof params.thresholds !== "object" || Array.isArray(params.thresholds))) {
    return persistenceFailed("Invalid VOLVOX thresholds payload. Provide an object with numeric threshold overrides or omit thresholds.");
  }

  try {
    const epoch = await adapters.runVolvoxEpoch({
      ...(typeof params.trigger === "string" && params.trigger.trim() ? { trigger: params.trigger.trim() } : {}),
      ...(typeof params.dryRun === "boolean" ? { dryRun: params.dryRun } : {}),
      ...(params.thresholds === undefined ? {} : { thresholds: params.thresholds as Record<string, unknown> }),
      ...(typeof params.now === "string" && params.now.trim() ? { now: params.now.trim() } : {}),
    });
    return ok({ kind: "volvox-epoch", epoch });
  } catch (cause) {
    return persistenceFailed("VOLVOX epoch execution failed. Inspect hammer_volvox_diagnose for persisted diagnostics before retrying.", cause);
  }
}

export async function executeIAMVolvoxStatus(
  adapters: IAMToolAdapters,
  _params: Record<string, never> = {},
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;
  if (!adapters.getVolvoxStatus) return executorNotWired("hammer_volvox_status");

  try {
    const status = await adapters.getVolvoxStatus();
    const latestEpoch = status.epochResult ?? status.latestEpoch;
    return ok({
      kind: "volvox-status",
      ...(latestEpoch ? { epoch: latestEpoch } : {}),
      memories: status.memories.map(normalizeMemoryEntry),
      diagnostics: status.diagnostics,
    });
  } catch (cause) {
    return persistenceFailed("VOLVOX status read failed. Ensure the Hammer database is open and schema v25 migrations completed.", cause);
  }
}

export async function executeIAMVolvoxDiagnose(
  adapters: IAMToolAdapters,
  params: { memoryId?: unknown; includeInfo?: unknown } = {},
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;
  if (!adapters.diagnoseVolvox) return executorNotWired("hammer_volvox_diagnose");

  try {
    const diagnostics = await adapters.diagnoseVolvox({
      ...(typeof params.memoryId === "string" && params.memoryId.trim() ? { memoryId: params.memoryId.trim() } : {}),
      ...(typeof params.includeInfo === "boolean" ? { includeInfo: params.includeInfo } : {}),
    });
    return ok({ kind: "volvox-diagnostics", diagnostics: diagnostics.diagnostics, blocking: diagnostics.blocking });
  } catch (cause) {
    return persistenceFailed("VOLVOX diagnostics read failed. Inspect database availability and retry hammer_volvox_diagnose.", cause);
  }
}

function executorNotWired(toolName: string): IAMResult<IAMToolOutput> {
  return {
    ok: false,
    error: {
      iamErrorKind: "executor-not-wired",
      remediation: `${toolName} requires VOLVOX memory-store adapters from the Hammer extension runtime. Wire run/status/diagnose adapters before calling this tool.`,
      persistenceStatus: "not-attempted",
    },
  };
}

// ---------------------------------------------------------------------------
// Group 3 — IAM governance tools
// ---------------------------------------------------------------------------

export async function executeIAMRune(
  _adapters: IAMToolAdapters,
  params: { runeName: string },
): Promise<IAMResult<IAMToolOutput>> {
  const validNames = new Set<string>(listRunes().map((rune) => rune.runeName));
  if (!validNames.has(params.runeName)) {
    return {
      ok: false,
      error: {
        iamErrorKind: "unknown-rune",
        runeName: params.runeName as RuneName,
        remediation: `Valid rune names: ${Array.from(validNames).join(", ")}`,
      },
    };
  }

  return ok({
    kind: "rune-contract",
    rune: getRune(params.runeName as RuneName),
  });
}

export async function executeIAMValidate(
  _adapters: IAMToolAdapters,
  params: { runeNames: string[] },
): Promise<IAMResult<IAMToolOutput>> {
  const validation = validateRuneNames(params.runeNames);
  if (!validation.ok) {
    return validation;
  }

  return ok({
    kind: "rune-list",
    runes: validation.value.map((runeName) => getRune(runeName)),
  });
}

export async function executeIAMAssess(
  _adapters: IAMToolAdapters,
  params: { text: string; target?: string },
): Promise<IAMResult<IAMToolOutput>> {
  const target = params.target ?? "provided text";
  const scorecard = buildSavesuccessScorecard(params.text, target);
  const result = validateSavesuccess(scorecard);
  const report = formatSavesuccessReport(result);

  return ok({
    kind: "savesuccess-report",
    scorecard: result.scorecard,
    report,
    success: result.success,
  });
}

export async function executeIAMCompile(
  _adapters: IAMToolAdapters,
  _params: Record<string, never>,
): Promise<IAMResult<IAMToolOutput>> {
  return ok({ kind: "rune-list", runes: listRunes() });
}

export async function executeIAMCheck(
  adapters: IAMToolAdapters,
  _params: Record<string, never>,
): Promise<IAMResult<IAMToolOutput>> {
  return ok({
    kind: "check-result",
    tools: [...IAM_PUBLIC_TOOL_NAMES],
    kernelVersion: "M001/S03",
    dbAvailable: adapters.isDbAvailable(),
  });
}
