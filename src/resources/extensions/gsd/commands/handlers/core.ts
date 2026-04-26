import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@gsd/pi-coding-agent";
import type { Model } from "@gsd/pi-ai";
import type { GSDState } from "../../types.js";

import { computeProgressScore, formatProgressLine } from "../../progress-score.js";
import { loadEffectiveGSDPreferences, getGlobalGSDPreferencesPath, getProjectGSDPreferencesPath } from "../../preferences.js";
import { ensurePreferencesFile, handlePrefs, handlePrefsMode, handlePrefsWizard, handleLanguage } from "../../commands-prefs-wizard.js";
import { runEnvironmentChecks } from "../../doctor-environment.js";
import { deriveState } from "../../state.js";
import { handleCmux } from "../../commands-cmux.js";
import { setSessionModelOverride } from "../../session-model-override.js";
import { projectRoot } from "../context.js";
import { formattedShortcutPair } from "../../shortcut-defs.js";

export function showHelp(ctx: ExtensionCommandContext, args = ""): void {
  const summaryLines = [
    "Hammer\n",
    "QUICK START",
    "  /hammer start <tpl>   Start a workflow template",
    "  /hammer               Run next unit (same as /hammer next)",
    "  /hammer auto          Run all queued units continuously",
    "  /hammer pause         Pause auto-mode",
    "  /hammer stop          Stop auto-mode gracefully",
    "",
    "VISIBILITY",
    `  /hammer status         Dashboard  (${formattedShortcutPair("dashboard")})`,
    `  /hammer parallel watch Parallel monitor  (${formattedShortcutPair("parallel")})`,
    `  /hammer notifications  Notification history  (${formattedShortcutPair("notifications")})`,
    "  /hammer visualize      Interactive 10-tab TUI",
    "  /hammer queue          Show queued/dispatched units",
    "",
    "COURSE CORRECTION",
    "  /hammer steer <desc>   Apply user override to active work",
    "  /hammer capture <text> Quick-capture a thought to CAPTURES.md",
    "  /hammer triage         Classify and route pending captures",
    "  /hammer undo           Revert last completed unit  [--force]",
    "  /hammer rethink        Conversational project reorganization",
    "",
    "OBSERVABILITY",
    "  /hammer logs           Browse activity and debug logs",
    "  /hammer debug          Create/list/continue persistent debug sessions",
    "",
    "SETUP",
    "  /hammer onboarding     Re-run setup wizard  [--resume|--reset|--step <name>]",
    "  /hammer setup          Configuration hub  [llm|model|search|remote|keys|prefs|onboarding]",
    "  /hammer init           Project init wizard",
    "  /hammer model          Switch active session model",
    "  /hammer prefs          Manage preferences (alias for /hammer setup prefs)",
    "  /hammer keys           API key manager (LLM + tool keys)",
    "  /hammer doctor         Diagnose and repair .hammer/ state",
    "",
    "Use /hammer help full for the complete command reference.",
  ];

  const fullLines = [
    "Hammer\n",
    "WORKFLOW",
    "  /hammer start <tpl>   Start a workflow template (bugfix, spike, feature, hotfix, etc.)",
    "  /hammer templates     List available workflow templates  [info <name>]",
    "  /hammer               Run next unit in step mode (same as /hammer next)",
    "  /hammer next           Execute next task, then pause  [--dry-run] [--verbose]",
    "  /hammer auto           Run all queued units continuously  [--verbose]",
    "  /hammer stop           Stop auto-mode gracefully",
    "  /hammer pause          Pause auto-mode (preserves state, /hammer auto to resume)",
    "  /hammer discuss        Start guided milestone/slice discussion",
    "  /hammer new-milestone  Create milestone from headless context (used by hammer headless)",
    "  /hammer quick          Execute a quick task without full planning overhead",
    "  /hammer dispatch       Dispatch a specific phase directly  [research|plan|execute|complete|uat|replan]",
    "  /hammer parallel       Parallel milestone orchestration  [start|status|stop|pause|resume|merge|watch]",
    "  /hammer workflow       Custom workflow lifecycle  [new|run|list|validate|pause|resume]",
    "",
    "VISIBILITY",
    `  /hammer status         Show progress dashboard  (${formattedShortcutPair("dashboard")})`,
    `  /hammer parallel watch Open parallel worker monitor  (${formattedShortcutPair("parallel")})`,
    "  /hammer widget         Cycle status widget  [full|small|min|off]",
    "  /hammer visualize      Interactive 10-tab TUI (progress, timeline, deps, metrics, health, agent, changes, knowledge, captures, export)",
    "  /hammer queue          Show queued/dispatched units and execution order",
    "  /hammer history        View execution history  [--cost] [--phase] [--model] [N]",
    "  /hammer changelog      Show categorized release notes  [version]",
    `  /hammer notifications  View persistent notification history  [clear|tail|filter]  (${formattedShortcutPair("notifications")})`,
    "  /hammer logs           Browse activity logs, debug logs, and metrics  [debug|tail|clear]",
    "  /hammer debug          Create/list/continue persistent debug sessions",
    "",
    "COURSE CORRECTION",
    "  /hammer steer <desc>   Apply user override to active work",
    "  /hammer capture <text> Quick-capture a thought to CAPTURES.md",
    "  /hammer triage         Classify and route pending captures",
    "  /hammer skip <unit>    Prevent a unit from auto-mode dispatch",
    "  /hammer undo           Revert last completed unit  [--force]",
    "  /hammer undo-task      Reset a specific task's completion state  [DB + markdown]",
    "  /hammer reset-slice    Reset a slice and all its tasks  [DB + markdown]",
    "  /hammer rate           Rate last unit's model tier  [over|ok|under]",
    "  /hammer rethink        Conversational project reorganization — reorder, park, discard, add milestones",
    "  /hammer park [id]      Park a milestone — skip without deleting  [reason]",
    "  /hammer unpark [id]    Reactivate a parked milestone",
    "",
    "PROJECT KNOWLEDGE",
    "  /hammer knowledge <type> <text>   Add rule, pattern, or lesson to KNOWLEDGE.md",
    "  /hammer codebase [generate|update|stats]   Manage the CODEBASE.md cache used in prompt context",
    "",
    "SHIPPING & BACKLOG",
    "  /hammer ship           Create a PR from milestone artifacts  [--dry-run|--draft|--base|--force]",
    "  /hammer do <text>      Route freeform text to the right Hammer command",
    "  /hammer session-report Show session cost, tokens, and work summary  [--json|--save]",
    "  /hammer backlog        Manage backlog items  [add|promote|remove|list]",
    "  /hammer pr-branch      Create a clean PR branch filtering .hammer/ commits  [--dry-run|--name]",
    "  /hammer add-tests      Generate tests for completed slices",
    "  /hammer scan           Rapid codebase assessment  [--focus tech|arch|quality|concerns|tech+arch]",
    "",
    "SETUP & CONFIGURATION",
    "  /hammer onboarding     Re-run setup wizard  [--resume|--reset|--step <name>]",
    "  /hammer setup          Configuration hub  [llm|model|search|remote|keys|prefs|onboarding]",
    "  /hammer init           Project init wizard — detect, configure, bootstrap .hammer/",
    "  /hammer model          Switch active session model  [provider/model|model-id]",
    "  /hammer mode           Set workflow mode (solo/team)  [global|project]",
    "  /hammer prefs          Manage preferences  [global|project|status|wizard|setup|import-claude]  (alias for /hammer setup prefs)",
    "  /hammer cmux           Manage cmux integration  [status|on|off|notifications|sidebar|splits|browser]",
    "  /hammer keys           API key manager (LLM + tool keys)  [list|add|remove|test|rotate|doctor]",
    "  /hammer config         (deprecated) Set tool API keys — use /hammer keys instead",
    "  /hammer show-config    Show effective configuration (models, routing, toggles)",
    "  /hammer hooks          Show post-unit hook configuration",
    "  /hammer run-hook       Manually trigger a specific hook",
    "  /hammer skill-health   Skill lifecycle dashboard",
    "  /hammer extensions     Manage extensions  [list|enable|disable|info]",
    "  /hammer fast           Toggle OpenAI service tier  [on|off|flex|status]",
    "  /hammer mcp            MCP server status and connectivity  [status|check <server>|init [dir]]",
    "",
    "MAINTENANCE",
    "  /hammer doctor         Diagnose and repair .hammer/ state  [audit|fix|heal] [scope]",
    "  /hammer forensics      Examine execution logs and post-mortem analysis",
    "  /hammer export         Export milestone/slice results  [--json|--markdown|--html] [--all]",
    "  /hammer cleanup        Remove merged branches or snapshots  [branches|snapshots]",
    "  /hammer migrate        Migrate .planning/ (v1) to .hammer/ (v2) format",
    "  /hammer remote         Control remote auto-mode  [slack|discord|status|disconnect]",
    "  /hammer inspect        Show SQLite DB diagnostics (schema, row counts, recent entries)",
    "  /hammer update         Update Hammer to the latest version via npm",
    "  /hammer language       Set or clear the global response language  [off|clear|<language>]",
  ];
  const full = ["full", "--full", "all"].includes(args.trim().toLowerCase());
  ctx.ui.notify((full ? fullLines : summaryLines).join("\n"), "info");
}

export async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
  const basePath = projectRoot();
  // Open DB in cold sessions so status uses DB-backed state, not filesystem fallback (#3385)
  const { ensureDbOpen } = await import("../../bootstrap/dynamic-tools.js");
  await ensureDbOpen();
  const state = await deriveState(basePath);

  if (state.registry.length === 0) {
    ctx.ui.notify("No Hammer milestones found. Run /hammer to start.", "info");
    return;
  }

  const { GSDDashboardOverlay } = await import("../../dashboard-overlay.js");
  const result = await ctx.ui.custom<boolean>(
    (tui, theme, _kb, done) => new GSDDashboardOverlay(tui, theme, () => done(true)),
    {
      overlay: true,
      overlayOptions: {
        width: "90%",
        minWidth: 80,
        maxHeight: "92%",
        anchor: "center",
      },
    },
  );

  if (result === undefined) {
    ctx.ui.notify(formatTextStatus(state), "info");
  }
}

export async function fireStatusViaCommand(ctx: ExtensionContext): Promise<void> {
  await handleStatus(ctx as ExtensionCommandContext);
}

export async function handleVisualize(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Visualizer requires an interactive terminal.", "warning");
    return;
  }

  const { GSDVisualizerOverlay } = await import("../../visualizer-overlay.js");
  const result = await ctx.ui.custom<boolean>(
    (tui, theme, _kb, done) => new GSDVisualizerOverlay(tui, theme, () => done(true)),
    {
      overlay: true,
      overlayOptions: {
        width: "80%",
        minWidth: 80,
        maxHeight: "90%",
        anchor: "center",
      },
    },
  );

  if (result === undefined) {
    ctx.ui.notify("Visualizer requires an interactive terminal. Use /hammer status for a text-based overview.", "warning");
  }
}

export async function handleSetup(args: string, ctx: ExtensionCommandContext, pi?: ExtensionAPI): Promise<void> {
  const { detectProjectState, hasGlobalSetup } = await import("../../detection.js");
  const { isOnboardingComplete, readOnboardingRecord } = await import("../../onboarding-state.js");

  // Sub-route dispatch — keep redirects but route the canonical work to /hammer
  // onboarding (single source for wizard steps) and /hammer keys (single source
  // for credentials).
  if (args === "onboarding" || args === "wizard") {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding("", ctx);
    return;
  }
  if (args === "llm" || args === "auth") {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding("--step llm", ctx);
    return;
  }
  if (args === "search") {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding("--step search", ctx);
    return;
  }
  if (args === "remote") {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding("--step remote", ctx);
    return;
  }
  if (args === "model") {
    await handleModel("", ctx, pi);
    return;
  }
  if (args === "keys") {
    ctx.ui.notify("Tip: /hammer keys is the canonical command for API key management.", "info");
    const { handleKeys } = await import("../../key-manager.js");
    await handleKeys("", ctx);
    return;
  }
  if (args === "prefs") {
    await ensurePreferencesFile(getGlobalGSDPreferencesPath(), ctx, "global");
    await handlePrefsWizard(ctx, "global");
    return;
  }

  // Bare /hammer setup — render the hub: status + actions
  const globalConfigured = hasGlobalSetup();
  const detection = detectProjectState(projectRoot());
  const onboardingDone = isOnboardingComplete();
  const record = readOnboardingRecord();

  const statusLines: string[] = ["Hammer Setup\n"];
  statusLines.push(
    onboardingDone
      ? `  Onboarding:         ✓ complete${record.completedAt ? ` (${record.completedAt.slice(0, 10)})` : ""}`
      : `  Onboarding:         ○ not complete  —  /hammer onboarding to start`,
  );
  statusLines.push(`  Global preferences: ${globalConfigured ? "configured" : "not set"}`);
  statusLines.push(`  Project state:      ${detection.state}`);
  if (detection.projectSignals.primaryLanguage) {
    statusLines.push(`  Detected:           ${detection.projectSignals.primaryLanguage}`);
  }

  ctx.ui.notify(statusLines.join("\n"), "info");
  ctx.ui.notify(
    "Configuration hub:\n" +
    "  /hammer setup llm        — LLM provider & auth\n" +
    "  /hammer setup model      — Default model picker\n" +
    "  /hammer setup search     — Web search provider\n" +
    "  /hammer setup remote     — Remote questions (Discord/Slack/Telegram)\n" +
    "  /hammer setup keys       — API keys (alias for /hammer keys)\n" +
    "  /hammer setup prefs      — Global preferences (alias for /hammer prefs)\n" +
    "  /hammer setup onboarding — Full wizard (alias for /hammer onboarding)\n\n" +
    "Tip: /hammer onboarding --resume to continue an incomplete setup.",
    "info",
  );
}

function sortModelsForSelection(models: Model<any>[], currentModel: Model<any> | undefined): Model<any>[] {
  return [...models].sort((a, b) => {
    const aCurrent = currentModel && a.provider === currentModel.provider && a.id === currentModel.id;
    const bCurrent = currentModel && b.provider === currentModel.provider && b.id === currentModel.id;
    if (aCurrent && !bCurrent) return -1;
    if (!aCurrent && bCurrent) return 1;
    const providerCmp = a.provider.localeCompare(b.provider);
    if (providerCmp !== 0) return providerCmp;
    return a.id.localeCompare(b.id);
  });
}

function buildProviderModelGroups(
  models: Model<any>[],
  currentModel: Model<any> | undefined,
): Map<string, Model<any>[]> {
  const byProvider = new Map<string, Model<any>[]>();

  for (const model of sortModelsForSelection(models, currentModel)) {
    let group = byProvider.get(model.provider);
    if (!group) {
      group = [];
      byProvider.set(model.provider, group);
    }
    group.push(model);
  }
  return byProvider;
}

async function selectModelByProvider(
  title: string,
  models: Model<any>[],
  ctx: ExtensionCommandContext,
  currentModel: Model<any> | undefined,
): Promise<Model<any> | undefined> {
  const byProvider = buildProviderModelGroups(models, currentModel);
  const providerOptions = Array.from(byProvider.entries()).map(([provider, group]) =>
    `${provider} (${group.length} model${group.length === 1 ? "" : "s"})`,
  );
  providerOptions.push("(cancel)");

  const providerChoice = await ctx.ui.select(`${title} — choose provider:`, providerOptions);
  if (!providerChoice || typeof providerChoice !== "string" || providerChoice === "(cancel)") return undefined;

  const providerName = providerChoice.replace(/ \(\d+ models?\)$/, "");
  const providerModels = byProvider.get(providerName);
  if (!providerModels || providerModels.length === 0) return undefined;

  const optionToModel = new Map<string, Model<any>>();
  const modelOptions = providerModels.map((model) => {
    const isCurrent = currentModel && model.provider === currentModel.provider && model.id === currentModel.id;
    const label = `${isCurrent ? "* " : ""}${model.id}`;
    optionToModel.set(label, model);
    return label;
  });
  modelOptions.push("(cancel)");

  const modelChoice = await ctx.ui.select(`${title} — ${providerName}:`, modelOptions);
  if (!modelChoice || typeof modelChoice !== "string" || modelChoice === "(cancel)") return undefined;
  return optionToModel.get(modelChoice);
}

async function resolveRequestedModel(
  query: string,
  ctx: ExtensionCommandContext,
): Promise<Model<any> | undefined> {
  const { resolveModelId } = await import("../../auto-model-selection.js");
  const models = ctx.modelRegistry.getAvailable();
  const exact = resolveModelId(query, models, ctx.model?.provider);
  if (exact) return exact;

  const lowerQuery = query.toLowerCase();
  const partialMatches = models.filter((model) =>
    model.id.toLowerCase().includes(lowerQuery)
      || `${model.provider}/${model.id}`.toLowerCase().includes(lowerQuery),
  );

  if (partialMatches.length === 1) return partialMatches[0];
  if (partialMatches.length === 0 || !ctx.hasUI) return undefined;
  return selectModelByProvider(`Multiple models match "${query}"`, partialMatches, ctx, ctx.model);
}

async function handleModel(trimmedArgs: string, ctx: ExtensionCommandContext, pi: ExtensionAPI | undefined): Promise<void> {
  const availableModels = ctx.modelRegistry.getAvailable();
  if (availableModels.length === 0) {
    ctx.ui.notify("No available models found. Check provider auth and model discovery.", "warning");
    return;
  }
  if (!pi) {
    ctx.ui.notify("Model switching is unavailable in this context.", "warning");
    return;
  }

  const trimmed = trimmedArgs.trim();
  let targetModel: Model<any> | undefined;

  if (!trimmed) {
    if (!ctx.hasUI) {
      const current = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "(none)";
      ctx.ui.notify(`Current model: ${current}\nUsage: /hammer model <provider/model|model-id>`, "info");
      return;
    }

    targetModel = await selectModelByProvider("Select session model:", availableModels, ctx, ctx.model);
  } else {
    targetModel = await resolveRequestedModel(trimmed, ctx);
  }

  if (!targetModel) {
    ctx.ui.notify(`Model "${trimmed}" not found. Use /hammer model with an exact provider/model or a unique model ID.`, "warning");
    return;
  }

  const ok = await pi.setModel(targetModel);
  if (!ok) {
    ctx.ui.notify(`No API key for ${targetModel.provider}/${targetModel.id}`, "warning");
    return;
  }

  // /hammer model is an explicit per-session pin for Hammer dispatches.
  // This is captured at auto bootstrap so it survives internal session
  // switches during /hammer auto and /hammer next runs.
  const sessionId = ctx.sessionManager?.getSessionId?.();
  if (sessionId) {
    setSessionModelOverride(sessionId, {
      provider: targetModel.provider,
      id: targetModel.id,
    });
  }

  ctx.ui.notify(`Model: ${targetModel.provider}/${targetModel.id}`, "info");
}

export async function handleCoreCommand(
  trimmed: string,
  ctx: ExtensionCommandContext,
  pi?: ExtensionAPI,
): Promise<boolean> {
  if (trimmed === "help" || trimmed === "h" || trimmed === "?" || trimmed.startsWith("help ")) {
    showHelp(ctx, trimmed.startsWith("help ") ? trimmed.slice(5).trim() : "");
    return true;
  }
  if (trimmed === "status") {
    await handleStatus(ctx);
    return true;
  }
  if (trimmed === "visualize") {
    await handleVisualize(ctx);
    return true;
  }
  if (trimmed === "widget" || trimmed.startsWith("widget ")) {
    const { cycleWidgetMode, setWidgetMode, getWidgetMode } = await import("../../auto-dashboard.js");
    const arg = trimmed.replace(/^widget\s*/, "").trim();
    if (arg === "full" || arg === "small" || arg === "min" || arg === "off") {
      setWidgetMode(arg);
    } else {
      cycleWidgetMode();
    }
    ctx.ui.notify(`Widget: ${getWidgetMode()}`, "info");
    return true;
  }
  if (trimmed === "model" || trimmed.startsWith("model ")) {
    await handleModel(trimmed.replace(/^model\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "mode" || trimmed.startsWith("mode ")) {
    const modeArgs = trimmed.replace(/^mode\s*/, "").trim();
    const scope = modeArgs === "project" ? "project" : "global";
    const path = scope === "project" ? getProjectGSDPreferencesPath() : getGlobalGSDPreferencesPath();
    await ensurePreferencesFile(path, ctx, scope);
    await handlePrefsMode(ctx, scope);
    return true;
  }
  if (trimmed === "prefs" || trimmed.startsWith("prefs ")) {
    await handlePrefs(trimmed.replace(/^prefs\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "language" || trimmed.startsWith("language ")) {
    await handleLanguage(trimmed.replace(/^language\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "cmux" || trimmed.startsWith("cmux ")) {
    await handleCmux(trimmed.replace(/^cmux\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "show-config") {
    const { GSDConfigOverlay, formatConfigText } = await import("../../config-overlay.js");
    const result = await ctx.ui.custom<boolean>(
      (tui, theme, _kb, done) => new GSDConfigOverlay(tui, theme, () => done(true)),
      {
        overlay: true,
        overlayOptions: {
          width: "65%",
          minWidth: 55,
          maxHeight: "85%",
          anchor: "center",
        },
      },
    );
    if (result === undefined) {
      ctx.ui.notify(formatConfigText(), "info");
    }
    return true;
  }
  if (trimmed === "setup" || trimmed.startsWith("setup ")) {
    await handleSetup(trimmed.replace(/^setup\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "onboarding" || trimmed.startsWith("onboarding ")) {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding(trimmed.replace(/^onboarding\s*/, "").trim(), ctx);
    return true;
  }
  return false;
}

export function formatTextStatus(state: GSDState): string {
  const lines: string[] = ["Hammer Status\n"];
  lines.push(formatProgressLine(computeProgressScore()));
  lines.push("");
  lines.push(`Phase: ${state.phase}`);

  if (state.activeMilestone) {
    lines.push(`Active milestone: ${state.activeMilestone.id} — ${state.activeMilestone.title}`);
  }
  if (state.activeSlice) {
    lines.push(`Active slice: ${state.activeSlice.id} — ${state.activeSlice.title}`);
  }
  if (state.activeTask) {
    lines.push(`Active task: ${state.activeTask.id} — ${state.activeTask.title}`);
  }
  if (state.progress) {
    const { milestones, slices, tasks } = state.progress;
    const parts: string[] = [`milestones ${milestones.done}/${milestones.total}`];
    if (slices) parts.push(`slices ${slices.done}/${slices.total}`);
    if (tasks) parts.push(`tasks ${tasks.done}/${tasks.total}`);
    lines.push(`Progress: ${parts.join(", ")}`);
  }
  if (state.nextAction) {
    lines.push(`Next: ${state.nextAction}`);
  }
  if (state.blockers.length > 0) {
    lines.push(`Blockers: ${state.blockers.join("; ")}`);
  }
  if (state.registry.length > 0) {
    lines.push("");
    lines.push("Milestones:");
    for (const milestone of state.registry) {
      const icon = milestone.status === "complete"
        ? "✓"
        : milestone.status === "active"
          ? "▶"
          : milestone.status === "parked"
            ? "⏸"
            : "○";
      lines.push(`  ${icon} ${milestone.id}: ${milestone.title} (${milestone.status})`);
    }
  }

  const envResults = runEnvironmentChecks(projectRoot());
  const envIssues = envResults.filter((result) => result.status !== "ok");
  if (envIssues.length > 0) {
    lines.push("");
    lines.push("Environment:");
    for (const issue of envIssues) {
      lines.push(`  ${issue.status === "error" ? "✗" : "⚠"} ${issue.message}`);
    }
  }

  return lines.join("\n");
}
