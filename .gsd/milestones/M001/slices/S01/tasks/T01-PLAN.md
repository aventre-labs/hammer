---
estimated_steps: 5
estimated_files: 2
---

# T01: Create git-service.ts with GitPreferences, RUNTIME_EXCLUSION_PATHS, runGit, and inferCommitType

**Slice:** S01 — GitService Core Implementation
**Milestone:** M001

## Description

Create the `git-service.ts` module with the foundational types, constants, and pure functions. This establishes the `GitPreferences` interface that the entire milestone depends on, the `RUNTIME_EXCLUSION_PATHS` constant that smart staging uses, and `inferCommitType()` which fixes the hardcoded `feat` bug (R009). Also sets up the test file with the project's established test pattern (manual assert/assertEq, temp git repos, main() async wrapper).

## Steps

1. Create `src/resources/extensions/gsd/git-service.ts` with imports (`node:fs`, `node:child_process`, `node:path`, `node:os`).
2. Define and export `GitPreferences` interface: `auto_push?: boolean`, `push_branches?: boolean`, `remote?: string`, `snapshots?: boolean`, `pre_merge_check?: boolean | string`, `commit_type?: string`.
3. Define and export `CommitOptions` interface: `message: string`, `allowEmpty?: boolean`.
4. Define and export `MergeSliceResult` interface (same shape as worktree.ts): `branch: string`, `mergedCommitMessage: string`, `deletedBranch: boolean`.
5. Export `RUNTIME_EXCLUSION_PATHS` constant: the 6 GSD runtime paths (`[".gsd/activity/", ".gsd/runtime/", ".gsd/worktrees/", ".gsd/auto.lock", ".gsd/metrics.json", ".gsd/STATE.md"]`).
6. Implement local `runGit(basePath, args, options?)` function — same pattern as worktree.ts (execSync, trim, allowFailure flag, descriptive error message).
7. Implement and export `inferCommitType(sliceTitle: string): string` — keyword matching: `fix`/`bug`/`patch`/`hotfix` → `fix`, `refactor`/`restructure`/`reorganize` → `refactor`, `doc`/`documentation` → `docs`, `test`/`testing` → `test`, `chore`/`cleanup`/`clean up`/`archive`/`remove`/`delete` → `chore`. Case-insensitive word boundary matching. Default: `feat`.
8. Create `src/resources/extensions/gsd/tests/git-service.test.ts` following worktree.test.ts pattern: imports, assert/assertEq helpers, `run()` helper, temp repo setup, async `main()`.
9. Add tests for `inferCommitType`: feature title → `feat`, fix title → `fix`, refactor title → `refactor`, docs title → `docs`, test title → `test`, chore title → `chore`, mixed keywords → first match wins, unknown → `feat`.
10. Add test verifying `RUNTIME_EXCLUSION_PATHS` contains exactly the 6 expected paths.

## Must-Haves

- [ ] `GitPreferences` interface exported with all 6 fields
- [ ] `CommitOptions` interface exported
- [ ] `MergeSliceResult` interface exported
- [ ] `RUNTIME_EXCLUSION_PATHS` exported with exactly 6 paths matching SKIP_PATHS + SKIP_EXACT
- [ ] `inferCommitType()` exported, returns correct type for all keyword categories
- [ ] `inferCommitType()` defaults to `feat` for unrecognized titles
- [ ] Test file follows project test pattern (assert/assertEq, async main, process.exit on failure)
- [ ] All tests pass

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts` — all tests pass with 0 failures

## Observability Impact

- Signals added/changed: None — pure types, constants, and functions
- How a future agent inspects this: Read exports from `git-service.ts`, run the test file
- Failure state exposed: `inferCommitType` is pure — bad output is immediately visible in test assertions

## Inputs

- `src/resources/extensions/gsd/worktree.ts` — `MergeSliceResult` interface shape, `runGit()` pattern
- `src/resources/extensions/gsd/gitignore.ts` — `BASELINE_PATTERNS` (first 6 entries = GSD runtime paths)
- `src/resources/extensions/gsd/worktree-manager.ts` — `SKIP_PATHS` + `SKIP_EXACT` (same 6 paths)
- `src/resources/extensions/gsd/tests/worktree.test.ts` — test infrastructure pattern

## Expected Output

- `src/resources/extensions/gsd/git-service.ts` — module with `GitPreferences`, `CommitOptions`, `MergeSliceResult`, `RUNTIME_EXCLUSION_PATHS`, `runGit()`, `inferCommitType()`
- `src/resources/extensions/gsd/tests/git-service.test.ts` — test file with passing tests for inferCommitType and RUNTIME_EXCLUSION_PATHS
