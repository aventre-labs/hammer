---
estimated_steps: 4
estimated_files: 2
---

# T04: Implement mergeSliceToMain with inferCommitType and full integration tests

**Slice:** S01 — GitService Core Implementation
**Milestone:** M001

## Description

The capstone task: implement `mergeSliceToMain()` which uses `inferCommitType()` to produce correct conventional commit types instead of hardcoding `feat` (fixing R009). Add full lifecycle integration tests that exercise create branch → work on branch → merge → verify commit type. Then run `npm run build` and `npm run test` to verify no regressions across the entire codebase.

## Steps

1. Implement `mergeSliceToMain(milestoneId, sliceId, sliceTitle)` method on `GitServiceImpl`: call `switchToMain()`, verify on main branch, verify slice branch exists, check commits ahead (`git rev-list --count`), `git merge --squash`, build commit message using `inferCommitType(sliceTitle)` → `${type}(${milestoneId}/${sliceId}): ${sliceTitle}`, commit with `JSON.stringify(message)`, delete branch with `git branch -D`. Return `MergeSliceResult`.
2. Add integration tests for full lifecycle:
   - Create branch → make changes → commit → switchToMain → mergeSliceToMain with feature title → verify commit message starts with `feat(`
   - Same lifecycle with "Fix broken config" title → verify commit message starts with `fix(`
   - Same lifecycle with "Docs update" title → verify commit message starts with `docs(`
   - Same lifecycle with "Refactor state management" title → verify commit message starts with `refactor(`
3. Add error case tests:
   - `mergeSliceToMain` when not on main → throws
   - `mergeSliceToMain` when branch doesn't exist → throws
   - `mergeSliceToMain` when branch has no commits ahead → throws
4. Run `npm run build` and `npm run test` to verify no regressions. Fix any issues.

## Must-Haves

- [ ] `mergeSliceToMain()` uses `inferCommitType(sliceTitle)` for commit message type
- [ ] `mergeSliceToMain()` squash merges and deletes the slice branch
- [ ] `mergeSliceToMain()` returns correct `MergeSliceResult`
- [ ] Merge commits have correct conventional type based on slice title keywords
- [ ] Error thrown when not on main branch
- [ ] Error thrown when slice branch doesn't exist
- [ ] Error thrown when no commits ahead
- [ ] `npm run build` passes
- [ ] `npm run test` passes (all existing + new tests)

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts` — all tests pass
- `npm run build` — passes
- `npm run test` — passes (no regressions)

## Observability Impact

- Signals added/changed: None beyond existing. Merge commit messages are the primary observable output — they now carry inferred types.
- How a future agent inspects this: `git log --oneline` after merge shows the conventional commit type. Test output verifies all type inference paths.
- Failure state exposed: Descriptive errors for each failure mode (not on main, branch missing, no commits ahead) include branch names and current state.

## Inputs

- `src/resources/extensions/gsd/git-service.ts` — T03 output: full `GitServiceImpl` with branch lifecycle methods
- `src/resources/extensions/gsd/tests/git-service.test.ts` — T03 output: existing passing tests for staging, commit, branch lifecycle

## Expected Output

- `src/resources/extensions/gsd/git-service.ts` — complete with `mergeSliceToMain()`, all public methods implemented
- `src/resources/extensions/gsd/tests/git-service.test.ts` — complete test suite covering all methods, all passing
- `npm run build` — green
- `npm run test` — green (all existing + new tests)
