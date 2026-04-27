/**
 * src/tests/hammer-iam-tools.test.ts
 *
 * Unit tests for the pure IAM public tool executor surface (tools.ts).
 * All database and graph behavior is supplied through stub adapters; these
 * tests never open a real Hammer database.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  executeIAMRecall, executeIAMQuick, executeIAMRefract,
  executeIAMRemember, executeIAMHarvest, executeIAMCluster,
  executeIAMLandscape, executeIAMBridge, executeIAMCompare,
  executeIAMProvenance, executeIAMExplore, executeIAMTension,
  executeIAMRune, executeIAMValidate, executeIAMAssess,
  executeIAMCompile, executeIAMCheck, executeIAMSpiral,
  executeIAMCanonicalSpiral, executeIAMVolvoxEpoch,
  executeIAMVolvoxStatus, executeIAMVolvoxDiagnose,
} from "../../src/iam/tools.js";
import type { TrinityMetadata } from "../../src/iam/trinity.js";
import type { IAMError, IAMResult, IAMToolAdapters, IAMToolOutput, OmegaRun } from "../../src/iam/types.js";

// ── Shared stubs ─────────────────────────────────────────────────────────────

const TRINITY_A: TrinityMetadata = {
  layer: "knowledge",
  ity: { factuality: 0.9, stability: 0.8 },
  pathy: { empathy: 0.1 },
  provenance: {
    sourceUnitType: "task",
    sourceUnitId: "M001/S04/T01",
    sourceRelations: [{ type: "derived_from", targetId: "SRC-1", targetKind: "summary", weight: 0.8 }],
  },
  validation: { state: "validated", score: 0.9 },
};

const TRINITY_B: TrinityMetadata = {
  layer: "social",
  ity: { risk: 0.95, stability: 0.1 },
  pathy: { risk: 0.1, reciprocity: 0.2 },
  provenance: {
    sourceUnitType: "task",
    sourceUnitId: "M001/S04/T02",
    sourceRelations: [{ type: "contradicts", targetId: "m001", targetKind: "memory", weight: 0.7 }],
  },
  validation: { state: "contested", score: 0.25 },
};

const MEM_A = {
  id: "m001",
  content: "hammer is aware",
  score: 0.9,
  category: "architecture",
  trinity: TRINITY_A,
  volvox: {
    cellType: "GERMLINE" as const,
    roleStability: 0.85,
    lifecyclePhase: "mature" as const,
    propagationEligible: true,
    lastEpochId: "epoch-1",
    lastEpochAt: "2026-04-27T00:00:00.000Z",
  },
};
const MEM_B = {
  id: "m002",
  content: "IAM governs",
  score: 0.7,
  category: "convention",
  trinity: TRINITY_B,
  volvox: {
    cellType: "DORMANT" as const,
    roleStability: 0.2,
    lifecyclePhase: "dormant" as const,
    propagationEligible: false,
  },
};

const ACTIVE_MEM_A = { ...MEM_A, confidence: 0.9 };
const ACTIVE_MEM_B = { ...MEM_B, confidence: 0.7 };

const EXPECTED_TOOL_NAMES = [
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

const stubVolvoxEpoch = {
  epochId: "volvox-test-epoch",
  status: "completed" as const,
  trigger: "manual",
  startedAt: "2026-04-27T00:00:00.000Z",
  completedAt: "2026-04-27T00:00:00.000Z",
  thresholds: {
    activationRate: 0.5,
    offspringCount: 3,
    crossLayerConnections: 3,
    connectionDensity: 5,
    dormancyCycles: 10,
    dormantArchiveCycles: 30,
    stableRole: 0.9,
    propagationStability: 0.8,
  },
  thresholdsJson: JSON.stringify({
    activationRate: 0.5,
    offspringCount: 3,
    crossLayerConnections: 3,
    connectionDensity: 5,
    dormancyCycles: 10,
    dormantArchiveCycles: 30,
    stableRole: 0.9,
    propagationStability: 0.8,
  }),
  phases: ["normalize", "classify", "stabilize", "propagate", "diagnose"] as const,
  records: [],
  diffs: [],
  diagnostics: [],
  diagnosticsJson: "[]",
  counts: {
    processed: 0,
    changed: 0,
    diagnostics: 0,
    blockingDiagnostics: 0,
    byCellType: {
      UNDIFFERENTIATED: 0,
      SOMATIC_SENSOR: 0,
      SOMATIC_MOTOR: 0,
      STRUCTURAL: 0,
      GERMLINE: 0,
      DORMANT: 0,
    },
    propagationEligible: 0,
    archived: 0,
  },
};


function makeOmegaRun(overrides: Partial<OmegaRun> = {}): OmegaRun {
  return {
    id: "omega-run-001",
    query: "What is Hammer?",
    runes: [],
    stages: ["materiality", "vitality", "interiority", "criticality", "connectivity", "lucidity", "necessity", "reciprocity", "totality", "continuity"],
    stageResults: Array.from({ length: 10 }, (_value, index) => ({
      stage: {
        stageName: ["materiality", "vitality", "interiority", "criticality", "connectivity", "lucidity", "necessity", "reciprocity", "totality", "continuity"][index] as OmegaRun["stages"][number],
        stageNumber: index + 1,
        runeName: "TEST",
        archetypeName: "Test Archetype",
        phaseLabel: "Test Phase",
        archetypePromptTemplate: "Test {query} {previous_output}",
      },
      prompt: `prompt ${index + 1}`,
      response: `response ${index + 1}`,
      completedAt: "2026-04-27T00:00:00.000Z",
    })),
    status: "complete",
    synthesis: "Native Omega synthesis",
    createdAt: "2026-04-27T00:00:00.000Z",
    completedAt: "2026-04-27T00:01:00.000Z",
    ...overrides,
  };
}

const stubVolvoxDiagnostic = {
  epochId: "volvox-test-epoch",
  memoryId: "m002",
  code: "false-germline" as const,
  severity: "blocking" as const,
  phase: "diagnose" as const,
  message: "Somatic memory claimed propagation eligibility.",
  remediation: "Run hammer_volvox_diagnose and clear propagation eligibility before retrying the epoch.",
  timestamp: "2026-04-27T00:00:00.000Z",
  metadata: { cellType: "SOMATIC_SENSOR" },
};

const stubAdapters: IAMToolAdapters = {
  isDbAvailable: () => true,
  queryMemories: (_q, k = 10, category, options) =>
    [MEM_A, MEM_B]
      .filter((memory) => !category || memory.category === category)
      .filter((memory) => !options?.trinityLayer || memory.trinity.layer === options.trinityLayer)
      .filter((memory) => !options?.volvoxCellType || memory.volvox.cellType === options.volvoxCellType)
      .filter((memory) => !options?.volvoxLifecyclePhase || memory.volvox.lifecyclePhase === options.volvoxLifecyclePhase)
      .filter((memory) => options?.propagationEligible === undefined || memory.volvox.propagationEligible === options.propagationEligible)
      .filter((memory) => options?.includeDormant !== false || memory.volvox.cellType !== "DORMANT")
      .slice(0, k),
  getActiveMemories: (limit = 30) => [ACTIVE_MEM_A, ACTIVE_MEM_B].slice(0, limit),
  createMemory: (fields) => `created-${fields.category}-001`,
  traverseGraph: (startId) => ({
    nodes: [{
      id: startId,
      category: "architecture",
      content: "test node",
      confidence: 0.8,
      trinity: TRINITY_A,
      volvox: MEM_A.volvox,
      provenanceSummary: {
        sourceUnitType: "task",
        sourceUnitId: "M001/S04/T01",
        sourceRelationCount: 1,
        sourceRelations: TRINITY_A.provenance.sourceRelations,
      },
    }],
    edges: [{ fromId: startId, toId: "m999", relation: "related_to" }],
  }),
  runVolvoxEpoch: (options) => ({
    ...stubVolvoxEpoch,
    trigger: options?.trigger ?? stubVolvoxEpoch.trigger,
  }),
  getVolvoxStatus: () => ({ latestEpoch: stubVolvoxEpoch, memories: [MEM_A], diagnostics: [stubVolvoxDiagnostic] }),
  diagnoseVolvox: () => ({ diagnostics: [stubVolvoxDiagnostic], blocking: [stubVolvoxDiagnostic] }),
  runOmega: async (options) => ({
    ok: true,
    value: {
      run: makeOmegaRun({ query: options.query, stages: options.stages, persona: options.persona, runes: options.runes ?? [] }),
      artifactDir: "/tmp/hammer/omega/tools/omega-run-001",
      runManifestPath: "/tmp/hammer/omega/tools/omega-run-001/run-manifest.json",
      synthesisPath: "/tmp/hammer/omega/tools/omega-run-001/synthesis.md",
      phaseManifestPath: options.unitType ? "/tmp/hammer/omega/phases/research-milestone/M001/omega-run-001/phase-manifest.json" : undefined,
      targetArtifactPath: options.targetArtifactPath,
      persistenceStatus: "complete",
    },
  }),
};

const noDbAdapters: IAMToolAdapters = {
  ...stubAdapters,
  isDbAvailable: () => false,
};

const nullCreateAdapters: IAMToolAdapters = {
  ...stubAdapters,
  createMemory: () => null,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function assertOk(result: IAMResult<IAMToolOutput>, context: string): IAMToolOutput {
  if (!result.ok) {
    assert.fail(`${context}: expected ok:true, got ${result.error.iamErrorKind}`);
  }
  return result.value;
}

function assertError(
  result: IAMResult<IAMToolOutput>,
  expectedKind: IAMError["iamErrorKind"],
  context: string,
): IAMError {
  if (result.ok) {
    assert.fail(`${context}: expected ok:false, got ${result.value.kind}`);
  }
  assert.equal(result.error.iamErrorKind, expectedKind);
  assert.equal(typeof result.error.remediation, "string");
  assert.ok(result.error.remediation.length > 0, `${context}: remediation should be non-empty`);
  return result.error;
}

function assertKind<K extends IAMToolOutput["kind"]>(
  output: IAMToolOutput,
  kind: K,
): Extract<IAMToolOutput, { kind: K }> {
  assert.equal(output.kind, kind);
  return output as Extract<IAMToolOutput, { kind: K }>;
}

// ── Group A: Memory tools happy paths ───────────────────────────────────────

test("executeIAMRecall returns a memory-list with queried entries", async () => {
  const output = assertKind(
    assertOk(await executeIAMRecall(stubAdapters, { query: "hammer", k: 2 }), "recall"),
    "memory-list",
  );

  assert.equal(output.memories.length, 2);
  assert.deepEqual(output.memories[0], MEM_A);
  assert.deepEqual(output.memories[1], MEM_B);
});

test("executeIAMRecall passes category filtering through the adapter", async () => {
  const output = assertKind(
    assertOk(await executeIAMRecall(stubAdapters, { query: "hammer", category: "architecture" }), "recall category"),
    "memory-list",
  );

  assert.equal(output.memories.length, 1);
  assert.equal(output.memories[0].id, "m001");
  assert.equal(output.memories[0].category, "architecture");
});

test("executeIAMRecall passes Trinity layer/lens filters and normalizes returned metadata", async () => {
  let seenK: number | undefined;
  let seenLayer: string | undefined;
  let seenLens: unknown;
  const adapters: IAMToolAdapters = {
    ...stubAdapters,
    queryMemories: (_q, k = 10, _category, options) => {
      seenK = k;
      seenLayer = options?.trinityLayer;
      seenLens = options?.trinityLens;
      return [{
        ...MEM_A,
        trinity: {
          ...TRINITY_A,
          ity: { factuality: 2, bogus: 1 } as never,
          validation: { state: "not-real", score: 2 } as never,
        },
      }];
    },
  };

  const output = assertKind(
    assertOk(
      await executeIAMRecall(adapters, {
        query: "hammer",
        k: 500,
        trinityLayer: "knowledge",
        trinityLens: { ity: { factuality: 0.5, bogus: 1 }, pathy: { empathy: 0.3 } },
      }),
      "recall Trinity filters",
    ),
    "memory-list",
  );

  assert.equal(seenK, 100, "IAM executors clamp broad recall limits before adapter calls");
  assert.equal(seenLayer, "knowledge");
  assert.deepEqual(seenLens, { ity: { factuality: 0.5 }, pathy: { empathy: 0.3 } });
  assert.equal(output.memories[0].trinity?.ity.factuality, 1);
  assert.equal((output.memories[0].trinity?.ity as Record<string, unknown>).bogus, undefined);
  assert.deepEqual(output.memories[0].trinity?.validation, { state: "unvalidated", score: 1 });
});

test("executeIAMQuick returns at most one top memory", async () => {
  const output = assertKind(
    assertOk(await executeIAMQuick(stubAdapters, { query: "hammer" }), "quick"),
    "memory-list",
  );

  assert.equal(output.memories.length, 1);
  assert.equal(output.memories[0].id, "m001");
  assert.equal(output.memories[0].score, 0.9);
  assert.equal(output.memories[0].volvox?.cellType, "GERMLINE");
});

test("executeIAMRecall passes VOLVOX filters through the adapter and preserves metadata", async () => {
  let seenOptions: unknown;
  const adapters: IAMToolAdapters = {
    ...stubAdapters,
    queryMemories: (_q, _k, _category, options) => {
      seenOptions = options;
      return [MEM_A];
    },
  };

  const output = assertKind(
    assertOk(
      await executeIAMRecall(adapters, {
        query: "hammer",
        volvoxCellType: "germline",
        volvoxLifecyclePhase: "mature",
        propagationEligible: true,
        includeDormant: false,
      }),
      "recall VOLVOX filters",
    ),
    "memory-list",
  );

  assert.deepEqual(seenOptions, {
    volvoxCellType: "GERMLINE",
    volvoxLifecyclePhase: "mature",
    propagationEligible: true,
    includeDormant: false,
  });
  assert.equal(output.memories[0].volvox?.cellType, "GERMLINE");
  assert.equal(output.memories[0].volvox?.propagationEligible, true);
});

test("executeIAMRecall rejects malformed VOLVOX filters with remediation", async () => {
  const error = assertError(
    await executeIAMRecall(stubAdapters, { query: "hammer", volvoxCellType: "not-a-cell" }),
    "persistence-failed",
    "recall bad VOLVOX filter",
  );

  assert.ok(error.remediation.includes("volvoxCellType"));
});

test("executeIAMRefract reflects the requested lens in memory content", async () => {
  const output = assertKind(
    assertOk(await executeIAMRefract(stubAdapters, { query: "hammer", lens: "skeptic" }), "refract"),
    "memory-list",
  );

  assert.equal(output.memories.length, 2);
  assert.ok(output.memories[0].content.startsWith("[skeptic lens]"));
  assert.ok(output.memories[1].content.includes("IAM governs"));
});

test("executeIAMRemember creates a memory-created output with a persisted id", async () => {
  const output = assertKind(
    assertOk(
      await executeIAMRemember(stubAdapters, {
        category: "architecture",
        content: "IAM stays pure",
        confidence: 0.95,
      }),
      "remember",
    ),
    "memory-created",
  );

  assert.equal(output.id, "created-architecture-001");
  assert.equal(output.category, "architecture");
  assert.equal(output.content, "IAM stays pure");
});

test("executeIAMRemember persists explicit Trinity metadata and returns the normalized payload", async () => {
  let createdFields: Parameters<IAMToolAdapters["createMemory"]>[0] | null = null;
  const adapters: IAMToolAdapters = {
    ...stubAdapters,
    createMemory: (fields) => {
      createdFields = fields;
      return "created-trinity-001";
    },
  };

  const output = assertKind(
    assertOk(
      await executeIAMRemember(adapters, {
        category: "pattern",
        content: "Use Trinity-aware IAM tools",
        confidence: 0.88,
        trinityLayer: "generative",
        trinityIty: { creativity: 2, unknown: 1 },
        trinityPathy: { reciprocity: 0.6 },
        trinityProvenance: { sourceUnitId: "M001/S04/T03", sourceRelations: [{ type: "derived_from", targetId: "T03-PLAN" }] },
        trinityValidationState: "contested",
        trinityValidationScore: 0.4,
      }),
      "remember Trinity metadata",
    ),
    "memory-created",
  );

  assert.equal(output.id, "created-trinity-001");
  assert.equal(output.trinity?.layer, "generative");
  assert.deepEqual(output.trinity?.ity, { creativity: 1 });
  assert.deepEqual(output.trinity?.pathy, { reciprocity: 0.6 });
  assert.deepEqual(output.trinity?.validation, { state: "contested", score: 0.4 });
  assert.equal(createdFields?.trinity?.layer, "generative");
  assert.equal(createdFields?.trinity?.provenance.sourceUnitId, "M001/S04/T03");
});

test("executeIAMHarvest returns active memories with a category summary prefix", async () => {
  const output = assertKind(
    assertOk(await executeIAMHarvest(stubAdapters, { limit: 2 }), "harvest"),
    "memory-list",
  );

  assert.equal(output.memories.length, 2);
  assert.equal(output.memories[0].score, 0.9);
  assert.ok(output.memories[0].content.includes("[harvest total=2; categories=architecture:1,convention:1]"));
  assert.ok(output.memories[1].content.includes("IAM governs"));
});

test("executeIAMHarvest filters active memories by category", async () => {
  const output = assertKind(
    assertOk(await executeIAMHarvest(stubAdapters, { category: "convention" }), "harvest category"),
    "memory-list",
  );

  assert.equal(output.memories.length, 1);
  assert.equal(output.memories[0].id, "m002");
  assert.equal(output.memories[0].category, "convention");
});

test("executeIAMCluster returns a knowledge-map with totals by category", async () => {
  const output = assertKind(
    assertOk(await executeIAMCluster(stubAdapters, { query: "iam", k: 2 }), "cluster"),
    "knowledge-map",
  );

  assert.equal(output.total, 2);
  assert.equal(output.categories.architecture, 1);
  assert.equal(output.categories.convention, 1);
  assert.deepEqual(output.layers, { knowledge: 1, social: 1 });
});

test("executeIAMLandscape maps the active memory category landscape", async () => {
  const output = assertKind(
    assertOk(await executeIAMLandscape(stubAdapters, { limit: 2 }), "landscape"),
    "knowledge-map",
  );

  assert.equal(output.total, 2);
  assert.deepEqual(output.categories, { architecture: 1, convention: 1 });
  assert.deepEqual(output.layers, { knowledge: 1, social: 1 });
});

test("executeIAMBridge merges memories from two query sides without duplicates", async () => {
  const output = assertKind(
    assertOk(await executeIAMBridge(stubAdapters, { queryA: "hammer", queryB: "iam", k: 2 }), "bridge"),
    "memory-list",
  );

  assert.equal(output.memories.length, 2);
  assert.deepEqual(output.memories.map((memory) => memory.id), ["m001", "m002"]);
  assert.equal(new Set(output.memories.map((memory) => memory.id)).size, 2);
});

test("executeIAMCompare labels memories from each side of the comparison", async () => {
  const output = assertKind(
    assertOk(await executeIAMCompare(stubAdapters, { queryA: "hammer", queryB: "iam", k: 2 }), "compare"),
    "memory-list",
  );

  assert.equal(output.memories.length, 4);
  assert.deepEqual(output.memories.map((memory) => memory.id), ["A:m001", "A:m002", "B:m001", "B:m002"]);
  assert.ok(output.memories[0].content.startsWith("[A:hammer]"));
  assert.ok(output.memories[2].content.startsWith("[B:iam]"));
});

test("executeIAMProvenance walks graph provenance from a memory id", async () => {
  const output = assertKind(
    assertOk(await executeIAMProvenance(stubAdapters, { memoryId: "m001", depth: 3 }), "provenance"),
    "graph-walk",
  );

  assert.equal(output.nodes.length, 1);
  assert.equal(output.nodes[0].id, "m001");
  assert.equal(output.nodes[0].trinity?.layer, "knowledge");
  assert.equal(output.nodes[0].volvox?.cellType, "GERMLINE");
  assert.equal(output.nodes[0].volvox?.propagationEligible, true);
  assert.equal(output.nodes[0].provenanceSummary?.sourceUnitId, "M001/S04/T01");
  assert.equal(output.nodes[0].provenanceSummary?.sourceRelationCount, 1);
  assert.equal(output.edges.length, 1);
  assert.equal(output.edges[0].relation, "related_to");
});

test("executeIAMProvenance rejects missing graph start ids with a structured error", async () => {
  const error = assertError(
    await executeIAMProvenance(stubAdapters, { memoryId: "   ", depth: 1 }),
    "persistence-failed",
    "provenance missing id",
  );

  assert.ok(error.remediation.includes("memoryId"));
});

test("executeIAMExplore clamps traversal depth before calling the adapter", async () => {
  let seenDepth: number | undefined;
  const adapters: IAMToolAdapters = {
    ...stubAdapters,
    traverseGraph: (startId, depth = 2) => {
      seenDepth = depth;
      return stubAdapters.traverseGraph(startId, depth);
    },
  };

  const output = assertKind(
    assertOk(await executeIAMExplore(adapters, { memoryId: "m002", depth: 99 }), "explore depth clamp"),
    "graph-walk",
  );

  assert.equal(seenDepth, 5);
  assert.equal(output.nodes[0].id, "m002");
});

test("executeIAMExplore walks graph edges from a memory id", async () => {
  const output = assertKind(
    assertOk(await executeIAMExplore(stubAdapters, { memoryId: "m002", depth: 2 }), "explore"),
    "graph-walk",
  );

  assert.equal(output.nodes[0].id, "m002");
  assert.equal(output.nodes[0].content, "test node");
  assert.deepEqual(output.edges[0], { fromId: "m002", toId: "m999", relation: "related_to" });
});

test("executeIAMTension ranks contested and vector-opposed memories ahead of plain category hits", async () => {
  const output = assertKind(
    assertOk(await executeIAMTension(stubAdapters, { query: "risk", k: 2 }), "tension"),
    "memory-list",
  );

  assert.equal(output.memories.length, 2);
  assert.equal(output.memories[0].id, "m002");
  assert.ok(output.memories[0].content.startsWith("[tension score="));
  assert.match(output.memories[0].content, /contested|low-validation|vector-opposition/);
  assert.equal(output.memories[0].trinity?.validation.state, "contested");
  assert.ok(output.memories[1].content.includes("hammer is aware"));
});

test("executeIAMVolvoxEpoch delegates to the VOLVOX adapter and returns epoch diagnostics", async () => {
  let seenOptions: unknown;
  const adapters: IAMToolAdapters = {
    ...stubAdapters,
    runVolvoxEpoch: (options) => {
      seenOptions = options;
      return {
        ...stubVolvoxEpoch,
        status: "blocked",
        diagnostics: [stubVolvoxDiagnostic],
        diagnosticsJson: JSON.stringify([stubVolvoxDiagnostic]),
      };
    },
  };

  const output = assertKind(
    assertOk(await executeIAMVolvoxEpoch(adapters, { trigger: "manual-test", dryRun: true, thresholds: { activationRate: 0.6 } }), "volvox epoch"),
    "volvox-epoch",
  );

  assert.deepEqual(seenOptions, { trigger: "manual-test", dryRun: true, thresholds: { activationRate: 0.6 } });
  assert.equal(output.epoch.status, "blocked");
  assert.equal(output.epoch.diagnostics[0].code, "false-germline");
});

test("executeIAMVolvoxStatus delegates to the status adapter and preserves metadata", async () => {
  const output = assertKind(
    assertOk(await executeIAMVolvoxStatus(stubAdapters, {}), "volvox status"),
    "volvox-status",
  );

  assert.equal(output.epoch?.epochId, "volvox-test-epoch");
  assert.equal(output.memories[0].volvox?.cellType, "GERMLINE");
  assert.equal(output.diagnostics[0].memoryId, "m002");
});

test("executeIAMVolvoxDiagnose delegates to the diagnostics adapter", async () => {
  const output = assertKind(
    assertOk(await executeIAMVolvoxDiagnose(stubAdapters, { memoryId: "m002", includeInfo: true }), "volvox diagnose"),
    "volvox-diagnostics",
  );

  assert.equal(output.diagnostics.length, 1);
  assert.equal(output.blocking.length, 1);
  assert.equal(output.blocking[0].code, "false-germline");
});

// ── Group B: DB-unavailable and persistence-failure paths ───────────────────

test("executeIAMRecall returns a structured persistence-failed error when DB is unavailable", async () => {
  const error = assertError(
    await executeIAMRecall(noDbAdapters, { query: "hammer" }),
    "persistence-failed",
    "recall no DB",
  );

  assert.equal(error.persistenceStatus, "not-attempted");
});

test("executeIAMRemember returns a structured persistence-failed error when DB is unavailable", async () => {
  const error = assertError(
    await executeIAMRemember(noDbAdapters, { category: "architecture", content: "x" }),
    "persistence-failed",
    "remember no DB",
  );

  assert.equal(error.persistenceStatus, "not-attempted");
});

test("executeIAMHarvest returns a structured persistence-failed error when DB is unavailable", async () => {
  const error = assertError(
    await executeIAMHarvest(noDbAdapters, { limit: 1 }),
    "persistence-failed",
    "harvest no DB",
  );

  assert.equal(error.persistenceStatus, "not-attempted");
});

test("executeIAMRemember returns persistence-failed when createMemory cannot persist", async () => {
  const error = assertError(
    await executeIAMRemember(nullCreateAdapters, { category: "architecture", content: "x" }),
    "persistence-failed",
    "remember null id",
  );

  assert.equal(error.persistenceStatus, "not-attempted");
  assert.ok(error.remediation.includes("hammer_remember"));
});

test("VOLVOX tools return executor-not-wired when adapters omit lifecycle methods", async () => {
  const unwired: IAMToolAdapters = {
    queryMemories: stubAdapters.queryMemories,
    getActiveMemories: stubAdapters.getActiveMemories,
    createMemory: stubAdapters.createMemory,
    traverseGraph: stubAdapters.traverseGraph,
    isDbAvailable: stubAdapters.isDbAvailable,
  };

  for (const [name, result] of [
    ["hammer_volvox_epoch", await executeIAMVolvoxEpoch(unwired, { trigger: "manual" })],
    ["hammer_volvox_status", await executeIAMVolvoxStatus(unwired, {})],
    ["hammer_volvox_diagnose", await executeIAMVolvoxDiagnose(unwired, {})],
  ] as const) {
    const error = assertError(result, "executor-not-wired", name);
    assert.ok(error.remediation.includes(name));
  }
});

test("VOLVOX tools report DB unavailable before adapter execution", async () => {
  const error = assertError(
    await executeIAMVolvoxStatus(noDbAdapters, {}),
    "persistence-failed",
    "volvox status no db",
  );

  assert.equal(error.persistenceStatus, "not-attempted");
});

test("executeIAMVolvoxEpoch rejects malformed threshold payloads", async () => {
  const error = assertError(
    await executeIAMVolvoxEpoch(stubAdapters, { thresholds: "unsafe" }),
    "persistence-failed",
    "volvox bad thresholds",
  );

  assert.ok(error.remediation.includes("thresholds"));
});

// ── Group C: IAM governance tools ────────────────────────────────────────────

test("executeIAMRune returns the requested rune contract", async () => {
  const output = assertKind(
    assertOk(await executeIAMRune(stubAdapters, { runeName: "RIGOR" }), "rune valid"),
    "rune-contract",
  );

  assert.equal(output.rune.runeName, "RIGOR");
  assert.equal(typeof output.rune.obligation, "string");
  assert.ok(output.rune.obligation.length > 0);
});

test("executeIAMRune returns unknown-rune with remediation for invalid rune names", async () => {
  const error = assertError(
    await executeIAMRune(stubAdapters, { runeName: "NOT_A_RUNE" }),
    "unknown-rune",
    "rune invalid",
  );

  assert.ok(error.remediation.includes("RIGOR"));
  assert.equal(error.runeName, "NOT_A_RUNE");
});

test("executeIAMValidate returns contracts for valid rune names", async () => {
  const output = assertKind(
    assertOk(await executeIAMValidate(stubAdapters, { runeNames: ["RIGOR", "HUMAN"] }), "validate valid"),
    "rune-list",
  );

  assert.equal(output.runes.length, 2);
  assert.deepEqual(output.runes.map((rune) => rune.runeName), ["RIGOR", "HUMAN"]);
  assert.ok(output.runes.every((rune) => rune.exitCriteria.length > 0));
});

test("executeIAMValidate enforces the co-apply limit", async () => {
  const error = assertError(
    await executeIAMValidate(stubAdapters, { runeNames: ["RIGOR", "HUMAN", "FORGE", "IMAGINATION"] }),
    "rune-validation-failed",
    "validate co-apply limit",
  );

  assert.ok(error.remediation.includes("maximum of 3"));
});

test("executeIAMAssess produces a SAVESUCCESS report and scorecard", async () => {
  const output = assertKind(
    assertOk(
      await executeIAMAssess(stubAdapters, {
        text: "We should use evidence because users need a clear next action. The risk is documented, therefore the recommendation is grounded.",
        target: "clear IAM recommendation",
      }),
      "assess",
    ),
    "savesuccess-report",
  );

  assert.equal(typeof output.report, "string");
  assert.ok(output.report.length > 0);
  assert.equal(typeof output.success, "boolean");
  assert.deepEqual(Object.keys(output.scorecard).sort(), ["a", "c", "c2", "e", "e2", "s", "s2", "s3", "u", "v"]);
  assert.ok(output.scorecard.e >= 0 && output.scorecard.e <= 1);
});

test("executeIAMCompile returns all 12 governance rune contracts", async () => {
  const output = assertKind(
    assertOk(await executeIAMCompile(stubAdapters, {}), "compile"),
    "rune-list",
  );

  assert.equal(output.runes.length, 12);
  assert.equal(output.runes[0].runeName, "RIGOR");
  assert.equal(output.runes.at(-1)?.runeName, "PRAXIS");
  assert.ok(output.runes.every((rune) => rune.requiredSections.length > 0));
});

test("executeIAMCheck reports the native IAM catalog and DB availability", async () => {
  const output = assertKind(
    assertOk(await executeIAMCheck(stubAdapters, {}), "check"),
    "check-result",
  );

  assert.deepEqual(output.tools, [...EXPECTED_TOOL_NAMES]);
  assert.equal(output.tools.length, EXPECTED_TOOL_NAMES.length);
  assert.equal(new Set(output.tools).size, output.tools.length);
  assert.equal(output.tools.length, 22);
  assert.equal(typeof output.kernelVersion, "string");
  assert.ok(output.kernelVersion.length > 0);
  assert.equal(output.dbAvailable, true);
});

test("executeIAMCheck reports dbAvailable:false through the adapter", async () => {
  const output = assertKind(
    assertOk(await executeIAMCheck(noDbAdapters, {}), "check no DB"),
    "check-result",
  );

  assert.equal(output.dbAvailable, false);
  assert.deepEqual(output.tools, [...EXPECTED_TOOL_NAMES]);
});

// ── Group D: Native Omega spiral execution ─────────────────────────────────

test("executeIAMSpiral delegates to the injected native Omega runner and returns run diagnostics", async () => {
  let seenStages: string[] | undefined;
  const adapters: IAMToolAdapters = {
    ...stubAdapters,
    runOmega: async (options) => {
      seenStages = options.stages;
      return {
        ok: true,
        value: {
          run: makeOmegaRun({ query: options.query, stages: options.stages }),
          artifactDir: "/tmp/omega-run",
          runManifestPath: "/tmp/omega-run/run-manifest.json",
          synthesisPath: "/tmp/omega-run/synthesis.md",
          persistenceStatus: "complete",
        },
      };
    },
  };

  const output = assertKind(
    assertOk(await executeIAMSpiral(adapters, { query: "What is Hammer?", stages: ["materiality", "vitality"] }), "spiral"),
    "omega-run",
  );

  assert.deepEqual(seenStages, ["materiality", "vitality"]);
  assert.equal(output.runId, "omega-run-001");
  assert.equal(output.artifactDir, "/tmp/omega-run");
  assert.equal(output.runManifestPath, "/tmp/omega-run/run-manifest.json");
  assert.equal(output.synthesisPath, "/tmp/omega-run/synthesis.md");
  assert.equal(output.stageCount, 10);
  assert.equal(output.synthesis, "Native Omega synthesis");
  assert.equal(output.status, "complete");
  assert.equal(output.persistenceStatus, "complete");
});

test("executeIAMCanonicalSpiral always requests all ten canonical Omega stages", async () => {
  let seenStages: string[] | undefined;
  const adapters: IAMToolAdapters = {
    ...stubAdapters,
    runOmega: async (options) => {
      seenStages = options.stages;
      return {
        ok: true,
        value: {
          run: makeOmegaRun({ query: options.query, stages: options.stages }),
          artifactDir: "/tmp/phase-run",
          runManifestPath: "/tmp/phase-run/run-manifest.json",
          synthesisPath: "/tmp/phase-run/synthesis.md",
          phaseManifestPath: "/tmp/phase-run/phase-manifest.json",
          targetArtifactPath: "/tmp/M001-RESEARCH.md",
          persistenceStatus: "complete",
        },
      };
    },
  };

  const output = assertKind(
    assertOk(
      await executeIAMCanonicalSpiral(adapters, {
        query: "What is Hammer?",
        unitType: "research-milestone",
        unitId: "M001",
        targetArtifactPath: "/tmp/M001-RESEARCH.md",
      }),
      "canonical spiral",
    ),
    "omega-run",
  );

  assert.deepEqual(seenStages, ["materiality", "vitality", "interiority", "criticality", "connectivity", "lucidity", "necessity", "reciprocity", "totality", "continuity"]);
  assert.equal(output.manifestPath, "/tmp/phase-run/phase-manifest.json");
  assert.equal(output.target, "/tmp/M001-RESEARCH.md");
});

test("executeIAMSpiral returns executor-not-wired when no Omega runner adapter is installed", async () => {
  const unwired: IAMToolAdapters = {
    queryMemories: stubAdapters.queryMemories,
    getActiveMemories: stubAdapters.getActiveMemories,
    createMemory: stubAdapters.createMemory,
    traverseGraph: stubAdapters.traverseGraph,
    isDbAvailable: stubAdapters.isDbAvailable,
  };

  const error = assertError(
    await executeIAMSpiral(unwired, { query: "What is Hammer?" }),
    "executor-not-wired",
    "spiral unwired",
  );

  assert.equal(error.persistenceStatus, "not-attempted");
  assert.ok(error.remediation.includes("hammer_spiral"));
});

test("executeIAMSpiral rejects malformed input before calling the Omega runner", async () => {
  let called = false;
  const adapters: IAMToolAdapters = {
    ...stubAdapters,
    runOmega: async () => {
      called = true;
      return stubAdapters.runOmega!({ query: "x", stages: ["materiality"], canonical: false });
    },
  };

  const emptyQuery = assertError(
    await executeIAMSpiral(adapters, { query: "   " }),
    "persistence-failed",
    "spiral empty query",
  );
  assert.match(emptyQuery.validationGap ?? "", /query/);

  const badStage = assertError(
    await executeIAMSpiral(adapters, { query: "What is Hammer?", stages: ["not-a-stage"] }),
    "invalid-stage-sequence",
    "spiral bad stage",
  );
  assert.match(badStage.remediation, /materiality/);
  assert.equal(called, false);
});

test("executeIAMSpiral propagates persistence failures from the Omega runner", async () => {
  const adapters: IAMToolAdapters = {
    ...stubAdapters,
    runOmega: async () => ({
      ok: false,
      error: {
        iamErrorKind: "persistence-failed",
        remediation: "Phase manifest write failed.",
        persistenceStatus: "partial",
        target: "/tmp/phase-manifest.json",
      },
    }),
  };

  const error = assertError(
    await executeIAMSpiral(adapters, { query: "What is Hammer?" }),
    "persistence-failed",
    "spiral persistence failure",
  );

  assert.equal(error.persistenceStatus, "partial");
  assert.equal(error.target, "/tmp/phase-manifest.json");
});
