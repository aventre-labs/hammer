/**
 * src/iam/tools.ts
 *
 * Pure executor functions for the public IAM tool surface. This module has no
 * extension-tree imports and performs all memory/graph work through injected
 * adapters so it can be tested without a live Hammer database.
 */

import { getRune, listRunes, validateRuneNames } from "./rune-registry.js";
import { validateSavesuccess, formatSavesuccessReport } from "./savesuccess.js";
import type {
  IAMError,
  IAMResult,
  IAMToolAdapters,
  IAMToolOutput,
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

type MemoryListEntry = {
  id: string;
  content: string;
  score: number;
  category: string;
};

type ActiveMemoryEntry = {
  id: string;
  content: string;
  confidence: number;
  category: string;
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

function countByCategory(
  memories: Array<{ category: string }>,
): Record<string, number> {
  const categories: Record<string, number> = {};
  for (const memory of memories) {
    categories[memory.category] = (categories[memory.category] ?? 0) + 1;
  }
  return categories;
}

function activeMemoryToListEntry(memory: ActiveMemoryEntry): MemoryListEntry {
  return {
    id: memory.id,
    content: memory.content,
    score: memory.confidence,
    category: memory.category,
  };
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
  params: { query: string; k?: number; category?: string },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const memories = adapters.queryMemories(params.query, params.k ?? 10, params.category);
  return ok({ kind: "memory-list", memories });
}

export async function executeIAMQuick(
  adapters: IAMToolAdapters,
  params: { query: string },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const memories = adapters.queryMemories(params.query, 1).slice(0, 1);
  return ok({ kind: "memory-list", memories });
}

export async function executeIAMRefract(
  adapters: IAMToolAdapters,
  params: { query: string; lens: string },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const memories = adapters.queryMemories(params.query, 5).map((memory) => ({
    ...memory,
    content: `[${params.lens} lens] ${memory.content}`,
  }));
  return ok({ kind: "memory-list", memories });
}

export async function executeIAMRemember(
  adapters: IAMToolAdapters,
  params: { category: string; content: string; confidence?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const id = adapters.createMemory({
    category: params.category,
    content: params.content,
    confidence: params.confidence,
    source_unit_type: "iam-tool",
    structuredFields: { iam_tool: "remember" },
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
  });
}

export async function executeIAMHarvest(
  adapters: IAMToolAdapters,
  params: { limit?: number; category?: string },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const active = adapters
    .getActiveMemories(params.limit ?? 30)
    .filter((memory) => !params.category || memory.category === params.category);
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
  params: { query: string; k?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const memories = adapters.queryMemories(params.query, params.k ?? 20);
  return ok({
    kind: "knowledge-map",
    categories: countByCategory(memories),
    total: memories.length,
  });
}

export async function executeIAMLandscape(
  adapters: IAMToolAdapters,
  params: { limit?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const memories = adapters.getActiveMemories(params.limit ?? 50);
  return ok({
    kind: "knowledge-map",
    categories: countByCategory(memories),
    total: memories.length,
  });
}

export async function executeIAMBridge(
  adapters: IAMToolAdapters,
  params: { queryA: string; queryB: string; k?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const limit = params.k ?? 10;
  const combined = new Map<string, MemoryListEntry>();
  for (const memory of adapters.queryMemories(params.queryA, limit)) {
    combined.set(memory.id, memory);
  }
  for (const memory of adapters.queryMemories(params.queryB, limit)) {
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

  const limit = params.k ?? 10;
  const memoriesA = adapters.queryMemories(params.queryA, limit).map((memory) => ({
    ...memory,
    id: `A:${memory.id}`,
    content: `[A:${params.queryA}] ${memory.content}`,
  }));
  const memoriesB = adapters.queryMemories(params.queryB, limit).map((memory) => ({
    ...memory,
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

  const graph = adapters.traverseGraph(params.memoryId, params.depth ?? 3);
  return ok({ kind: "graph-walk", nodes: graph.nodes, edges: graph.edges });
}

export async function executeIAMExplore(
  adapters: IAMToolAdapters,
  params: { memoryId: string; depth?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const graph = adapters.traverseGraph(params.memoryId, params.depth ?? 2);
  return ok({ kind: "graph-walk", nodes: graph.nodes, edges: graph.edges });
}

export async function executeIAMTension(
  adapters: IAMToolAdapters,
  params: { query: string; k?: number },
): Promise<IAMResult<IAMToolOutput>> {
  const unavailable = requireDb(adapters);
  if (unavailable) return unavailable;

  const memories = adapters.queryMemories(params.query, params.k ?? 10).map((memory) => ({
    ...memory,
    content: `[heuristic tension scan; semantic contradiction filtering arrives in S04] ${memory.content}`,
  }));
  return ok({ kind: "memory-list", memories });
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
