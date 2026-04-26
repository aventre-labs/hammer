/**
 * src/tests/hammer-iam-omega-contract.test.ts
 *
 * Contract tests for the Omega Protocol engine (omega.ts).
 * All assertions cover the canonical ten-stage definition, prompt building,
 * and full / partial spiral execution via a stub executor.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  OMEGA_STAGES,
  getOmegaStage,
  buildStagePrompt,
  executeOmegaSpiral,
} from "../../src/iam/omega.js";

// ── Stage definition contract ───────────────────────────────────────────────

test("OMEGA_STAGES has exactly 10 stages", () => {
  assert.equal(OMEGA_STAGES.length, 10);
});

test("Stage names match canonical order", () => {
  const expected = [
    "materiality",
    "vitality",
    "interiority",
    "criticality",
    "connectivity",
    "lucidity",
    "necessity",
    "reciprocity",
    "totality",
    "continuity",
  ];
  assert.deepEqual(
    OMEGA_STAGES.map((s) => s.stageName),
    expected,
  );
});

test("Each stage has a non-empty runeName", () => {
  for (const stage of OMEGA_STAGES) {
    assert.ok(
      stage.runeName.length > 0,
      `Stage ${stage.stageName} has empty runeName`,
    );
  }
});

test("Each stage archetypePromptTemplate contains {query} and {previous_output}", () => {
  for (const stage of OMEGA_STAGES) {
    assert.ok(
      stage.archetypePromptTemplate.includes("{query}"),
      `Stage ${stage.stageName} missing {query} placeholder`,
    );
    assert.ok(
      stage.archetypePromptTemplate.includes("{previous_output}"),
      `Stage ${stage.stageName} missing {previous_output} placeholder`,
    );
  }
});

test("Stage numbers are 1–10 in order", () => {
  for (let i = 0; i < OMEGA_STAGES.length; i++) {
    assert.equal(OMEGA_STAGES[i].stageNumber, i + 1);
  }
});

// ── buildStagePrompt ────────────────────────────────────────────────────────

test("buildStagePrompt substitutes query into the prompt", () => {
  const stage = getOmegaStage("materiality");
  assert.ok(stage, "materiality stage not found");
  const prompt = buildStagePrompt(stage, "test query");
  assert.ok(
    prompt.includes("test query"),
    "prompt does not contain the query text",
  );
});

test("buildStagePrompt with persona returns different output than without persona", () => {
  const stage = getOmegaStage("materiality");
  assert.ok(stage);
  const without = buildStagePrompt(stage, "the same query");
  const with_persona = buildStagePrompt(stage, "the same query", "", "engineer");
  assert.notEqual(without, with_persona);
});

// ── Full spiral with stub executor ──────────────────────────────────────────

test("Full executeOmegaSpiral with stub executor returns ok:true with 10 stage results", async () => {
  const stub = () => Promise.resolve("stub response");
  const result = await executeOmegaSpiral({
    query: "test spiral",
    executor: stub,
  });
  assert.ok(result.ok, "expected ok:true");
  assert.equal(result.value.status, "complete");
  assert.equal(result.value.stageResults.length, 10);
});

test("Partial subset: stages ['materiality', 'vitality'] runs exactly 2 stages", async () => {
  const stub = () => Promise.resolve("stub response");
  const result = await executeOmegaSpiral({
    query: "partial test",
    executor: stub,
    stages: ["materiality", "vitality"],
  });
  assert.ok(result.ok, "expected ok:true");
  assert.equal(result.value.stageResults.length, 2);
});

test("Failing executor returns ok:false with iamErrorKind omega-stage-failed", async () => {
  const stub = () => Promise.reject(new Error("executor failure"));
  const result = await executeOmegaSpiral({
    query: "failing test",
    executor: stub,
  });
  assert.ok(!result.ok, "expected ok:false");
  assert.equal(result.error.iamErrorKind, "omega-stage-failed");
});
