# Issue #672: Parallel Milestone Orchestration
<!-- HAMMER FORK BRIDGE: This file is part of Hammer's documentation surface. Hammer is a fork of GSD-2 that adds explicit IAM-gated subagent dispatch, a no-guardrails posture, recover-and-resume on session crash, and Omega-driven discuss/research/plan/execute/refine phases. Legacy `/gsd` commands, `gsd_*` tool names, `.gsd/` state paths, and `GSD_*` env vars remain accepted as internal-implementation/state-bridge surface so existing installations keep working — see CHANGELOG.md and VISION.md for the full fork-relationship note. -->


**Issue:** https://github.com/gsd-build/gsd-2/issues/672
**Contributor:** @deseltrus (7 merged PRs, proven contributor)
**Status:** WIP — foundation modules built, orchestrator core in progress
**Default:** `parallel.enabled: false` — opt-in, zero impact to existing users

## Delivery Plan (6 PRs)

### PR 1: Worktree Bugfixes - MERGED (#675)
### PR 2: Dispatch Hardening (Small) - pending contributor
### PR 3: Parallel Config + Preferences (Small) - included in this PR
### PR 4: Session Status Protocol (Medium) - included in this PR
### PR 5: Orchestrator Core (Large) - included in this PR
### PR 6: Dashboard + Commands (Medium) - commands included, dashboard deferred

See full plan in the GitHub issue comment.
