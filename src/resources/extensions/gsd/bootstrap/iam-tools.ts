// Hammer — IAM awareness tool registration
// Exposes the native public IAM tools (recall, refract, quick, spiral, …)
// as hammer_* canonical tools with gsd_* legacy aliases.

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { ensureDbOpen } from "./dynamic-tools.js";
import {
  queryMemoriesRanked,
  getActiveMemoriesRanked,
  createMemory,
} from "../memory-store.js";
import { traverseGraph } from "../memory-relations.js";
import {
  executeIAMRecall,
  executeIAMQuick,
  executeIAMRefract,
  executeIAMRemember,
  executeIAMHarvest,
  executeIAMCluster,
  executeIAMLandscape,
  executeIAMBridge,
  executeIAMCompare,
  executeIAMProvenance,
  executeIAMExplore,
  executeIAMTension,
  executeIAMRune,
  executeIAMValidate,
  executeIAMAssess,
  executeIAMCompile,
  executeIAMCheck,
  executeIAMSpiral,
  executeIAMCanonicalSpiral,
} from "../../../../iam/tools.js";
import type {
  IAMError,
  IAMResult,
  IAMToolAdapters,
  IAMToolOutput,
} from "../../../../iam/types.js";

function buildAdapters(dbAvailable: boolean): IAMToolAdapters {
  return {
    isDbAvailable: () => dbAvailable,
    queryMemories: (query, k = 10, category, options) =>
      queryMemoriesRanked({
        query,
        k,
        ...(category ? { category } : {}),
        ...(options?.trinityLayer ? { trinityLayer: options.trinityLayer } : {}),
        ...(options?.trinityLens ? { trinityLens: options.trinityLens } : {}),
      })
        .map((r) => ({ id: r.memory.id, content: r.memory.content, score: r.score, category: r.memory.category, trinity: r.memory.trinity })),
    getActiveMemories: (limit = 30) =>
      getActiveMemoriesRanked(limit)
        .map((m) => ({ id: m.id, content: m.content, confidence: m.confidence, category: m.category, trinity: m.trinity })),
    createMemory: (fields) => createMemory(fields),
    traverseGraph: (startId, depth = 2) => {
      const graph = traverseGraph(startId, depth);
      return {
        nodes: graph.nodes.map((n) => ({
          id: n.id,
          category: n.category,
          content: n.content,
          confidence: n.confidence,
          trinity: n.trinity,
          provenanceSummary: n.provenanceSummary,
        })),
        edges: graph.edges.map((e) => ({ fromId: e.from, toId: e.to, relation: e.rel })),
      };
    },
  };
}

/**
 * Register an alias tool that shares the same execute function as its canonical counterpart.
 * The alias description and promptGuidelines direct the LLM to prefer the canonical name.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- toolDef shape matches ToolDefinition but typing it fully requires generics
function registerAlias(pi: ExtensionAPI, toolDef: any, aliasName: string, canonicalName: string): void {
  pi.registerTool({
    ...toolDef,
    name: aliasName,
    description: toolDef.description + ` (alias for ${canonicalName} — prefer the canonical name)`,
    promptGuidelines: [`Alias for ${canonicalName} — prefer the canonical name.`],
  });
}

function iamErrorResponse(error: IAMError) {
  return {
    content: [{ type: "text" as const, text: `IAM error: ${error.iamErrorKind} — ${error.remediation}` }],
    isError: true,
    details: {
      iamErrorKind: error.iamErrorKind,
      remediation: error.remediation,
      ...(error.stage ? { stage: error.stage } : {}),
      ...(error.runeName ? { runeName: error.runeName } : {}),
      ...(error.target ? { target: error.target } : {}),
      ...(error.persistenceStatus ? { persistenceStatus: error.persistenceStatus } : {}),
      ...(error.validationGap ? { validationGap: error.validationGap } : {}),
    },
  };
}

function unexpectedErrorResponse(err: unknown) {
  return iamErrorResponse({
    iamErrorKind: "persistence-failed",
    remediation: `Unexpected IAM tool failure: ${err instanceof Error ? err.message : String(err)}`,
    persistenceStatus: "partial",
  });
}

function iamSuccessResponse(value: IAMToolOutput) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: { status: "ok", kind: value.kind },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- executor params and tool result details differ per IAM tool and are validated by each tool schema
async function runIAMTool(execute: (adapters: IAMToolAdapters, params: any) => Promise<IAMResult<IAMToolOutput>>, adapters: IAMToolAdapters, params: any): Promise<any> {
  try {
    const result = await execute(adapters, params);
    if (!result.ok) return iamErrorResponse(result.error);
    return iamSuccessResponse(result.value);
  } catch (err) {
    return unexpectedErrorResponse(err);
  }
}

const trinityLayerSchema = Type.Union([Type.Literal("social"), Type.Literal("knowledge"), Type.Literal("generative")], {
  description: "Optional Trinity layer filter or metadata value.",
});

const trinityVectorSchema = Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 }), {
  description: "Normalized Trinity vector scores (0–1). Unknown keys are ignored by IAM normalization.",
});

const trinityLensSchema = Type.Object({
  ity: Type.Optional(trinityVectorSchema),
  pathy: Type.Optional(trinityVectorSchema),
}, { description: "Optional Trinity -ity/-pathy vector lens for deterministic ranking." });

const trinityValidationStateSchema = Type.Union([
  Type.Literal("unvalidated"),
  Type.Literal("validated"),
  Type.Literal("contested"),
  Type.Literal("deprecated"),
], { description: "Optional Trinity validation state." });

const trinityMetadataSchema = Type.Object({
  layer: Type.Optional(trinityLayerSchema),
  ity: Type.Optional(trinityVectorSchema),
  pathy: Type.Optional(trinityVectorSchema),
  provenance: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: "Optional provenance/source-relation metadata. Do not include secrets.",
  })),
  validation: Type.Optional(Type.Object({
    state: Type.Optional(trinityValidationStateSchema),
    score: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  })),
}, { description: "Optional Trinity metadata payload. Unknown vector keys and malformed values are normalized by IAM." });

export function registerIAMTools(pi: ExtensionAPI): void {
  const recallTool = {
    name: "hammer_recall",
    label: "IAM Recall",
    description: "Query Hammer memory with IAM-aware filtering and scoring.",
    promptSnippet: "Recall memories matching a query",
    promptGuidelines: ["Use hammer_recall to search Hammer memory for relevant prior knowledge."],
    parameters: Type.Object({
      query: Type.String({ description: "Keywords to search for" }),
      k: Type.Optional(Type.Number({ description: "Max results (default 10, max 100)", minimum: 1, maximum: 100 })),
      category: Type.Optional(Type.String({ description: "Filter by category" })),
      trinityLayer: Type.Optional(trinityLayerSchema),
      trinityLens: Type.Optional(trinityLensSchema),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMRecall, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(recallTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, recallTool, "gsd_recall", "hammer_recall");

  const quickTool = {
    name: "hammer_quick",
    label: "IAM Quick",
    description: "Return the highest-ranked Hammer memory for a query.",
    promptSnippet: "Quickly recall the top memory for a query",
    promptGuidelines: ["Use hammer_quick when one highly relevant memory is enough."],
    parameters: Type.Object({
      query: Type.String({ description: "Keywords to search for" }),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMQuick, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(quickTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, quickTool, "gsd_quick", "hammer_quick");

  const refractTool = {
    name: "hammer_refract",
    label: "IAM Refract",
    description: "Recall Hammer memories through a named interpretive lens.",
    promptSnippet: "Reframe recalled memories through a lens",
    promptGuidelines: ["Use hammer_refract to view relevant memories through a specific lens."],
    parameters: Type.Object({
      query: Type.String({ description: "Keywords to search for" }),
      lens: Type.String({ description: "Lens to apply to recalled memory content" }),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMRefract, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(refractTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, refractTool, "gsd_refract", "hammer_refract");

  const spiralTool = {
    name: "hammer_spiral",
    label: "IAM Spiral",
    description: "Return structured guidance for the deferred Omega spiral executor.",
    promptSnippet: "Request an Omega spiral over a query",
    promptGuidelines: ["Use hammer_spiral to get structured guidance while direct spiral execution is deferred."],
    parameters: Type.Object({
      query: Type.String({ description: "Topic or question for the spiral" }),
      stages: Type.Optional(Type.Array(Type.String({ description: "Omega stage name" }), { description: "Optional stage names" })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      return runIAMTool(executeIAMSpiral, buildAdapters(false), params);
    },
  };
  pi.registerTool(spiralTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, spiralTool, "gsd_spiral", "hammer_spiral");

  const canonicalSpiralTool = {
    name: "hammer_canonical_spiral",
    label: "IAM Canonical Spiral",
    description: "Return structured guidance for the canonical deferred Omega spiral executor.",
    promptSnippet: "Request a canonical Omega spiral over a query",
    promptGuidelines: ["Use hammer_canonical_spiral for canonical spiral guidance until direct execution is wired."],
    parameters: Type.Object({
      query: Type.String({ description: "Topic or question for the canonical spiral" }),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      return runIAMTool(executeIAMCanonicalSpiral, buildAdapters(false), params);
    },
  };
  pi.registerTool(canonicalSpiralTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, canonicalSpiralTool, "gsd_canonical_spiral", "hammer_canonical_spiral");

  const exploreTool = {
    name: "hammer_explore",
    label: "IAM Explore",
    description: "Traverse the Hammer memory graph outward from a memory.",
    promptSnippet: "Explore graph neighbors for a memory",
    promptGuidelines: ["Use hammer_explore to inspect related memories around a known memory id."],
    parameters: Type.Object({
      memoryId: Type.String({ description: "Memory ID to start from" }),
      depth: Type.Optional(Type.Number({ description: "Traversal depth (0–5, default 2)", minimum: 0, maximum: 5 })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMExplore, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(exploreTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, exploreTool, "gsd_explore", "hammer_explore");

  const bridgeTool = {
    name: "hammer_bridge",
    label: "IAM Bridge",
    description: "Recall memories that bridge two Hammer memory queries.",
    promptSnippet: "Bridge memories between two queries",
    promptGuidelines: ["Use hammer_bridge to gather memories relevant to two concepts."],
    parameters: Type.Object({
      queryA: Type.String({ description: "First query" }),
      queryB: Type.String({ description: "Second query" }),
      k: Type.Optional(Type.Number({ description: "Max results per query (default 10)" })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMBridge, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(bridgeTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, bridgeTool, "gsd_bridge", "hammer_bridge");

  const compareTool = {
    name: "hammer_compare",
    label: "IAM Compare",
    description: "Recall and label Hammer memories for two queries so they can be compared.",
    promptSnippet: "Compare memories from two queries",
    promptGuidelines: ["Use hammer_compare to inspect side-by-side memory sets for two concepts."],
    parameters: Type.Object({
      queryA: Type.String({ description: "First query" }),
      queryB: Type.String({ description: "Second query" }),
      k: Type.Optional(Type.Number({ description: "Max results per query (default 10)" })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMCompare, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(compareTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, compareTool, "gsd_compare", "hammer_compare");

  const clusterTool = {
    name: "hammer_cluster",
    label: "IAM Cluster",
    description: "Summarize category clusters across recalled Hammer memories.",
    promptSnippet: "Cluster recalled memories by category",
    promptGuidelines: ["Use hammer_cluster to see category distribution for memories matching a query."],
    parameters: Type.Object({
      query: Type.String({ description: "Keywords to search for" }),
      k: Type.Optional(Type.Number({ description: "Max results (default 20, max 100)", minimum: 1, maximum: 100 })),
      trinityLayer: Type.Optional(trinityLayerSchema),
      trinityLens: Type.Optional(trinityLensSchema),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMCluster, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(clusterTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, clusterTool, "gsd_cluster", "hammer_cluster");

  const landscapeTool = {
    name: "hammer_landscape",
    label: "IAM Landscape",
    description: "Summarize the active Hammer memory landscape by category.",
    promptSnippet: "Map active memory categories",
    promptGuidelines: ["Use hammer_landscape to inspect the active memory category distribution."],
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max active memories to inspect (default 50, max 100)", minimum: 1, maximum: 100 })),
      trinityLayer: Type.Optional(trinityLayerSchema),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMLandscape, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(landscapeTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, landscapeTool, "gsd_landscape", "hammer_landscape");

  const tensionTool = {
    name: "hammer_tension",
    label: "IAM Tension",
    description: "Recall memories for a heuristic tension scan over a query.",
    promptSnippet: "Surface potential tensions in recalled memories",
    promptGuidelines: ["Use hammer_tension to gather memories that may contain unresolved tensions."],
    parameters: Type.Object({
      query: Type.String({ description: "Keywords to search for" }),
      k: Type.Optional(Type.Number({ description: "Max results (default 10, max 100)", minimum: 1, maximum: 100 })),
      trinityLayer: Type.Optional(trinityLayerSchema),
      trinityLens: Type.Optional(trinityLensSchema),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMTension, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(tensionTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, tensionTool, "gsd_tension", "hammer_tension");

  const runeTool = {
    name: "hammer_rune",
    label: "IAM Rune",
    description: "Read a single IAM governance rune contract.",
    promptSnippet: "Inspect a governance rune contract",
    promptGuidelines: ["Use hammer_rune to read one canonical IAM governance rune."],
    parameters: Type.Object({
      runeName: Type.String({ description: "Rune name to inspect" }),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      return runIAMTool(executeIAMRune, buildAdapters(false), params);
    },
  };
  pi.registerTool(runeTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, runeTool, "gsd_rune", "hammer_rune");

  const validateTool = {
    name: "hammer_validate",
    label: "IAM Validate",
    description: "Validate IAM governance rune names and return matching contracts.",
    promptSnippet: "Validate governance rune names",
    promptGuidelines: ["Use hammer_validate to check whether rune names are canonical."],
    parameters: Type.Object({
      runeNames: Type.Array(Type.String({ description: "Rune name" }), { description: "Rune names to validate" }),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      return runIAMTool(executeIAMValidate, buildAdapters(false), params);
    },
  };
  pi.registerTool(validateTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, validateTool, "gsd_validate", "hammer_validate");

  const assessTool = {
    name: "hammer_assess",
    label: "IAM Assess",
    description: "Assess text with the deterministic SAVESUCCESS scorecard bridge.",
    promptSnippet: "Assess text against SAVESUCCESS pillars",
    promptGuidelines: ["Use hammer_assess to produce a SAVESUCCESS report for prose or plans."],
    parameters: Type.Object({
      text: Type.String({ description: "Text to assess" }),
      target: Type.Optional(Type.String({ description: "Optional target or intended outcome" })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      return runIAMTool(executeIAMAssess, buildAdapters(false), params);
    },
  };
  pi.registerTool(assessTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, assessTool, "gsd_assess", "hammer_assess");

  const compileTool = {
    name: "hammer_compile",
    label: "IAM Compile",
    description: "Compile and return the canonical IAM governance rune list.",
    promptSnippet: "List all governance rune contracts",
    promptGuidelines: ["Use hammer_compile to retrieve the canonical IAM rune catalog."],
    parameters: Type.Object({}),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      return runIAMTool(executeIAMCompile, buildAdapters(false), params);
    },
  };
  pi.registerTool(compileTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, compileTool, "gsd_compile", "hammer_compile");

  const harvestTool = {
    name: "hammer_harvest",
    label: "IAM Harvest",
    description: "Harvest active Hammer memories into a category-aware memory list.",
    promptSnippet: "Harvest active memories by category",
    promptGuidelines: ["Use hammer_harvest to retrieve active memories with category summary context."],
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max active memories to inspect (default 30, max 100)", minimum: 1, maximum: 100 })),
      category: Type.Optional(Type.String({ description: "Filter active memories by category" })),
      trinityLayer: Type.Optional(trinityLayerSchema),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMHarvest, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(harvestTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, harvestTool, "gsd_harvest", "hammer_harvest");

  const rememberTool = {
    name: "hammer_remember",
    label: "IAM Remember",
    description: "Persist a new IAM memory into Hammer memory.",
    promptSnippet: "Remember a durable IAM memory",
    promptGuidelines: ["Use hammer_remember only for reusable project knowledge, not transient notes."],
    parameters: Type.Object({
      category: Type.String({ description: "Memory category" }),
      content: Type.String({ description: "Durable memory content" }),
      confidence: Type.Optional(Type.Number({ description: "Confidence from 0.1 to 0.99", minimum: 0.1, maximum: 0.99 })),
      trinity: Type.Optional(trinityMetadataSchema),
      trinityLayer: Type.Optional(trinityLayerSchema),
      trinityIty: Type.Optional(trinityVectorSchema),
      trinityPathy: Type.Optional(trinityVectorSchema),
      trinityProvenance: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "Optional provenance/source-relation metadata. Do not include secrets.",
      })),
      trinityValidationState: Type.Optional(trinityValidationStateSchema),
      trinityValidationScore: Type.Optional(Type.Number({ description: "Optional validation score (0–1).", minimum: 0, maximum: 1 })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMRemember, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(rememberTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, rememberTool, "gsd_remember", "hammer_remember");

  const provenanceTool = {
    name: "hammer_provenance",
    label: "IAM Provenance",
    description: "Trace provenance around a Hammer memory through the memory graph.",
    promptSnippet: "Trace graph provenance for a memory",
    promptGuidelines: ["Use hammer_provenance to inspect graph context for a specific memory id."],
    parameters: Type.Object({
      memoryId: Type.String({ description: "Memory ID to start from" }),
      depth: Type.Optional(Type.Number({ description: "Traversal depth (0–5, default 3)", minimum: 0, maximum: 5 })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMProvenance, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(provenanceTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, provenanceTool, "gsd_provenance", "hammer_provenance");

  const checkTool = {
    name: "hammer_check",
    label: "IAM Check",
    description: "Report the IAM tool catalog, kernel version, and Hammer DB availability.",
    promptSnippet: "Check IAM awareness tool availability",
    promptGuidelines: ["Use hammer_check to verify the native IAM awareness tool surface is registered."],
    parameters: Type.Object({}),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      return runIAMTool(executeIAMCheck, buildAdapters(!!dbAvailable), params);
    },
  };
  pi.registerTool(checkTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, checkTool, "gsd_check", "hammer_check");
}
