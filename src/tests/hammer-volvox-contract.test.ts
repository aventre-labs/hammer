/**
 * src/tests/hammer-volvox-contract.test.ts
 *
 * Contract tests for the pure VOLVOX lifecycle kernel. These tests use inline
 * records only and import src/iam modules directly so the IAM kernel remains
 * independent from the extension-tree database/runtime substrate.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  VOLVOX_CELL_TYPES,
  VOLVOX_LIFECYCLE_PHASES,
  DEFAULT_VOLVOX_THRESHOLDS,
  classifyVolvoxCell,
  deterministicVolvoxMutation,
  mapKirkStepToLifecyclePhase,
  normalizeVolvoxMetadata,
  normalizeVolvoxMetrics,
  normalizeVolvoxThresholds,
  reconcileVolvoxRoleStability,
  runVolvoxEpoch,
} from "../../src/iam/volvox.js";
import type { VolvoxMemoryRecord } from "../../src/iam/volvox.js";

test("VOLVOX exposes the canonical public constants", () => {
  assert.deepEqual(VOLVOX_CELL_TYPES, [
    "UNDIFFERENTIATED",
    "SOMATIC_SENSOR",
    "SOMATIC_MOTOR",
    "STRUCTURAL",
    "GERMLINE",
    "DORMANT",
  ]);
  assert.deepEqual(VOLVOX_LIFECYCLE_PHASES, ["embryonic", "juvenile", "mature", "dormant", "archived"]);
  assert.deepEqual(DEFAULT_VOLVOX_THRESHOLDS, {
    activationRate: 0.5,
    offspringCount: 3,
    crossLayerConnections: 3,
    connectionDensity: 5,
    dormancyCycles: 10,
    dormantArchiveCycles: 30,
    stableRole: 0.9,
    propagationStability: 0.8,
  });
});

test("normalization tolerates malformed lifecycle state without throwing", () => {
  assert.doesNotThrow(() => normalizeVolvoxMetadata({
    cellType: "mystery",
    roleStability: Number.NaN,
    lifecyclePhase: "elder",
    propagationEligible: "yes",
    archivedAt: 42,
  }));

  const metadata = normalizeVolvoxMetadata({
    cellType: "mystery",
    roleStability: -3,
    lifecyclePhase: "elder",
    propagationEligible: "yes",
    archivedAt: 42,
  });
  assert.deepEqual(metadata, {
    cellType: "UNDIFFERENTIATED",
    roleStability: 0,
    lifecyclePhase: "embryonic",
    propagationEligible: false,
  });

  assert.deepEqual(normalizeVolvoxMetrics({
    activationRate: Number.NaN,
    offspringCount: -1,
    crossLayerConnections: 3.9,
    connectionDensity: Infinity,
    dormancyCycles: -4,
    kirkStep: 99,
  }), {
    activationRate: 0,
    offspringCount: 0,
    crossLayerConnections: 3,
    connectionDensity: 0,
    dormancyCycles: 0,
    kirkStep: 99,
  });

  const thresholds = normalizeVolvoxThresholds({
    activationRate: Number.NaN,
    offspringCount: -1,
    crossLayerConnections: 0,
    connectionDensity: Infinity,
    dormancyCycles: 2,
    dormantArchiveCycles: 20,
    stableRole: 1.5,
    propagationStability: -2,
  });
  assert.equal(thresholds.activationRate, DEFAULT_VOLVOX_THRESHOLDS.activationRate);
  assert.equal(thresholds.offspringCount, DEFAULT_VOLVOX_THRESHOLDS.offspringCount);
  assert.equal(thresholds.crossLayerConnections, DEFAULT_VOLVOX_THRESHOLDS.crossLayerConnections);
  assert.equal(thresholds.connectionDensity, DEFAULT_VOLVOX_THRESHOLDS.connectionDensity);
  assert.equal(thresholds.dormancyCycles, 2);
  assert.equal(thresholds.dormantArchiveCycles, 20);
  assert.equal(thresholds.stableRole, 1);
  assert.equal(thresholds.propagationStability, 0);
});

test("classification priority follows dormancy, stable preservation, germline, structural, sensor, motor, fallback", () => {
  assert.equal(classifyVolvoxCell({ metrics: { dormancyCycles: 11, offspringCount: 99 } }).cellType, "DORMANT");

  assert.equal(classifyVolvoxCell({
    previous: { cellType: "SOMATIC_SENSOR", roleStability: 0.95, lifecyclePhase: "mature", propagationEligible: false },
    metrics: { offspringCount: 9, activationRate: 0.1 },
  }).cellType, "SOMATIC_SENSOR");

  assert.equal(classifyVolvoxCell({ metrics: { offspringCount: 4, crossLayerConnections: 9 } }).cellType, "GERMLINE");
  assert.equal(classifyVolvoxCell({ metrics: { offspringCount: 3, crossLayerConnections: 4 } }).cellType, "STRUCTURAL");
  assert.equal(classifyVolvoxCell({ metrics: { crossLayerConnections: 3, activationRate: 0.51, connectionDensity: 10 }, trinityLayer: "generative" }).cellType, "SOMATIC_SENSOR");
  assert.equal(classifyVolvoxCell({ metrics: { activationRate: 0.5, connectionDensity: 6 }, trinityLayer: "generative" }).cellType, "SOMATIC_MOTOR");
  assert.equal(classifyVolvoxCell({ metrics: { activationRate: 0.5, connectionDensity: 6 }, trinityLayer: "knowledge" }).cellType, "UNDIFFERENTIATED");
  assert.equal(classifyVolvoxCell({ metrics: { connectionDensity: 5 }, trinityLayer: "generative" }).cellType, "UNDIFFERENTIATED");
});

test("role stability resets on changed role, increments on unchanged role, and preserves stable roles", () => {
  assert.equal(reconcileVolvoxRoleStability("SOMATIC_SENSOR", "STRUCTURAL", 0.7), 0.1);
  assert.equal(reconcileVolvoxRoleStability("STRUCTURAL", "STRUCTURAL", 0.7), 0.75);
  assert.equal(reconcileVolvoxRoleStability("STRUCTURAL", "STRUCTURAL", 0.98), 1);

  const preserved = runVolvoxEpoch([
    record("stable-sensor", {
      previous: { cellType: "SOMATIC_SENSOR", roleStability: 0.9, lifecyclePhase: "mature", propagationEligible: false },
      metrics: { activationRate: 0.1, offspringCount: 4, kirkStep: 10 },
    }),
  ], { now: "2026-04-27T00:00:00.000Z", epochId: "epoch-stable" });

  assert.equal(preserved.records[0].volvox.cellType, "SOMATIC_SENSOR");
  assert.equal(preserved.records[0].volvox.roleStability, 0.95);
  assert.equal(preserved.diffs[0].changedFields.includes("cellType"), false);
});

test("Kirk steps map to lifecycle phases at documented boundaries", () => {
  assert.equal(mapKirkStepToLifecyclePhase(0), "embryonic");
  assert.equal(mapKirkStepToLifecyclePhase(1), "embryonic");
  assert.equal(mapKirkStepToLifecyclePhase(4), "embryonic");
  assert.equal(mapKirkStepToLifecyclePhase(5), "juvenile");
  assert.equal(mapKirkStepToLifecyclePhase(9), "juvenile");
  assert.equal(mapKirkStepToLifecyclePhase(10), "mature");
  assert.equal(mapKirkStepToLifecyclePhase(12), "mature");
  assert.equal(mapKirkStepToLifecyclePhase(13), "mature");
});

test("propagation eligibility requires germline stability, lifecycle, and provenance gates", () => {
  const result = runVolvoxEpoch([
    record("eligible", {
      previous: { cellType: "GERMLINE", roleStability: 0.75, lifecyclePhase: "juvenile", propagationEligible: false },
      metrics: { offspringCount: 4, kirkStep: 5 },
      propagation: { contributor: true, provenanceComplete: true },
    }),
    record("too-young", {
      previous: { cellType: "GERMLINE", roleStability: 0.75, lifecyclePhase: "embryonic", propagationEligible: false },
      metrics: { offspringCount: 4, kirkStep: 4 },
      propagation: { contributor: true, provenanceComplete: true },
    }),
    record("missing-provenance", {
      previous: { cellType: "GERMLINE", roleStability: 0.75, lifecyclePhase: "juvenile", propagationEligible: false },
      metrics: { offspringCount: 4, kirkStep: 5 },
      propagation: { contributor: true, provenanceComplete: false },
    }),
    record("exact-threshold", {
      previous: { cellType: "GERMLINE", roleStability: 0.75, lifecyclePhase: "juvenile", propagationEligible: false },
      metrics: { offspringCount: 4, kirkStep: 5 },
      propagation: { contributor: true, provenanceComplete: true },
    }),
  ], { now: "2026-04-27T00:00:00.000Z", epochId: "epoch-prop" });

  assert.equal(result.records.find((entry) => entry.id === "eligible")?.volvox.propagationEligible, true);
  assert.equal(result.records.find((entry) => entry.id === "too-young")?.volvox.propagationEligible, false);
  assert.equal(result.records.find((entry) => entry.id === "missing-provenance")?.volvox.propagationEligible, false);
  assert.equal(result.records.find((entry) => entry.id === "exact-threshold")?.volvox.roleStability, 0.8);
  assert.equal(result.records.find((entry) => entry.id === "exact-threshold")?.volvox.propagationEligible, true);
});

test("false germline and invalid transitions are blocking diagnostics", () => {
  const result = runVolvoxEpoch([
    record("false-germline", {
      previous: { cellType: "SOMATIC_SENSOR", roleStability: 0.2, lifecyclePhase: "juvenile", propagationEligible: true },
      metrics: { activationRate: 0.9, kirkStep: 5 },
      propagation: { contributor: true, provenanceComplete: true },
    }),
    record("regression", {
      previous: { cellType: "GERMLINE", roleStability: 0.85, lifecyclePhase: "mature", propagationEligible: true },
      metrics: { activationRate: 0.9, kirkStep: 4 },
      propagation: { contributor: true, provenanceComplete: true },
    }),
  ], { now: "2026-04-27T00:00:00.000Z", epochId: "epoch-diagnostics" });

  const falseGermline = result.diagnostics.find((diagnostic) => diagnostic.code === "false-germline");
  assert.equal(falseGermline?.severity, "blocking");
  assert.equal(falseGermline?.memoryId, "false-germline");
  assert.equal(falseGermline?.phase, "diagnose");
  assert.match(falseGermline?.remediation ?? "", /GERMLINE/i);

  const invalidTransition = result.diagnostics.find((diagnostic) => diagnostic.code === "invalid-transition");
  assert.equal(invalidTransition?.severity, "blocking");
  assert.equal(invalidTransition?.memoryId, "regression");
  assert.equal(invalidTransition?.phase, "diagnose");
});

test("deterministic mutation is seeded and bounded", () => {
  const first = deterministicVolvoxMutation("seed-1", { activationRate: 0.5, offspringCount: 2, connectionDensity: 5 });
  const second = deterministicVolvoxMutation("seed-1", { activationRate: 0.5, offspringCount: 2, connectionDensity: 5 });
  const third = deterministicVolvoxMutation("seed-2", { activationRate: 0.5, offspringCount: 2, connectionDensity: 5 });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, third);
  assert.ok(first.activationRate >= 0 && first.activationRate <= 1);
  assert.ok(Number.isInteger(first.offspringCount) && first.offspringCount >= 0);
  assert.ok(Number.isInteger(first.connectionDensity) && first.connectionDensity >= 0);
});

test("germline records are never archived during settle", () => {
  const result = runVolvoxEpoch([
    record("sleepy-germline", {
      previous: { cellType: "GERMLINE", roleStability: 0.95, lifecyclePhase: "mature", propagationEligible: true },
      metrics: { dormancyCycles: 31, offspringCount: 4, kirkStep: 10 },
      propagation: { contributor: true, provenanceComplete: true },
    }),
    record("sleepy-somatic", {
      previous: { cellType: "SOMATIC_SENSOR", roleStability: 0.95, lifecyclePhase: "mature", propagationEligible: false },
      metrics: { dormancyCycles: 31, activationRate: 0.1, kirkStep: 10 },
    }),
  ], { now: "2026-04-27T00:00:00.000Z", epochId: "epoch-settle" });

  const germline = result.records.find((entry) => entry.id === "sleepy-germline");
  const somatic = result.records.find((entry) => entry.id === "sleepy-somatic");
  assert.equal(germline?.volvox.cellType, "GERMLINE");
  assert.equal(germline?.volvox.lifecyclePhase, "mature");
  assert.equal(germline?.volvox.archivedAt, undefined);
  assert.equal(somatic?.volvox.cellType, "DORMANT");
  assert.equal(somatic?.volvox.lifecyclePhase, "archived");
  assert.equal(somatic?.volvox.archivedAt, "2026-04-27T00:00:00.000Z");

  const diagnostic = result.diagnostics.find((entry) => entry.code === "archive-germline-blocked");
  assert.equal(diagnostic?.severity, "blocking");
});

test("runVolvoxEpoch is deterministic and reports five phase metadata", () => {
  const records = [
    record("b", { metrics: { activationRate: 0.9, kirkStep: 5 } }),
    record("a", { metrics: { crossLayerConnections: 4, kirkStep: 10 } }),
  ];
  const first = runVolvoxEpoch(records, { now: "2026-04-27T00:00:00.000Z", epochId: "epoch-deterministic", trigger: "manual" });
  const second = runVolvoxEpoch([...records].reverse(), { now: "2026-04-27T00:00:00.000Z", epochId: "epoch-deterministic", trigger: "manual" });

  assert.deepEqual(first.records.map((entry) => entry.id), ["a", "b"]);
  assert.deepEqual(first.records, second.records);
  assert.deepEqual(first.phases, ["normalize", "classify", "stabilize", "propagate", "diagnose"]);
  assert.equal(first.status, "completed");
  assert.equal(first.trigger, "manual");
  assert.equal(first.counts.processed, 2);
  assert.equal(first.counts.blockingDiagnostics, 0);
});

test("src/iam VOLVOX contract keeps extension-tree imports out", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const iamEntries = await readdir(new URL("../../src/iam/", import.meta.url));
  const sources = await Promise.all(
    iamEntries
      .filter((entry) => entry.endsWith(".ts"))
      .map(async (entry) => [entry, await readFile(new URL(`../../src/iam/${entry}`, import.meta.url), "utf8")] as const),
  );

  for (const [entry, source] of sources) {
    assert.equal(/from\s+["'].*resources\/extensions/.test(source), false, `${entry} must not import extension-tree modules`);
  }

  const testSource = await readFile(new URL("./hammer-volvox-contract.test.ts", import.meta.url), "utf8");
  assert.equal(/readFile\([^)]*\.gsd\//.test(testSource), false, "VOLVOX tests must not read ignored planning paths");
});

function record(id: string, overrides: {
  category?: string;
  trinityLayer?: VolvoxMemoryRecord["trinityLayer"];
  previous?: VolvoxMemoryRecord["volvox"];
  metrics?: VolvoxMemoryRecord["metrics"];
  propagation?: VolvoxMemoryRecord["propagation"];
} = {}): VolvoxMemoryRecord {
  return {
    id,
    category: overrides.category ?? "architecture",
    content: `VOLVOX fixture ${id}`,
    trinityLayer: overrides.trinityLayer ?? "knowledge",
    volvox: overrides.previous,
    metrics: overrides.metrics,
    propagation: overrides.propagation,
  };
}
