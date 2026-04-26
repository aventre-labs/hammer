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
  executeIAMCanonicalSpiral,
} from "../../src/iam/tools.js";
import type { IAMError, IAMResult, IAMToolAdapters, IAMToolOutput } from "../../src/iam/types.js";

// ── Shared stubs ─────────────────────────────────────────────────────────────

const MEM_A = { id: "m001", content: "hammer is aware", score: 0.9, category: "architecture" };
const MEM_B = { id: "m002", content: "IAM governs", score: 0.7, category: "convention" };

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
] as const;

const stubAdapters: IAMToolAdapters = {
  isDbAvailable: () => true,
  queryMemories: (_q, k = 10, category) =>
    [MEM_A, MEM_B]
      .filter((memory) => !category || memory.category === category)
      .slice(0, k),
  getActiveMemories: (limit = 30) => [ACTIVE_MEM_A, ACTIVE_MEM_B].slice(0, limit),
  createMemory: (fields) => `created-${fields.category}-001`,
  traverseGraph: (startId) => ({
    nodes: [{ id: startId, category: "architecture", content: "test node", confidence: 0.8 }],
    edges: [{ fromId: startId, toId: "m999", relation: "related_to" }],
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

test("executeIAMQuick returns at most one top memory", async () => {
  const output = assertKind(
    assertOk(await executeIAMQuick(stubAdapters, { query: "hammer" }), "quick"),
    "memory-list",
  );

  assert.equal(output.memories.length, 1);
  assert.equal(output.memories[0].id, "m001");
  assert.equal(output.memories[0].score, 0.9);
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
});

test("executeIAMLandscape maps the active memory category landscape", async () => {
  const output = assertKind(
    assertOk(await executeIAMLandscape(stubAdapters, { limit: 2 }), "landscape"),
    "knowledge-map",
  );

  assert.equal(output.total, 2);
  assert.deepEqual(output.categories, { architecture: 1, convention: 1 });
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
  assert.equal(output.edges.length, 1);
  assert.equal(output.edges[0].relation, "related_to");
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

test("executeIAMTension returns memories annotated as a heuristic tension scan", async () => {
  const output = assertKind(
    assertOk(await executeIAMTension(stubAdapters, { query: "risk", k: 2 }), "tension"),
    "memory-list",
  );

  assert.equal(output.memories.length, 2);
  assert.ok(output.memories[0].content.startsWith("[heuristic tension scan"));
  assert.ok(output.memories[1].content.includes("IAM governs"));
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
  assert.equal(output.tools.length, 19);
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

// ── Group D: Spiral deferred structured outputs ─────────────────────────────

test("executeIAMSpiral returns structured deferred guidance", async () => {
  const output = assertKind(
    assertOk(await executeIAMSpiral(stubAdapters, { query: "What is Hammer?", stages: ["materiality"] }), "spiral"),
    "spiral-deferred",
  );

  assert.equal(typeof output.reason, "string");
  assert.ok(output.reason.length > 0);
  assert.equal(typeof output.guidance, "string");
  assert.ok(output.guidance.length > 0);
  assert.ok(output.guidance.includes("S06"));
});

test("executeIAMCanonicalSpiral returns structured deferred guidance", async () => {
  const output = assertKind(
    assertOk(await executeIAMCanonicalSpiral(noDbAdapters, { query: "What is Hammer?" }), "canonical spiral"),
    "spiral-deferred",
  );

  assert.equal(typeof output.reason, "string");
  assert.ok(output.reason.length > 0);
  assert.equal(typeof output.guidance, "string");
  assert.ok(output.guidance.length > 0);
});
