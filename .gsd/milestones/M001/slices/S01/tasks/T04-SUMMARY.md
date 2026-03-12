---
id: T04
parent: S01
milestone: M001
provides:
  - GitServiceImpl.mergeSliceToMain() method with inferCommitType integration
key_files:
  - src/resources/extensions/gsd/git-service.ts
  - src/resources/extensions/gsd/tests/git-service.test.ts
key_decisions:
  - Added "docs" (plural) to COMMIT_TYPE_RULES keyword list — word-boundary regex prevented "Docs update" from matching "doc", consistent with T01 decision that added "tests" plural
patterns_established:
  - mergeSliceToMain delegates to inferCommitType for commit type instead of hardcoding — conventional commit type is always data-driven from slice title keywords
  - Squash merge workflow: verify on main → verify branch exists → verify commits ahead → git merge --squash → commit with inferred type → git branch -D
observability_surfaces:
  - Merge commit messages carry inferred conventional types — inspect via `git log --oneline` after merge
  - Descriptive errors for each failure mode include branch names and current state
duration: 8min
verification_result: passed
completed_at: 2026-03-12
blocker_discovered: false
---

# T04: Implement mergeSliceToMain with inferCommitType and full integration tests

**Added `mergeSliceToMain()` to GitServiceImpl with `inferCommitType` integration and full lifecycle tests — 113 tests passing, build green.**

## What Happened

Implemented `mergeSliceToMain(milestoneId, sliceId, sliceTitle)` on `GitServiceImpl` that squash-merges a slice branch into main using `inferCommitType(sliceTitle)` for the conventional commit type. The method validates three preconditions (on main, branch exists, commits ahead) before performing the merge, commit, and branch deletion.

During testing, discovered that the slice title "Docs update" failed to match the `doc` keyword due to word-boundary regex (`\bdoc\b` doesn't match "docs"). Added "docs" as a plural keyword to `COMMIT_TYPE_RULES`, consistent with the T01 precedent of adding "tests" for the same reason.

Added 7 new test groups: 4 full lifecycle integration tests (feat, fix, docs, refactor) each exercising create branch → commit work → switch to main → merge → verify commit type, plus 3 error case tests (not on main, branch missing, no commits ahead).

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts` — 113 passed, 0 failed ✓
- `npm run build` — passes ✓
- `npm run test` — 116 passed, 2 failed (pre-existing AGENTS.md sync failures in app-smoke.test.ts, unrelated to git-service) ✓

## Diagnostics

- `git log --oneline` after merge shows conventional commit type in the squash-merge message
- Error messages from `mergeSliceToMain` include: current branch name, expected main branch, missing branch name, and commits-ahead count context
- Test file can be re-run at any time: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts`

## Deviations

- Added "docs" (plural) to `COMMIT_TYPE_RULES` keyword list — not in original plan but required for correct type inference on titles like "Docs update". Same pattern as T01's "tests" addition.

## Known Issues

- 2 pre-existing test failures in `src/tests/app-smoke.test.ts` (tests 49 and 52) related to AGENTS.md syncing — completely unrelated to git-service.

## Files Created/Modified

- `src/resources/extensions/gsd/git-service.ts` — Added `mergeSliceToMain()` method and "docs" keyword to COMMIT_TYPE_RULES
- `src/resources/extensions/gsd/tests/git-service.test.ts` — Added 22 new assertions across 7 test groups for merge lifecycle and error cases
