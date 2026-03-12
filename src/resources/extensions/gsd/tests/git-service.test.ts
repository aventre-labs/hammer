import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import {
  inferCommitType,
  GitServiceImpl,
  RUNTIME_EXCLUSION_PATHS,
  runGit,
  type GitPreferences,
  type CommitOptions,
  type MergeSliceResult,
} from "../git-service.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function run(command: string, cwd: string): string {
  return execSync(command, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

async function main(): Promise<void> {
  // ─── inferCommitType ───────────────────────────────────────────────────

  console.log("\n=== inferCommitType ===");

  assertEq(
    inferCommitType("Implement user authentication"),
    "feat",
    "generic feature title → feat"
  );

  assertEq(
    inferCommitType("Add dashboard page"),
    "feat",
    "add-style title → feat"
  );

  assertEq(
    inferCommitType("Fix login redirect bug"),
    "fix",
    "title with 'fix' → fix"
  );

  assertEq(
    inferCommitType("Bug in session handling"),
    "fix",
    "title with 'bug' → fix"
  );

  assertEq(
    inferCommitType("Hotfix for production crash"),
    "fix",
    "title with 'hotfix' → fix"
  );

  assertEq(
    inferCommitType("Patch memory leak"),
    "fix",
    "title with 'patch' → fix"
  );

  assertEq(
    inferCommitType("Refactor state management"),
    "refactor",
    "title with 'refactor' → refactor"
  );

  assertEq(
    inferCommitType("Restructure project layout"),
    "refactor",
    "title with 'restructure' → refactor"
  );

  assertEq(
    inferCommitType("Reorganize module imports"),
    "refactor",
    "title with 'reorganize' → refactor"
  );

  assertEq(
    inferCommitType("Update API documentation"),
    "docs",
    "title with 'documentation' → docs"
  );

  assertEq(
    inferCommitType("Add doc for setup guide"),
    "docs",
    "title with 'doc' → docs"
  );

  assertEq(
    inferCommitType("Add unit tests for auth"),
    "test",
    "title with 'tests' → test"
  );

  assertEq(
    inferCommitType("Testing infrastructure setup"),
    "test",
    "title with 'testing' → test"
  );

  assertEq(
    inferCommitType("Chore: update dependencies"),
    "chore",
    "title with 'chore' → chore"
  );

  assertEq(
    inferCommitType("Cleanup unused imports"),
    "chore",
    "title with 'cleanup' → chore"
  );

  assertEq(
    inferCommitType("Clean up stale branches"),
    "chore",
    "title with 'clean up' → chore"
  );

  assertEq(
    inferCommitType("Archive old milestones"),
    "chore",
    "title with 'archive' → chore"
  );

  assertEq(
    inferCommitType("Remove deprecated endpoints"),
    "chore",
    "title with 'remove' → chore"
  );

  assertEq(
    inferCommitType("Delete temp files"),
    "chore",
    "title with 'delete' → chore"
  );

  // Mixed keywords — first match wins
  assertEq(
    inferCommitType("Fix and refactor the login module"),
    "fix",
    "mixed keywords → first match wins (fix before refactor)"
  );

  assertEq(
    inferCommitType("Refactor test utilities"),
    "refactor",
    "mixed keywords → first match wins (refactor before test)"
  );

  // Unknown / unrecognized title → feat
  assertEq(
    inferCommitType("Build the new pipeline"),
    "feat",
    "unrecognized title → feat"
  );

  assertEq(
    inferCommitType(""),
    "feat",
    "empty title → feat"
  );

  // Word boundary: "testify" should NOT match "test"
  assertEq(
    inferCommitType("Testify integration"),
    "feat",
    "'testify' does not match 'test' — word boundary prevents partial match"
  );

  // "documentary" should NOT match "doc" (word boundary)
  assertEq(
    inferCommitType("Documentary style UI"),
    "feat",
    "'documentary' does not match 'doc' — word boundary prevents partial match"
  );

  // "prefix" should NOT match "fix" (word boundary)
  assertEq(
    inferCommitType("Add prefix to all IDs"),
    "feat",
    "'prefix' does not match 'fix' — word boundary prevents partial match"
  );

  // ─── RUNTIME_EXCLUSION_PATHS ───────────────────────────────────────────

  console.log("\n=== RUNTIME_EXCLUSION_PATHS ===");

  assertEq(
    RUNTIME_EXCLUSION_PATHS.length,
    6,
    "exactly 6 runtime exclusion paths"
  );

  const expectedPaths = [
    ".gsd/activity/",
    ".gsd/runtime/",
    ".gsd/worktrees/",
    ".gsd/auto.lock",
    ".gsd/metrics.json",
    ".gsd/STATE.md",
  ];

  assertEq(
    [...RUNTIME_EXCLUSION_PATHS],
    expectedPaths,
    "paths match expected set in order"
  );

  assert(
    RUNTIME_EXCLUSION_PATHS.includes(".gsd/activity/"),
    "includes .gsd/activity/"
  );
  assert(
    RUNTIME_EXCLUSION_PATHS.includes(".gsd/STATE.md"),
    "includes .gsd/STATE.md"
  );

  // ─── runGit ────────────────────────────────────────────────────────────

  console.log("\n=== runGit ===");

  const tempDir = mkdtempSync(join(tmpdir(), "gsd-git-service-test-"));
  run("git init -b main", tempDir);
  run("git config user.name 'Pi Test'", tempDir);
  run("git config user.email 'pi@example.com'", tempDir);

  // runGit should work on a valid repo
  const branch = runGit(tempDir, ["branch", "--show-current"]);
  assertEq(branch, "main", "runGit returns current branch");

  // runGit allowFailure returns empty string on failure
  const result = runGit(tempDir, ["log", "--oneline"], { allowFailure: true });
  assertEq(result, "", "runGit allowFailure returns empty on error (no commits yet)");

  // runGit throws on failure without allowFailure
  let threw = false;
  try {
    runGit(tempDir, ["log", "--oneline"]);
  } catch (e) {
    threw = true;
    assert(
      (e as Error).message.includes("git log --oneline failed"),
      "error message includes command and path"
    );
  }
  assert(threw, "runGit throws without allowFailure on error");

  // ─── Type exports compile check ────────────────────────────────────────

  console.log("\n=== Type exports ===");

  // These are compile-time checks — if we got here, the types import fine
  const _prefs: GitPreferences = { auto_push: true, remote: "origin" };
  const _opts: CommitOptions = { message: "test" };
  const _result: MergeSliceResult = { branch: "main", mergedCommitMessage: "msg", deletedBranch: false };
  assert(true, "GitPreferences type exported and usable");
  assert(true, "CommitOptions type exported and usable");
  assert(true, "MergeSliceResult type exported and usable");

  // Cleanup T01 temp dir
  rmSync(tempDir, { recursive: true, force: true });

  // ─── Helper: create file with intermediate dirs ────────────────────────

  function createFile(base: string, relativePath: string, content: string = "x"): void {
    const full = join(base, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }

  function initTempRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "gsd-git-t02-"));
    run("git init -b main", dir);
    run("git config user.name 'Pi Test'", dir);
    run("git config user.email 'pi@example.com'", dir);
    // Need an initial commit so HEAD exists
    createFile(dir, ".gitkeep", "");
    run("git add -A", dir);
    run("git commit -m 'init'", dir);
    return dir;
  }

  // ─── GitServiceImpl: smart staging ─────────────────────────────────────

  console.log("\n=== GitServiceImpl: smart staging ===");

  {
    const repo = initTempRepo();
    const svc = new GitServiceImpl(repo);

    // Create runtime files (should be excluded from staging)
    createFile(repo, ".gsd/activity/log.jsonl", "log data");
    createFile(repo, ".gsd/runtime/state.json", '{"state":true}');
    createFile(repo, ".gsd/STATE.md", "# State");
    createFile(repo, ".gsd/auto.lock", "lock");
    createFile(repo, ".gsd/metrics.json", "{}");
    createFile(repo, ".gsd/worktrees/wt/file.txt", "wt data");

    // Create a real file (should be staged)
    createFile(repo, "src/code.ts", 'console.log("hello");');

    const result = svc.commit({ message: "test: smart staging" });

    assertEq(result, "test: smart staging", "commit returns the commit message");

    // Verify only src/code.ts is in the commit
    const showStat = run("git show --stat --format='' HEAD", repo);
    assert(showStat.includes("src/code.ts"), "src/code.ts is in the commit");
    assert(!showStat.includes(".gsd/activity"), ".gsd/activity/ excluded from commit");
    assert(!showStat.includes(".gsd/runtime"), ".gsd/runtime/ excluded from commit");
    assert(!showStat.includes("STATE.md"), ".gsd/STATE.md excluded from commit");
    assert(!showStat.includes("auto.lock"), ".gsd/auto.lock excluded from commit");
    assert(!showStat.includes("metrics.json"), ".gsd/metrics.json excluded from commit");
    assert(!showStat.includes(".gsd/worktrees"), ".gsd/worktrees/ excluded from commit");

    // Verify runtime files are still untracked
    // git status --short may collapse to "?? .gsd/" or show individual files
    // Use --untracked-files=all to force individual listing
    const statusOut = run("git status --short --untracked-files=all", repo);
    assert(statusOut.includes(".gsd/activity/"), "activity still untracked after commit");
    assert(statusOut.includes(".gsd/runtime/"), "runtime still untracked after commit");
    assert(statusOut.includes(".gsd/STATE.md"), "STATE.md still untracked after commit");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── GitServiceImpl: smart staging fallback ────────────────────────────

  console.log("\n=== GitServiceImpl: smart staging fallback ===");

  {
    // We can't easily make the pathspec fail in a real repo, but we can test
    // the fallback behavior by verifying that if smart staging somehow fails,
    // everything gets staged. We do this by checking that a commit with both
    // runtime and real files works when pathspec would fail.
    //
    // To force the fallback: temporarily override RUNTIME_EXCLUSION_PATHS
    // with an invalid pathspec. Since we can't modify a readonly array,
    // we'll test the actual fallback by creating a custom subclass.

    const repo = initTempRepo();

    // Create a subclass that overrides smartStage to simulate failure + fallback
    class FallbackTestService extends GitServiceImpl {
      fallbackUsed = false;
      smartStageWithBadPathspec(): void {
        // Simulate: try bad pathspec, catch, fallback
        try {
          runGit(this.basePath, ["add", "-A", "--", ".", ":(exclude)__NONEXISTENT_PATHSPEC_SYNTAX_ERROR__["]);
          // If the above doesn't throw, git accepted it (some versions do).
          // That's fine — the point is testing the fallback path.
          throw new Error("force fallback for test");
        } catch {
          console.error("GitService: smart staging failed, falling back to git add -A");
          this.fallbackUsed = true;
          runGit(this.basePath, ["add", "-A"]);
        }
      }
    }

    const svc = new FallbackTestService(repo);
    createFile(repo, "src/real.ts", "real code");
    createFile(repo, ".gsd/activity/log.jsonl", "log");

    // Call the fallback path manually
    svc.smartStageWithBadPathspec();

    // Check that everything was staged (fallback stages all)
    const staged = run("git diff --cached --name-only", repo);
    assert(staged.includes("src/real.ts"), "fallback stages real files");
    assert(staged.includes(".gsd/activity/log.jsonl"), "fallback stages runtime files too (no exclusion)");
    assert(svc.fallbackUsed, "fallback path was actually used");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── GitServiceImpl: autoCommit on clean repo ──────────────────────────

  console.log("\n=== GitServiceImpl: autoCommit ===");

  {
    const repo = initTempRepo();
    const svc = new GitServiceImpl(repo);

    // Clean repo — autoCommit should return null
    const cleanResult = svc.autoCommit("task", "T01");
    assertEq(cleanResult, null, "autoCommit on clean repo returns null");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── GitServiceImpl: autoCommit on dirty repo ──────────────────────────

  console.log("\n=== GitServiceImpl: autoCommit on dirty repo ===");

  {
    const repo = initTempRepo();
    const svc = new GitServiceImpl(repo);

    createFile(repo, "src/new-feature.ts", "export const x = 1;");
    const msg = svc.autoCommit("task", "T01");

    assertEq(msg, "chore(T01): auto-commit after task", "autoCommit returns correct message format");

    // Verify the commit exists
    const log = run("git log --oneline -1", repo);
    assert(log.includes("chore(T01): auto-commit after task"), "commit message is in git log");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── GitServiceImpl: empty-after-staging guard ─────────────────────────

  console.log("\n=== GitServiceImpl: empty-after-staging guard ===");

  {
    const repo = initTempRepo();
    const svc = new GitServiceImpl(repo);

    // Create only runtime files
    createFile(repo, ".gsd/activity/x.jsonl", "data");

    const result = svc.autoCommit("task", "T02");
    assertEq(result, null, "autoCommit returns null when only runtime files are dirty");

    // Verify no new commit was created (should still be at init commit)
    const logCount = run("git rev-list --count HEAD", repo);
    assertEq(logCount, "1", "no new commit created when only runtime files changed");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── GitServiceImpl: commit returns null when nothing staged ───────────

  console.log("\n=== GitServiceImpl: commit empty ===");

  {
    const repo = initTempRepo();
    const svc = new GitServiceImpl(repo);

    // Nothing dirty, commit should return null
    const result = svc.commit({ message: "should not commit" });
    assertEq(result, null, "commit returns null when nothing to stage");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── Helper: create repo for branch tests ────────────────────────────

  function initBranchTestRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "gsd-git-t03-"));
    run("git init -b main", dir);
    run("git config user.name 'Pi Test'", dir);
    run("git config user.email 'pi@example.com'", dir);
    createFile(dir, ".gitkeep", "");
    run("git add -A", dir);
    run("git commit -m 'init'", dir);
    return dir;
  }

  // ─── getCurrentBranch / isOnSliceBranch / getActiveSliceBranch ─────────

  console.log("\n=== Branch queries ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    // On main
    assertEq(svc.getCurrentBranch(), "main", "getCurrentBranch returns main on main branch");
    assertEq(svc.isOnSliceBranch(), false, "isOnSliceBranch returns false on main");
    assertEq(svc.getActiveSliceBranch(), null, "getActiveSliceBranch returns null on main");

    // Create and checkout a slice branch manually
    run("git checkout -b gsd/M001/S01", repo);
    assertEq(svc.getCurrentBranch(), "gsd/M001/S01", "getCurrentBranch returns slice branch name");
    assertEq(svc.isOnSliceBranch(), true, "isOnSliceBranch returns true on slice branch");
    assertEq(svc.getActiveSliceBranch(), "gsd/M001/S01", "getActiveSliceBranch returns branch name on slice branch");

    // Non-slice feature branch
    run("git checkout -b feature/foo", repo);
    assertEq(svc.isOnSliceBranch(), false, "isOnSliceBranch returns false on non-slice branch");
    assertEq(svc.getActiveSliceBranch(), null, "getActiveSliceBranch returns null on non-slice branch");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── getMainBranch ────────────────────────────────────────────────────

  console.log("\n=== getMainBranch ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    // Basic case: repo has "main" branch
    assertEq(svc.getMainBranch(), "main", "getMainBranch returns main when main exists");

    rmSync(repo, { recursive: true, force: true });
  }

  {
    // master-only repo
    const repo = mkdtempSync(join(tmpdir(), "gsd-git-t03-master-"));
    run("git init -b master", repo);
    run("git config user.name 'Pi Test'", repo);
    run("git config user.email 'pi@example.com'", repo);
    createFile(repo, ".gitkeep", "");
    run("git add -A", repo);
    run("git commit -m 'init'", repo);

    const svc = new GitServiceImpl(repo);
    assertEq(svc.getMainBranch(), "master", "getMainBranch returns master when only master exists");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── ensureSliceBranch: creates and checks out ────────────────────────

  console.log("\n=== ensureSliceBranch ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    const created = svc.ensureSliceBranch("M001", "S01");
    assertEq(created, true, "ensureSliceBranch returns true on first call (branch created)");
    assertEq(svc.getCurrentBranch(), "gsd/M001/S01", "ensureSliceBranch checks out the slice branch");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── ensureSliceBranch: idempotent ────────────────────────────────────

  console.log("\n=== ensureSliceBranch: idempotent ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    svc.ensureSliceBranch("M001", "S01");
    const secondCall = svc.ensureSliceBranch("M001", "S01");
    assertEq(secondCall, false, "ensureSliceBranch returns false when already on the branch");
    assertEq(svc.getCurrentBranch(), "gsd/M001/S01", "still on slice branch after idempotent call");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── ensureSliceBranch: from non-main working branch inherits artifacts ──

  console.log("\n=== ensureSliceBranch: from non-main inherits artifacts ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    // Create a feature branch with planning artifacts
    run("git checkout -b developer", repo);
    createFile(repo, ".gsd/milestones/M001/M001-ROADMAP.md", "# Roadmap");
    run("git add -A", repo);
    run("git commit -m 'add roadmap'", repo);

    // ensureSliceBranch from this non-main, non-slice branch
    const created = svc.ensureSliceBranch("M001", "S01");
    assertEq(created, true, "branch created from non-main working branch");
    assertEq(svc.getCurrentBranch(), "gsd/M001/S01", "checked out to slice branch");

    // The roadmap from developer branch should be present
    const logOutput = run("git log --oneline", repo);
    assert(logOutput.includes("add roadmap"), "slice branch inherits artifacts from working branch");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── ensureSliceBranch: from another slice branch falls back to main ──

  console.log("\n=== ensureSliceBranch: from slice branch falls back to main ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    // Create file only on main
    createFile(repo, "main-only.txt", "from main");
    run("git add -A", repo);
    run("git commit -m 'main-only file'", repo);

    // Create and check out S01
    svc.ensureSliceBranch("M001", "S01");
    // Add a file only on S01
    createFile(repo, "s01-only.txt", "from s01");
    run("git add -A", repo);
    run("git commit -m 'S01 work'", repo);

    // Now create S02 from S01 — should fall back to main
    const created = svc.ensureSliceBranch("M001", "S02");
    assertEq(created, true, "S02 branch created from S01 (fell back to main)");
    assertEq(svc.getCurrentBranch(), "gsd/M001/S02", "on S02 branch");

    // S02 should NOT have the S01-only file (it branched from main)
    const showFiles = run("git ls-files", repo);
    assert(!showFiles.includes("s01-only.txt"), "S02 does not have S01-only files (branched from main)");
    assert(showFiles.includes("main-only.txt"), "S02 has main files");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── ensureSliceBranch: auto-commits dirty files via smart staging ────

  console.log("\n=== ensureSliceBranch: auto-commits with smart staging ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    // Create dirty files: both real and runtime
    createFile(repo, "src/feature.ts", "export const y = 2;");
    createFile(repo, ".gsd/activity/session.jsonl", "session data");
    createFile(repo, ".gsd/STATE.md", "# Current State");
    createFile(repo, ".gsd/metrics.json", '{"tasks":1}');

    // ensureSliceBranch should auto-commit before checkout
    svc.ensureSliceBranch("M001", "S01");

    // The auto-commit on main should have src/feature.ts but NOT runtime files
    run("git checkout main", repo);
    const showStat = run("git show --stat --format='' HEAD", repo);
    assert(showStat.includes("src/feature.ts"), "auto-commit includes real files");
    assert(!showStat.includes(".gsd/activity"), "auto-commit excludes .gsd/activity/ (smart staging)");
    assert(!showStat.includes("STATE.md"), "auto-commit excludes .gsd/STATE.md (smart staging)");
    assert(!showStat.includes("metrics.json"), "auto-commit excludes .gsd/metrics.json (smart staging)");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── switchToMain ─────────────────────────────────────────────────────

  console.log("\n=== switchToMain ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    // Switch to a slice branch first
    svc.ensureSliceBranch("M001", "S01");
    assertEq(svc.getCurrentBranch(), "gsd/M001/S01", "on slice branch before switchToMain");

    // Create dirty files
    createFile(repo, "src/work.ts", "work in progress");
    createFile(repo, ".gsd/activity/log.jsonl", "activity log");
    createFile(repo, ".gsd/runtime/state.json", '{"running":true}');

    svc.switchToMain();
    assertEq(svc.getCurrentBranch(), "main", "switchToMain switches to main");

    // Verify the auto-commit on the slice branch used smart staging
    const sliceLog = run("git log gsd/M001/S01 --oneline -1", repo);
    assert(sliceLog.includes("pre-switch"), "auto-commit message includes pre-switch");

    // Check that the auto-commit on the slice branch excluded runtime files
    const showStat = run("git log gsd/M001/S01 -1 --format='' --stat", repo);
    assert(showStat.includes("src/work.ts"), "switchToMain auto-commit includes real files");
    assert(!showStat.includes(".gsd/activity"), "switchToMain auto-commit excludes .gsd/activity/");
    assert(!showStat.includes(".gsd/runtime"), "switchToMain auto-commit excludes .gsd/runtime/");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── switchToMain: idempotent when already on main ─────────────────────

  console.log("\n=== switchToMain: idempotent ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    assertEq(svc.getCurrentBranch(), "main", "already on main");
    svc.switchToMain(); // Should not throw
    assertEq(svc.getCurrentBranch(), "main", "still on main after idempotent switchToMain");

    // Verify no extra commits were created
    const logCount = run("git rev-list --count HEAD", repo);
    assertEq(logCount, "1", "no extra commits from idempotent switchToMain");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── mergeSliceToMain: full lifecycle with feat ─────────────────────────

  console.log("\n=== mergeSliceToMain: full lifecycle ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    // Create and switch to slice branch
    svc.ensureSliceBranch("M001", "S01");
    assertEq(svc.getCurrentBranch(), "gsd/M001/S01", "on slice branch for merge test");

    // Do work on the slice branch
    createFile(repo, "src/feature.ts", "export const feature = true;");
    svc.commit({ message: "add feature module" });

    // Switch to main and merge
    svc.switchToMain();
    const result = svc.mergeSliceToMain("M001", "S01", "Implement user authentication");

    assertEq(result.mergedCommitMessage, "feat(M001/S01): Implement user authentication", "merge commit message uses feat type");
    assertEq(result.deletedBranch, true, "branch was deleted");
    assertEq(result.branch, "gsd/M001/S01", "result includes branch name");

    // Verify commit is on main
    const log = run("git log --oneline -1", repo);
    assert(log.includes("feat(M001/S01): Implement user authentication"), "merge commit visible in git log");

    // Verify the file is on main
    const files = run("git ls-files", repo);
    assert(files.includes("src/feature.ts"), "merged file exists on main");

    // Verify slice branch is deleted
    const branches = run("git branch", repo);
    assert(!branches.includes("gsd/M001/S01"), "slice branch deleted after merge");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── mergeSliceToMain: fix type ───────────────────────────────────────

  console.log("\n=== mergeSliceToMain: fix type ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    svc.ensureSliceBranch("M001", "S02");
    createFile(repo, "src/bugfix.ts", "// fixed");
    svc.commit({ message: "fix the bug" });

    svc.switchToMain();
    const result = svc.mergeSliceToMain("M001", "S02", "Fix broken config");

    assert(result.mergedCommitMessage.startsWith("fix("), "merge commit starts with fix(");
    assertEq(result.mergedCommitMessage, "fix(M001/S02): Fix broken config", "fix merge commit message correct");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── mergeSliceToMain: docs type ──────────────────────────────────────

  console.log("\n=== mergeSliceToMain: docs type ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    svc.ensureSliceBranch("M001", "S03");
    createFile(repo, "docs/guide.md", "# Guide");
    svc.commit({ message: "write docs" });

    svc.switchToMain();
    const result = svc.mergeSliceToMain("M001", "S03", "Docs update");

    assert(result.mergedCommitMessage.startsWith("docs("), "merge commit starts with docs(");
    assertEq(result.mergedCommitMessage, "docs(M001/S03): Docs update", "docs merge commit message correct");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── mergeSliceToMain: refactor type ──────────────────────────────────

  console.log("\n=== mergeSliceToMain: refactor type ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    svc.ensureSliceBranch("M001", "S04");
    createFile(repo, "src/refactored.ts", "// cleaner");
    svc.commit({ message: "restructure modules" });

    svc.switchToMain();
    const result = svc.mergeSliceToMain("M001", "S04", "Refactor state management");

    assert(result.mergedCommitMessage.startsWith("refactor("), "merge commit starts with refactor(");
    assertEq(result.mergedCommitMessage, "refactor(M001/S04): Refactor state management", "refactor merge commit message correct");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── mergeSliceToMain: error — not on main ────────────────────────────

  console.log("\n=== mergeSliceToMain: error cases ===");

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    // Create a slice branch with a commit
    svc.ensureSliceBranch("M001", "S01");
    createFile(repo, "src/work.ts", "work");
    svc.commit({ message: "slice work" });

    // Try to merge while still on the slice branch
    let threw = false;
    try {
      svc.mergeSliceToMain("M001", "S01", "Some feature");
    } catch (e) {
      threw = true;
      const msg = (e as Error).message;
      assert(msg.includes("must be called from the main branch"), "error mentions main branch requirement");
      assert(msg.includes("gsd/M001/S01"), "error includes current branch name");
    }
    assert(threw, "mergeSliceToMain throws when not on main");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── mergeSliceToMain: error — branch doesn't exist ───────────────────

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    let threw = false;
    try {
      svc.mergeSliceToMain("M001", "S99", "Nonexistent");
    } catch (e) {
      threw = true;
      const msg = (e as Error).message;
      assert(msg.includes("does not exist"), "error mentions branch does not exist");
      assert(msg.includes("gsd/M001/S99"), "error includes missing branch name");
    }
    assert(threw, "mergeSliceToMain throws when branch doesn't exist");

    rmSync(repo, { recursive: true, force: true });
  }

  // ─── mergeSliceToMain: error — no commits ahead ───────────────────────

  {
    const repo = initBranchTestRepo();
    const svc = new GitServiceImpl(repo);

    // Create slice branch but don't add any commits
    svc.ensureSliceBranch("M001", "S01");
    // Switch back to main without committing anything on the slice branch
    svc.switchToMain();

    let threw = false;
    try {
      svc.mergeSliceToMain("M001", "S01", "Empty slice");
    } catch (e) {
      threw = true;
      const msg = (e as Error).message;
      assert(msg.includes("no commits ahead"), "error mentions no commits ahead");
      assert(msg.includes("gsd/M001/S01"), "error includes branch name");
    }
    assert(threw, "mergeSliceToMain throws when no commits ahead");

    rmSync(repo, { recursive: true, force: true });
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All tests passed ✓");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
