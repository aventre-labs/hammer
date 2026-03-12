/**
 * GSD Git Service
 *
 * Core git operations for GSD: types, constants, and pure helpers.
 * Higher-level operations (commit, staging, branching) build on these.
 *
 * This module centralizes the GitPreferences interface, runtime exclusion
 * paths, commit type inference, and the runGit shell helper.
 */

import { execSync } from "node:child_process";
import { sep } from "node:path";

import {
  detectWorktreeName,
  getSliceBranchName,
  SLICE_BRANCH_RE,
} from "./worktree.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GitPreferences {
  auto_push?: boolean;
  push_branches?: boolean;
  remote?: string;
  snapshots?: boolean;
  pre_merge_check?: boolean | string;
  commit_type?: string;
}

export interface CommitOptions {
  message: string;
  allowEmpty?: boolean;
}

export interface MergeSliceResult {
  branch: string;
  mergedCommitMessage: string;
  deletedBranch: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * GSD runtime paths that should be excluded from smart staging.
 * These are transient/generated artifacts that should never be committed.
 * Matches the union of SKIP_PATHS + SKIP_EXACT in worktree-manager.ts
 * and the first 6 entries in gitignore.ts BASELINE_PATTERNS.
 */
export const RUNTIME_EXCLUSION_PATHS: readonly string[] = [
  ".gsd/activity/",
  ".gsd/runtime/",
  ".gsd/worktrees/",
  ".gsd/auto.lock",
  ".gsd/metrics.json",
  ".gsd/STATE.md",
];

// ─── Git Helper ────────────────────────────────────────────────────────────

/**
 * Run a git command in the given directory.
 * Returns trimmed stdout. Throws on non-zero exit unless allowFailure is set.
 */
export function runGit(basePath: string, args: string[], options: { allowFailure?: boolean } = {}): string {
  try {
    return execSync(`git ${args.join(" ")}`, {
      cwd: basePath,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
  } catch (error) {
    if (options.allowFailure) return "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(" ")} failed in ${basePath}: ${message}`);
  }
}

// ─── Commit Type Inference ─────────────────────────────────────────────────

/**
 * Keyword-to-commit-type mapping. Order matters — first match wins.
 * Each entry: [keywords[], commitType]
 */
const COMMIT_TYPE_RULES: [string[], string][] = [
  [["fix", "bug", "patch", "hotfix"], "fix"],
  [["refactor", "restructure", "reorganize"], "refactor"],
  [["doc", "docs", "documentation"], "docs"],
  [["test", "tests", "testing"], "test"],
  [["chore", "cleanup", "clean up", "archive", "remove", "delete"], "chore"],
];

/**
 * Infer a conventional commit type from a slice title.
 * Uses case-insensitive word-boundary matching against known keywords.
 * Returns "feat" when no keywords match.
 */
// ─── GitServiceImpl ────────────────────────────────────────────────────

export class GitServiceImpl {
  readonly basePath: string;
  readonly prefs: GitPreferences;

  constructor(basePath: string, prefs: GitPreferences = {}) {
    this.basePath = basePath;
    this.prefs = prefs;
  }

  /** Convenience wrapper: run git in this repo's basePath. */
  private git(args: string[], options: { allowFailure?: boolean } = {}): string {
    return runGit(this.basePath, args, options);
  }

  /**
   * Smart staging: `git add -A` excluding GSD runtime paths via pathspec.
   * Falls back to plain `git add -A` if the exclusion pathspec fails.
   */
  private smartStage(): void {
    const excludes = RUNTIME_EXCLUSION_PATHS.map(p => `':(exclude)${p}'`);
    const args = ["add", "-A", "--", ".", ...excludes];
    try {
      this.git(args);
    } catch {
      console.error("GitService: smart staging failed, falling back to git add -A");
      this.git(["add", "-A"]);
    }
  }

  /**
   * Stage files (smart staging) and commit.
   * Returns the commit message string on success, or null if nothing to commit.
   */
  commit(opts: CommitOptions): string | null {
    this.smartStage();

    // Check if anything was actually staged
    const staged = this.git(["diff", "--cached", "--stat"], { allowFailure: true });
    if (!staged && !opts.allowEmpty) return null;

    this.git(["commit", "-m", JSON.stringify(opts.message), ...(opts.allowEmpty ? ["--allow-empty"] : [])]);
    return opts.message;
  }

  /**
   * Auto-commit dirty working tree with a conventional chore message.
   * Returns the commit message on success, or null if nothing to commit.
   */
  autoCommit(unitType: string, unitId: string): string | null {
    // Quick check: is there anything dirty at all?
    const status = this.git(["status", "--short"], { allowFailure: true });
    if (!status) return null;

    this.smartStage();

    // After smart staging, check if anything was actually staged
    // (all changes might have been runtime files that got excluded)
    const staged = this.git(["diff", "--cached", "--stat"], { allowFailure: true });
    if (!staged) return null;

    const message = `chore(${unitId}): auto-commit after ${unitType}`;
    this.git(["commit", "-m", JSON.stringify(message)]);
    return message;
  }

  // ─── Branch Queries ────────────────────────────────────────────────────

  /**
   * Get the "main" branch for this repo.
   * In a worktree: returns worktree/<name> (the worktree's base branch).
   * In the main tree: origin/HEAD symbolic-ref → main/master fallback → current branch.
   */
  getMainBranch(): string {
    const wtName = detectWorktreeName(this.basePath);
    if (wtName) {
      const wtBranch = `worktree/${wtName}`;
      const exists = this.git(["show-ref", "--verify", `refs/heads/${wtBranch}`], { allowFailure: true });
      if (exists) return wtBranch;
      return this.git(["branch", "--show-current"]);
    }

    const symbolic = this.git(["symbolic-ref", "refs/remotes/origin/HEAD"], { allowFailure: true });
    if (symbolic) {
      const match = symbolic.match(/refs\/remotes\/origin\/(.+)$/);
      if (match) return match[1]!;
    }

    const mainExists = this.git(["show-ref", "--verify", "refs/heads/main"], { allowFailure: true });
    if (mainExists) return "main";

    const masterExists = this.git(["show-ref", "--verify", "refs/heads/master"], { allowFailure: true });
    if (masterExists) return "master";

    return this.git(["branch", "--show-current"]);
  }

  /** Get the current branch name. */
  getCurrentBranch(): string {
    return this.git(["branch", "--show-current"]);
  }

  /** True if currently on a GSD slice branch. */
  isOnSliceBranch(): boolean {
    const current = this.getCurrentBranch();
    return SLICE_BRANCH_RE.test(current);
  }

  /** Returns the slice branch name if on one, null otherwise. */
  getActiveSliceBranch(): string | null {
    try {
      const current = this.getCurrentBranch();
      return SLICE_BRANCH_RE.test(current) ? current : null;
    } catch {
      return null;
    }
  }

  // ─── Branch Lifecycle ──────────────────────────────────────────────────

  /**
   * Check if a local branch exists.
   */
  private branchExists(branch: string): boolean {
    try {
      this.git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the slice branch exists and is checked out.
   *
   * Creates the branch from the current working branch if it's not a slice
   * branch (preserves planning artifacts). Falls back to main when on another
   * slice branch (avoids chaining slice branches).
   *
   * Auto-commits dirty state via smart staging before checkout so runtime
   * files are never accidentally committed during branch switches.
   *
   * Returns true if the branch was newly created.
   */
  ensureSliceBranch(milestoneId: string, sliceId: string): boolean {
    const wtName = detectWorktreeName(this.basePath);
    const branch = getSliceBranchName(milestoneId, sliceId, wtName);
    const current = this.getCurrentBranch();

    if (current === branch) return false;

    let created = false;

    if (!this.branchExists(branch)) {
      // Branch from current when it's a normal working branch (not a slice).
      // If already on a slice branch, fall back to main to avoid chaining.
      const mainBranch = this.getMainBranch();
      const base = SLICE_BRANCH_RE.test(current) ? mainBranch : current;
      this.git(["branch", branch, base]);
      created = true;
    } else {
      // Branch exists — check it's not checked out in another worktree
      const worktreeList = this.git(["worktree", "list", "--porcelain"]);
      if (worktreeList.includes(`branch refs/heads/${branch}`)) {
        throw new Error(
          `Branch "${branch}" is already in use by another worktree. ` +
          `Remove that worktree first, or switch it to a different branch.`,
        );
      }
    }

    // Auto-commit dirty state via smart staging before checkout
    this.autoCommit("pre-switch", current);

    this.git(["checkout", branch]);
    return created;
  }

  /**
   * Switch to main, auto-committing dirty state via smart staging first.
   */
  switchToMain(): void {
    const mainBranch = this.getMainBranch();
    const current = this.getCurrentBranch();
    if (current === mainBranch) return;

    this.autoCommit("pre-switch", current);

    this.git(["checkout", mainBranch]);
  }

  // ─── Merge ─────────────────────────────────────────────────────────────

  /**
   * Squash-merge a slice branch into main and delete it.
   *
   * Must be called from the main branch. Uses `inferCommitType(sliceTitle)`
   * for the conventional commit type instead of hardcoding `feat`.
   *
   * Throws when:
   * - Not currently on the main branch
   * - The slice branch does not exist
   * - The slice branch has no commits ahead of main
   */
  mergeSliceToMain(milestoneId: string, sliceId: string, sliceTitle: string): MergeSliceResult {
    const mainBranch = this.getMainBranch();
    const current = this.getCurrentBranch();

    if (current !== mainBranch) {
      throw new Error(
        `mergeSliceToMain must be called from the main branch ("${mainBranch}"), ` +
        `but currently on "${current}"`,
      );
    }

    const wtName = detectWorktreeName(this.basePath);
    const branch = getSliceBranchName(milestoneId, sliceId, wtName);

    if (!this.branchExists(branch)) {
      throw new Error(
        `Slice branch "${branch}" does not exist. Nothing to merge.`,
      );
    }

    // Check commits ahead
    const aheadCount = this.git(["rev-list", "--count", `${mainBranch}..${branch}`]);
    if (aheadCount === "0") {
      throw new Error(
        `Slice branch "${branch}" has no commits ahead of "${mainBranch}". Nothing to merge.`,
      );
    }

    // Squash merge
    this.git(["merge", "--squash", branch]);

    // Build conventional commit message
    const commitType = inferCommitType(sliceTitle);
    const message = `${commitType}(${milestoneId}/${sliceId}): ${sliceTitle}`;
    this.git(["commit", "-m", JSON.stringify(message)]);

    // Delete the merged branch
    this.git(["branch", "-D", branch]);

    return {
      branch,
      mergedCommitMessage: message,
      deletedBranch: true,
    };
  }
}

// ─── Commit Type Inference ─────────────────────────────────────────────────

export function inferCommitType(sliceTitle: string): string {
  const lower = sliceTitle.toLowerCase();

  for (const [keywords, commitType] of COMMIT_TYPE_RULES) {
    for (const keyword of keywords) {
      // "clean up" is multi-word — use indexOf for it
      if (keyword.includes(" ")) {
        if (lower.includes(keyword)) return commitType;
      } else {
        // Word boundary match: keyword must not be surrounded by word chars
        const re = new RegExp(`\\b${keyword}\\b`, "i");
        if (re.test(lower)) return commitType;
      }
    }
  }

  return "feat";
}
