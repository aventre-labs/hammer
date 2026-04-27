/**
 * GSD bootstrappers for .gitignore and PREFERENCES.md
 *
 * Ensures baseline .gitignore exists with universally-correct patterns.
 * Creates an empty PREFERENCES.md template if it doesn't exist.
 * Both idempotent — non-destructive if already present.
 */

import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { nativeRmCached, nativeLsFiles } from "./native-git-bridge.js";
import { gsdRoot } from "./paths.js";
import { GIT_NO_PROMPT_ENV } from "./git-constants.js";
import {
  HAMMER_STATE_DIR_NAME,
  HAMMER_PROJECT_MARKER_FILE,
  HAMMER_HOME_ENV,
  HAMMER_LEGACY_ENV_ALIASES,
} from "../../../hammer-identity/index.js";

/**
 * Hammer and legacy GSD runtime patterns for git index cleanup.
 *
 * CANONICAL SOURCE OF TRUTH: This array is the authoritative list of runtime
 * ignore patterns. Other modules (RUNTIME_EXCLUSION_PATHS in git-service.ts,
 * SKIP_* arrays in worktree-manager.ts, criticalPatterns in doctor-runtime-checks.ts)
 * must stay synchronized with this list.
 *
 * Includes both .hammer/ (canonical) and .gsd/ (legacy import bridge — gitignore-baseline-legacy-patterns)
 * patterns so both layouts are kept out of git regardless of which state dir is in use.
 *
 * With external state (symlink), these are a no-op in most cases,
 * but retained for backwards compatibility during migration.
 */
const GSD_RUNTIME_PATTERNS = [
  // Canonical Hammer runtime state
  ".hammer/activity/",
  ".hammer/audit/",
  ".hammer/forensics/",
  ".hammer/runtime/",
  ".hammer/worktrees/",
  ".hammer/parallel/",
  ".hammer/auto.lock",
  ".hammer/metrics.json",
  ".hammer/completed-units*.json",
  ".hammer/state-manifest.json",
  ".hammer/STATE.md",
  ".hammer/gsd.db*",
  ".hammer/journal/",
  ".hammer/doctor-history.jsonl",
  ".hammer/event-log.jsonl",
  ".hammer/DISCUSSION-MANIFEST.json",
  ".hammer/milestones/**/*-CONTINUE.md",
  ".hammer/milestones/**/continue.md",
  // Legacy .gsd runtime state — gitignore-baseline-legacy-patterns
  ".gsd/activity/",
  ".gsd/audit/",
  ".gsd/forensics/",
  ".gsd/runtime/",
  ".gsd/worktrees/",
  ".gsd/parallel/",
  ".gsd/auto.lock",
  ".gsd/metrics.json",
  ".gsd/completed-units*.json",
  ".gsd/state-manifest.json",
  ".gsd/STATE.md",
  ".gsd/gsd.db*",
  ".gsd/journal/",
  ".gsd/doctor-history.jsonl",
  ".gsd/event-log.jsonl",
  ".gsd/DISCUSSION-MANIFEST.json",
  ".gsd/milestones/**/*-CONTINUE.md",
  ".gsd/milestones/**/continue.md",
] as const;

const BASELINE_PATTERNS = [
  // ── Hammer state directory (canonical) ──
  ".hammer",
  ".hammer-id",
  // ── GSD state directory (legacy import bridge — gitignore-baseline-legacy-patterns) ──
  ".gsd",
  ".gsd-id",
  ".mcp.json",
  ".bg-shell/",

  // ── OS junk ──
  ".DS_Store",
  "Thumbs.db",

  // ── Editor / IDE ──
  "*.swp",
  "*.swo",
  "*~",
  ".idea/",
  ".vscode/",
  "*.code-workspace",

  // ── Environment / secrets ──
  ".env",
  ".env.*",
  "!.env.example",

  // ── Node / JS / TS ──
  "node_modules/",
  ".next/",
  "dist/",
  "build/",

  // ── Python ──
  "__pycache__/",
  "*.pyc",
  ".venv/",
  "venv/",

  // ── Rust ──
  "target/",

  // ── Go ──
  "vendor/",

  // ── Misc build artifacts ──
  "*.log",
  "coverage/",
  ".cache/",
  "tmp/",
];

/**
 * Check whether `.hammer` (canonical) or `.gsd` (legacy import bridge) is
 * covered by the project's `.gitignore`.
 *
 * Uses `git check-ignore` for accurate evaluation — this respects nested
 * .gitignore files, global gitignore, and negation patterns. Returns true
 * when either state directory path is ignored.
 *
 * Returns false (not ignored) if:
 *   - No `.gitignore` exists
 *   - Neither state path is listed in any active ignore rule
 *   - Not a git repo or git is unavailable
 */
export function isGsdGitignored(basePath: string): boolean {
  // Check both canonical .hammer paths and legacy .gsd paths (state-namespace-bridge)
  const pathsToCheck = [
    ".hammer", ".hammer/",
    ".gsd", ".gsd/",     // legacy import bridge — gitignore-baseline-legacy-patterns
  ];
  for (const path of pathsToCheck) {
    try {
      execFileSync("git", ["check-ignore", "-q", path], {
        cwd: basePath,
        stdio: "pipe",
        env: GIT_NO_PROMPT_ENV,
      });
      return true; // exit 0 → path is ignored
    } catch {
      // exit 1 → this form is NOT ignored, try the next
    }
  }
  return false;
}

/**
 * Check whether a project state directory (`.hammer` canonical, or `.gsd` legacy import bridge)
 * contains files tracked by git.
 * If so, the project intentionally keeps state in version control
 * and we must NOT add state dir to `.gitignore` or attempt migration.
 *
 * Returns true if git tracks at least one file under the state dir.
 * Returns false (safe to ignore) if:
 *   - Not a git repo
 *   - State dir is a symlink (external state, should be ignored)
 *   - State dir doesn't exist
 *   - No tracked files found under the state dir
 */
export function hasGitTrackedGsdFiles(basePath: string): boolean {
  // Check canonical .hammer first, then legacy .gsd (state-namespace-bridge)
  for (const dirName of [HAMMER_STATE_DIR_NAME, ".gsd"]) { // .gsd — legacy import bridge — gitignore-baseline-legacy-patterns
    const localDir = join(basePath, dirName);
    if (!existsSync(localDir)) continue;
    try {
      if (lstatSync(localDir).isSymbolicLink()) continue; // symlink — no tracked files concern
    } catch {
      continue;
    }

    try {
      const tracked = nativeLsFiles(basePath, dirName);
      if (tracked.length > 0) return true;

      // Verify git is reachable before trusting the empty result
      execFileSync("git", ["rev-parse", "--git-dir"], {
        cwd: basePath,
        stdio: "pipe",
        env: GIT_NO_PROMPT_ENV,
      });
    } catch {
      // git unavailable, index locked, or repo corrupt — fail safe
      return true;
    }
  }

  return false;
}

/**
 * Ensure basePath/.gitignore contains baseline ignore patterns.
 * Creates the file if missing; appends missing patterns.
 * Returns true if the file was created or modified, false if already complete.
 *
 * **Safety check:** If the project state directory (`.hammer` or `.gsd`) contains
 * git-tracked files (i.e., the project intentionally keeps state in version
 * control), the state dir ignore patterns are excluded to prevent data loss.
 */
export function ensureGitignore(
  basePath: string,
  options?: { manageGitignore?: boolean },
): boolean {
  // If manage_gitignore is explicitly false, do not touch .gitignore at all
  if (options?.manageGitignore === false) return false;

  const gitignorePath = join(basePath, ".gitignore");

  let existing = "";
  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, "utf-8");
  }

  // Parse existing lines (trimmed, ignoring comments and blanks)
  const existingLines = new Set(
    existing
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );

  // Determine which patterns to apply. If any state dir has tracked files,
  // exclude that specific state dir's patterns to prevent deleting tracked state.
  const stateIsTracked = hasGitTrackedGsdFiles(basePath);
  const patternsToApply = stateIsTracked
    ? BASELINE_PATTERNS.filter((p) => p !== ".hammer" && p !== ".gsd")
    : BASELINE_PATTERNS;

  // Find patterns not yet present
  const missing = patternsToApply.filter((p) => !existingLines.has(p));

  if (missing.length === 0) return false;

  // Build the block to append
  const block = [
    "",
    "# ── Hammer baseline (auto-generated) ──",
    ...missing,
    "",
  ].join("\n");

  // Ensure existing content ends with a newline before appending
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, existing + prefix + block, "utf-8");

  return true;
}

/**
 * Remove BASELINE_PATTERNS runtime paths from the git index if they are
 * currently tracked. This fixes repos that started tracking these files
 * before the .gitignore rule was added — git continues tracking files
 * already in the index even after .gitignore is updated.
 *
 * Only removes from the index (`--cached`), never from disk. Idempotent.
 *
 * Note: These are strictly runtime/ephemeral paths (activity logs, lock files,
 * metrics, STATE.md). They are always safe to untrack, even when the project
 * intentionally keeps other `.gsd/` files (like PROJECT.md, milestones/) in
 * version control.
 */
export function untrackRuntimeFiles(basePath: string): void {
  const runtimePaths = GSD_RUNTIME_PATTERNS;

  for (const pattern of runtimePaths) {
    // Use -r for directory patterns (trailing slash), strip the slash for the command
    const target = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
    try {
      nativeRmCached(basePath, [target]);
    } catch {
      // File not tracked or doesn't exist — expected, ignore
    }
  }
}

/**
 * Ensure basePath/[state-dir]/PREFERENCES.md exists as an empty template.
 * Creates the file with frontmatter only if it doesn't exist.
 * Returns true if created, false if already exists.
 *
 * Uses the canonical Hammer state directory (from gsdRoot, which probes
 * .hammer first), then checks legacy .gsd paths to avoid creating duplicates.
 */
export function ensurePreferences(basePath: string): boolean {
  const stateRoot = gsdRoot(basePath); // .hammer or .gsd depending on what exists
  const preferencesPath = join(stateRoot, "PREFERENCES.md");
  const legacyPath = join(stateRoot, "preferences.md");

  if (existsSync(preferencesPath) || existsSync(legacyPath)) {
    return false;
  }

  const template = `---
version: 1
always_use_skills: []
prefer_skills: []
avoid_skills: []
skill_rules: []
custom_instructions: []
models: {}
skill_discovery: {}
auto_supervisor: {}
---

# Hammer Skill Preferences

Project-specific guidance for skill selection, IAM-aware execution defaults, and no-degradation preferences.

Project preferences live in \`.hammer/PREFERENCES.md\`; global defaults live in \`~/.hammer/PREFERENCES.md\`.
See \`~/.hammer/agent/extensions/gsd/docs/preferences-reference.md\` for full field documentation and examples.

## Skill selection guidance

- Prefer skills that preserve Hammer IAM role, provenance, verification, and artifact contracts.
- No-degradation rule: preferences cannot weaken required tests, quality gates, state-namespace constraints, or higher-priority instructions.

## Fields

- \`always_use_skills\`: Skills that must be available during all Hammer operations
- \`prefer_skills\`: Skills to prioritize when multiple options exist
- \`avoid_skills\`: Skills to minimize or avoid (with lower priority than prefer)
- \`skill_rules\`: Context-specific rules (e.g., "use tool X for Y type of work")
- \`custom_instructions\`: Append-only project guidance (do not override system rules)
- \`models\`: Model preferences for specific task types
- \`skill_discovery\`: Automatic skill detection preferences
- \`auto_supervisor\`: Supervision and gating rules for autonomous modes
- \`git\`: Git preferences — \`main_branch\` (default branch name for new repos, e.g., "main", "master", "trunk"), \`auto_push\`, \`snapshots\`, etc.

## Examples

\`\`\`yaml
prefer_skills:
  - playwright
  - resolve_library
avoid_skills:
  - subagent  # prefer direct execution in this project

custom_instructions:
  - "Always verify with browser_assert before marking UI work done"
  - "Use Context7 for all library/framework decisions"
\`\`\`
`;

  writeFileSync(preferencesPath, template, "utf-8");
  return true;
}
