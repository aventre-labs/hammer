import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerIAMTools } from "../bootstrap/iam-tools.ts";

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

type RegisteredTool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
    details?: Record<string, unknown>;
  }>;
};

type FakeModel = {
  id: string;
  provider: string;
  api: string;
  cost: { input: number; output: number };
};

function makeBase(t: test.TestContext): { basePath: string; targetArtifactPath: string } {
  const basePath = mkdtempSync(join(tmpdir(), "iam-tools-omega-runtime-"));
  t.after(() => rmSync(basePath, { recursive: true, force: true }));
  mkdirSync(join(basePath, ".gsd", "milestones", "M001"), { recursive: true });
  const targetArtifactPath = join(basePath, ".gsd", "milestones", "M001", "M001-RESEARCH.md");
  writeFileSync(targetArtifactPath, "# Research\n", "utf-8");
  return { basePath, targetArtifactPath };
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
    provider: "anthropic",
    api: "anthropic-messages",
    cost: { input: 0.25, output: 1.25 },
  };
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    omegaExecutor: (prompt: string) => {
      if (prompt.includes("Malformed response path")) return "";
      return `stub omega response for ${prompt.slice(0, 48)}`;
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

function parseToolJson(response: Awaited<ReturnType<RegisteredTool["execute"]>>): Record<string, unknown> {
  assert.equal(response.isError, undefined, `expected success, got ${JSON.stringify(response.details)}`);
  assert.equal(response.content[0].type, "text");
  return JSON.parse(response.content[0].text) as Record<string, unknown>;
}

test("hammer_canonical_spiral executes native Omega through the registered runtime and persists a phase manifest", async (t) => {
  const { basePath, targetArtifactPath } = makeBase(t);
  const tools = withCwd(basePath, () => registerTools());
  const tool = toolByName(tools, "hammer_canonical_spiral");

  const result = await tool.execute("call-1", {
    query: "Govern M001 research with Omega",
    unitType: "research-milestone",
    unitId: "M001",
    targetArtifactPath,
    persona: "engineer",
    runes: ["RIGOR", "HUMAN"],
  });

  const output = parseToolJson(result);
  assert.equal(output.kind, "omega-run");
  assert.equal(output.status, "complete");
  assert.equal(output.stageCount, 10);
  assert.equal(output.persistenceStatus, "complete");
  assert.equal(output.target, targetArtifactPath);
  assert.equal(typeof output.runId, "string");
  assert.equal(typeof output.artifactDir, "string");
  assert.equal(typeof output.manifestPath, "string");
  assert.equal(typeof output.runManifestPath, "string");
  assert.equal(typeof output.synthesisPath, "string");
  assert.ok(existsSync(output.artifactDir as string));
  assert.ok(existsSync(output.manifestPath as string));
  assert.ok(existsSync(output.runManifestPath as string));
  assert.ok(existsSync(output.synthesisPath as string));

  const manifest = JSON.parse(readFileSync(output.manifestPath as string, "utf-8")) as Record<string, unknown>;
  assert.equal(manifest.unitType, "research-milestone");
  assert.equal(manifest.unitId, "M001");
  assert.equal(manifest.runId, output.runId);
  assert.equal(manifest.stageCount, 10);
  assert.deepEqual(Object.keys(manifest.stageFilePaths as Record<string, string>).sort(), [...CANONICAL_STAGES].sort());
});

test("hammer_spiral executes standalone native Omega runs and defaults an empty stages array to canonical order", async (t) => {
  const { basePath } = makeBase(t);
  const tools = withCwd(basePath, () => registerTools());
  const tool = toolByName(tools, "hammer_spiral");

  const result = await tool.execute("call-2", {
    query: "Standalone Omega run",
    stages: [],
  });

  const output = parseToolJson(result);
  assert.equal(output.kind, "omega-run");
  assert.equal(output.status, "complete");
  assert.equal(output.stageCount, 10);
  assert.equal(output.manifestPath, undefined);
  assert.ok(String(output.artifactDir).includes(".gsd/omega/tools"));
  assert.ok(existsSync(output.runManifestPath as string));
  const runManifest = JSON.parse(readFileSync(output.runManifestPath as string, "utf-8")) as Record<string, unknown>;
  assert.deepEqual(runManifest.stages, [...CANONICAL_STAGES]);
});

test("hammer_spiral reports executor-not-wired when no model registry is available", async (t) => {
  const { basePath } = makeBase(t);
  const tools = withCwd(basePath, () => registerTools({
    omegaExecutor: undefined as never,
    modelRegistry: { getAvailable: () => [], getApiKey: async () => undefined },
  }));
  const tool = toolByName(tools, "hammer_spiral");

  const result = await tool.execute("call-3", { query: "No model" });

  assert.equal(result.isError, true);
  assert.equal(result.details?.iamErrorKind, "executor-not-wired");
  assert.equal(result.details?.persistenceStatus, "not-attempted");
  assert.match(result.content[0].text, /No model is available/);
});

test("hammer_spiral rejects malformed phase parameters before persistence", async (t) => {
  const { basePath, targetArtifactPath } = makeBase(t);
  const tools = withCwd(basePath, () => registerTools());
  const tool = toolByName(tools, "hammer_spiral");

  const result = await tool.execute("call-4", {
    query: "Bad phase",
    unitType: "execute-task",
    unitId: "M001/S01/T01",
    targetArtifactPath,
  });

  assert.equal(result.isError, true);
  assert.equal(result.details?.iamErrorKind, "persistence-failed");
  assert.equal(result.details?.persistenceStatus, "not-attempted");
  assert.match(String(result.details?.validationGap), /Unknown Omega phase unit type/);
});

test("hammer_spiral surfaces malformed model text responses as structured IAM errors with partial diagnostics", async (t) => {
  const { basePath } = makeBase(t);
  const tools = withCwd(basePath, () => registerTools());
  const tool = toolByName(tools, "hammer_spiral");

  const result = await tool.execute("call-5", {
    query: "Malformed response path",
    // The runtime test resolver stubs completeSimple with empty text when the prompt contains this token.
    stages: ["interiority"],
  });

  assert.equal(result.isError, true);
  assert.equal(result.details?.iamErrorKind, "omega-stage-failed");
  assert.match(result.content[0].text, /executor|Omega/i);
});
