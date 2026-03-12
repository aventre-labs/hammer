# S01: GitService Core Implementation

**Goal:** A standalone `GitServiceImpl` class in `git-service.ts` that encapsulates all git mechanics — commit, autoCommit, ensureSliceBranch, switchToMain, mergeSliceToMain, smart staging, commit type inference — with comprehensive unit tests passing in temp git repos.
**Demo:** `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts` passes all assertions.

## Must-Haves

- `GitServiceImpl` class with constructor `(basePath: string, prefs?: GitPreferences)`
- `GitPreferences` interface exported (auto_push, push_branches, remote, snapshots, pre_merge_check, commit_type)
- `commit(opts: CommitOptions)` with smart staging exclusion filter + fallback to `git add -A`
- `autoCommit(unitType: string, unitId: string)` using smart staging
- `ensureSliceBranch(milestoneId, sliceId)` with worktree-aware naming, branch-from-current logic, pre-checkout auto-commit using smart staging
- `switchToMain()` with pre-checkout auto-commit using smart staging
- `mergeSliceToMain(milestoneId, sliceId, sliceTitle)` with `inferCommitType()` instead of hardcoded `feat`
- `inferCommitType(sliceTitle: string)` exported as pure function
- `getMainBranch()`, `getCurrentBranch()`, `isOnSliceBranch()`, `getActiveSliceBranch()`
- `RUNTIME_EXCLUSION_PATHS` exported constant (the 6 GSD runtime paths)
- Unit tests covering: smart staging exclusion, smart staging fallback, commit type inference for all types, branch lifecycle, merge with correct commit type, empty-commit-after-staging guard

## Proof Level

- This slice proves: contract
- Real runtime required: no (temp git repos in tests)
- Human/UAT required: no

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts` — all tests pass
- `npm run build` — TypeScript compilation still passes (git-service.ts is in extensions, excluded from tsc, but verify no import breakage)
- `npm run test` — all existing tests still pass (no regressions)

## Observability / Diagnostics

- Runtime signals: None — this is a library module, not a runtime service. Errors surface as thrown `Error` instances with descriptive messages including the failed git command and basePath.
- Inspection surfaces: Test output shows pass/fail counts per test group. `git log` in temp repos verifies commit messages and types.
- Failure visibility: All `runGit()` failures include the full git command and working directory in the error message. Smart staging fallback logs a warning to stderr when exclusion pathspecs fail.
- Redaction constraints: None — no secrets handled.

## Integration Closure

- Upstream surfaces consumed: None (first slice)
- New wiring introduced in this slice: `git-service.ts` module with `GitServiceImpl` class and exports — standalone, not yet consumed by any caller
- What remains before the milestone is truly usable end-to-end: S02 (wire into auto.ts/worktree.ts), S03 (bug fixes), S04 (remove git from prompts), S05 (enhanced features), S06 (cleanup)

## Tasks

- [x] **T01: Create git-service.ts with GitPreferences, RUNTIME_EXCLUSION_PATHS, runGit, and inferCommitType** `est:30m`
  - Why: Foundation types, constants, and pure functions that everything else depends on. Separating these first means T02/T03 can build on stable exports.
  - Files: `src/resources/extensions/gsd/git-service.ts`, `src/resources/extensions/gsd/tests/git-service.test.ts`
  - Do: Define `GitPreferences` interface with all fields (defaulting to safe values). Export `RUNTIME_EXCLUSION_PATHS` array matching the 6 GSD runtime paths from BASELINE_PATTERNS/SKIP_PATHS. Implement local `runGit()` (same pattern as worktree.ts). Implement `inferCommitType(sliceTitle)` as exported pure function with keyword matching for fix/refactor/docs/test/chore, defaulting to feat. Create test file with test scaffolding (assert/assertEq helpers, temp repo setup) and tests for `inferCommitType` covering all types + default. Tests for `RUNTIME_EXCLUSION_PATHS` matching the known 6 paths.
  - Verify: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts` passes
  - Done when: `inferCommitType` returns correct types for all keyword variants, `RUNTIME_EXCLUSION_PATHS` has exactly the 6 expected paths, tests pass

- [x] **T02: Implement GitServiceImpl — smart staging, commit, and autoCommit** `est:45m`
  - Why: The core value of GitService is smart staging (R002) and centralized commit (R001). This task builds the `GitServiceImpl` class with the staging/commit methods that all other operations depend on.
  - Files: `src/resources/extensions/gsd/git-service.ts`, `src/resources/extensions/gsd/tests/git-service.test.ts`
  - Do: Implement `GitServiceImpl` class with `(basePath, prefs)` constructor. Implement private `smartStage()` using `git add -A -- . ':(exclude)path'` for each RUNTIME_EXCLUSION_PATHS entry, with fallback to `git add -A` + stderr warning on failure. Implement `commit(opts: CommitOptions)` that calls smartStage, checks `git diff --cached --stat` for empty, builds conventional commit message. Implement `autoCommit(unitType, unitId)`. Add tests: smart staging excludes runtime files, smart staging fallback works, commit with message, autoCommit on clean repo returns null, autoCommit on dirty repo commits and returns message, empty-after-staging guard (only runtime files dirty → no commit).
  - Verify: All new tests pass alongside T01 tests
  - Done when: Smart staging provably excludes `.gsd/activity/`, `.gsd/runtime/`, `.gsd/STATE.md`, `.gsd/auto.lock`, `.gsd/metrics.json`, `.gsd/worktrees/` while staging other files. Fallback to `git add -A` works when pathspec fails.

- [x] **T03: Implement branch lifecycle — ensureSliceBranch, switchToMain, branch queries** `est:40m`
  - Why: Covers R001 branch operations. These methods replicate the logic from worktree.ts but route staging through smart staging instead of `git add -A`.
  - Files: `src/resources/extensions/gsd/git-service.ts`, `src/resources/extensions/gsd/tests/git-service.test.ts`
  - Do: Implement `getMainBranch()`, `getCurrentBranch()`, `isOnSliceBranch()`, `getActiveSliceBranch()` — same logic as worktree.ts. Implement `ensureSliceBranch(milestoneId, sliceId)` with worktree detection, branch-from-current-not-main logic, pre-checkout smart staging auto-commit. Implement `switchToMain()` with pre-checkout smart staging auto-commit. Add tests: branch creation, idempotent ensure, branch-from-non-main-working-branch, branch-from-slice-falls-back-to-main, switchToMain auto-commits dirty files using smart staging (verify runtime files excluded), query methods return correct values on main vs slice branch.
  - Verify: All tests pass including branch lifecycle tests
  - Done when: `ensureSliceBranch` and `switchToMain` use smart staging for pre-checkout commits, branch creation logic matches worktree.ts behavior, all query methods work correctly

- [x] **T04: Implement mergeSliceToMain with inferCommitType and full integration tests** `est:40m`
  - Why: Closes R001 (merge), R003 (commit type inference in merge), R009 (fixes hardcoded feat). This is the capstone method that proves the full GitService lifecycle works end-to-end.
  - Files: `src/resources/extensions/gsd/git-service.ts`, `src/resources/extensions/gsd/tests/git-service.test.ts`
  - Do: Implement `mergeSliceToMain(milestoneId, sliceId, sliceTitle)` — switchToMain, verify on main, check branch exists, check commits ahead, squash merge, use `inferCommitType(sliceTitle)` for commit message (not hardcoded feat), delete branch. Add integration tests: full lifecycle (create branch → commit on branch → merge → verify commit message type), merge with fix title → `fix(...)` commit, merge with docs title → `docs(...)` commit, merge with feature title → `feat(...)` commit, error cases (not on main, branch doesn't exist, no commits ahead). Run `npm run build` and `npm run test` to verify no regressions.
  - Verify: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts` — all tests pass. `npm run build` passes. `npm run test` passes.
  - Done when: Full GitService lifecycle works in tests, merge commits use inferred type from slice title, all existing tests still pass, build is green

## Files Likely Touched

- `src/resources/extensions/gsd/git-service.ts` (new)
- `src/resources/extensions/gsd/tests/git-service.test.ts` (new)
