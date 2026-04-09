import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface WorkflowMcpLaunchConfig {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface WorkflowCapabilityOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  surface?: string;
  unitType?: string;
  authMode?: "apiKey" | "oauth" | "externalCli" | "none";
  baseUrl?: string;
}

const MCP_WORKFLOW_TOOL_SURFACE = new Set([
  "gsd_milestone_status",
  "gsd_summary_save",
  "gsd_task_complete",
]);

function parseLookupOutput(output: Buffer | string): string {
  return output
    .toString()
    .trim()
    .split(/\r?\n/)[0] ?? "";
}

function parseJsonEnv<T>(env: NodeJS.ProcessEnv, name: string): T | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON in ${name}`);
  }
}

function lookupCommand(command: string, platform: NodeJS.Platform = process.platform): string | null {
  const lookup = platform === "win32" ? `where ${command}` : `which ${command}`;
  try {
    const resolved = parseLookupOutput(execSync(lookup, { timeout: 5_000, stdio: "pipe" }));
    return resolved || null;
  } catch {
    return null;
  }
}

export function detectWorkflowMcpLaunchConfig(
  projectRoot = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): WorkflowMcpLaunchConfig | null {
  const name = env.GSD_WORKFLOW_MCP_NAME?.trim() || "gsd-workflow";
  const explicitCommand = env.GSD_WORKFLOW_MCP_COMMAND?.trim();
  const explicitArgs = parseJsonEnv<unknown>(env, "GSD_WORKFLOW_MCP_ARGS");
  const explicitEnv = parseJsonEnv<Record<string, string>>(env, "GSD_WORKFLOW_MCP_ENV");
  const explicitCwd = env.GSD_WORKFLOW_MCP_CWD?.trim();

  if (explicitCommand) {
    const launchEnv = {
      ...(env.GSD_CLI_PATH ? { GSD_CLI_PATH: env.GSD_CLI_PATH } : {}),
      ...(explicitEnv ?? {}),
    };
    return {
      name,
      command: explicitCommand,
      args: Array.isArray(explicitArgs) && explicitArgs.length > 0 ? explicitArgs.map(String) : undefined,
      cwd: explicitCwd || undefined,
      env: Object.keys(launchEnv).length > 0 ? launchEnv : undefined,
    };
  }

  const distCli = resolve(projectRoot, "packages", "mcp-server", "dist", "cli.js");
  if (existsSync(distCli)) {
    return {
      name,
      command: process.execPath,
      args: [distCli],
      cwd: projectRoot,
      env: env.GSD_CLI_PATH ? { GSD_CLI_PATH: env.GSD_CLI_PATH } : undefined,
    };
  }

  const binPath = lookupCommand("gsd-mcp-server");
  if (binPath) {
    return {
      name,
      command: binPath,
      env: env.GSD_CLI_PATH ? { GSD_CLI_PATH: env.GSD_CLI_PATH } : undefined,
    };
  }

  return null;
}

export function buildWorkflowMcpServers(
  projectRoot = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Record<string, Record<string, unknown>> | undefined {
  const launch = detectWorkflowMcpLaunchConfig(projectRoot, env);
  if (!launch) return undefined;

  return {
    [launch.name]: {
      command: launch.command,
      ...(launch.args && launch.args.length > 0 ? { args: launch.args } : {}),
      ...(launch.env ? { env: launch.env } : {}),
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
    },
  };
}

export function getRequiredWorkflowToolsForGuidedUnit(unitType: string): string[] {
  switch (unitType) {
    case "discuss-milestone":
      return ["gsd_summary_save", "gsd_plan_milestone"];
    case "discuss-slice":
      return ["gsd_summary_save"];
    case "research-milestone":
    case "research-slice":
      return ["gsd_summary_save"];
    case "plan-milestone":
      return ["gsd_plan_milestone"];
    case "plan-slice":
      return ["gsd_plan_slice"];
    case "execute-task":
      return ["gsd_task_complete"];
    case "complete-slice":
      return ["gsd_slice_complete"];
    default:
      return [];
  }
}

export function getRequiredWorkflowToolsForAutoUnit(unitType: string): string[] {
  switch (unitType) {
    case "discuss-milestone":
      return ["gsd_summary_save", "gsd_plan_milestone"];
    case "research-milestone":
    case "research-slice":
    case "run-uat":
      return ["gsd_summary_save"];
    case "plan-milestone":
      return ["gsd_plan_milestone"];
    case "plan-slice":
      return ["gsd_plan_slice"];
    case "execute-task":
    case "execute-task-simple":
    case "reactive-execute":
      return ["gsd_complete_task"];
    case "complete-slice":
      return ["gsd_complete_slice"];
    case "replan-slice":
      return ["gsd_replan_slice"];
    case "reassess-roadmap":
      return ["gsd_milestone_status", "gsd_reassess_roadmap"];
    case "gate-evaluate":
      return ["gsd_save_gate_result"];
    case "validate-milestone":
      return ["gsd_milestone_status", "gsd_validate_milestone"];
    case "complete-milestone":
      return ["gsd_milestone_status", "gsd_complete_milestone"];
    default:
      return [];
  }
}

export function usesWorkflowMcpTransport(
  authMode: WorkflowCapabilityOptions["authMode"],
  baseUrl: string | undefined,
): boolean {
  return authMode === "externalCli" && typeof baseUrl === "string" && baseUrl.startsWith("local://");
}

export function getWorkflowTransportSupportError(
  provider: string | undefined,
  requiredTools: string[],
  options: WorkflowCapabilityOptions = {},
): string | null {
  if (!provider || requiredTools.length === 0) return null;
  if (!usesWorkflowMcpTransport(options.authMode, options.baseUrl)) return null;

  const projectRoot = options.projectRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const launch = detectWorkflowMcpLaunchConfig(projectRoot, env);
  const surface = options.surface ?? "workflow dispatch";
  const unitLabel = options.unitType ? ` for ${options.unitType}` : "";
  const providerLabel = `"${provider}"`;

  if (!launch) {
    return `Provider ${providerLabel} cannot run ${surface}${unitLabel}: the GSD workflow MCP server is not configured or discoverable. Configure GSD_WORKFLOW_MCP_COMMAND, build packages/mcp-server/dist/cli.js, or install gsd-mcp-server on PATH.`;
  }

  const missing = [...new Set(requiredTools)].filter((tool) => !MCP_WORKFLOW_TOOL_SURFACE.has(tool));
  if (missing.length === 0) return null;

  return `Provider ${providerLabel} cannot run ${surface}${unitLabel}: this unit requires ${missing.join(", ")}, but the workflow MCP transport currently exposes only ${Array.from(MCP_WORKFLOW_TOOL_SURFACE).sort().join(", ")}.`;
}
