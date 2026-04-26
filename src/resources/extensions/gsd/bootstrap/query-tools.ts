// Hammer — Read-only query tools exposing DB state to the LLM via the WAL connection

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@gsd/pi-coding-agent";
import { ensureDbOpen } from "./dynamic-tools.js";
import { executeMilestoneStatus } from "../tools/workflow-tool-executors.js";
import { checkpointDatabase } from "../gsd-db.js";

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

export function registerQueryTools(pi: ExtensionAPI): void {
  const milestoneStatusTool = {
    name: "hammer_milestone_status",
    label: "Milestone Status",
    description:
      "Read the current status of a milestone and all its slices from the Hammer database. " +
      "Returns milestone metadata, per-slice status, and task counts per slice. " +
      "Use this instead of querying .gsd/gsd.db directly via sqlite3 or better-sqlite3.",
    promptSnippet: "Get milestone status, slice statuses, and task counts for a given milestoneId",
    promptGuidelines: [
      "Use this tool — not sqlite3 or better-sqlite3 — to inspect milestone or slice state from the DB.",
    ],
    parameters: Type.Object({
      milestoneId: Type.String({ description: "Milestone ID to query (e.g. M001)" }),
    }),
    async execute(_toolCallId: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      if (!dbAvailable) {
        return {
          content: [{ type: "text" as const, text: "Error: Hammer database is not available. Cannot read milestone status." }],
          details: { operation: "milestone_status", error: "db_unavailable" },
        };
      }
      return executeMilestoneStatus(params);
    },
  };

  pi.registerTool(milestoneStatusTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, milestoneStatusTool, "gsd_milestone_status", "hammer_milestone_status");

  const checkpointDbTool = {
    name: "hammer_checkpoint_db",
    label: "Checkpoint Hammer Database",
    description:
      "Flush the SQLite WAL (Write-Ahead Log) into the base gsd.db file. " +
      "Call this before `git add .gsd/gsd.db` to ensure the committed database " +
      "contains current milestone/slice/task state rather than stale pre-session content. " +
      "Safe to call at any time while Hammer is running.",
    promptSnippet: "Flush WAL into gsd.db so git add stages current state",
    promptGuidelines: [
      "Call hammer_checkpoint_db immediately before staging .gsd/gsd.db with git add.",
      "Do not use sqlite3 or shell commands to checkpoint — they are blocked. Use this tool instead.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const dbAvailable = await ensureDbOpen();
      if (!dbAvailable) {
        return {
          content: [{ type: "text" as const, text: "Error: Hammer database is not available. Cannot checkpoint." }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          details: { operation: "checkpoint_db", error: "db_unavailable" } as any,
        };
      }
      checkpointDatabase();
      return {
        content: [{ type: "text" as const, text: "WAL checkpoint complete. gsd.db is now up to date and safe to stage with git add." }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        details: { operation: "checkpoint_db", status: "ok" } as any,
      };
    },
  };

  pi.registerTool(checkpointDbTool);
  // legacy alias for compatibility — legacy-alias
  registerAlias(pi, checkpointDbTool, "gsd_checkpoint_db", "hammer_checkpoint_db");
}
