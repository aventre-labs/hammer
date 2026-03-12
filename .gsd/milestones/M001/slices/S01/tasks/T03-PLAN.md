---
estimated_steps: 5
estimated_files: 2
---

# T03: Implement branch lifecycle — ensureSliceBranch, switchToMain, branch queries

**Slice:** S01 — GitService Core Implementation
**Milestone:** M001

## Description

Add branch management methods to `GitServiceImpl` that replicate the logic from `worktree.ts` but route all staging through smart staging. This covers `ensureSliceBranch`, `switchToMain`, and the branch query methods (`getMainBranch`, `getCurrentBranch`, `isOnSliceBranch`, `getActiveSliceBranch`). The key difference from worktree.ts: pre-checkout auto-commits use `smartStage()` instead of `git add -A`, so runtime files are never accidentally committed during branch switches.

## Steps

1. Add `getMainBranch()` method to `GitServiceImpl` — reuse exact logic from `worktree.ts` (`detectWorktreeName`, worktree branch check, `symbolic-ref`, main/master fallback, current branch fallback). Import `detectWorktreeName`, `getSliceBranchName`, `SLICE_BRANCH_RE` from worktree.ts (these are pure utility functions that don't change in S02).
2. Add `getCurrentBranch()`, `isOnSliceBranch()`, `getActiveSliceBranch()` methods — same logic as worktree.ts standalone functions, using `this.git()`.
3. Implement `ensureSliceBranch(milestoneId, sliceId)` method: detect worktree name, compute branch name, check if already on branch (return false), create branch if needed (branch-from-current-not-main logic, slice-to-slice falls back to main), check worktree conflict, pre-checkout auto-commit using `autoCommit("pre-switch", currentBranch)`, checkout, return created boolean.
4. Implement `switchToMain()` method: get main branch, check if already on main (return early), auto-commit dirty state via `autoCommit("pre-switch", currentBranch)`, checkout main.
5. Add tests:
   - `ensureSliceBranch` creates branch and checks it out
   - `ensureSliceBranch` is idempotent (second call returns false)
   - `ensureSliceBranch` from non-main working branch inherits artifacts
   - `ensureSliceBranch` from another slice branch falls back to main
   - `ensureSliceBranch` auto-commits dirty files before checkout using smart staging (verify runtime files NOT in the auto-commit)
   - `switchToMain` auto-commits dirty files using smart staging
   - `switchToMain` is idempotent when already on main
   - `getCurrentBranch`, `isOnSliceBranch`, `getActiveSliceBranch` return correct values on main vs slice branch

## Must-Haves

- [ ] `getMainBranch()` handles worktree, origin/HEAD, main/master fallback
- [ ] `getCurrentBranch()` returns current branch name
- [ ] `isOnSliceBranch()` returns true on slice branch, false on main
- [ ] `getActiveSliceBranch()` returns branch name or null
- [ ] `ensureSliceBranch()` creates branch from current working branch (not main) when current is not a slice branch
- [ ] `ensureSliceBranch()` creates branch from main when current branch IS a slice branch
- [ ] `ensureSliceBranch()` auto-commits dirty state via smart staging before checkout
- [ ] `switchToMain()` auto-commits dirty state via smart staging before checkout
- [ ] All tests pass

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts` — all tests pass including branch lifecycle tests

## Observability Impact

- Signals added/changed: None beyond what T02 established (smart staging fallback warning). Pre-checkout auto-commits are visible in `git log`.
- How a future agent inspects this: `git log --oneline` shows auto-commit messages before branch switches. `git branch -a` shows created slice branches.
- Failure state exposed: Throws descriptive Error if branch is checked out in another worktree. Throws on checkout failure with git command and basePath in message.

## Inputs

- `src/resources/extensions/gsd/git-service.ts` — T02 output: `GitServiceImpl` with smartStage, commit, autoCommit
- `src/resources/extensions/gsd/worktree.ts` — `detectWorktreeName`, `getSliceBranchName`, `SLICE_BRANCH_RE` imports (pure utilities)
- `src/resources/extensions/gsd/tests/git-service.test.ts` — T02 output: existing passing tests

## Expected Output

- `src/resources/extensions/gsd/git-service.ts` — updated with `getMainBranch()`, `getCurrentBranch()`, `isOnSliceBranch()`, `getActiveSliceBranch()`, `ensureSliceBranch()`, `switchToMain()`
- `src/resources/extensions/gsd/tests/git-service.test.ts` — updated with branch lifecycle tests passing
