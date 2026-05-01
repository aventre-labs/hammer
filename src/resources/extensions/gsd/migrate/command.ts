/**
 * /gsd migrate — lift legacy layouts (`.planning/`, `.gsd/`) to `.hammer/`.
 *
 * Thin UX orchestrator: routes through `liftLegacyLayoutsToHammer` (the slice
 * S07 core) to handle all three legacy-layout cases — `.planning/`-only,
 * `.gsd/`-only, and both-present (per D014: lift `.gsd/`, rename `.planning/`
 * without re-parsing). The lift core is shared with `init-wizard.ts:offerMigration`.
 *
 * For `.planning/`-only lifts we pre-compute the migration preview so the
 * post-write GSD-2 review prompt has accurate stats. The review prompt is
 * only dispatched when a `.planning/` lift actually occurred (not when
 * `.planning/` is renamed-without-recopy in the both-present case, and not
 * for `.gsd/`-only lifts where the on-disk format is already canonical).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { showNextAction } from "../../shared/tui.js";
import {
  validatePlanningDirectory,
  parsePlanningDirectory,
  transformToGSD,
  generatePreview,
  liftLegacyLayoutsToHammer,
  detectLegacyLayouts,
  LiftError,
} from "./index.js";

import type { MigrationPreview } from "./writer.js";

/** Format preview stats for embedding in the review prompt. */
function formatPreviewStats(preview: MigrationPreview): string {
  const lines = [
    `- Milestones: ${preview.milestoneCount}`,
    `- Slices: ${preview.totalSlices} (${preview.doneSlices} done — ${preview.sliceCompletionPct}%)`,
    `- Tasks: ${preview.totalTasks} (${preview.doneTasks} done — ${preview.taskCompletionPct}%)`,
  ];
  if (preview.requirements.total > 0) {
    lines.push(
      `- Requirements: ${preview.requirements.total} (${preview.requirements.validated} validated, ${preview.requirements.active} active, ${preview.requirements.deferred} deferred)`,
    );
  }
  return lines.join("\n");
}

/** Load and interpolate the review-migration prompt template. */
function buildReviewPrompt(
  sourcePath: string,
  gsdPath: string,
  preview: MigrationPreview,
): string {
  const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");
  const templatePath = join(promptsDir, "review-migration.md");
  let content = readFileSync(templatePath, "utf-8");

  content = content.replaceAll("{{sourcePath}}", sourcePath);
  content = content.replaceAll("{{gsdPath}}", gsdPath);
  content = content.replaceAll("{{previewStats}}", formatPreviewStats(preview));

  return content.trim();
}

/** Dispatch the review prompt to the agent. */
function dispatchReview(
  pi: ExtensionAPI,
  sourcePath: string,
  gsdPath: string,
  preview: MigrationPreview,
): void {
  const prompt = buildReviewPrompt(sourcePath, gsdPath, preview);

  pi.sendMessage(
    {
      customType: "gsd-migrate-review",
      content: prompt,
      display: false,
    },
    { triggerTurn: true },
  );
}

export async function handleMigrate(
  _args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const basePath = process.cwd();

  // ── Detect legacy layouts ──────────────────────────────────────────────────
  const detection = detectLegacyLayouts(basePath);

  // No legacy state and no `.hammer/` either → nothing to migrate.
  if (!detection.hasPlanning && !detection.hasGsd && !detection.hasHammer) {
    ctx.ui.notify(
      "No legacy state detected.\n\n" +
        "Migration lifts a `.planning/` (GSD v1) or `.gsd/` (GSD v2) directory into `.hammer/`.\n" +
        "If you are starting a new project, use `/hammer init` instead.",
      "error",
    );
    return;
  }

  // `.hammer/` already exists with no un-renamed legacy sources → no-op (lift
  // reports `already-migrated`). Tell the user up-front so we don't ask them
  // to confirm a no-op.
  if (
    detection.hasHammer &&
    !detection.hasPlanning &&
    !detection.hasGsd
  ) {
    ctx.ui.notify(
      ".hammer/ already exists and no un-renamed legacy sources remain — nothing to migrate.",
      "info",
    );
    return;
  }

  // ── Build layout-aware preview ─────────────────────────────────────────────
  const both = detection.hasPlanning && detection.hasGsd;
  const planningOnly = detection.hasPlanning && !detection.hasGsd;

  // For `.planning/`-only we pre-compute the GSD-2 preview so dispatchReview
  // has accurate stats. Lift will re-parse internally — duplicate work, but
  // it keeps the unified `liftLegacyLayoutsToHammer` core as the single
  // codepath (per slice S07 integration closure). For `.gsd/`-only and
  // both-present cases we skip parse/preview entirely (no GSD-2 transform
  // happens, and the review prompt is GSD-1 → GSD-2 specific).
  let planningPreview: MigrationPreview | undefined;
  if (planningOnly) {
    const planningPath = join(basePath, ".planning");
    const validation = await validatePlanningDirectory(planningPath);

    const warnings = validation.issues.filter((i) => i.severity === "warning");
    const fatals = validation.issues.filter((i) => i.severity === "fatal");

    for (const w of warnings) ctx.ui.notify(`⚠ ${w.message} (${w.file})`, "warning");
    for (const f of fatals) ctx.ui.notify(`✖ ${f.message} (${f.file})`, "error");

    if (!validation.valid) {
      ctx.ui.notify(
        "Migration blocked — fix the fatal issues above before retrying.",
        "error",
      );
      return;
    }

    const parsed = await parsePlanningDirectory(planningPath);
    const project = transformToGSD(parsed);
    planningPreview = generatePreview(project);
  }

  const summaryLines: string[] = [];
  const renameNote = "(source renamed to `.{layout}.migrated-{timestamp}/`)";

  if (both) {
    summaryLines.push("Two legacy layouts detected:");
    summaryLines.push("  • `.gsd/`  → `.hammer/` (recursive copy)");
    summaryLines.push(
      "  • `.planning/` → renamed in place (NOT re-parsed — `.gsd/` wins; D014)",
    );
    summaryLines.push(renameNote);
  } else if (planningOnly && planningPreview) {
    summaryLines.push("`.planning/` (GSD v1) → `.hammer/` via GSD-2 transform");
    summaryLines.push(renameNote);
    summaryLines.push("");
    summaryLines.push(
      `Milestones: ${planningPreview.milestoneCount}`,
    );
    summaryLines.push(
      `Slices: ${planningPreview.totalSlices} (${planningPreview.doneSlices} done — ${planningPreview.sliceCompletionPct}%)`,
    );
    summaryLines.push(
      `Tasks: ${planningPreview.totalTasks} (${planningPreview.doneTasks} done — ${planningPreview.taskCompletionPct}%)`,
    );
    if (planningPreview.requirements.total > 0) {
      summaryLines.push(
        `Requirements: ${planningPreview.requirements.total} (${planningPreview.requirements.validated} validated, ${planningPreview.requirements.active} active, ${planningPreview.requirements.deferred} deferred)`,
      );
    }
  } else if (detection.hasGsd) {
    summaryLines.push("`.gsd/` (GSD v2) → `.hammer/` (recursive copy)");
    summaryLines.push(renameNote);
  } else if (detection.hasHammer) {
    // `.hammer/` exists AND a legacy source has not been renamed →
    // partial-failure resume case. Tell the user we'll just finish the rename.
    summaryLines.push(
      "`.hammer/` is already populated, but a legacy source has not been renamed.",
    );
    summaryLines.push(
      "This looks like a previous lift was interrupted — confirm to finish the rename.",
    );
  }

  // ── Confirmation via showNextAction ────────────────────────────────────────
  const confirmLabel = detection.hasHammer && !planningOnly && !both && !detection.hasGsd
    ? "Finish interrupted lift"
    : "Lift to .hammer/";
  const choice = await showNextAction(ctx, {
    title: "Migration preview",
    summary: summaryLines,
    actions: [
      {
        id: "confirm",
        label: confirmLabel,
        description: `Run lift in ${basePath}`,
        recommended: true,
      },
      {
        id: "cancel",
        label: "Cancel",
        description: "Exit without writing anything",
      },
    ],
    notYetMessage: "Run /hammer migrate again when ready.",
  });

  if (choice !== "confirm") {
    ctx.ui.notify("Migration cancelled — no files were written.", "info");
    return;
  }

  // ── Lift ───────────────────────────────────────────────────────────────────
  ctx.ui.notify("Lifting legacy state to .hammer/…", "info");

  // Wire the lift's stage-tagged notify lines through ctx.ui.notify so the
  // user sees [lift:detect], [lift:copy], [lift:rename-source], etc.
  const notify: (msg: string, level?: "info" | "warning" | "error") => void = (
    msg,
    level,
  ) => ctx.ui.notify(msg, level ?? "info");

  let result;
  try {
    result = await liftLegacyLayoutsToHammer(basePath, { notify });
  } catch (err) {
    if (err instanceof LiftError) {
      const layoutNote = err.layout ? ` for legacy layout \`${err.layout}\`` : "";
      const pathNote = err.pathOnDisk ? ` at ${err.pathOnDisk}` : "";
      ctx.ui.notify(
        `Lift failed during stage \`${err.stage}\`${layoutNote}${pathNote} — ${err.message}\n` +
          "Re-run /hammer migrate to resume from where it stopped.",
        "error",
      );
      return;
    }
    throw err;
  }

  if (result.status === "already-migrated") {
    ctx.ui.notify(
      ".hammer/ already populated — no work needed. Previous renamed sources: " +
        (result.layouts.length > 0 ? result.layouts.join(", ") : "(none recorded)"),
      "info",
    );
    return;
  }

  if (result.status === "no-legacy") {
    ctx.ui.notify(
      "No legacy layouts present at lift time — nothing was changed.",
      "info",
    );
    return;
  }

  const renamedLines = result.renamed.map(
    (r) => `  • ${r.layout}: ${r.from} → ${r.to}`,
  );
  if (result.status === "resumed") {
    ctx.ui.notify(
      `✓ Lift resumed — finished pending source rename(s):\n${renamedLines.join("\n")}`,
      "info",
    );
    return;
  }

  // status === 'lifted'
  ctx.ui.notify(
    `✓ Migration complete — lifted ${result.layouts.join(" + ")} → .hammer/.\n${renamedLines.join("\n")}`,
    "info",
  );

  // ── Post-write review offer ────────────────────────────────────────────────
  // Only dispatch the GSD-1 → GSD-2 review when a `.planning/` lift actually
  // happened. In the both-present case `.planning/` is renamed but its
  // content was NOT re-parsed (D014), so the GSD-2 review prompt does not
  // apply. In the `.gsd/`-only case the on-disk format was already canonical.
  const planningWasLifted =
    result.status === "lifted" &&
    !detection.hasGsd &&
    result.layouts.includes("planning") &&
    planningPreview !== undefined;

  if (!planningWasLifted) return;

  const reviewChoice = await showNextAction(ctx, {
    title: "Migration written",
    summary: [
      "GSD v1 (.planning/) was transformed into GSD-2 (.hammer/).",
      "",
      "The agent can now review the migrated output against GSD-2 standards —",
      "checking structure, content quality, deriveState() round-trip, and",
      "requirement statuses. It will fix minor issues in-place.",
    ],
    actions: [
      {
        id: "review",
        label: "Review migration",
        description: "Agent audits the .hammer/ output and reports PASS/FAIL per category",
        recommended: true,
      },
      {
        id: "skip",
        label: "Skip review",
        description: "Trust the migration output as-is",
      },
    ],
    notYetMessage: "Run /hammer migrate again to re-migrate, or review .hammer/ manually.",
  });

  if (reviewChoice === "review") {
    // Best-effort: source is the now-renamed .planning.migrated-<ts>/. Use the
    // renamed entry so the review prompt's sourcePath matches what's on disk.
    const renamedPlanning = result.renamed.find((r) => r.layout === "planning");
    const sourcePath = renamedPlanning?.to ?? join(basePath, ".planning");
    dispatchReview(pi, sourcePath, result.hammerPath, planningPreview!);
  }
}
