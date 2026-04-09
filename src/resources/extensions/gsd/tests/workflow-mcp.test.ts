import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWorkflowMcpServers,
  detectWorkflowMcpLaunchConfig,
  getWorkflowTransportSupportError,
  getRequiredWorkflowToolsForAutoUnit,
  getRequiredWorkflowToolsForGuidedUnit,
  usesWorkflowMcpTransport,
} from "../workflow-mcp.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const gsdDir = join(__dirname, "..");

function readSrc(file: string): string {
  return readFileSync(join(gsdDir, file), "utf-8");
}

test("guided execute-task requires canonical task completion tool", () => {
  assert.deepEqual(getRequiredWorkflowToolsForGuidedUnit("execute-task"), ["gsd_task_complete"]);
});

test("auto execute-task requires legacy completion alias until prompt contract is aligned", () => {
  assert.deepEqual(getRequiredWorkflowToolsForAutoUnit("execute-task"), ["gsd_complete_task"]);
});

test("detectWorkflowMcpLaunchConfig prefers explicit env override", () => {
  const launch = detectWorkflowMcpLaunchConfig("/tmp/project", {
    GSD_WORKFLOW_MCP_NAME: "workflow-tools",
    GSD_WORKFLOW_MCP_COMMAND: "node",
    GSD_WORKFLOW_MCP_ARGS: JSON.stringify(["dist/cli.js"]),
    GSD_WORKFLOW_MCP_ENV: JSON.stringify({ FOO: "bar" }),
    GSD_WORKFLOW_MCP_CWD: "/tmp/project",
    GSD_CLI_PATH: "/tmp/gsd",
  });

  assert.deepEqual(launch, {
    name: "workflow-tools",
    command: "node",
    args: ["dist/cli.js"],
    cwd: "/tmp/project",
    env: {
      FOO: "bar",
      GSD_CLI_PATH: "/tmp/gsd",
    },
  });
});

test("buildWorkflowMcpServers mirrors explicit launch config", () => {
  const servers = buildWorkflowMcpServers("/tmp/project", {
    GSD_WORKFLOW_MCP_COMMAND: "node",
    GSD_WORKFLOW_MCP_ARGS: JSON.stringify(["dist/cli.js"]),
  });

  assert.deepEqual(servers, {
    "gsd-workflow": {
      command: "node",
      args: ["dist/cli.js"],
    },
  });
});

test("usesWorkflowMcpTransport matches local externalCli providers", () => {
  assert.equal(usesWorkflowMcpTransport("externalCli", "local://claude-code"), true);
  assert.equal(usesWorkflowMcpTransport("externalCli", "https://api.example.com"), false);
  assert.equal(usesWorkflowMcpTransport("oauth", "local://custom"), false);
});

test("transport compatibility passes when required tools fit current MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["gsd_task_complete"],
    {
      projectRoot: "/tmp/project",
      env: { GSD_WORKFLOW_MCP_COMMAND: "node" },
      surface: "guided flow",
      unitType: "execute-task",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility fails cleanly when MCP server is unavailable", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["gsd_task_complete"],
    {
      projectRoot: "/tmp/project",
      env: {},
      surface: "auto-mode",
      unitType: "execute-task",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.match(error ?? "", /workflow MCP server is not configured or discoverable/);
});

test("transport compatibility fails cleanly when unit requires unsupported tools", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["gsd_plan_slice"],
    {
      projectRoot: "/tmp/project",
      env: { GSD_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "plan-slice",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.match(error ?? "", /requires gsd_plan_slice/);
  assert.match(error ?? "", /currently exposes only/);
});

test("transport compatibility ignores API-backed providers", () => {
  const error = getWorkflowTransportSupportError(
    "openai-codex",
    ["gsd_plan_slice"],
    {
      projectRoot: "/tmp/project",
      env: {},
      surface: "auto-mode",
      unitType: "plan-slice",
      authMode: "oauth",
      baseUrl: "https://api.openai.com",
    },
  );

  assert.equal(error, null);
});

test("guided-flow source enforces workflow compatibility preflight", () => {
  const src = readSrc("guided-flow.ts");
  assert.match(src, /getRequiredWorkflowToolsForGuidedUnit/);
  assert.match(src, /getWorkflowTransportSupportError/);
});

test("auto direct dispatch source enforces workflow compatibility preflight", () => {
  const src = readSrc("auto-direct-dispatch.ts");
  assert.match(src, /getRequiredWorkflowToolsForAutoUnit/);
  assert.match(src, /getWorkflowTransportSupportError/);
});

test("auto phases source enforces workflow compatibility preflight", () => {
  const src = readSrc(join("auto", "phases.ts"));
  assert.match(src, /getRequiredWorkflowToolsForAutoUnit/);
  assert.match(src, /getWorkflowTransportSupportError/);
  assert.match(src, /workflow-capability/);
});
