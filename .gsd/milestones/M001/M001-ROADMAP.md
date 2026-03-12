# M001: Deterministic GitService

**Vision:** Centralize all git mechanics into a single deterministic GitService, fixing the trust boundary where probabilistic LLM prompts currently run raw git commands. The result: reliable commits, typed history, merge guards, recovery snapshots, and zero git commands in prompts.

## Success Criteria

- All git operations in auto-mode route through GitService (no inline execSync git calls except `git status --porcelain` for idle detection and `git rev-parse --git-dir` for init check)
- `npm run build` passes
- `npm run test` passes (existing tests + new GitService tests)
- No raw git commands in LLM-facing prompts (except worktree-merge.md for conflict resolution)
- Git preferences recognized in preferences.md schema
- README and GSD-WORKFLOW doc claims match actual code behavior
- Squash merge commits use correct conventional types (not always `feat`)

## Key Risks / Unknowns

- **Facade wiring breaks callers** — worktree.ts has 6+ consumers. Any export signature change breaks the build.
- **auto.ts surgery** — 2600+ line orchestrator. Changes must be surgical to avoid regressions.
- **Smart staging edge cases** — Exclusion filter may miss patterns or over-filter. Fallback to `git add -A` is the safety net.

## Proof Strategy

- Facade wiring breaks callers → retire in S02 by proving `npm run build` and `npm run test` pass with the facade in place
- auto.ts surgery → retire in S02 by proving auto.ts compiles and existing tests pass
- Smart staging edge cases → retire in S01 by proving unit tests cover exclusion patterns and fallback behavior

## Verification Classes

- Contract verification: `npm run build`, `npm run test`, grep prompts for raw git commands
- Integration verification: Full slice lifecycle through GitService (exercised by existing worktree tests + new GitService tests)
- Operational verification: none — internal infrastructure
- UAT / human verification: Run a GSD auto-mode cycle and check git log for correct commit types

## Milestone Definition of Done

This milestone is complete only when all are true:

- All slice deliverables are complete
- `npm run build` passes
- `npm run test` passes (existing + new)
- No raw git commands in execute-task.md, complete-slice.md, replan-slice.md, complete-milestone.md
- Git preferences parse and apply correctly
- README.md and GSD-WORKFLOW.md match actual behavior
- Design input files (synthesis/audit) are archived

## Requirement Coverage

- Covers: R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011, R012, R013, R014, R015, R016, R017, R018
- Partially covers: none
- Leaves for later: R019 (PR workflow), R020 (milestone tags), R021 (file ownership tracking)
- Orphan risks: none

## Slices

- [x] **S01: GitService core implementation** `risk:high` `depends:[]`
  > After this: `git-service.ts` exists with commit, autoCommit, ensureSliceBranch, switchToMain, mergeSliceToMain, inferCommitType, smart staging — all passing unit tests in temp git repos.

- [ ] **S02: Wire GitService into codebase** `risk:high` `depends:[S01]`
  > After this: auto.ts and worktree.ts delegate to GitService. Git preferences schema added to preferences.ts. `npm run build` passes. Existing worktree tests still pass.

- [ ] **S03: Bug fixes and doc corrections** `risk:medium` `depends:[S02]`
  > After this: Worktree create commits before fork. Worktree merge uses deterministic helper by default. README and GSD-WORKFLOW match actual branch deletion and snapshot behavior. Build passes.

- [ ] **S04: Remove git commands from prompts** `risk:low` `depends:[S02]`
  > After this: execute-task.md, complete-slice.md, replan-slice.md, complete-milestone.md contain no raw git commands. worktree-merge.md unchanged. Verified by grep.

- [ ] **S05: Enhanced features — merge guards, snapshots, auto-push, rich commits** `risk:medium` `depends:[S02]`
  > After this: Pre-merge verification auto-detects test runners and blocks broken merges. Snapshot refs created before merges (visible via `git for-each-ref refs/gsd/snapshots/`). auto_push preference pushes main after merge. Squash commits include task lists. Remote fetch before branching when remote exists. All verified by unit tests.

- [ ] **S06: Cleanup and archive** `risk:low` `depends:[S05]`
  > After this: CODEX-GIT-SYNTHESIS.md, CLAUDE-GIT-SYNTHESIS.md, GEMINI-GIT-SYNTHESIS.md, and ONBOARDING-PLAN.md are deleted. Final doc consistency check passes.

## Boundary Map

### S01 → S02

Produces:
- `git-service.ts` → `GitServiceImpl` class with constructor `(basePath: string, prefs: GitPreferences)`
- `git-service.ts` → `GitPreferences` interface (auto_push, push_branches, remote, snapshots, pre_merge_check, commit_type)
- `git-service.ts` → `commit(opts: CommitOptions)` — smart staging with exclusion filter, conventional commit message
- `git-service.ts` → `autoCommit(unitType: string, unitId: string)` — safety-net commit after LLM session
- `git-service.ts` → `ensureSliceBranch(milestoneId: string, sliceId: string)` — create/checkout slice branch
- `git-service.ts` → `switchToMain()` — switch to main, auto-commit dirty state first
- `git-service.ts` → `mergeSliceToMain(milestoneId: string, sliceId: string, sliceTitle: string)` — squash merge with inferred commit type
- `git-service.ts` → `inferCommitType(sliceTitle: string)` — keyword-based type inference
- `git-service.ts` → `getMainBranch()`, `getCurrentBranch()`, `isOnSliceBranch()`, `getActiveSliceBranch()`
- `git-service.ts` → Shared exclusion patterns (aligned with gitignore.ts BASELINE_PATTERNS)

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- `worktree.ts` — thin facade: all existing exports preserved, internals delegate to `GitServiceImpl`
- `auto.ts` — all git callsites route through GitService
- `preferences.ts` — `git?: GitPreferences` field with validation and merge logic
- `templates/preferences.md` — `git:` section in template
- `docs/preferences-reference.md` — git preferences documented

Consumes from S01:
- `git-service.ts` → `GitServiceImpl`, `GitPreferences`, all public methods

### S02 → S04

Produces:
- Same as S02 → S03 (prompts depend on the system committing automatically, which S02 enables)

Consumes from S01:
- Same as S02 → S03

### S02 → S05

Produces:
- Same as S02 → S03 (enhanced features build on the GitService and preferences schema)

Consumes from S01:
- Same as S02 → S03

### S03 → S06

Produces:
- Fixed `worktree-command.ts` — create ordering, merge dispatch
- Fixed `README.md` — branch lifecycle claims
- Fixed `GSD-WORKFLOW.md` — checkpoint/branch docs

Consumes from S02:
- `worktree.ts` facade (for autoCommitCurrentBranch used in create ordering fix)
- `git-service.ts` (for mergeWorktreeToMain delegation)

### S05 → S06

Produces:
- `git-service.ts` → `createSnapshot(label: string)` — hidden snapshot refs
- `git-service.ts` → `runPreMergeCheck()` — auto-detect and execute verification
- `git-service.ts` → auto-push logic in mergeSliceToMain
- `git-service.ts` → rich squash commit message builder
- `git-service.ts` → remote fetch before branching

Consumes from S02:
- `git-service.ts` core methods
- `preferences.ts` git preferences (pre_merge_check, auto_push, remote)
