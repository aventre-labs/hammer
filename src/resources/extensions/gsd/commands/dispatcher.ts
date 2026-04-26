import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";

import { GSDNoProjectError } from "./context.js";
import { handleAutoCommand } from "./handlers/auto.js";
import { handleCoreCommand } from "./handlers/core.js";
import { handleOpsCommand } from "./handlers/ops.js";
import { handleParallelCommand } from "./handlers/parallel.js";
import { handleWorkflowCommand } from "./handlers/workflow.js";

export interface HandleGSDCommandOptions {
  /** True when the invocation arrived via the /gsd legacy alias rather than /hammer canonical. */
  viaLegacyAlias?: boolean;
}

export async function handleGSDCommand(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  { viaLegacyAlias = false }: HandleGSDCommandOptions = {},
): Promise<void> {
  const trimmed = (typeof args === "string" ? args : "").trim();

  // Observability: log legacy alias usage so operators can track adoption of /hammer.
  if (viaLegacyAlias) {
    const { logWarning } = await import("../workflow-logger.js");
    logWarning(
      "command",
      `/gsd ${trimmed || "(bare)"} dispatched via legacy alias — canonical: /hammer ${trimmed || "(bare)"}`, // legacy alias for compatibility — explicit-legacy-alias-marker
    );
  }

  const handlers = [
    () => handleCoreCommand(trimmed, ctx, pi),
    () => handleAutoCommand(trimmed, ctx, pi),
    () => handleParallelCommand(trimmed, ctx, pi),
    () => handleWorkflowCommand(trimmed, ctx, pi),
    () => handleOpsCommand(trimmed, ctx, pi),
  ];

  try {
    for (const handler of handlers) {
      if (await handler()) {
        return;
      }
    }
  } catch (err) {
    if (err instanceof GSDNoProjectError) {
      ctx.ui.notify(
        `${err.message} \`cd\` into a project directory first.`,
        "warning",
      );
      return;
    }
    throw err;
  }

  // Unknown command — suggest the canonical /hammer form.
  const invocationPrefix = viaLegacyAlias
    ? `/gsd ${trimmed}` // legacy alias for compatibility — explicit-legacy-alias-marker
    : `/hammer ${trimmed}`;
  ctx.ui.notify(
    `Unknown: ${invocationPrefix}. Run /hammer help for available commands.`,
    "warning",
  );
}
