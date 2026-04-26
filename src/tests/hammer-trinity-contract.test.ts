/**
 * src/tests/hammer-trinity-contract.test.ts
 *
 * Contract tests for pure Trinity metadata helpers. These tests intentionally
 * import only src/iam modules so the IAM kernel stays independent from the
 * extension-tree database/runtime substrate.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  TRINITY_LAYERS,
  VALID_TRINITY_VALIDATION_STATES,
  buildDefaultTrinityMetadata,
  clampTrinityScore,
  normalizeTrinityLayer,
  normalizeTrinityMetadata,
  parseTrinityJson,
  serializeTrinityJson,
  trinityVectorDot,
} from "../../src/iam/trinity.js";
import type { TrinitySourceRelation } from "../../src/iam/trinity.js";

test("Trinity layer contract exposes Social / Knowledge / Generative layers", () => {
  assert.deepEqual(TRINITY_LAYERS, ["social", "knowledge", "generative"]);
  assert.equal(normalizeTrinityLayer("SOCIAL"), "social");
  assert.equal(normalizeTrinityLayer("Knowledge"), "knowledge");
  assert.equal(normalizeTrinityLayer("generative"), "generative");
  assert.equal(normalizeTrinityLayer("invalid"), "knowledge");
});

test("category defaults map legacy memory categories onto deterministic layers", () => {
  assert.equal(buildDefaultTrinityMetadata({ category: "preference" }).layer, "social");
  assert.equal(buildDefaultTrinityMetadata({ category: "environment" }).layer, "knowledge");
  assert.equal(buildDefaultTrinityMetadata({ category: "pattern" }).layer, "generative");
  assert.equal(buildDefaultTrinityMetadata({ category: "unknown" }).layer, "knowledge");
});

test("buildDefaultTrinityMetadata preserves source relation provenance", () => {
  const metadata = buildDefaultTrinityMetadata({
    category: "architecture",
    sourceUnitType: "milestone",
    sourceUnitId: "M001/S04",
    sourceRelations: [
      { type: "derived_from", targetId: "M001-CONTEXT", targetKind: "artifact", weight: 2 },
      { type: "invalid", targetId: "", targetKind: "artifact", weight: -1 } as unknown as TrinitySourceRelation,
    ],
    provenance: { sourceId: "ctx-001", artifactPath: ".hammer/milestones/M001/M001-CONTEXT.md" },
  });

  assert.equal(metadata.layer, "knowledge");
  assert.deepEqual(metadata.provenance, {
    sourceUnitType: "milestone",
    sourceUnitId: "M001/S04",
    sourceId: "ctx-001",
    artifactPath: ".hammer/milestones/M001/M001-CONTEXT.md",
    sourceRelations: [{ type: "derived_from", targetId: "M001-CONTEXT", targetKind: "artifact", weight: 1 }],
  });
});

test("normalizeTrinityMetadata clamps vectors and validation scores without throwing", () => {
  const metadata = normalizeTrinityMetadata({
    layer: "nonsense",
    ity: { factuality: 1.5, invalidity: "bad", continuity: -0.5, creativity: 0.25 },
    pathy: ["not", "an", "object"],
    provenance: { sourceRelations: [{ type: "observed_in", targetId: "MEM001", weight: 0 }] },
    validation: { state: "weird", score: 9 },
  });

  assert.equal(metadata.layer, "knowledge");
  assert.deepEqual(metadata.ity, { factuality: 1, continuity: 0, creativity: 0.25 });
  assert.deepEqual(metadata.pathy, {});
  assert.deepEqual(metadata.provenance.sourceRelations, [{ type: "observed_in", targetId: "MEM001", weight: 0 }]);
  assert.deepEqual(metadata.validation, { state: "unvalidated", score: 1 });
});

test("normalizeTrinityMetadata accepts boundary validation scores 0 and 1", () => {
  for (const state of VALID_TRINITY_VALIDATION_STATES) {
    const zero = normalizeTrinityMetadata({ validation: { state, score: 0 } });
    const one = normalizeTrinityMetadata({ validation: { state, score: 1 } });
    assert.equal(zero.validation.state, state);
    assert.equal(zero.validation.score, 0);
    assert.equal(one.validation.state, state);
    assert.equal(one.validation.score, 1);
  }
});

test("Trinity JSON helpers tolerate malformed and non-object payloads", () => {
  assert.deepEqual(parseTrinityJson("not-json"), {});
  assert.deepEqual(parseTrinityJson("[]"), {});
  assert.deepEqual(parseTrinityJson(null), {});
  assert.equal(serializeTrinityJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test("vector scoring drops invalid keys and clamps numeric values", () => {
  assert.equal(clampTrinityScore(Number.NaN), 0);
  assert.equal(clampTrinityScore(-1), 0);
  assert.equal(clampTrinityScore(2), 1);
  assert.equal(clampTrinityScore(0.34567), 0.3457);

  const score = trinityVectorDot(
    { factuality: 1, continuity: 0.5, bogus: 1 },
    { factuality: 0.5, continuity: 2, empathy: 1 },
  );
  assert.equal(score, 1);
});
