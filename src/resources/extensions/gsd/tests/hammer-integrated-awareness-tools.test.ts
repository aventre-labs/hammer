import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { registerIAMTools } from "../bootstrap/iam-tools.ts";
import { ensureDbOpen } from "../bootstrap/dynamic-tools.ts";
import { closeDatabase, _getAdapter } from "../gsd-db.ts";
import { _clearGsdRootCache, gsdRoot } from "../paths.ts";
import { clearParseCache } from "../files.ts";

const CANONICAL_STAGES = [
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
] as const;

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  details?: Record<string, unknown>;
};

type RegisteredTool = {
  name: string;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<ToolResponse>;
};

type FakeModel = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  api: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

function makeHammerProject(t: test.TestContext, label: string): { basePath: string; targetArtifactPath: string } {
  const basePath = mkdtempSync(join(tmpdir(), `hammer-awareness-${label}-`));
  t.after(() => cleanup(basePath));
  mkdirSync(join(basePath, ".hammer", "milestones", "M777"), { recursive: true });
  const targetArtifactPath = join(basePath, ".hammer", "milestones", "M777", "M777-RESEARCH.md");
  writeFileSync(
    targetArtifactPath,
    [
      "# Hammer Integrated Awareness Research",
      "",
      "This tracked artifact gives Omega a governed phase target under the canonical Hammer state root.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return { basePath, targetArtifactPath };
}

function cleanup(basePath: string): void {
  try { closeDatabase(); } catch { /* ok */ }
  _clearGsdRootCache();
  clearParseCache();
  rmSync(basePath, { recursive: true, force: true });
}

function withCwd<T>(cwd: string, fn: () => T): T {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

function registerTools(ctxOverrides: Partial<{ modelRegistry: unknown; omegaExecutor: (prompt: string) => Promise<string> | string }> = {}): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  const fakeModel: FakeModel = {
    id: "claude-3-5-haiku-test",
    name: "Claude Haiku test double",
    provider: "anthropic",
    baseUrl: "https://example.invalid",
    api: "anthropic-messages",
    reasoning: false,
    input: ["text"],
    cost: { input: 0.25, output: 1.25, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  };
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    omegaExecutor: (prompt: string) => {
      if (prompt.includes("Malformed response path")) return "";
      const stageMatch = prompt.match(/Stage\s+(\d+)\s*[:—-]\s*([^\n]+)/i);
      const stage = stageMatch ? `stage ${stageMatch[1]} ${stageMatch[2].trim()}` : "synthesis";
      return `Deterministic Omega ${stage}: ${prompt.slice(0, 120)}`;
    },
    modelRegistry: {
      getAvailable: () => [fakeModel],
      getApiKey: async () => "sk-test-not-real",
    },
    ...ctxOverrides,
  };
  registerIAMTools(pi as never);
  return tools;
}

function toolByName(tools: RegisteredTool[], name: string): RegisteredTool {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} should be registered`);
  return tool;
}

async function callTool(tools: RegisteredTool[], name: string, params: Record<string, unknown>): Promise<ToolResponse> {
  return toolByName(tools, name).execute(`${name}-call`, params);
}

function parseSuccess(response: ToolResponse): Record<string, unknown> {
  assert.equal(response.isError, undefined, `expected tool success, got ${JSON.stringify(response.details)}`);
  assert.equal(response.content[0].type, "text");
  return JSON.parse(response.content[0].text) as Record<string, unknown>;
}

function parseError(response: ToolResponse, expectedKind: string): Record<string, unknown> {
  assert.equal(response.isError, true, `expected IAM error ${expectedKind}`);
  assert.equal(response.details?.iamErrorKind, expectedKind);
  assert.equal(typeof response.details?.remediation, "string");
  assert.match(String(response.details?.remediation), /\S/);
  return response.details ?? {};
}

function assertUnderHammer(basePath: string, filePath: string, label: string): string {
  const realBase = realpathSync(basePath);
  const rel = relative(realBase, realpathSync(filePath)).replaceAll("\\", "/");
  assert.ok(rel.startsWith(".hammer/"), `${label} should be under .hammer, got ${rel}`);
  assert.equal(rel.startsWith(".gsd/"), false, `${label} must not be under .gsd`);
  return rel;
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else files.push(abs);
    }
  }
  walk(root);
  return files.sort();
}

function seedVolvoxRows(): void {
  const adapter = _getAdapter();
  assert.ok(adapter, "DB adapter should be available for VOLVOX fixture seeding");
  adapter.prepare(
    `UPDATE memories
        SET volvox_offspring_count = 5,
            volvox_kirk_step = 6,
            source_unit_type = 'task',
            source_unit_id = 'M777/S10/T03'
      WHERE id = 'MEM001'`,
  ).run();
  adapter.prepare(
    `UPDATE memories
        SET volvox_cross_layer_connections = 4,
            volvox_kirk_step = 10,
            source_unit_type = 'task',
            source_unit_id = 'M777/S10/T03'
      WHERE id = 'MEM002'`,
  ).run();
  adapter.prepare(
    `UPDATE memories
        SET volvox_activation_rate = 0.9,
            volvox_kirk_step = 5,
            source_unit_type = 'task',
            source_unit_id = 'M777/S10/T03'
      WHERE id = 'MEM003'`,
  ).run();
  adapter.prepare(
    `UPDATE memories
        SET volvox_dormancy_cycles = 11,
            volvox_kirk_step = 5,
            source_unit_type = 'task',
            source_unit_id = 'M777/S10/T03'
      WHERE id = 'MEM004'`,
  ).run();
  adapter.prepare(
    `UPDATE memories
        SET volvox_propagation_eligible = 1,
            volvox_cell_type = 'SOMATIC_SENSOR',
            volvox_lifecycle_phase = 'juvenile',
            volvox_kirk_step = 5,
            source_unit_type = 'task',
            source_unit_id = 'M777/S10/T03'
      WHERE id = 'MEM005'`,
  ).run();
}

test("registered hammer_* tools persist Trinity, Omega, Rune/SAVESUCCESS, and VOLVOX state under .hammer", async (t) => {
  const { basePath, targetArtifactPath } = makeHammerProject(t, "tools");
  const tools = withCwd(basePath, () => registerTools());

  assert.equal(gsdRoot(basePath), join(basePath, ".hammer"));
  assert.equal(await ensureDbOpen(basePath), true, "fixture DB should open under .hammer");
  assert.ok(existsSync(join(basePath, ".hammer", "gsd.db")));
  assert.equal(existsSync(join(basePath, ".gsd")), false, ".hammer-only tool fixture must not create .gsd");

  const check = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_check", {})));
  assert.equal(check.kind, "check-result");
  assert.equal(check.dbAvailable, true);
  assert.ok((check.tools as string[]).includes("remember"));
  assert.ok((check.tools as string[]).includes("volvox_epoch"));

  const remember = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_remember", {
    category: "architecture",
    content: "Hammer registered tools persist Trinity metadata inside the canonical Hammer root.",
    confidence: 0.95,
    trinityLayer: "knowledge",
    trinityIty: { factuality: 0.9, stability: 0.8 },
    trinityPathy: { reciprocity: 0.6 },
    trinityProvenance: {
      sourceUnitType: "task",
      sourceUnitId: "M777/S10/T03",
      artifactPath: targetArtifactPath,
    },
    trinityValidationState: "validated",
    trinityValidationScore: 0.91,
  })));
  assert.equal(remember.kind, "memory-created");
  assert.equal(remember.id, "MEM001");
  assert.equal((remember.trinity as Record<string, unknown>).layer, "knowledge");

  const recall = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_recall", {
    query: "registered tools Trinity canonical root",
    k: 5,
    trinityLayer: "knowledge",
    trinityLens: { ity: { factuality: 1, stability: 1 }, pathy: { reciprocity: 1 } },
  })));
  assert.equal(recall.kind, "memory-list");
  const recalled = recall.memories as Array<Record<string, unknown>>;
  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].id, "MEM001");
  assert.equal((recalled[0].trinity as Record<string, unknown>).layer, "knowledge");
  assert.equal((recalled[0].volvox as Record<string, unknown>).cellType, "UNDIFFERENTIATED");

  const rune = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_rune", { runeName: "RIGOR" })));
  assert.equal(rune.kind, "rune-contract");
  assert.equal((rune.rune as Record<string, unknown>).runeName, "RIGOR");
  assert.equal(typeof (rune.rune as Record<string, unknown>).minimumBar, "string");

  const validRunes = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_validate", { runeNames: ["RIGOR", "HUMAN"] })));
  assert.equal(validRunes.kind, "rune-list");
  assert.deepEqual((validRunes.runes as Array<Record<string, unknown>>).map((entry) => entry.runeName), ["RIGOR", "HUMAN"]);

  const badRune = parseError(
    await withCwd(basePath, () => callTool(tools, "hammer_validate", { runeNames: ["RIGOR", "NOT_A_RUNE"] })),
    "unknown-rune",
  );
  assert.equal(badRune.persistenceStatus, "not-attempted");
  assert.match(String(badRune.remediation), /NOT_A_RUNE/);

  const assessment = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_assess", {
    target: "thin plan",
    text: "TODO",
  })));
  assert.equal(assessment.kind, "savesuccess-report");
  assert.equal(assessment.success, false);
  assert.match(String(assessment.report), /blind spot|FAILURE/i);

  const omega = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_canonical_spiral", {
    query: "Govern M777 Hammer awareness proof with native Omega",
    unitType: "research-milestone",
    unitId: "M777",
    targetArtifactPath,
    persona: "engineer",
    runes: ["RIGOR", "HUMAN"],
  })));
  assert.equal(omega.kind, "omega-run");
  assert.equal(omega.status, "complete");
  assert.equal(omega.stageCount, 10);
  assert.equal(omega.persistenceStatus, "complete");
  assert.equal(omega.target, targetArtifactPath);
  const artifactDir = omega.artifactDir as string;
  const manifestPath = omega.manifestPath as string;
  const runManifestPath = omega.runManifestPath as string;
  const synthesisPath = omega.synthesisPath as string;
  assertUnderHammer(basePath, artifactDir, "Omega artifactDir");
  assertUnderHammer(basePath, manifestPath, "Omega phase manifest");
  assertUnderHammer(basePath, runManifestPath, "Omega run manifest");
  assertUnderHammer(basePath, synthesisPath, "Omega synthesis");
  assert.ok(existsSync(manifestPath));
  assert.ok(existsSync(runManifestPath));
  assert.ok(existsSync(synthesisPath));

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
  assert.equal(manifest.unitType, "research-milestone");
  assert.equal(manifest.unitId, "M777");
  assert.equal(manifest.runId, omega.runId);
  assert.equal(manifest.stageCount, 10);
  assert.equal(manifest.status, "complete");
  assert.deepEqual(Object.keys(manifest.stageFilePaths as Record<string, string>).sort(), [...CANONICAL_STAGES].sort());
  for (const stage of CANONICAL_STAGES) {
    const stagePath = (manifest.stageFilePaths as Record<string, string>)[stage];
    assertUnderHammer(basePath, stagePath, `Omega stage ${stage}`);
    assert.ok(existsSync(stagePath), `stage file ${stage} should exist`);
  }

  const runManifest = JSON.parse(readFileSync(runManifestPath, "utf-8")) as Record<string, unknown>;
  assert.deepEqual(runManifest.stages, [...CANONICAL_STAGES]);
  assert.equal(runManifest.stageCount, 10);
  assert.equal((runManifest.stageResults as unknown[]).length, 10);

  const adapter = _getAdapter();
  assert.ok(adapter, "DB adapter should remain open after Omega run");
  const omegaRow = adapter.prepare("SELECT status, artifact_dir FROM omega_runs WHERE id = ?").get(omega.runId);
  assert.equal(omegaRow?.status, "complete");
  assertUnderHammer(basePath, String(omegaRow?.artifact_dir), "omega_runs.artifact_dir");
  const phaseRow = adapter.prepare("SELECT unit_type, unit_id, stage_count, manifest_path FROM omega_phase_artifacts WHERE run_id = ?").get(omega.runId);
  assert.equal(phaseRow?.unit_type, "research-milestone");
  assert.equal(phaseRow?.unit_id, "M777");
  assert.equal(phaseRow?.stage_count, 10);
  assertUnderHammer(basePath, String(phaseRow?.manifest_path), "omega_phase_artifacts.manifest_path");

  const badPhase = parseError(await withCwd(basePath, () => callTool(tools, "hammer_canonical_spiral", {
    query: "Bad phase params",
    unitType: "execute-task",
    unitId: "M777/S10/T03",
    targetArtifactPath,
  })), "persistence-failed");
  assert.equal(badPhase.persistenceStatus, "not-attempted");
  assert.match(String(badPhase.validationGap), /Unknown Omega phase unit type|Invalid Omega phase unitType/);
  assert.match(String(badPhase.remediation), /research-milestone|unitType/);

  for (const [content, trinityLayer] of [
    ["offspring rich germline candidate", "knowledge"],
    ["cross layer structural candidate", "social"],
    ["high activation sensor candidate", "social"],
    ["dormant lifecycle candidate", "knowledge"],
  ] as const) {
    parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_remember", {
      category: "pattern",
      content,
      confidence: 0.9,
      trinityLayer,
      trinityProvenance: { sourceUnitType: "task", sourceUnitId: "M777/S10/T03" },
    })));
  }
  seedVolvoxRows();

  const epochOutput = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_volvox_epoch", {
    trigger: "integrated-awareness",
    now: "2026-04-27T00:00:00.000Z",
    thresholds: { offspringCount: 3, crossLayerConnections: 3, activationRate: 0.5, dormancyCycles: 10 },
  })));
  assert.equal(epochOutput.kind, "volvox-epoch");
  const epoch = epochOutput.epoch as Record<string, unknown>;
  assert.equal(epoch.status, "blocked");
  assert.equal((epoch.counts as Record<string, unknown>).processed, 5);
  assert.equal((epoch.counts as Record<string, unknown>).blockingDiagnostics, 1);
  assert.ok((epoch.diagnostics as Array<Record<string, unknown>>).some((diagnostic) => diagnostic.code === "false-germline" && diagnostic.memoryId === "MEM005"));
  assert.deepEqual(epoch.phases, ["normalize", "classify", "stabilize", "propagate", "diagnose"]);

  const statusOutput = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_volvox_status", {})));
  assert.equal(statusOutput.kind, "volvox-status");
  const statusEpoch = statusOutput.epoch as Record<string, unknown>;
  assert.equal(statusEpoch.epochId, epoch.epochId);
  assert.equal(statusEpoch.status, "blocked");
  const statusMemories = statusOutput.memories as Array<Record<string, unknown>>;
  assert.ok(statusMemories.some((memory) => memory.id === "MEM001" && (memory.volvox as Record<string, unknown>).cellType === "GERMLINE"));
  assert.ok(statusMemories.some((memory) => (memory.volvox as Record<string, unknown>).cellType === "STRUCTURAL"));
  assert.ok(statusMemories.some((memory) => (memory.volvox as Record<string, unknown>).cellType === "SOMATIC_SENSOR"));
  assert.ok(statusMemories.some((memory) => (memory.volvox as Record<string, unknown>).cellType === "DORMANT"));

  const diagnosticsOutput = parseSuccess(await withCwd(basePath, () => callTool(tools, "hammer_volvox_diagnose", { memoryId: "MEM005", includeInfo: true })));
  assert.equal(diagnosticsOutput.kind, "volvox-diagnostics");
  const blocking = diagnosticsOutput.blocking as Array<Record<string, unknown>>;
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].code, "false-germline");
  assert.equal(blocking[0].severity, "blocking");
  assert.match(String(blocking[0].remediation), /Clear propagation eligibility|offspring\/provenance/);
  assert.equal(typeof blocking[0].timestamp, "string");

  const badVolvox = parseError(await withCwd(basePath, () => callTool(tools, "hammer_volvox_epoch", { thresholds: "unsafe" })), "persistence-failed");
  assert.match(String(badVolvox.remediation), /thresholds/);

  const epochRow = adapter.prepare("SELECT status, trigger, diagnostics_json FROM volvox_epochs WHERE id = ?").get(epoch.epochId);
  assert.equal(epochRow?.status, "failed");
  assert.equal(epochRow?.trigger, "integrated-awareness");
  assert.match(String(epochRow?.diagnostics_json), /false-germline/);
  const mutationRows = adapter.prepare("SELECT memory_id, diagnostics_json FROM volvox_epoch_mutations WHERE epoch_id = ? ORDER BY memory_id").all(epoch.epochId);
  assert.equal(mutationRows.length, 5);
  assert.match(String(mutationRows.find((row) => row.memory_id === "MEM005")?.diagnostics_json), /false-germline/);

  const generatedFiles = listFiles(join(basePath, ".hammer"));
  assert.ok(generatedFiles.some((file) => file.endsWith("gsd.db")), ".hammer DB should be generated");
  assert.ok(generatedFiles.some((file) => file.includes("/omega/phases/research-milestone/M777/")), "Omega phase files should be generated under .hammer");
  assert.equal(existsSync(join(basePath, ".gsd")), false, "registered tools must not create legacy .gsd");
});

test("registered Omega runtime reports executor and malformed-response failures without external credentials", async (t) => {
  const { basePath } = makeHammerProject(t, "negative");
  const noExecutorTools = withCwd(basePath, () => registerTools({
    omegaExecutor: undefined as never,
    modelRegistry: { getAvailable: () => [], getApiKey: async () => undefined },
  }));

  const notWired = parseError(await withCwd(basePath, () => callTool(noExecutorTools, "hammer_canonical_spiral", {
    query: "No executor available",
  })), "executor-not-wired");
  assert.equal(notWired.persistenceStatus, "not-attempted");
  assert.match(String(notWired.remediation), /model|provider|API key/i);

  const malformedTools = withCwd(basePath, () => registerTools());
  const malformed = parseError(await withCwd(basePath, () => callTool(malformedTools, "hammer_spiral", {
    query: "Malformed response path",
    stages: ["interiority"],
  })), "omega-stage-failed");
  assert.match(String(malformed.remediation), /executor|retry|Omega|model|persistence/i);
});
