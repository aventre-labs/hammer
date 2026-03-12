---
estimated_steps: 5
estimated_files: 2
---

# T02: Implement GitServiceImpl — smart staging, commit, and autoCommit

**Slice:** S01 — GitService Core Implementation
**Milestone:** M001

## Description

Build the `GitServiceImpl` class with the core value proposition: smart staging (R002) that excludes GSD runtime paths, and centralized commit/autoCommit methods (R001). The smart staging uses git's `:(exclude)` pathspec syntax to filter runtime paths from `git add`, with a fallback to `git add -A` if the pathspec fails. This is the foundational class that T03 and T04 build upon.

## Steps

1. Add `GitServiceImpl` class to `git-service.ts` with constructor `(basePath: string, prefs: GitPreferences = {})`. Store basePath and prefs as readonly properties.
2. Implement private `git(args, options?)` instance method that calls the module-level `runGit(this.basePath, args, options)`.
3. Implement private `smartStage()` method: build pathspec string `git add -A -- . ':(exclude).gsd/activity/' ':(exclude).gsd/runtime/' ...` for all RUNTIME_EXCLUSION_PATHS entries. Execute via `runGit`. On failure (catch), log warning to stderr (`console.error("GitService: smart staging failed, falling back to git add -A")`), then execute `git add -A` as fallback.
4. Implement `commit(opts: CommitOptions)` method: call `smartStage()`, check `git diff --cached --stat` — if empty and not `allowEmpty`, return null. Build commit message, execute `git commit -m ${JSON.stringify(opts.message)}`. Return the commit message string.
5. Implement `autoCommit(unitType: string, unitId: string)` method: check `git status --short` — if clean, return null. Call `smartStage()`, check `git diff --cached --stat` — if empty return null (all changes were runtime files). Build message `chore(${unitId}): auto-commit after ${unitType}`, commit, return message.
6. Add tests to `git-service.test.ts`: create temp repo, create GitServiceImpl instance.
   - Test smart staging excludes runtime files: create `.gsd/activity/log.jsonl`, `.gsd/runtime/state.json`, `.gsd/STATE.md`, `.gsd/auto.lock`, `.gsd/metrics.json`, `.gsd/worktrees/wt/file.txt` plus a real file `src/code.ts`. Call `commit()`. Verify only `src/code.ts` is in the commit (check `git show --stat HEAD`). Verify runtime files are still untracked/unstaged.
   - Test smart staging fallback: mock a scenario where exclusion fails (e.g., use a bad pathspec) and verify fallback to `git add -A` stages everything.
   - Test autoCommit on clean repo returns null.
   - Test autoCommit on dirty repo: create a file, call autoCommit, verify commit exists with correct message format.
   - Test empty-after-staging guard: create only runtime files (`.gsd/activity/x.jsonl`), call autoCommit, verify returns null and no commit is created.

## Must-Haves

- [ ] `GitServiceImpl` class with constructor `(basePath, prefs?)`
- [ ] Smart staging uses `:(exclude)` pathspecs for all 6 RUNTIME_EXCLUSION_PATHS
- [ ] Smart staging falls back to `git add -A` with stderr warning on pathspec failure
- [ ] `commit()` returns null when nothing staged after smart staging
- [ ] `commit()` uses `JSON.stringify` for shell-escaping commit messages
- [ ] `autoCommit()` returns null on clean repo
- [ ] `autoCommit()` returns null when only runtime files are dirty (empty-after-staging)
- [ ] `autoCommit()` returns commit message string on success
- [ ] All tests pass

## Verification

- `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/git-service.test.ts` — all tests pass including new staging/commit tests

## Observability Impact

- Signals added/changed: stderr warning when smart staging fallback activates — this is the primary diagnostic signal for staging issues
- How a future agent inspects this: Check stderr output during commits for "smart staging failed" messages. Check `git show --stat HEAD` after commits to verify which files were included.
- Failure state exposed: Fallback warning on stderr. Null return from commit/autoCommit when no files to stage.

## Inputs

- `src/resources/extensions/gsd/git-service.ts` — T01 output: types, constants, runGit, inferCommitType
- `src/resources/extensions/gsd/tests/git-service.test.ts` — T01 output: test scaffolding with passing inferCommitType tests

## Expected Output

- `src/resources/extensions/gsd/git-service.ts` — updated with `GitServiceImpl` class, `smartStage()`, `commit()`, `autoCommit()`
- `src/resources/extensions/gsd/tests/git-service.test.ts` — updated with smart staging and commit tests passing
