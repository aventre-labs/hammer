import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@gsd/pi-coding-agent";

import {
  getAutoCommandContext,
  getAutoDashboardData,
  startAuto,
  type AutoDashboardData,
} from "../auto.js";
import { resetTransientRetryState } from "./agent-end-recovery.js";

type AutoResumeSnapshot = Pick<AutoDashboardData, "active" | "paused" | "stepMode" | "basePath">;

export interface ProviderErrorResumeDeps {
  getSnapshot(): AutoResumeSnapshot;
  getCommandContext(): ExtensionCommandContext | null;
  resetTransientRetryState(): void;
  startAuto(
    ctx: ExtensionCommandContext,
    pi: ExtensionAPI,
    base: string,
    verboseMode: boolean,
    options?: { step?: boolean },
  ): Promise<void>;
}

const defaultDeps: ProviderErrorResumeDeps = {
  getSnapshot: () => getAutoDashboardData(),
  getCommandContext: () => getAutoCommandContext(),
  resetTransientRetryState,
  startAuto,
};

function hasSessionControl(ctx: ExtensionContext): ctx is ExtensionCommandContext {
  return typeof (ctx as Partial<ExtensionCommandContext>).newSession === "function";
}

export async function resumeAutoAfterProviderDelay(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  deps: ProviderErrorResumeDeps = defaultDeps,
): Promise<"resumed" | "already-active" | "not-paused" | "missing-base" | "missing-command-context"> {
  const snapshot = deps.getSnapshot();

  if (snapshot.active) return "already-active";
  if (!snapshot.paused) return "not-paused";

  if (!snapshot.basePath) {
    ctx.ui.notify(
      "Provider error recovery delay elapsed, but no paused auto-mode base path was available. Leaving auto-mode paused.",
      "warning",
    );
    return "missing-base";
  }

  const commandCtx = hasSessionControl(ctx) ? ctx : deps.getCommandContext();
  if (!commandCtx || !hasSessionControl(commandCtx)) {
    ctx.ui.notify(
      "Provider error recovery delay elapsed, but no command context is available to create a fresh session. Leaving auto-mode paused; run /gsd auto to resume.",
      "warning",
    );
    return "missing-command-context";
  }

  // Reset provider-error retry state before restarting. Session-creation
  // timeout state intentionally survives delayed resumes so the bounded
  // auto-resume limit cannot be reset into an infinite pause/resume loop.
  deps.resetTransientRetryState();

  await deps.startAuto(
    commandCtx,
    pi,
    snapshot.basePath,
    false,
    { step: snapshot.stepMode },
  );
  return "resumed";
}
