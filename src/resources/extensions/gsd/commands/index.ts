import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";

import { HAMMER_COMMAND_DESCRIPTION, getHammerArgumentCompletions } from "./catalog.js";

/** Shared command handler — invoked by both /hammer and the /gsd legacy alias. */
async function hammerCommandHandler(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  { isLegacyAlias = false }: { isLegacyAlias?: boolean } = {},
): Promise<void> {
  const { handleGSDCommand } = await import("./dispatcher.js");
  const { setStderrLoggingEnabled } = await import("../workflow-logger.js");
  const previousStderrSetting = setStderrLoggingEnabled(false);
  try {
    await handleGSDCommand(args, ctx, pi, { viaLegacyAlias: isLegacyAlias });
  } finally {
    setStderrLoggingEnabled(previousStderrSetting);
  }
}

/** Register the canonical /hammer command. */
export function registerHammerCommand(pi: ExtensionAPI): void {
  pi.registerCommand("hammer", {
    description: HAMMER_COMMAND_DESCRIPTION,
    getArgumentCompletions: getHammerArgumentCompletions,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await hammerCommandHandler(args, ctx, pi);
    },
  });
}

/**
 * Register /gsd as a hidden legacy compatibility alias.
 * Not advertised in manifest provides.commands or completion help.
 *
 * @deprecated legacy alias for /hammer — explicit-legacy-alias-marker
 */
export function registerGSDLegacyAlias(pi: ExtensionAPI): void {
  pi.registerCommand("gsd", { // legacy alias for compatibility — explicit-legacy-alias-marker
    description: "Legacy alias for /hammer — use /hammer instead", // legacy alias — explicit-legacy-alias-marker
    getArgumentCompletions: () => [], // hidden — no completions for legacy alias
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await hammerCommandHandler(args, ctx, pi, { isLegacyAlias: true });
    },
  });
}

/**
 * @deprecated use registerHammerCommand + registerGSDLegacyAlias instead
 * Retained for any internal callers during the migration period.
 */
export function registerGSDCommand(pi: ExtensionAPI): void { // legacy alias for compatibility — explicit-legacy-alias-marker
  registerHammerCommand(pi);
  registerGSDLegacyAlias(pi);
}
