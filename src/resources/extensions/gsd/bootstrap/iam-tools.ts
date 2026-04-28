// Hammer — IAM awareness tool registration
// Exposes the native public IAM tools (recall, refract, quick, spiral, …)
// as hammer_* canonical tools with gsd_* legacy aliases.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";
import type { Api, AssistantMessage, Model } from "@gsd/pi-ai";
import { ensureDbOpen } from "./dynamic-tools.js";
import {
  persistPhaseOmegaRun,
} from "../omega-phase-artifacts.js";
import { atomicWriteSync } from "../atomic-write.js";
import { gsdRoot } from "../paths.js";
import {
  queryMemoriesRanked,
  getActiveMemoriesRanked,
  createMemory,
  runVolvoxEpoch,
  getVolvoxStatus,
} from "../memory-store.js";
import {
  getOmegaRun,
  insertOmegaRun,
  insertSavesuccessResult,
  updateOmegaRunStatus,
} from "../gsd-db.js";
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
  executeIAMVolvoxEpoch,
  executeIAMVolvoxStatus,
  executeIAMVolvoxDiagnose,
} from "../../../../iam/tools.js";
import type {
  IAMError,
  IAMOmegaRunOptions,
  IAMResult,
  IAMToolAdapters,
  IAMToolOutput,
  IAMToolVolvoxStatus,
} from "../../../../iam/types.js";
import { executeOmegaSpiral } from "../../../../iam/omega.js";
import { persistOmegaRun } from "../../../../iam/persist.js";

type IAMToolRuntimeOptions = {
  ctx?: ExtensionContext;
  basePath?: string;
};

function buildAdapters(dbAvailable: boolean, options: IAMToolRuntimeOptions = {}): IAMToolAdapters {
  return {
    isDbAvailable: () => dbAvailable,
    queryMemories: (query, k = 10, category, options) =>
      queryMemoriesRanked({
        query,
        k,
        ...(category ? { category } : {}),
        ...(options?.trinityLayer ? { trinityLayer: options.trinityLayer } : {}),
        ...(options?.trinityLens ? { trinityLens: options.trinityLens } : {}),
        ...(options?.volvoxCellType ? { volvoxCellType: options.volvoxCellType } : {}),
        ...(options?.volvoxLifecyclePhase ? { volvoxLifecyclePhase: options.volvoxLifecyclePhase } : {}),
        ...(options?.propagationEligible === undefined ? {} : { propagationEligible: options.propagationEligible }),
        ...(options?.includeDormant === undefined ? {} : { includeDormant: options.includeDormant }),
      })
        .map((r) => ({ id: r.memory.id, content: r.memory.content, score: r.score, category: r.memory.category, trinity: r.memory.trinity, volvox: r.memory.volvox })),
    getActiveMemories: (limit = 30, options) =>
      getActiveMemoriesRanked(limit, {
        ...(options?.volvoxCellType ? { volvoxCellType: options.volvoxCellType } : {}),
        ...(options?.volvoxLifecyclePhase ? { volvoxLifecyclePhase: options.volvoxLifecyclePhase } : {}),
        ...(options?.propagationEligible === undefined ? {} : { propagationEligible: options.propagationEligible }),
        ...(options?.includeDormant === undefined ? {} : { includeDormant: options.includeDormant }),
      })
        .map((m) => ({ id: m.id, content: m.content, confidence: m.confidence, category: m.category, trinity: m.trinity, volvox: m.volvox })),
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
          volvox: n.volvox,
          provenanceSummary: n.provenanceSummary,
        })),
        edges: graph.edges.map((e) => ({ fromId: e.from, toId: e.to, relation: e.rel })),
      };
    },
    runVolvoxEpoch: (options) => runVolvoxEpoch(options),
    getVolvoxStatus: () => {
      const status = getVolvoxStatus();
      const latestEpoch: IAMToolVolvoxStatus["latestEpoch"] = status.latestEpoch
        ? {
            epochId: status.latestEpoch.id,
            status: status.latestEpoch.status === "failed" ? "blocked" : "completed",
            trigger: status.latestEpoch.trigger,
            startedAt: status.latestEpoch.startedAt,
            completedAt: status.latestEpoch.completedAt ?? status.latestEpoch.startedAt,
            thresholds: status.latestEpoch.thresholds as never,
            thresholdsJson: JSON.stringify(status.latestEpoch.thresholds ?? {}),
            phases: ["normalize", "classify", "stabilize", "propagate", "diagnose"] as const,
            records: [],
            diffs: [],
            diagnostics: status.latestEpoch.diagnostics,
            diagnosticsJson: JSON.stringify(status.latestEpoch.diagnostics),
            counts: status.latestEpoch.counts as never,
          }
        : null;
      return {
        latestEpoch,
        epochResult: latestEpoch,
        memories: status.memories.map((m) => ({ id: m.id, content: m.content, score: m.confidence, category: m.category, trinity: m.trinity, volvox: m.volvox })),
        diagnostics: status.diagnostics,
      };
    },
    diagnoseVolvox: (params) => {
      const status = getVolvoxStatus();
      const diagnostics = params?.memoryId
        ? status.diagnostics.filter((diagnostic) => diagnostic.memoryId === params.memoryId)
        : status.diagnostics;
      const visible = params?.includeInfo ? diagnostics : diagnostics.filter((diagnostic) => diagnostic.severity !== "info");
      return {
        diagnostics: visible,
        blocking: visible.filter((diagnostic) => diagnostic.severity === "blocking"),
      };
    },
    runOmega: (params) => runNativeOmega(params, options),
  };
}

const OMEGA_RUN_DIR = "omega/tools";

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function selectOmegaModel(ctx: ExtensionContext | undefined): Model<Api> | null {
  try {
    const available = ctx?.modelRegistry?.getAvailable?.() ?? [];
    if (!available || available.length === 0) return null;
    return available.find((model) => model.id.toLowerCase().includes("haiku")) as Model<Api>
      ?? [...available].sort((a, b) => a.cost.input - b.cost.input)[0] as Model<Api>
      ?? null;
  } catch {
    return null;
  }
}

async function buildOmegaExecutor(ctx: ExtensionContext | undefined): Promise<{ ok: true; executor: (prompt: string) => Promise<string> } | { ok: false; error: IAMError }> {
  const injectedExecutor = (ctx as { omegaExecutor?: unknown } | undefined)?.omegaExecutor;
  if (typeof injectedExecutor === "function") {
    return {
      ok: true,
      executor: async (prompt: string): Promise<string> => {
        const text = await (injectedExecutor as (prompt: string) => Promise<string> | string)(prompt);
        if (!isNonEmptyText(text)) {
          throw new Error("Omega model returned malformed response: expected non-empty text content.");
        }
        return text.trim();
      },
    };
  }

  const selectedModel = selectOmegaModel(ctx);
  if (!selectedModel || !ctx?.modelRegistry) {
    return {
      ok: false,
      error: {
        iamErrorKind: "executor-not-wired",
        remediation: "No model is available for Omega execution. Configure at least one model provider/API key before calling hammer_spiral or hammer_canonical_spiral.",
        persistenceStatus: "not-attempted",
      },
    };
  }

  let completeSimple: typeof import("@gsd/pi-ai").completeSimple;
  try {
    ({ completeSimple } = await import("@gsd/pi-ai"));
  } catch (cause) {
    return {
      ok: false,
      error: {
        iamErrorKind: "executor-not-wired",
        remediation: "Failed to load @gsd/pi-ai completeSimple for Omega execution. Rebuild/install Hammer workspace packages before retrying.",
        persistenceStatus: "not-attempted",
        cause,
      },
    };
  }

  const apiKey = await ctx.modelRegistry.getApiKey(selectedModel).catch(() => undefined);
  return {
    ok: true,
    executor: async (prompt: string): Promise<string> => {
      const result = await completeSimple(selectedModel, {
        systemPrompt: "You are Hammer's native Omega Protocol executor. Return only the requested stage output as clear, durable Markdown text.",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
      }, {
        maxTokens: 4096,
        temperature: 0,
        ...(apiKey ? { apiKey } : {}),
      });
      const text = extractAssistantText(result);
      if (!isNonEmptyText(text)) {
        throw new Error("Omega model returned malformed response: expected non-empty text content.");
      }
      return text;
    },
  };
}

function omegaRunManifestPath(artifactDir: string): string {
  return join(artifactDir, "run-manifest.json");
}

function omegaSynthesisPath(artifactDir: string): string | undefined {
  const path = join(artifactDir, "synthesis.md");
  return existsSync(path) ? path : undefined;
}

function omegaToolBaseDir(basePath: string): string {
  return join(gsdRoot(basePath), OMEGA_RUN_DIR);
}

async function runNativeOmega(params: IAMOmegaRunOptions, options: IAMToolRuntimeOptions) {
  const basePath = options.basePath ?? process.cwd();
  const executor = await buildOmegaExecutor(options.ctx);
  if (!executor.ok) return { ok: false as const, error: executor.error };

  const hasPhasePersistence = !!params.unitType || !!params.unitId || !!params.targetArtifactPath;
  if (hasPhasePersistence) {
    if (!params.unitType || !params.unitId || !params.targetArtifactPath) {
      return {
        ok: false as const,
        error: {
          iamErrorKind: "persistence-failed" as const,
          remediation: "Phase Omega persistence requires unitType, unitId, and targetArtifactPath together.",
          validationGap: "Incomplete Omega phase persistence parameters.",
          persistenceStatus: "not-attempted" as const,
        },
      };
    }

    const phaseResult = await persistPhaseOmegaRun({
      basePath,
      unitType: params.unitType,
      unitId: params.unitId,
      query: params.query,
      targetArtifactPath: params.targetArtifactPath,
      executor: executor.executor,
      ...(params.persona ? { persona: params.persona } : {}),
      ...(params.runes ? { runes: params.runes } : {}),
    });

    if (!phaseResult.ok) return phaseResult;
    const manifest = phaseResult.value;
    return {
      ok: true as const,
      value: {
        run: {
          id: manifest.runId,
          query: manifest.query,
          persona: params.persona,
          runes: params.runes ?? [],
          stages: params.stages,
          stageResults: Array.from({ length: manifest.stageCount }, () => null) as never,
          status: manifest.status === "complete" ? "complete" as const : manifest.status === "failed" ? "failed" as const : "running" as const,
          createdAt: manifest.createdAt,
          completedAt: manifest.completedAt ?? undefined,
        },
        artifactDir: manifest.artifactDir,
        runManifestPath: manifest.runManifestPath,
        ...(manifest.synthesisPath ? { synthesisPath: manifest.synthesisPath } : {}),
        phaseManifestPath: manifest.manifestPath,
        targetArtifactPath: manifest.targetArtifactPath,
        persistenceStatus: "complete" as const,
      },
    };
  }

  const runResult = await executeOmegaSpiral({
    query: params.query,
    executor: executor.executor,
    ...(params.persona ? { persona: params.persona } : {}),
    ...(params.runes ? { runes: params.runes } : {}),
    stages: params.stages,
  });
  if (!runResult.ok) return runResult;

  const persisted = await persistOmegaRun(runResult.value, omegaToolBaseDir(basePath), {
    atomicWrite: atomicWriteSync,
    insertOmegaRun,
    updateOmegaRunStatus,
    getOmegaRun,
    insertSavesuccessResult,
  });
  if (!persisted.ok) return persisted;

  return {
    ok: true as const,
    value: {
      run: runResult.value,
      artifactDir: persisted.value,
      runManifestPath: omegaRunManifestPath(persisted.value),
      ...(omegaSynthesisPath(persisted.value) ? { synthesisPath: omegaSynthesisPath(persisted.value) } : {}),
      persistenceStatus: "complete" as const,
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

const volvoxCellTypeSchema = Type.Union([
  Type.Literal("UNDIFFERENTIATED"),
  Type.Literal("SOMATIC_SENSOR"),
  Type.Literal("SOMATIC_MOTOR"),
  Type.Literal("STRUCTURAL"),
  Type.Literal("GERMLINE"),
  Type.Literal("DORMANT"),
], { description: "Optional VOLVOX cell type filter." });

const volvoxLifecyclePhaseSchema = Type.Union([
  Type.Literal("embryonic"),
  Type.Literal("juvenile"),
  Type.Literal("mature"),
  Type.Literal("dormant"),
  Type.Literal("archived"),
], { description: "Optional VOLVOX lifecycle phase filter." });

const volvoxThresholdsSchema = Type.Object({
  activationRate: Type.Optional(Type.Number({ minimum: 0 })),
  offspringCount: Type.Optional(Type.Number({ minimum: 0 })),
  crossLayerConnections: Type.Optional(Type.Number({ minimum: 0 })),
  connectionDensity: Type.Optional(Type.Number({ minimum: 0 })),
  dormancyCycles: Type.Optional(Type.Number({ minimum: 0 })),
  dormantArchiveCycles: Type.Optional(Type.Number({ minimum: 0 })),
  stableRole: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  propagationStability: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
}, { additionalProperties: false, description: "Optional VOLVOX threshold overrides. Malformed values are rejected or normalized by the IAM executor." });

const omegaPersonaSchema = Type.Union([
  Type.Literal("poet"),
  Type.Literal("engineer"),
  Type.Literal("skeptic"),
  Type.Literal("child"),
], { description: "Optional Omega persona overlay." });

const omegaRuneSchema = Type.Union([
  Type.Literal("RIGOR"),
  Type.Literal("HUMAN"),
  Type.Literal("FORGE"),
  Type.Literal("IMAGINATION"),
  Type.Literal("RISK"),
  Type.Literal("STEWARDSHIP"),
  Type.Literal("MEANING"),
  Type.Literal("CLARITY"),
  Type.Literal("INSIGHT"),
  Type.Literal("GROUNDING"),
  Type.Literal("CONVERGENCE"),
  Type.Literal("PRAXIS"),
], { description: "IAM governance rune to annotate the Omega run." });

const omegaPhaseUnitTypeSchema = Type.Union([
  Type.Literal("research-milestone"),
  Type.Literal("plan-milestone"),
  Type.Literal("research-slice"),
  Type.Literal("plan-slice"),
  Type.Literal("refine-slice"),
  Type.Literal("replan-slice"),
], { description: "Optional governed phase unit type for phase artifact persistence." });

const omegaStageSchema = Type.Union([
  Type.Literal("materiality"),
  Type.Literal("vitality"),
  Type.Literal("interiority"),
  Type.Literal("criticality"),
  Type.Literal("connectivity"),
  Type.Literal("lucidity"),
  Type.Literal("necessity"),
  Type.Literal("reciprocity"),
  Type.Literal("totality"),
  Type.Literal("continuity"),
], { description: "Canonical Omega stage name." });

const omegaRuntimeParameters = {
  persona: Type.Optional(omegaPersonaSchema),
  runes: Type.Optional(Type.Array(omegaRuneSchema, { maxItems: 3, description: "Optional IAM governance runes to annotate the run (max 3)." })),
  unitType: Type.Optional(omegaPhaseUnitTypeSchema),
  unitId: Type.Optional(Type.String({ description: "Optional governed phase unit id, e.g. M001 or M001/S01." })),
  targetArtifactPath: Type.Optional(Type.String({ description: "Optional governed phase artifact path (required with unitType/unitId for phase persistence)." })),
};

const volvoxQueryParameters = {
  volvoxCellType: Type.Optional(volvoxCellTypeSchema),
  volvoxLifecyclePhase: Type.Optional(volvoxLifecyclePhaseSchema),
  propagationEligible: Type.Optional(Type.Boolean({ description: "Filter by VOLVOX propagation eligibility." })),
  includeDormant: Type.Optional(Type.Boolean({ description: "When false, exclude dormant/archived VOLVOX rows." })),
};

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
  const ctx = pi as unknown as ExtensionContext;
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
      ...volvoxQueryParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMRecall, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      ...volvoxQueryParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMQuick, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMRefract, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
    },
  };
  pi.registerTool(refractTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, refractTool, "gsd_refract", "hammer_refract");

  const spiralTool = {
    name: "hammer_spiral",
    label: "IAM Spiral",
    description: "Execute and persist a native Hammer Omega spiral over a query.",
    promptSnippet: "Run an Omega spiral over a query",
    promptGuidelines: ["Use hammer_spiral to execute an Omega spiral and return durable run diagnostics."],
    parameters: Type.Object({
      query: Type.String({ description: "Topic or question for the spiral" }),
      stages: Type.Optional(Type.Array(omegaStageSchema, { maxItems: 10, description: "Optional ordered Omega stage names; defaults to the canonical ten-stage order." })),
      ...omegaRuntimeParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMSpiral, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
    },
  };
  pi.registerTool(spiralTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, spiralTool, "gsd_spiral", "hammer_spiral");

  const canonicalSpiralTool = {
    name: "hammer_canonical_spiral",
    label: "IAM Canonical Spiral",
    description: "Execute and persist the canonical ten-stage native Hammer Omega spiral over a query.",
    promptSnippet: "Run a canonical Omega spiral over a query",
    promptGuidelines: ["Use hammer_canonical_spiral for the full ten-stage Omega Protocol with durable artifacts and run diagnostics."],
    parameters: Type.Object({
      query: Type.String({ description: "Topic or question for the canonical spiral" }),
      ...omegaRuntimeParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMCanonicalSpiral, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      ...volvoxQueryParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMExplore, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMBridge, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMCompare, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      ...volvoxQueryParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMCluster, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      ...volvoxQueryParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMLandscape, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      ...volvoxQueryParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMTension, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      return runIAMTool(executeIAMRune, buildAdapters(false, { ctx, basePath: process.cwd() }), params);
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
      return runIAMTool(executeIAMValidate, buildAdapters(false, { ctx, basePath: process.cwd() }), params);
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
      return runIAMTool(executeIAMAssess, buildAdapters(false, { ctx, basePath: process.cwd() }), params);
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
      return runIAMTool(executeIAMCompile, buildAdapters(false, { ctx, basePath: process.cwd() }), params);
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
      ...volvoxQueryParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMHarvest, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMRemember, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
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
      ...volvoxQueryParameters,
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMProvenance, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
    },
  };
  pi.registerTool(provenanceTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, provenanceTool, "gsd_provenance", "hammer_provenance");

  const volvoxEpochTool = {
    name: "hammer_volvox_epoch",
    label: "IAM VOLVOX Epoch",
    description: "Run or dry-run the Hammer VOLVOX lifecycle epoch over memory rows.",
    promptSnippet: "Run a VOLVOX lifecycle epoch",
    promptGuidelines: ["Use hammer_volvox_epoch to update or dry-run lifecycle classification. Inspect hammer_volvox_diagnose if diagnostics block the epoch."],
    parameters: Type.Object({
      trigger: Type.Optional(Type.String({ description: "Epoch trigger label (default manual)." })),
      dryRun: Type.Optional(Type.Boolean({ description: "When true, compute but do not persist lifecycle changes." })),
      thresholds: Type.Optional(volvoxThresholdsSchema),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMVolvoxEpoch, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
    },
  };
  pi.registerTool(volvoxEpochTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, volvoxEpochTool, "gsd_volvox_epoch", "hammer_volvox_epoch");

  const volvoxStatusTool = {
    name: "hammer_volvox_status",
    label: "IAM VOLVOX Status",
    description: "Read latest VOLVOX epoch status, memory lifecycle summary, and diagnostics.",
    promptSnippet: "Inspect VOLVOX lifecycle status",
    promptGuidelines: ["Use hammer_volvox_status to inspect latest epoch state without dumping raw audit JSON."],
    parameters: Type.Object({}),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMVolvoxStatus, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
    },
  };
  pi.registerTool(volvoxStatusTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, volvoxStatusTool, "gsd_volvox_status", "hammer_volvox_status");

  const volvoxDiagnoseTool = {
    name: "hammer_volvox_diagnose",
    label: "IAM VOLVOX Diagnose",
    description: "Return structured VOLVOX diagnostics, optionally scoped to a memory id.",
    promptSnippet: "Inspect VOLVOX lifecycle diagnostics",
    promptGuidelines: ["Use hammer_volvox_diagnose when epoch/status reports blocking or malformed lifecycle diagnostics."],
    parameters: Type.Object({
      memoryId: Type.Optional(Type.String({ description: "Optional memory id to filter diagnostics." })),
      includeInfo: Type.Optional(Type.Boolean({ description: "Include informational diagnostics; default false." })),
    }),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMVolvoxDiagnose, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
    },
  };
  pi.registerTool(volvoxDiagnoseTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, volvoxDiagnoseTool, "gsd_volvox_diagnose", "hammer_volvox_diagnose");

  const checkTool = {
    name: "hammer_check",
    label: "IAM Check",
    description: "Report the IAM tool catalog, kernel version, and Hammer DB availability.",
    promptSnippet: "Check IAM awareness tool availability",
    promptGuidelines: ["Use hammer_check to verify the native IAM awareness tool surface is registered."],
    parameters: Type.Object({}),
    async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const basePath = process.cwd();
      const dbAvailable = await ensureDbOpen(basePath);
      return runIAMTool(executeIAMCheck, buildAdapters(!!dbAvailable, { ctx, basePath }), params);
    },
  };
  pi.registerTool(checkTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, checkTool, "gsd_check", "hammer_check");
}
