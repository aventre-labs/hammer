// GSD Memory Store — CRUD, ranked queries, maintenance, and prompt formatting
//
// Storage layer for auto-learned project memories. Follows context-store.ts patterns.
// All functions degrade gracefully: return empty results when DB unavailable, never throw.

import type { TrinityLayer, TrinityMetadata, TrinityVector } from '../../../iam/trinity.js';
import {
  normalizeVolvoxMetadata as normalizeKernelVolvoxMetadata,
  runVolvoxEpoch as runPureVolvoxEpoch,
  scoreVolvoxFitness,
} from '../../../iam/volvox.js';
import type { VolvoxCellType, VolvoxDiagnostic, VolvoxLifecyclePhase, VolvoxMetadata as KernelVolvoxMetadata, VolvoxThresholds } from '../../../iam/volvox.js';
import {
  buildDefaultTrinityMetadata,
  normalizeTrinityMetadata,
  normalizeTrinityVector,
  parseTrinityJson,
  trinityVectorDot,
} from '../../../iam/trinity.js';
import {
  isDbAvailable,
  _getAdapter,
  transaction,
  isInTransaction,
  insertMemoryRow,
  rewriteMemoryId,
  updateMemoryContentRow,
  incrementMemoryVolvoxActivation,
  incrementMemoryVolvoxDormancy,
  insertVolvoxEpochMutationRow,
  insertVolvoxEpochRow,
  getLatestVolvoxEpochRow,
  supersedeMemoryRow,
  updateMemoryVolvoxMetadata,
  markMemoryUnitProcessed,
  decayMemoriesBefore,
  supersedeLowestRankedMemories,
  deleteMemoryEmbedding,
  deleteMemoryRelationsFor,
} from './gsd-db.js';
import { createMemoryRelation, isValidRelation } from './memory-relations.js';
import { logWarning } from './workflow-logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Memory {
  seq: number;
  id: string;
  category: string;
  content: string;
  confidence: number;
  source_unit_type: string | null;
  source_unit_id: string | null;
  created_at: string;
  updated_at: string;
  superseded_by: string | null;
  hit_count: number;
  scope: string;
  tags: string[];
  /**
   * ADR-013 Step 2: optional structured payload. NULL for memories captured
   * via plain capture_thought. Populated on memories backfilled from the
   * decisions table (Step 5) with the original scope/decision/choice/etc.
   */
  structured_fields: Record<string, unknown> | null;
  trinity?: TrinityMetadata;
  volvox?: MemoryVolvoxMetadata;
}

export interface MemoryVolvoxMetadata extends KernelVolvoxMetadata {
  activationCount: number;
  activationRate: number;
  propagationCount: number;
  dormancyCycles: number;
  generation: number;
  offspringCount: number;
  connectionDensity: number;
  crossLayerConnections: number;
  fitness: number;
  kirkStep?: number;
}

export type MemoryActionCreate = {
  action: 'CREATE';
  category: string;
  content: string;
  confidence?: number;
  scope?: string;
  tags?: string[];
  structuredFields?: Record<string, unknown> | null;
  trinity?: Partial<TrinityMetadata> | null;
  volvox?: Partial<MemoryVolvoxMetadata> | null;
};

export type MemoryActionUpdate = {
  action: 'UPDATE';
  id: string;
  content: string;
  confidence?: number;
};

export type MemoryActionReinforce = {
  action: 'REINFORCE';
  id: string;
};

export type MemoryActionSupersede = {
  action: 'SUPERSEDE';
  id: string;
  superseded_by: string;
};

export type MemoryActionLink = {
  action: 'LINK';
  from: string;
  to: string;
  rel: string;
  confidence?: number;
};

export type MemoryAction =
  | MemoryActionCreate
  | MemoryActionUpdate
  | MemoryActionReinforce
  | MemoryActionSupersede
  | MemoryActionLink;

// ─── Category Display Order ─────────────────────────────────────────────────

const CATEGORY_PRIORITY: Record<string, number> = {
  gotcha: 0,
  convention: 1,
  architecture: 2,
  pattern: 3,
  environment: 4,
  preference: 5,
};

// ─── Row Mapping ────────────────────────────────────────────────────────────

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    seq: row['seq'] as number,
    id: row['id'] as string,
    category: row['category'] as string,
    content: row['content'] as string,
    confidence: row['confidence'] as number,
    source_unit_type: (row['source_unit_type'] as string) ?? null,
    source_unit_id: (row['source_unit_id'] as string) ?? null,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
    superseded_by: (row['superseded_by'] as string) ?? null,
    hit_count: row['hit_count'] as number,
    scope: (row['scope'] as string) ?? 'project',
    tags: parseTags(row['tags']),
    structured_fields: parseStructuredFields(row['structured_fields']),
    trinity: rowToTrinityMetadata(row),
    volvox: rowToVolvoxMetadata(row),
  };
}


function rowToVolvoxMetadata(row: Record<string, unknown>): MemoryVolvoxMetadata {
  const base = normalizeKernelVolvoxMetadata({
    cellType: row['volvox_cell_type'],
    roleStability: row['volvox_role_stability'],
    lifecyclePhase: row['volvox_lifecycle_phase'],
    propagationEligible: row['volvox_propagation_eligible'] === 1 || row['volvox_propagation_eligible'] === true,
    lastEpochId: row['volvox_last_epoch_id'],
    lastEpochAt: row['volvox_last_epoch_at'],
    archivedAt: row['volvox_archived_at'],
  });
  return {
    ...base,
    activationCount: nonNegativeInteger(row['volvox_activation_count']),
    activationRate: clampUnitNumber(row['volvox_activation_rate']),
    propagationCount: nonNegativeInteger(row['volvox_propagation_count']),
    dormancyCycles: nonNegativeInteger(row['volvox_dormancy_cycles']),
    generation: nonNegativeInteger(row['volvox_generation']),
    offspringCount: nonNegativeInteger(row['volvox_offspring_count']),
    connectionDensity: nonNegativeInteger(row['volvox_connection_density']),
    crossLayerConnections: nonNegativeInteger(row['volvox_cross_layer_connections']),
    fitness: clampUnitNumber(row['volvox_fitness']),
    ...(typeof row['volvox_kirk_step'] === 'number' && Number.isFinite(row['volvox_kirk_step'])
      ? { kirkStep: Math.floor(row['volvox_kirk_step'] as number) }
      : {}),
  };
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function clampUnitNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function rowToTrinityMetadata(row: Record<string, unknown>): TrinityMetadata {
  const category = row['category'] as string | undefined;
  const sourceUnitType = (row['source_unit_type'] as string | null) ?? null;
  const sourceUnitId = (row['source_unit_id'] as string | null) ?? null;
  const ity = parseTrinityJson(row['trinity_ity']);
  const pathy = parseTrinityJson(row['trinity_pathy']);
  const provenance = parseTrinityJson(row['trinity_provenance']);
  return normalizeTrinityMetadata(
    {
      layer: row['trinity_layer'],
      ity,
      pathy,
      provenance,
      validation: {
        state: row['trinity_validation_state'],
        score: row['trinity_validation_score'],
      },
    },
    buildDefaultTrinityMetadata({ category }).layer,
    {
      ...(sourceUnitType ? { sourceUnitType } : {}),
      ...(sourceUnitId ? { sourceUnitId } : {}),
    },
  );
}

function parseStructuredFields(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

// ─── Query Functions ────────────────────────────────────────────────────────

/**
 * Get all memories where superseded_by IS NULL.
 * Returns [] if DB is not available. Never throws.
 */
export function getActiveMemories(): Memory[] {
  if (!isDbAvailable()) return [];
  const adapter = _getAdapter();
  if (!adapter) return [];

  try {
    const rows = adapter.prepare('SELECT * FROM memories WHERE superseded_by IS NULL').all();
    return rows.map(rowToMemory);
  } catch {
    return [];
  }
}

/**
 * Get active memories ordered by ranking score: confidence * (1 + hit_count * 0.1).
 * Higher-scored memories are more relevant and frequently confirmed.
 */
export function getActiveMemoriesRanked(limit = 30, filters: Omit<QueryMemoriesFilters, 'category' | 'scope' | 'tag' | 'include_superseded' | 'trinityLayer'> = {}): Memory[] {
  if (!isDbAvailable()) return [];
  const adapter = _getAdapter();
  if (!adapter) return [];

  try {
    const { clause, params } = buildVolvoxSqlFilter(filters, '');
    const rows = adapter.prepare(
      `SELECT * FROM memories
       WHERE superseded_by IS NULL${clause}
       ORDER BY (confidence * (1.0 + hit_count * 0.1)) DESC
       LIMIT :limit`,
    ).all({ ...params, ':limit': limit });
    return rows.map(rowToMemory);
  } catch {
    return [];
  }
}

// ─── Hybrid query (keyword FTS + optional semantic) ─────────────────────────

export interface QueryMemoriesFilters {
  category?: string;
  scope?: string;
  tag?: string;
  include_superseded?: boolean;
  trinityLayer?: TrinityLayer;
  volvoxCellType?: VolvoxCellType;
  volvoxLifecyclePhase?: VolvoxLifecyclePhase;
  propagationEligible?: boolean;
  includeDormant?: boolean;
}

export interface QueryMemoriesOptions extends QueryMemoriesFilters {
  query: string;
  k?: number;
  /**
   * Optional query-side embedding. When provided and embeddings exist in the
   * DB, results are fused with cosine similarity via reciprocal-rank-fusion.
   */
  queryVector?: Float32Array | null;
  /** RRF fusion constant (default 60). */
  rrfK?: number;
  /** Optional -ity/-pathy query vector used as a deterministic Trinity ranking lens. */
  trinityLens?: {
    ity?: TrinityVector | Record<string, number>;
    pathy?: TrinityVector | Record<string, number>;
  };
}

export interface RankedMemory {
  memory: Memory;
  score: number;
  keywordRank: number | null;
  semanticRank: number | null;
  confidenceBoost: number;
  trinityScore: number;
  trinityRank: number | null;
  trinityLayerMatch: boolean;
  reason: 'keyword' | 'semantic' | 'both' | 'ranked';
}

export function queryMemoriesRanked(opts: QueryMemoriesOptions): RankedMemory[] {
  if (!isDbAvailable()) return [];
  const adapter = _getAdapter();
  if (!adapter) return [];

  const k = clampLimit(opts.k, 10);
  const rrfK = opts.rrfK ?? 60;
  const whereClauses: string[] = [];
  if (opts.include_superseded !== true) whereClauses.push('superseded_by IS NULL');
  if (opts.trinityLayer) whereClauses.push('trinity_layer = :trinityLayer');
  appendVolvoxWhereClauses(whereClauses, opts);
  const activeClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const sqlParams = buildQuerySqlParams(opts);
  const trimmedQuery = (opts.query ?? '').trim();
  const fetchLimit = Math.max(k, Math.min(100, k * 4));

  // 1) Keyword hits — try FTS5 first, fall back to LIKE when unavailable.
  const keywordHits = trimmedQuery ? keywordSearch(adapter, trimmedQuery, activeClause, fetchLimit, sqlParams) : [];

  // 2) Semantic hits — cosine over memory_embeddings. Requires opts.queryVector.
  const semanticHits = opts.queryVector
    ? semanticSearch(adapter, opts.queryVector, activeClause, fetchLimit, sqlParams)
    : [];

  if (keywordHits.length === 0 && semanticHits.length === 0 && !trimmedQuery) {
    // No query at all — fall back to the existing ranked-by-score listing.
    const candidates = opts.trinityLayer
      ? selectRankedMemoryCandidates(adapter, activeClause, fetchLimit, sqlParams)
      : getActiveMemoriesRanked(fetchLimit);
    return rankTrinityBoosts(candidates.map((memory) => {
      const boost = memory.confidence * (1 + memory.hit_count * 0.1);
      return {
        memory,
        score: boost,
        keywordRank: null,
        semanticRank: null,
        confidenceBoost: boost,
        trinityScore: 0,
        trinityRank: null,
        trinityLayerMatch: trinityLayerMatches(memory, opts.trinityLayer),
        reason: 'ranked' as const,
      };
    }).filter((hit) => passesFilters(hit.memory, opts)), opts).slice(0, k);
  }

  // 3) Reciprocal rank fusion — each hit contributes 1/(rrfK + rank).
  const fused = new Map<string, { memory: Memory; kwRank: number | null; semRank: number | null; score: number }>();

  for (let i = 0; i < keywordHits.length; i++) {
    const hit = keywordHits[i];
    const existing = fused.get(hit.id);
    const rrf = 1 / (rrfK + i + 1);
    if (existing) {
      existing.kwRank = i + 1;
      existing.score += rrf;
    } else {
      fused.set(hit.id, { memory: hit, kwRank: i + 1, semRank: null, score: rrf });
    }
  }

  for (let i = 0; i < semanticHits.length; i++) {
    const hit = semanticHits[i];
    const existing = fused.get(hit.id);
    const rrf = 1 / (rrfK + i + 1);
    if (existing) {
      existing.semRank = i + 1;
      existing.score += rrf;
    } else {
      fused.set(hit.id, { memory: hit, kwRank: null, semRank: i + 1, score: rrf });
    }
  }

  // 4) Apply filters + confidence + Trinity boosts, then sort.
  const ranked: RankedMemory[] = [];
  for (const entry of fused.values()) {
    if (!passesFilters(entry.memory, opts)) continue;
    const boost = entry.memory.confidence * (1 + entry.memory.hit_count * 0.1);
    const reason: RankedMemory['reason'] =
      entry.kwRank != null && entry.semRank != null
        ? 'both'
        : entry.kwRank != null
          ? 'keyword'
          : 'semantic';
    ranked.push({
      memory: entry.memory,
      score: entry.score * boost,
      keywordRank: entry.kwRank,
      semanticRank: entry.semRank,
      confidenceBoost: boost,
      trinityScore: 0,
      trinityRank: null,
      trinityLayerMatch: trinityLayerMatches(entry.memory, opts.trinityLayer),
      reason,
    });
  }

  return rankTrinityBoosts(ranked, opts).slice(0, k);
}

function clampLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 1) return 1;
  if (value > 100) return 100;
  return Math.floor(value);
}

function passesFilters(memory: Memory, filters: QueryMemoriesFilters): boolean {
  if (filters.category && memory.category.toLowerCase() !== filters.category.toLowerCase()) return false;
  if (filters.scope && memory.scope !== filters.scope) return false;
  if (filters.tag) {
    const needle = filters.tag.toLowerCase();
    if (!memory.tags.map((t) => t.toLowerCase()).includes(needle)) return false;
  }
  if (filters.trinityLayer && memory.trinity?.layer !== filters.trinityLayer) return false;
  if (filters.volvoxCellType && memory.volvox?.cellType !== filters.volvoxCellType) return false;
  if (filters.volvoxLifecyclePhase && memory.volvox?.lifecyclePhase !== filters.volvoxLifecyclePhase) return false;
  if (filters.propagationEligible !== undefined && memory.volvox?.propagationEligible !== filters.propagationEligible) return false;
  if (filters.includeDormant === false && (memory.volvox?.cellType === 'DORMANT' || memory.volvox?.lifecyclePhase === 'dormant' || memory.volvox?.lifecyclePhase === 'archived')) return false;
  return true;
}

function appendVolvoxWhereClauses(whereClauses: string[], filters: QueryMemoriesFilters): void {
  if (filters.volvoxCellType) whereClauses.push('volvox_cell_type = :volvoxCellType');
  if (filters.volvoxLifecyclePhase) whereClauses.push('volvox_lifecycle_phase = :volvoxLifecyclePhase');
  if (filters.propagationEligible !== undefined) whereClauses.push('volvox_propagation_eligible = :propagationEligible');
  if (filters.includeDormant === false) whereClauses.push("volvox_cell_type != 'DORMANT' AND volvox_lifecycle_phase NOT IN ('dormant', 'archived')");
}

function buildQuerySqlParams(opts: QueryMemoriesFilters): Record<string, unknown> | undefined {
  const params: Record<string, unknown> = {};
  if (opts.trinityLayer) params[':trinityLayer'] = opts.trinityLayer;
  if (opts.volvoxCellType) params[':volvoxCellType'] = opts.volvoxCellType;
  if (opts.volvoxLifecyclePhase) params[':volvoxLifecyclePhase'] = opts.volvoxLifecyclePhase;
  if (opts.propagationEligible !== undefined) params[':propagationEligible'] = opts.propagationEligible ? 1 : 0;
  return Object.keys(params).length > 0 ? params : undefined;
}

function buildVolvoxSqlFilter(filters: Pick<QueryMemoriesFilters, 'volvoxCellType' | 'volvoxLifecyclePhase' | 'propagationEligible' | 'includeDormant'>, alias: string): { clause: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  appendVolvoxWhereClauses(clauses, filters as QueryMemoriesFilters);
  const prefix = alias ? `${alias}.` : '';
  const clause = clauses.length === 0 ? '' : ` AND ${clauses.join(' AND ').replace(/\bvolvox_/g, `${prefix}volvox_`)}`;
  return { clause, params: buildQuerySqlParams(filters as QueryMemoriesFilters) ?? {} };
}

function trinityLayerMatches(memory: Memory, layer: TrinityLayer | undefined): boolean {
  return !layer || memory.trinity?.layer === layer;
}

function trinityLensScore(memory: Memory, lens: QueryMemoriesOptions['trinityLens']): number {
  if (!lens) return 0;
  const ity = normalizeTrinityVector(lens.ity);
  const pathy = normalizeTrinityVector(lens.pathy);
  const ityScore = trinityVectorDot(memory.trinity?.ity, ity);
  const pathyScore = trinityVectorDot(memory.trinity?.pathy, pathy);
  return Math.round((ityScore + pathyScore) * 10_000) / 10_000;
}

function rankTrinityBoosts(ranked: RankedMemory[], opts: QueryMemoriesOptions): RankedMemory[] {
  const withScores = ranked.map((hit) => ({
    ...hit,
    trinityScore: trinityLensScore(hit.memory, opts.trinityLens),
    trinityLayerMatch: trinityLayerMatches(hit.memory, opts.trinityLayer),
  }));

  const orderedByLens = [...withScores].sort((a, b) => {
    if (b.trinityScore !== a.trinityScore) return b.trinityScore - a.trinityScore;
    return a.memory.id.localeCompare(b.memory.id);
  });
  const rankById = new Map<string, number>();
  for (let i = 0; i < orderedByLens.length; i++) {
    if (orderedByLens[i].trinityScore > 0) rankById.set(orderedByLens[i].memory.id, i + 1);
  }

  const boosted = withScores.map((hit) => {
    const trinityRank = rankById.get(hit.memory.id) ?? null;
    return {
      ...hit,
      trinityRank,
      // Keep the boost strong enough to deterministically break tied/equal keyword
      // hits, but bounded so a weak vector does not swamp exact keyword relevance.
      score: hit.score * (1 + Math.min(hit.trinityScore, 2)),
    };
  });

  boosted.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.trinityScore !== a.trinityScore) return b.trinityScore - a.trinityScore;
    if (b.confidenceBoost !== a.confidenceBoost) return b.confidenceBoost - a.confidenceBoost;
    return a.memory.id.localeCompare(b.memory.id);
  });
  return boosted;
}

function selectRankedMemoryCandidates(
  adapter: NonNullable<ReturnType<typeof _getAdapter>>,
  activeClause: string,
  limit: number,
  params?: Record<string, unknown>,
): Memory[] {
  try {
    const rows = adapter.prepare(
      `SELECT * FROM memories
       ${activeClause}
       ORDER BY (confidence * (1.0 + hit_count * 0.1)) DESC, id ASC
       LIMIT :limit`,
    ).all({ ...(params ?? {}), ':limit': limit });
    return rows.map(rowToMemory);
  } catch {
    return [];
  }
}

function qualifyMemoryWhereClause(clause: string, alias: string): string {
  if (!clause) return '';
  return clause.replace(/\b(superseded_by|trinity_layer|volvox_cell_type|volvox_lifecycle_phase|volvox_propagation_eligible)\b/g, `${alias}.$1`);
}

function keywordSearch(
  adapter: NonNullable<ReturnType<typeof _getAdapter>>,
  rawQuery: string,
  activeClause: string,
  limit: number,
  params?: Record<string, unknown>,
): Memory[] {
  const ftsAvailable = isFtsAvailable(adapter);
  if (ftsAvailable) {
    try {
      const matchExpr = toFtsMatchExpr(rawQuery);
      if (!matchExpr) return [];
      const activePart = activeClause ? `AND ${qualifyMemoryWhereClause(activeClause, 'm').replace(/^WHERE\s+/i, '')}` : '';
      const rows = adapter.prepare(
        `SELECT m.*
         FROM memories_fts f
         JOIN memories m ON m.seq = f.rowid
         WHERE memories_fts MATCH :match
         ${activePart}
         ORDER BY bm25(memories_fts)
         LIMIT :limit`,
      ).all({ ...(params ?? {}), ':match': matchExpr, ':limit': limit });
      return rows.map(rowToMemory);
    } catch {
      // fall through to LIKE
    }
  }

  // LIKE fallback — scans the candidate pool.
  const terms = rawQuery
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);
  if (terms.length === 0) return [];

  const rows = adapter.prepare(`SELECT * FROM memories ${activeClause}`).all(params ?? {});
  const scored: Array<{ memory: Memory; score: number }> = [];
  for (const row of rows) {
    const memory = rowToMemory(row);
    const lower = memory.content.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx === -1) continue;
      score += 1 + (term.length >= 5 ? 0.5 : 0);
    }
    if (score > 0) scored.push({ memory, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.memory);
}

function isFtsAvailable(adapter: NonNullable<ReturnType<typeof _getAdapter>>): boolean {
  try {
    const row = adapter
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
      .get();
    return !!row;
  } catch {
    return false;
  }
}

function toFtsMatchExpr(query: string): string | null {
  // Build a tolerant AND expression: quote each bare term with a trailing *.
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' OR ');
}

function semanticSearch(
  adapter: NonNullable<ReturnType<typeof _getAdapter>>,
  queryVector: Float32Array,
  activeClause: string,
  limit: number,
  params?: Record<string, unknown>,
): Memory[] {
  try {
    const rows = adapter
      .prepare(
        `SELECT m.*, e.vector as embedding_vector, e.dim as embedding_dim
         FROM memories m
         JOIN memory_embeddings e ON e.memory_id = m.id
         ${qualifyMemoryWhereClause(activeClause, 'm')}`,
      )
      .all(params ?? {});

    const scored: Array<{ memory: Memory; sim: number }> = [];
    for (const row of rows) {
      const dim = row['embedding_dim'] as number;
      if (dim !== queryVector.length) continue;
      const vector = unpackVector(row['embedding_vector'], dim);
      if (!vector) continue;
      const sim = cosine(queryVector, vector);
      if (sim <= 0) continue;
      scored.push({ memory: rowToMemory(row), sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, limit).map((s) => s.memory);
  } catch {
    return [];
  }
}

function unpackVector(blob: unknown, dim: number): Float32Array | null {
  if (!blob) return null;
  try {
    let view: Uint8Array | null = null;
    if (blob instanceof Float32Array) return blob;
    if (blob instanceof Uint8Array) view = blob;
    else if (blob instanceof ArrayBuffer) view = new Uint8Array(blob);
    else if ((blob as Buffer).buffer && (blob as Buffer).byteLength != null) {
      const buf = blob as Buffer;
      view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } else if (Array.isArray(blob)) {
      return new Float32Array(blob as number[]);
    }
    if (!view || view.byteLength % 4 !== 0) return null;
    const aligned = new ArrayBuffer(view.byteLength);
    new Uint8Array(aligned).set(view);
    const f32 = new Float32Array(aligned);
    return f32.length === dim ? f32 : null;
  } catch {
    return null;
  }
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Generate the next memory ID: MEM + zero-padded 3-digit from MAX(seq).
 * Returns MEM001 if no memories exist.
 *
 * NOTE: For race-safe creation, prefer createMemory() which inserts with a
 * placeholder ID then updates to the seq-derived ID atomically.
 */
export function nextMemoryId(): string {
  if (!isDbAvailable()) return 'MEM001';
  const adapter = _getAdapter();
  if (!adapter) return 'MEM001';

  try {
    const row = adapter
      .prepare('SELECT MAX(seq) as max_seq FROM memories')
      .get();
    const maxSeq = row ? (row['max_seq'] as number | null) : null;
    if (maxSeq == null || isNaN(maxSeq)) return 'MEM001';
    const next = maxSeq + 1;
    return `MEM${String(next).padStart(3, '0')}`;
  } catch {
    return 'MEM001';
  }
}

// ─── Mutation Functions ─────────────────────────────────────────────────────

/**
 * Insert a new memory with a race-safe auto-assigned ID.
 * Uses AUTOINCREMENT seq to derive the ID after insert, avoiding
 * the read-then-write race in concurrent scenarios (e.g. worktrees).
 * Returns the assigned ID, or null when the DB is unavailable.
 *
 * Throws on genuine SQL errors (corruption, missing tables, constraint
 * violations) so callers can surface the underlying message instead of
 * collapsing the failure to a generic "create_failed". See issue #4967 —
 * the previous bare-catch swallowed "database disk image is malformed"
 * errors, leaving the memory subsystem broken without any signal.
 */
export function createMemory(fields: {
  category: string;
  content: string;
  confidence?: number;
  source_unit_type?: string;
  source_unit_id?: string;
  scope?: string;
  tags?: string[];
  structuredFields?: Record<string, unknown> | null;
  trinity?: Partial<TrinityMetadata> | null;
  volvox?: Partial<MemoryVolvoxMetadata> | null;
}): string | null {
  if (!isDbAvailable()) return null;
  const adapter = _getAdapter();
  if (!adapter) return null;

  try {
    return transaction(() => doCreateMemory(adapter, fields));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Targeted recovery: a malformed memory store can sometimes be rebuilt
    // by VACUUM. Skip when inside a transaction — SQLite refuses VACUUM
    // there and a secondary throw would mask the real fault.
    if (message.toLowerCase().includes('malformed') && !isInTransaction()) {
      try {
        adapter.prepare('VACUUM').run();
        const recoveryMessage = 'recovered malformed memory store via VACUUM';
        process.stderr.write(`memory-store: ${recoveryMessage}\n`);
        logWarning('memory-store', recoveryMessage);
        return transaction(() => doCreateMemory(adapter, fields));
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        logWarning('memory-store', `VACUUM recovery for memory store failed: ${retryMsg}`);
        // Surface the *original* malformed error — it's the actionable signal.
        throw err;
      }
    }

    throw err;
  }
}

function doCreateMemory(
  adapter: NonNullable<ReturnType<typeof _getAdapter>>,
  fields: {
    category: string;
    content: string;
    confidence?: number;
    source_unit_type?: string;
    source_unit_id?: string;
    scope?: string;
    tags?: string[];
    structuredFields?: Record<string, unknown> | null;
    trinity?: Partial<TrinityMetadata> | null;
    volvox?: Partial<MemoryVolvoxMetadata> | null;
  },
): string {
  const now = new Date().toISOString();
  const trinity = normalizeTrinityMetadata(
    fields.trinity,
    buildDefaultTrinityMetadata({ category: fields.category }).layer,
    {
      ...(fields.source_unit_type ? { sourceUnitType: fields.source_unit_type } : {}),
      ...(fields.source_unit_id ? { sourceUnitId: fields.source_unit_id } : {}),
    },
  );
  // Insert with a temporary placeholder ID — seq is auto-assigned
  const placeholder = `_TMP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  insertMemoryRow({
    id: placeholder,
    category: fields.category,
    content: fields.content,
    confidence: fields.confidence ?? 0.8,
    sourceUnitType: fields.source_unit_type ?? null,
    sourceUnitId: fields.source_unit_id ?? null,
    createdAt: now,
    updatedAt: now,
    scope: fields.scope ?? 'project',
    tags: fields.tags ?? [],
    structuredFields: fields.structuredFields ?? null,
    trinity,
    volvox: fields.volvox ?? null,
  });
  // Derive the real ID from the assigned seq (SELECT is still fine via adapter)
  const row = adapter.prepare('SELECT seq FROM memories WHERE id = :id').get({ ':id': placeholder });
  if (!row) return placeholder; // fallback — should not happen
  const seq = row['seq'] as number;
  const realId = `MEM${String(seq).padStart(3, '0')}`;
  rewriteMemoryId(placeholder, realId);
  return realId;
}

/**
 * Update a memory's content and optionally its confidence.
 */
export function updateMemoryContent(id: string, content: string, confidence?: number): boolean {
  if (!isDbAvailable()) return false;

  try {
    updateMemoryContentRow(id, content, confidence, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

/**
 * Reinforce a memory: increment hit_count, update timestamp.
 */
export function reinforceMemory(id: string): boolean {
  if (!isDbAvailable()) return false;

  try {
    incrementMemoryVolvoxActivation(id, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a memory as superseded by another.
 */
export function supersedeMemory(oldId: string, newId: string): boolean {
  if (!isDbAvailable()) return false;

  try {
    supersedeMemoryRow(oldId, newId, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

// ─── Processed Unit Tracking ────────────────────────────────────────────────

/**
 * Check if a unit has already been processed for memory extraction.
 */
export function isUnitProcessed(unitKey: string): boolean {
  if (!isDbAvailable()) return false;
  const adapter = _getAdapter();
  if (!adapter) return false;

  try {
    const row = adapter.prepare(
      'SELECT 1 FROM memory_processed_units WHERE unit_key = :key',
    ).get({ ':key': unitKey });
    return row != null;
  } catch {
    return false;
  }
}

/**
 * Record that a unit has been processed for memory extraction.
 */
export function markUnitProcessed(unitKey: string, activityFile: string): boolean {
  if (!isDbAvailable()) return false;

  try {
    markMemoryUnitProcessed(unitKey, activityFile, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

// ─── Maintenance ────────────────────────────────────────────────────────────

/**
 * Reduce confidence for memories not updated within the last N processed units.
 * "Stale" = updated_at is older than the Nth most recent processed_at.
 * Returns the number of decayed memory IDs for observability.
 */
export function decayStaleMemories(thresholdUnits = 20): string[] {
  if (!isDbAvailable()) return [];
  const adapter = _getAdapter();
  if (!adapter) return [];

  try {
    // Find the timestamp of the Nth most recent processed unit (read-only SELECT)
    const row = adapter.prepare(
      `SELECT processed_at FROM memory_processed_units
       ORDER BY processed_at DESC
       LIMIT 1 OFFSET :offset`,
    ).get({ ':offset': thresholdUnits - 1 });

    if (!row) return []; // not enough processed units yet

    const cutoff = row['processed_at'] as string;
    const affected = adapter.prepare(
      `SELECT id FROM memories
       WHERE superseded_by IS NULL AND updated_at < :cutoff AND confidence > 0.1`,
    ).all({ ':cutoff': cutoff }).map((r) => r['id'] as string);

    const now = new Date().toISOString();
    decayMemoriesBefore(cutoff, now);
    incrementMemoryVolvoxDormancy(affected, now);
    return affected;
  } catch {
    return [];
  }
}

/**
 * Supersede lowest-ranked memories when count exceeds cap. Cascades to the
 * embedding and relation rows so those tables don't grow unboundedly.
 */
export function enforceMemoryCap(max = 50): void {
  if (!isDbAvailable()) return;
  const adapter = _getAdapter();
  if (!adapter) return;

  try {
    const countRow = adapter.prepare(
      'SELECT count(*) as cnt FROM memories WHERE superseded_by IS NULL',
    ).get();
    const count = (countRow?.['cnt'] as number) ?? 0;
    if (count <= max) return;

    const excess = count - max;
    // Capture the about-to-be-superseded IDs first so we can cascade cleanup.
    const victims = adapter.prepare(
      `SELECT id FROM memories
       WHERE superseded_by IS NULL
       ORDER BY (confidence * (1.0 + hit_count * 0.1)) ASC
       LIMIT :limit`,
    ).all({ ':limit': excess }).map((row) => row['id'] as string);

    supersedeLowestRankedMemories(excess, new Date().toISOString());

    if (victims.length === 0) return;
    for (const id of victims) {
      try { deleteMemoryEmbedding(id); } catch { /* non-fatal */ }
      try { deleteMemoryRelationsFor(id); } catch { /* non-fatal */ }
    }
  } catch {
    // non-fatal
  }
}

// ─── Action Application ─────────────────────────────────────────────────────

/**
 * Process an array of memory actions in a transaction.
 * Calls enforceMemoryCap at the end.
 */
export function applyMemoryActions(
  actions: MemoryAction[],
  unitType?: string,
  unitId?: string,
): void {
  if (!isDbAvailable() || actions.length === 0) return;

  try {
    transaction(() => {
      for (const action of actions) {
        switch (action.action) {
          case 'CREATE':
            createMemory({
              category: action.category,
              content: action.content,
              confidence: action.confidence,
              source_unit_type: unitType,
              source_unit_id: unitId,
              scope: action.scope,
              tags: action.tags,
              // ADR-013: forward structured payload through the action layer so
              // bulk applyMemoryActions callers (extraction, ingestion) don't
              // silently drop it.
              structuredFields: action.structuredFields ?? null,
              trinity: action.trinity ?? null,
              volvox: action.volvox ?? null,
            });
            break;
          case 'UPDATE':
            updateMemoryContent(action.id, action.content, action.confidence);
            break;
          case 'REINFORCE':
            reinforceMemory(action.id);
            break;
          case 'SUPERSEDE':
            supersedeMemory(action.id, action.superseded_by);
            break;
          case 'LINK':
            applyLinkAction(action);
            break;
        }
      }
      enforceMemoryCap();
    });
  } catch (err) {
    // Non-fatal — the transaction has rolled back. We log a warning so a
    // degraded memory subsystem (e.g. malformed store, missing tables) is
    // visible to forensics instead of silently dropping every CREATE — see
    // issue #4967, where this swallow combined with createMemory's bare
    // catch hid SQLite corruption from the auto-mode flow entirely.
    const message = err instanceof Error ? err.message : String(err);
    logWarning(
      'memory-store',
      `applyMemoryActions failed (memory subsystem degraded): ${message}`,
    );
  }
}

// ─── LINK action ────────────────────────────────────────────────────────────

function applyLinkAction(action: MemoryActionLink): void {
  try {
    if (!isValidRelation(action.rel)) return;
    createMemoryRelation(action.from, action.to, action.rel, action.confidence);
  } catch {
    // Link failures should never break memory extraction.
  }
}

// ─── Prompt Formatting ──────────────────────────────────────────────────────

/**
 * Format memories as categorized markdown for system prompt injection.
 * Truncates to token budget (~4 chars per token).
 */
export function formatMemoriesForPrompt(memories: Memory[], tokenBudget = 2000): string {
  if (memories.length === 0) return '';

  const charBudget = tokenBudget * 4;
  const header = '## Project Memory (auto-learned)\n';
  let output = header;
  let remaining = charBudget - header.length;

  // Group by category
  const grouped = new Map<string, Memory[]>();
  for (const m of memories) {
    const list = grouped.get(m.category) ?? [];
    list.push(m);
    grouped.set(m.category, list);
  }

  // Sort categories by priority
  const sortedCategories = [...grouped.keys()].sort(
    (a, b) => (CATEGORY_PRIORITY[a] ?? 99) - (CATEGORY_PRIORITY[b] ?? 99),
  );

  for (const category of sortedCategories) {
    const items = grouped.get(category)!;
    const catHeader = `\n### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`;

    if (remaining < catHeader.length + 10) break;
    output += catHeader;
    remaining -= catHeader.length;

    for (const item of items) {
      const annotation = `${formatTrinityAnnotation(item.trinity)}${formatVolvoxAnnotation(item.volvox)}`;
      const bullet = `- ${item.content}${annotation}\n`;
      if (remaining < bullet.length) break;
      output += bullet;
      remaining -= bullet.length;
    }
  }

  return output.trimEnd();
}

function formatVolvoxAnnotation(metadata: MemoryVolvoxMetadata | undefined): string {
  if (!metadata) return '';
  const parts = [
    `cell=${metadata.cellType}`,
    `phase=${metadata.lifecyclePhase}`,
    `stable=${formatScore(metadata.roleStability)}`,
  ];
  if (metadata.propagationEligible) parts.push('propagation=eligible');
  return ` [volvox ${parts.join(' ')}]`;
}

function formatTrinityAnnotation(metadata: TrinityMetadata | undefined): string {
  if (!metadata) return '';
  const parts = [`layer=${metadata.layer}`];
  const ity = topVectorEntries(metadata.ity);
  const pathy = topVectorEntries(metadata.pathy);
  if (ity) parts.push(`ity=${ity}`);
  if (pathy) parts.push(`pathy=${pathy}`);
  parts.push(`validation=${metadata.validation.state}:${formatScore(metadata.validation.score)}`);
  return ` [${parts.join(' ')}]`;
}

function topVectorEntries(vector: TrinityVector): string {
  return Object.entries(vector)
    .filter(([, score]) => typeof score === 'number' && score > 0)
    .sort((a, b) => {
      const diff = (b[1] ?? 0) - (a[1] ?? 0);
      return diff !== 0 ? diff : a[0].localeCompare(b[0]);
    })
    .slice(0, 2)
    .map(([key, score]) => `${key}:${formatScore(score ?? 0)}`)
    .join(',');
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

// ─── VOLVOX epoch runner and status surfaces ────────────────────────────────

export interface RunMemoryVolvoxEpochOptions {
  trigger?: string;
  now?: string | Date;
  thresholds?: Partial<VolvoxThresholds> | null;
  dryRun?: boolean;
}

export interface MemoryVolvoxEpochStatus {
  id: string;
  status: string;
  trigger: string;
  startedAt: string;
  completedAt?: string;
  thresholds: unknown;
  counts: unknown;
  diagnostics: VolvoxDiagnostic[];
}

export function runVolvoxEpoch(options: RunMemoryVolvoxEpochOptions = {}) {
  if (!isDbAvailable()) {
    return runPureVolvoxEpoch([], options);
  }
  const adapter = _getAdapter();
  if (!adapter) return runPureVolvoxEpoch([], options);

  const timestamp = normalizeVolvoxEpochTimestamp(options.now);
  const rows = adapter.prepare(
    `SELECT * FROM memories WHERE superseded_by IS NULL AND volvox_archived_at IS NULL ORDER BY id`,
  ).all();
  const metrics = deriveVolvoxRelationMetrics(adapter);
  const records = rows.map((row) => memoryRowToVolvoxRecord(row, metrics.get(row['id'] as string)));
  const epoch = runPureVolvoxEpoch(records, {
    trigger: options.trigger ?? 'manual',
    now: timestamp,
    thresholds: options.thresholds ?? undefined,
  });

  if (options.dryRun) return epoch;

  const auditRow = {
    id: epoch.epochId,
    status: epoch.status === 'blocked' ? 'failed' : epoch.status,
    trigger: epoch.trigger,
    startedAt: epoch.startedAt,
    completedAt: epoch.completedAt,
    thresholdsJson: epoch.thresholdsJson,
    processedCount: epoch.counts.processed,
    changedCount: epoch.counts.changed,
    diagnosticsCount: epoch.counts.diagnostics,
    blockingDiagnosticsCount: epoch.counts.blockingDiagnostics,
    propagationEligibleCount: epoch.counts.propagationEligible,
    archivedCount: epoch.counts.archived,
    countsJson: stableMemoryJson(epoch.counts),
    diagnosticsJson: epoch.diagnosticsJson,
    dryRun: false,
  };

  try {
    transaction(() => {
      insertVolvoxEpochRow(auditRow);

    const diffById = new Map(epoch.diffs.map((diff) => [diff.memoryId, diff]));
    for (const record of epoch.records) {
      const previousRow = rows.find((row) => row['id'] === record.id);
      const previous = previousRow ? rowToVolvoxMetadata(previousRow) : undefined;
      const derived = metrics.get(record.id);
      const memoryDiagnostics = epoch.diagnostics.filter((diagnostic) => diagnostic.memoryId === record.id);
      const after = record.volvox;
      updateMemoryVolvoxMetadata({
        memoryId: record.id,
        cellType: after.cellType,
        roleStability: after.roleStability,
        activationCount: previous?.activationCount ?? 0,
        activationRate: record.metrics?.activationRate ?? previous?.activationRate ?? 0,
        propagationCount: after.propagationEligible ? (previous?.propagationCount ?? 0) + 1 : (previous?.propagationCount ?? 0),
        dormancyCycles: record.metrics?.dormancyCycles ?? previous?.dormancyCycles ?? 0,
        generation: previous?.generation ?? 0,
        offspringCount: record.metrics?.offspringCount ?? previous?.offspringCount ?? 0,
        connectionDensity: record.metrics?.connectionDensity ?? derived?.connectionDensity ?? previous?.connectionDensity ?? 0,
        crossLayerConnections: record.metrics?.crossLayerConnections ?? derived?.crossLayerConnections ?? previous?.crossLayerConnections ?? 0,
        fitness: scoreVolvoxFitness(record.metrics, after),
        kirkStep: record.metrics?.kirkStep ?? previous?.kirkStep ?? null,
        lifecyclePhase: after.lifecyclePhase,
        propagationEligible: after.propagationEligible,
        lastEpochId: after.lastEpochId ?? epoch.epochId,
        lastEpochAt: after.lastEpochAt ?? epoch.completedAt,
        archivedAt: after.archivedAt ?? null,
        updatedAt: epoch.completedAt,
      });

      const diff = diffById.get(record.id);
      insertVolvoxEpochMutationRow({
        epochId: epoch.epochId,
        memoryId: record.id,
        beforeJson: stableMemoryJson(diff?.before ?? previous ?? {}),
        afterJson: stableMemoryJson(after),
        changedFieldsJson: stableMemoryJson(diff?.changedFields ?? []),
        diagnosticsJson: stableMemoryJson(memoryDiagnostics),
        createdAt: epoch.completedAt,
      });
    }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    insertVolvoxEpochRow({
      ...auditRow,
      status: 'failed',
      completedAt: normalizeVolvoxEpochTimestamp(options.now),
      errorMessage: message,
      diagnosticsJson: stableMemoryJson([
        ...epoch.diagnostics,
        {
          epochId: epoch.epochId,
          code: 'persistence-failed',
          severity: 'blocking',
          phase: 'diagnose',
          message: 'VOLVOX epoch persistence failed before all memory mutations could be committed.',
          remediation: 'Inspect SQLite availability and retry the epoch after resolving the persistence error.',
          timestamp: normalizeVolvoxEpochTimestamp(options.now),
          metadata: { error: message },
        },
      ]),
    });
    throw err;
  }

  return epoch;
}

export function shouldRunVolvoxEpoch(input: {
  processedQueriesSinceLastEpoch: number;
  lastEpochAt?: string | null;
  now?: string | Date;
  queryThreshold?: number;
  minElapsedMs?: number;
}): boolean {
  const queryThreshold = input.queryThreshold ?? 5;
  if (input.processedQueriesSinceLastEpoch >= queryThreshold) return true;
  if (!input.lastEpochAt || input.minElapsedMs == null) return false;
  const nowMs = new Date(normalizeVolvoxEpochTimestamp(input.now)).getTime();
  const lastMs = new Date(input.lastEpochAt).getTime();
  return Number.isFinite(nowMs) && Number.isFinite(lastMs) && nowMs - lastMs >= input.minElapsedMs;
}

export function getVolvoxStatus(): { latestEpoch: MemoryVolvoxEpochStatus | null; memories: Memory[]; diagnostics: VolvoxDiagnostic[] } {
  const row = getLatestVolvoxEpochRow();
  const latestEpoch = row ? rowToVolvoxEpochStatus(row as unknown as Record<string, unknown>) : null;
  return {
    latestEpoch,
    memories: getActiveMemoriesRanked(30),
    diagnostics: latestEpoch?.diagnostics ?? [],
  };
}

function rowToVolvoxEpochStatus(row: Record<string, unknown>): MemoryVolvoxEpochStatus {
  const diagnostics = parseJsonArray(row['diagnostics_json']) as VolvoxDiagnostic[];
  return {
    id: row['id'] as string,
    status: row['status'] as string,
    trigger: row['trigger'] as string,
    startedAt: row['started_at'] as string,
    ...(row['completed_at'] ? { completedAt: row['completed_at'] as string } : {}),
    thresholds: parseJsonValue(row['thresholds_json']),
    counts: parseJsonValue(row['counts_json']),
    diagnostics,
  };
}

function memoryRowToVolvoxRecord(row: Record<string, unknown>, relationMetrics?: { connectionDensity: number; crossLayerConnections: number; offspringCount: number }) {
  const memory = rowToMemory(row);
  const activationRate = memory.volvox?.activationRate ?? clampUnitNumber((memory.hit_count ?? 0) / 5);
  const metrics = {
    activationRate,
    offspringCount: Math.max(memory.volvox?.offspringCount ?? 0, relationMetrics?.offspringCount ?? 0),
    crossLayerConnections: Math.max(memory.volvox?.crossLayerConnections ?? 0, relationMetrics?.crossLayerConnections ?? 0),
    connectionDensity: Math.max(memory.volvox?.connectionDensity ?? 0, relationMetrics?.connectionDensity ?? 0),
    dormancyCycles: memory.volvox?.dormancyCycles ?? 0,
    ...(memory.volvox?.kirkStep === undefined ? {} : { kirkStep: memory.volvox.kirkStep }),
  };
  return {
    id: memory.id,
    category: memory.category,
    content: memory.content.slice(0, 160),
    trinityLayer: memory.trinity?.layer,
    volvox: memory.volvox,
    metrics,
    propagation: {
      contributor: memory.confidence >= 0.5,
      provenanceComplete: (memory.trinity?.provenance.sourceRelations.length ?? 0) > 0 || Boolean(memory.source_unit_type),
    },
  };
}

function deriveVolvoxRelationMetrics(adapter: NonNullable<ReturnType<typeof _getAdapter>>): Map<string, { connectionDensity: number; crossLayerConnections: number; offspringCount: number }> {
  const out = new Map<string, { connectionDensity: number; crossLayerConnections: number; offspringCount: number }>();
  const ensure = (id: string) => {
    let entry = out.get(id);
    if (!entry) {
      entry = { connectionDensity: 0, crossLayerConnections: 0, offspringCount: 0 };
      out.set(id, entry);
    }
    return entry;
  };

  try {
    const rows = adapter.prepare(
      `SELECT from_id, to_id, rel FROM memory_relations`,
    ).all();
    const layerRows = adapter.prepare(
      `SELECT id, trinity_layer FROM memories`,
    ).all();
    const layers = new Map(layerRows.map((row) => [row['id'] as string, row['trinity_layer'] as string]));

    for (const row of rows) {
      const from = row['from_id'] as string;
      const to = row['to_id'] as string;
      const rel = row['rel'] as string;
      const fromEntry = ensure(from);
      const toEntry = ensure(to);
      fromEntry.connectionDensity += 1;
      toEntry.connectionDensity += 1;
      if (layers.get(from) !== layers.get(to)) {
        fromEntry.crossLayerConnections += 1;
        toEntry.crossLayerConnections += 1;
      }
      if (rel === 'supersedes' || rel === 'elaborates') {
        fromEntry.offspringCount += 1;
      }
    }
  } catch {
    // Missing/legacy relation tables count as zero metrics by design.
  }

  return out;
}

function normalizeVolvoxEpochTimestamp(value: string | Date | undefined): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return new Date().toISOString();
}

function stableMemoryJson(value: unknown): string {
  return JSON.stringify(toStableMemoryJsonValue(value));
}

function toStableMemoryJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toStableMemoryJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, toStableMemoryJsonValue(entry)]),
  );
}

function parseJsonValue(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function parseJsonArray(raw: unknown): unknown[] {
  const parsed = parseJsonValue(raw);
  return Array.isArray(parsed) ? parsed : [];
}
