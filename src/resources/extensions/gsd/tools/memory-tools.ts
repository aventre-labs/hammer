// GSD Memory Tools — Phase 1 executors for capture_thought, memory_query, gsd_graph
//
// These executors back the three memory-layer tools the LLM can call at any
// point in a session. They build on the existing `memory-store.ts` layer
// (SQLite memories table) and degrade gracefully when the DB is unavailable.
//
// Phase 1 scope:
//   - capture_thought → create a memory with the caller-supplied category/content
//   - memory_query    → keyword-filtered, score-ranked listing of active memories
//   - gsd_graph       → returns a memory and its supersedes edges only (Phase 4 adds memory_relations)

import { _getAdapter, isDbAvailable } from "../gsd-db.js";
import {
  createMemory,
  getActiveMemoriesRanked,
  queryMemoriesRanked,
  reinforceMemory,
} from "../memory-store.js";
import type { Memory, RankedMemory } from "../memory-store.js";
import { traverseGraph } from "../memory-relations.js";
import type { MemoryGraphProvenanceSummary } from "../memory-relations.js";
import {
  buildDefaultTrinityMetadata,
  normalizeTrinityLayer,
  normalizeTrinityMetadata,
  normalizeTrinityVector,
  parseTrinityJson,
} from "../../../../iam/trinity.js";
import type { TrinityLayer } from "../../../../iam/trinity.js";
import type { TrinityMetadata } from "../../../../iam/trinity.js";

// ─── Shared result shape (matches tools/workflow-tool-executors.ts) ─────────

export interface ToolExecutionResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

function dbUnavailable(operation: string): ToolExecutionResult {
  return {
    content: [
      {
        type: "text",
        text: "Error: GSD database is not available. Memory tools require an initialized .gsd/ project.",
      },
    ],
    details: { operation, error: "db_unavailable" },
    isError: true,
  };
}

// ─── capture_thought ────────────────────────────────────────────────────────

export interface MemoryCaptureParams {
  category: string;
  content: string;
  confidence?: number;
  tags?: string[];
  scope?: string;
  /**
   * ADR-013 Step 2: optional structured payload preserved verbatim on the
   * memories row. Used when capturing decisions that need to retain
   * gsd_save_decision-style fields (scope, decision, choice, rationale,
   * made_by, revisable) so the eventual cutover (Step 6) is lossless.
   * Plain pattern/gotcha/convention captures may omit this entirely.
   */
  structuredFields?: Record<string, unknown> | null;
  trinity_layer?: unknown;
  trinity_ity?: unknown;
  trinity_pathy?: unknown;
  trinity_provenance?: unknown;
  trinity_validation_state?: unknown;
  trinity_validation_score?: unknown;
}

const VALID_CATEGORIES = new Set([
  "architecture",
  "convention",
  "gotcha",
  "preference",
  "environment",
  "pattern",
]);

export function executeMemoryCapture(params: MemoryCaptureParams): ToolExecutionResult {
  if (!isDbAvailable()) return dbUnavailable("memory_capture");

  const category = (params.category ?? "").trim().toLowerCase();
  const content = (params.content ?? "").trim();
  if (!category || !content) {
    return {
      content: [{ type: "text", text: "Error: category and content are required." }],
      details: { operation: "memory_capture", error: "missing_fields" },
      isError: true,
    };
  }
  if (!VALID_CATEGORIES.has(category)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: invalid category "${category}". Must be one of: ${[...VALID_CATEGORIES].join(", ")}.`,
        },
      ],
      details: { operation: "memory_capture", error: "invalid_category" },
      isError: true,
    };
  }
  const confidence = clampConfidence(params.confidence);
  const scope = normalizeScope(params.scope);
  const tags = normalizeTags(params.tags);

  const structuredFields = normalizeStructuredFields(params.structuredFields);
  const trinity = normalizeCaptureTrinity(params, category);
  let id: string | null;
  try {
    id = createMemory({ category, content, confidence, scope, tags, structuredFields, trinity });
  } catch (err) {
    // Surface the underlying SQL message (e.g. "database disk image is
    // malformed", "no such table: memories") so the operator gets the
    // actionable signal instead of an opaque "create_failed". See #4967.
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: failed to create memory: ${message}` }],
      details: { operation: "memory_capture", error: message },
      isError: true,
    };
  }
  if (!id) {
    // DB unavailable or adapter missing — distinct from the SQL-error path
    // above. Keep the legacy create_failed token here so any consumers that
    // explicitly key on the unavailable case continue to work.
    return {
      content: [{ type: "text", text: "Error: failed to create memory." }],
      details: { operation: "memory_capture", error: "create_failed" },
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: `Captured ${id} (${category}): ${content}` }],
    details: { operation: "memory_capture", id, category, confidence, scope, tags, trinity },
  };
}

function normalizeCaptureTrinity(params: MemoryCaptureParams, category: string): TrinityMetadata {
  const fallback = buildDefaultTrinityMetadata({ category });
  return normalizeTrinityMetadata(
    {
      layer: params.trinity_layer ?? fallback.layer,
      ity: params.trinity_ity,
      pathy: params.trinity_pathy,
      provenance: params.trinity_provenance,
      validation: {
        state: params.trinity_validation_state,
        score: params.trinity_validation_score,
      },
    },
    fallback.layer,
    fallback.provenance,
  );
}

function normalizeScope(value: unknown): string {
  if (typeof value !== "string") return "project";
  const trimmed = value.trim();
  return trimmed.length === 0 ? "project" : trimmed;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 10);
}

function normalizeStructuredFields(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  // Only accept plain objects (Object.prototype or null prototype). Class
  // instances and exotic objects won't round-trip cleanly through JSON, so
  // reject them here instead of producing a partially-serialized payload.
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return null;
  return value as Record<string, unknown>;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.8;
  if (value < 0.1) return 0.1;
  if (value > 0.99) return 0.99;
  return value;
}

// ─── memory_query ───────────────────────────────────────────────────────────

export interface MemoryQueryParams {
  query: string;
  k?: number;
  category?: string;
  scope?: string;
  tag?: string;
  include_superseded?: boolean;
  reinforce_hits?: boolean;
  trinityLayer?: unknown;
  trinityLens?: { ity?: unknown; pathy?: unknown } | null;
  volvoxCellType?: unknown;
  volvoxLifecyclePhase?: unknown;
  propagationEligible?: unknown;
  includeDormant?: unknown;
}

export interface MemoryQueryHit {
  id: string;
  category: string;
  content: string;
  confidence: number;
  hit_count: number;
  score: number;
  reason: "keyword" | "semantic" | "both" | "ranked";
  keyword_rank: number | null;
  semantic_rank: number | null;
  trinity: TrinityMetadata;
  trinity_score: number;
  trinity_rank: number | null;
  trinity_layer_match: boolean;
  volvox: ReturnType<typeof normalizeMemoryVolvoxForDetails>;
}

export function executeMemoryQuery(params: MemoryQueryParams): ToolExecutionResult {
  if (!isDbAvailable()) return dbUnavailable("memory_query");

  const query = (params.query ?? "").trim();
  const k = clampTopK(params.k, 10);
  const includeSuperseded = params.include_superseded === true;
  const category = params.category?.trim().toLowerCase() || undefined;
  const scopeFilter = params.scope?.trim() || undefined;
  const tagFilter = params.tag?.trim().toLowerCase() || undefined;
  const trinityLayer = normalizeQueryTrinityLayer(params.trinityLayer);
  const volvoxFilters = normalizeQueryVolvoxFilters(params);
  if (volvoxFilters.error) return volvoxFilters.error;

  try {
    let ranked: RankedMemory[] = [];
    if (query) {
      ranked = queryMemoriesRanked({
        query,
        k,
        category,
        scope: scopeFilter,
        tag: tagFilter,
        include_superseded: includeSuperseded,
        ...(trinityLayer ? { trinityLayer } : {}),
        ...volvoxFilters.filters,
        trinityLens: normalizeQueryTrinityLens(params.trinityLens),
      });
    } else {
      const candidates: Memory[] = includeSuperseded
        ? includeSupersededMemories(getActiveMemoriesRanked(200))
        : getActiveMemoriesRanked(200);
      ranked = candidates
        .filter((m) => {
          if (category && m.category.toLowerCase() !== category) return false;
          if (scopeFilter && m.scope !== scopeFilter) return false;
          if (tagFilter && !m.tags.map((t) => t.toLowerCase()).includes(tagFilter)) return false;
          if (trinityLayer && m.trinity?.layer !== trinityLayer) return false;
          return memoryPassesVolvoxFilters(m, volvoxFilters.filters);
        })
        .slice(0, k)
        .map((memory) => ({
          memory,
          score: memory.confidence * (1 + memory.hit_count * 0.1),
          keywordRank: null,
          semanticRank: null,
          confidenceBoost: memory.confidence * (1 + memory.hit_count * 0.1),
          trinityScore: 0,
          trinityRank: null,
          trinityLayerMatch: !trinityLayer || memory.trinity?.layer === trinityLayer,
          reason: "ranked" as const,
        }));
    }

    const hits: MemoryQueryHit[] = ranked.map((r) => ({
      id: r.memory.id,
      category: r.memory.category,
      content: r.memory.content,
      confidence: r.memory.confidence,
      hit_count: r.memory.hit_count,
      score: r.score,
      reason: r.reason,
      keyword_rank: r.keywordRank,
      semantic_rank: r.semanticRank,
      trinity_score: r.trinityScore,
      trinity_rank: r.trinityRank,
      trinity_layer_match: r.trinityLayerMatch,
      trinity: r.memory.trinity ?? buildDefaultTrinityMetadata({
        category: r.memory.category,
        sourceUnitType: r.memory.source_unit_type,
        sourceUnitId: r.memory.source_unit_id,
      }),
      volvox: normalizeMemoryVolvoxForDetails(r.memory.volvox),
    }));

    if (params.reinforce_hits) {
      for (const h of hits) reinforceMemory(h.id);
    }

    const summary = hits.length === 0
      ? "No matching memories."
      : hits.map((h) => `- [${h.id}] (${h.category}) ${h.content}${formatVolvoxSummarySuffix(h.volvox)}`).join("\n");

    return {
      content: [{ type: "text", text: summary }],
      details: {
        operation: "memory_query",
        query,
        k,
        returned: hits.length,
        ...(trinityLayer ? { trinityLayer } : {}),
        ...volvoxFilters.filters,
        hits,
        volvoxSummary: summarizeVolvoxHits(hits),
      },
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: memory query failed: ${(err as Error).message}` }],
      details: { operation: "memory_query", error: (err as Error).message },
      isError: true,
    };
  }
}

function clampTopK(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 1) return 1;
  if (value > 50) return 50;
  return Math.floor(value);
}

function normalizeQueryTrinityLayer(value: unknown): TrinityLayer | undefined {
  if (value == null) return undefined;
  const normalized = normalizeTrinityLayer(value, "knowledge");
  return typeof value === "string" && value.trim().length > 0 ? normalized : undefined;
}

function normalizeQueryTrinityLens(value: unknown): { ity: Record<string, number>; pathy: Record<string, number> } | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as { ity?: unknown; pathy?: unknown };
  return {
    ity: normalizeTrinityVector(raw.ity),
    pathy: normalizeTrinityVector(raw.pathy),
  };
}

type NormalizedVolvoxFilters = {
  volvoxCellType?: NonNullable<Memory["volvox"]>["cellType"];
  volvoxLifecyclePhase?: NonNullable<Memory["volvox"]>["lifecyclePhase"];
  propagationEligible?: boolean;
  includeDormant?: boolean;
};

const VALID_VOLVOX_CELL_TYPES = new Set(["UNDIFFERENTIATED", "SOMATIC_SENSOR", "SOMATIC_MOTOR", "STRUCTURAL", "GERMLINE", "DORMANT"]);
const VALID_VOLVOX_LIFECYCLE_PHASES = new Set(["embryonic", "juvenile", "mature", "dormant", "archived"]);

function normalizeQueryVolvoxFilters(params: MemoryQueryParams): { filters: NormalizedVolvoxFilters; error?: ToolExecutionResult } {
  const filters: NormalizedVolvoxFilters = {};
  const cellType = normalizeVolvoxCellTypeParam(params.volvoxCellType);
  if (cellType.error) return { filters, error: cellType.error };
  if (cellType.value) filters.volvoxCellType = cellType.value;

  const lifecyclePhase = normalizeVolvoxLifecyclePhaseParam(params.volvoxLifecyclePhase);
  if (lifecyclePhase.error) return { filters, error: lifecyclePhase.error };
  if (lifecyclePhase.value) filters.volvoxLifecyclePhase = lifecyclePhase.value;

  if (params.propagationEligible !== undefined) {
    if (typeof params.propagationEligible !== "boolean") {
      return { filters, error: invalidVolvoxFilter("propagationEligible", "Use a boolean true/false value.") };
    }
    filters.propagationEligible = params.propagationEligible;
  }

  if (params.includeDormant !== undefined) {
    if (typeof params.includeDormant !== "boolean") {
      return { filters, error: invalidVolvoxFilter("includeDormant", "Use a boolean true/false value.") };
    }
    filters.includeDormant = params.includeDormant;
  }

  return { filters };
}

function normalizeVolvoxCellTypeParam(value: unknown): { value?: NormalizedVolvoxFilters["volvoxCellType"]; error?: ToolExecutionResult } {
  if (value == null || value === "") return {};
  if (typeof value !== "string") return { error: invalidVolvoxFilter("volvoxCellType", "Use one of the canonical VOLVOX cell type strings.") };
  const normalized = value.trim().toUpperCase();
  if (!VALID_VOLVOX_CELL_TYPES.has(normalized)) {
    return { error: invalidVolvoxFilter("volvoxCellType", `Unknown cell type "${value}".`) };
  }
  return { value: normalized as NormalizedVolvoxFilters["volvoxCellType"] };
}

function normalizeVolvoxLifecyclePhaseParam(value: unknown): { value?: NormalizedVolvoxFilters["volvoxLifecyclePhase"]; error?: ToolExecutionResult } {
  if (value == null || value === "") return {};
  if (typeof value !== "string") return { error: invalidVolvoxFilter("volvoxLifecyclePhase", "Use one of embryonic, juvenile, mature, dormant, archived.") };
  const normalized = value.trim().toLowerCase();
  if (!VALID_VOLVOX_LIFECYCLE_PHASES.has(normalized)) {
    return { error: invalidVolvoxFilter("volvoxLifecyclePhase", `Unknown lifecycle phase "${value}".`) };
  }
  return { value: normalized as NormalizedVolvoxFilters["volvoxLifecyclePhase"] };
}

function invalidVolvoxFilter(field: string, detail: string): ToolExecutionResult {
  return {
    content: [{ type: "text", text: `Error: invalid VOLVOX filter ${field}. ${detail}` }],
    details: { operation: "memory_query", error: "invalid_volvox_filter", field, remediation: "Use canonical VOLVOX filters exposed by memory_query." },
    isError: true,
  };
}

function memoryPassesVolvoxFilters(memory: Memory, filters: NormalizedVolvoxFilters): boolean {
  if (filters.volvoxCellType && memory.volvox?.cellType !== filters.volvoxCellType) return false;
  if (filters.volvoxLifecyclePhase && memory.volvox?.lifecyclePhase !== filters.volvoxLifecyclePhase) return false;
  if (filters.propagationEligible !== undefined && memory.volvox?.propagationEligible !== filters.propagationEligible) return false;
  if (filters.includeDormant === false && (memory.volvox?.cellType === "DORMANT" || memory.volvox?.lifecyclePhase === "dormant" || memory.volvox?.lifecyclePhase === "archived")) return false;
  return true;
}

function normalizeMemoryVolvoxForDetails(metadata: Memory["volvox"]): {
  cellType: string;
  roleStability: number;
  lifecyclePhase: string;
  propagationEligible: boolean;
  lastEpochId?: string;
  lastEpochAt?: string;
  archivedAt?: string;
  activationCount: number;
  activationRate: number;
  dormancyCycles: number;
  generation: number;
  offspringCount: number;
  connectionDensity: number;
  crossLayerConnections: number;
  fitness: number;
  kirkStep?: number;
} {
  return {
    cellType: metadata?.cellType ?? "UNDIFFERENTIATED",
    roleStability: metadata?.roleStability ?? 0,
    lifecyclePhase: metadata?.lifecyclePhase ?? "embryonic",
    propagationEligible: metadata?.propagationEligible ?? false,
    ...(metadata?.lastEpochId ? { lastEpochId: metadata.lastEpochId } : {}),
    ...(metadata?.lastEpochAt ? { lastEpochAt: metadata.lastEpochAt } : {}),
    ...(metadata?.archivedAt ? { archivedAt: metadata.archivedAt } : {}),
    activationCount: metadata?.activationCount ?? 0,
    activationRate: metadata?.activationRate ?? 0,
    dormancyCycles: metadata?.dormancyCycles ?? 0,
    generation: metadata?.generation ?? 0,
    offspringCount: metadata?.offspringCount ?? 0,
    connectionDensity: metadata?.connectionDensity ?? 0,
    crossLayerConnections: metadata?.crossLayerConnections ?? 0,
    fitness: metadata?.fitness ?? 0,
    ...(metadata?.kirkStep === undefined ? {} : { kirkStep: metadata.kirkStep }),
  };
}

function summarizeVolvoxHits(hits: MemoryQueryHit[]): { cellTypes: Record<string, number>; lifecyclePhases: Record<string, number>; propagationEligible: number; dormant: number; archived: number } {
  const cellTypes: Record<string, number> = {};
  const lifecyclePhases: Record<string, number> = {};
  let propagationEligible = 0;
  let dormant = 0;
  let archived = 0;
  for (const hit of hits) {
    cellTypes[hit.volvox.cellType] = (cellTypes[hit.volvox.cellType] ?? 0) + 1;
    lifecyclePhases[hit.volvox.lifecyclePhase] = (lifecyclePhases[hit.volvox.lifecyclePhase] ?? 0) + 1;
    if (hit.volvox.propagationEligible) propagationEligible++;
    if (hit.volvox.cellType === "DORMANT" || hit.volvox.lifecyclePhase === "dormant") dormant++;
    if (hit.volvox.lifecyclePhase === "archived" || hit.volvox.archivedAt) archived++;
  }
  return { cellTypes, lifecyclePhases, propagationEligible, dormant, archived };
}

function formatVolvoxSummarySuffix(volvox: MemoryQueryHit["volvox"]): string {
  const parts = [`cell=${volvox.cellType}`, `phase=${volvox.lifecyclePhase}`];
  if (volvox.propagationEligible) parts.push("eligible=true");
  if (volvox.lifecyclePhase === "dormant" || volvox.cellType === "DORMANT") parts.push("dormant=true");
  return ` [volvox ${parts.join(" ")}]`;
}

function includeSupersededMemories(rankedActive: Memory[]): Memory[] {
  const adapter = _getAdapter();
  if (!adapter) return rankedActive;
  try {
    const rows = adapter.prepare("SELECT * FROM memories").all();
    return rows.map((row) => {
      let tags: string[] = [];
      if (typeof row["tags"] === "string") {
        try {
          const parsed = JSON.parse(row["tags"] as string);
          if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === "string");
        } catch {
          /* leave empty */
        }
      }
      let structuredFields: Record<string, unknown> | null = null;
      if (typeof row["structured_fields"] === "string" && (row["structured_fields"] as string).length > 0) {
        try {
          const parsed = JSON.parse(row["structured_fields"] as string);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            structuredFields = parsed as Record<string, unknown>;
          }
        } catch { /* leave null */ }
      }
      const category = row["category"] as string;
      const sourceUnitType = (row["source_unit_type"] as string) ?? null;
      const sourceUnitId = (row["source_unit_id"] as string) ?? null;
      const trinity = normalizeTrinityMetadata(
        {
          layer: row["trinity_layer"],
          ity: parseTrinityJson(row["trinity_ity"]),
          pathy: parseTrinityJson(row["trinity_pathy"]),
          provenance: parseTrinityJson(row["trinity_provenance"]),
          validation: {
            state: row["trinity_validation_state"],
            score: row["trinity_validation_score"],
          },
        },
        buildDefaultTrinityMetadata({ category }).layer,
        {
          ...(sourceUnitType ? { sourceUnitType } : {}),
          ...(sourceUnitId ? { sourceUnitId } : {}),
        },
      );
      return {
        seq: row["seq"] as number,
        id: row["id"] as string,
        category,
        content: row["content"] as string,
        confidence: row["confidence"] as number,
        source_unit_type: sourceUnitType,
        source_unit_id: sourceUnitId,
        created_at: row["created_at"] as string,
        updated_at: row["updated_at"] as string,
        superseded_by: (row["superseded_by"] as string) ?? null,
        hit_count: row["hit_count"] as number,
        scope: (row["scope"] as string) ?? "project",
        tags,
        structured_fields: structuredFields,
        trinity,
        volvox: normalizeMemoryVolvoxForDetails({
          cellType: row["volvox_cell_type"] as never,
          roleStability: row["volvox_role_stability"] as number,
          lifecyclePhase: row["volvox_lifecycle_phase"] as never,
          propagationEligible: row["volvox_propagation_eligible"] === 1,
          lastEpochId: row["volvox_last_epoch_id"] as string | undefined,
          lastEpochAt: row["volvox_last_epoch_at"] as string | undefined,
          archivedAt: row["volvox_archived_at"] as string | undefined,
          activationCount: row["volvox_activation_count"] as number,
          activationRate: row["volvox_activation_rate"] as number,
          propagationCount: row["volvox_propagation_count"] as number,
          dormancyCycles: row["volvox_dormancy_cycles"] as number,
          generation: row["volvox_generation"] as number,
          offspringCount: row["volvox_offspring_count"] as number,
          connectionDensity: row["volvox_connection_density"] as number,
          crossLayerConnections: row["volvox_cross_layer_connections"] as number,
          fitness: row["volvox_fitness"] as number,
          kirkStep: row["volvox_kirk_step"] as number | undefined,
        } as Memory["volvox"]) as Memory["volvox"],
      };
    });
  } catch {
    return rankedActive;
  }
}

// ─── gsd_graph ──────────────────────────────────────────────────────────────

export interface GsdGraphParams {
  mode: "build" | "query";
  memoryId?: string;
  depth?: number;
  rel?: string;
}

export interface GraphNode {
  id: string;
  category: string;
  content: string;
  confidence: number;
  trinity?: TrinityMetadata;
  volvox?: MemoryQueryHit["volvox"];
  provenanceSummary?: MemoryGraphProvenanceSummary;
}

export interface GraphEdge {
  from: string;
  to: string;
  rel: string;
  confidence: number;
}

export function executeGsdGraph(params: GsdGraphParams): ToolExecutionResult {
  if (!isDbAvailable()) return dbUnavailable("gsd_graph");

  if (params.mode === "build") {
    // The extractor emits LINK actions incrementally (Phase 4). There is no
    // batch rebuild step to run today — ingest artifacts via `/gsd memory
    // extract <SRC-...>` and the next extraction turn will add edges.
    return {
      content: [
        {
          type: "text",
          text:
            "gsd_graph build acknowledged. Graph edges are populated incrementally by memory " +
            "extraction (including LINK actions). Use `/gsd memory extract <SRC-...>` to trigger " +
            "extraction against a specific ingested source.",
        },
      ],
      details: { operation: "gsd_graph", mode: "build", built: 0 },
    };
  }

  if (params.mode !== "query") {
    return {
      content: [{ type: "text", text: `Error: unknown mode "${params.mode}". Must be "build" or "query".` }],
      details: { operation: "gsd_graph", error: "invalid_mode" },
      isError: true,
    };
  }

  const memoryId = params.memoryId?.trim();
  if (!memoryId) {
    return {
      content: [{ type: "text", text: "Error: memoryId is required for mode=query." }],
      details: { operation: "gsd_graph", error: "missing_memory_id" },
      isError: true,
    };
  }

  try {
    const graph = traverseGraph(memoryId, clampDepth(params.depth));
    const rel = params.rel?.trim().toLowerCase() || null;
    const edges = rel ? graph.edges.filter((e) => e.rel === rel) : graph.edges;
    const relevantIds = new Set<string>([memoryId]);
    for (const e of edges) {
      relevantIds.add(e.from);
      relevantIds.add(e.to);
    }
    const nodes = graph.nodes.filter((n) => relevantIds.has(n.id));

    if (nodes.length === 0) {
      return {
        content: [{ type: "text", text: `No memory found with id ${memoryId}.` }],
        details: { operation: "gsd_graph", mode: "query", memoryId, nodes: [], edges: [] },
      };
    }

    const summary = [
      `Memory ${memoryId} — ${nodes.length} node(s), ${edges.length} edge(s).`,
      ...nodes.map((n) => `  [${n.id}] (${n.category}) ${n.content}`),
      ...edges.map((e) => `  ${e.from} --${e.rel}-> ${e.to}`),
    ].join("\n");
    return {
      content: [{ type: "text", text: summary }],
      details: {
        operation: "gsd_graph",
        mode: "query",
        memoryId,
        nodes: nodes.map((n) => ({
          id: n.id,
          category: n.category,
          content: n.content,
          trinity: n.trinity,
          volvox: n.volvox,
          provenanceSummary: n.provenanceSummary,
        })),
        edges: edges.map((e) => ({ from: e.from, to: e.to, rel: e.rel })),
      },
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: graph query failed: ${(err as Error).message}` }],
      details: { operation: "gsd_graph", error: (err as Error).message },
      isError: true,
    };
  }
}

function clampDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 5) return 5;
  return Math.floor(value);
}
