---
id: T04
parent: S05
milestone: M001
key_files:
  - src/resources/extensions/gsd/auto-prompts.ts
  - src/resources/extensions/gsd/auto-recovery.ts
  - src/resources/extensions/gsd/auto-direct-dispatch.ts
  - src/resources/extensions/gsd/auto-worktree.ts
  - src/resources/extensions/gsd/reactive-graph.ts
  - src/resources/extensions/gsd/markdown-renderer.ts
key_decisions:
  - auto-prompts.ts uses file-local async lazyParseRoadmap/lazyParsePlan helpers (centralized createRequire fallback within the file) rather than per-callsite inline createRequire — reduces duplication across 6 call sites while keeping the lazy pattern file-local
  - markdown-renderer.ts detectStaleRenders() parser calls kept as-is (intentional disk-vs-DB comparison) — only import moved to lazy createRequire inside the function
  - auto-worktree.ts mergeMilestoneToMain maps both id and title from SliceRow since downstream code formats commit messages using s.title
duration: ""
verification_result: passed
completed_at: 2026-03-23T18:16:53.812Z
blocker_discovered: false
---

# T04: Migrate remaining 6 callers (auto-prompts, auto-recovery, auto-direct-dispatch, auto-worktree, reactive-graph, markdown-renderer) from module-level parseRoadmap/parsePlan imports to DB-primary + lazy fallback — zero module-level parser imports remain

**Migrate remaining 6 callers (auto-prompts, auto-recovery, auto-direct-dispatch, auto-worktree, reactive-graph, markdown-renderer) from module-level parseRoadmap/parsePlan imports to DB-primary + lazy fallback — zero module-level parser imports remain**

## What Happened

Migrated all 6 remaining files with module-level parseRoadmap/parsePlan imports to the established DB-primary + lazy createRequire fallback pattern.

**auto-prompts.ts** (6 call sites — most complex file):
- Removed `parsePlan` and `parseRoadmap` from module-level import.
- Added `lazyParseRoadmap()` and `lazyParsePlan()` async helper functions at top of file to centralize the createRequire fallback pattern.
- `inlineDependencySummaries()`: DB path uses `getSlice(mid, sid).depends` directly; parser fallback via `lazyParseRoadmap`.
- `checkNeedsReassessment()`: DB path uses `getMilestoneSlices(mid)` filtered by `status === "complete"`; parser fallback via `lazyParseRoadmap`.
- `checkNeedsRunUat()`: Same pattern as checkNeedsReassessment with full DB primary path.
- `buildCompleteMilestonePrompt()`: DB path uses `getMilestoneSlices(mid).map(s => s.id)` for slice ID iteration; parser fallback.
- `buildValidateMilestonePrompt()`: Same pattern as buildCompleteMilestonePrompt.
- `buildRewriteDocsPrompt()` (was misidentified as `buildResumeContextListing` in plan): DB path uses `getSliceTasks(mid, sid)` to find incomplete task IDs; parser fallback via `lazyParsePlan`.

**auto-recovery.ts** (2 call sites):
- Removed `parseRoadmap` and `parsePlan` from module-level import; added `createRequire` from `node:module` and `getSliceTasks` from `gsd-db.js`.
- Line 370 parsePlan: DB path uses `getSliceTasks(mid, sid)` to get task IDs for verifying task plan files exist; createRequire fallback.
- Line 407 parseRoadmap: Already inside `!isDbAvailable()` block — moved import to lazy createRequire at call site.

**auto-direct-dispatch.ts** (2 call sites):
- Removed `parseRoadmap` from import; added `isDbAvailable, getMilestoneSlices` from `gsd-db.js`.
- Both call sites (reassess + run-uat dispatches) use `getMilestoneSlices(mid).filter(s => s.status === "complete")` with createRequire fallback.

**auto-worktree.ts** (1 call site):
- Removed `parseRoadmap` from import; added `createRequire` from `node:module` and `getMilestoneSlices` from `gsd-db.js`.
- `mergeMilestoneToMain()` uses `getMilestoneSlices(milestoneId)` for completed slice listing. Mapped both `id` and `title` since downstream code uses `s.title` for commit message formatting.

**reactive-graph.ts** (1 call site):
- Removed `parsePlan` from import (kept `parseTaskPlanIO` which is NOT a planning parser); added `isDbAvailable, getSliceTasks` from `gsd-db.js`.
- `loadSliceTaskIO()` uses `getSliceTasks(mid, sid)` to get task entries with status mapping; createRequire fallback for parsePlan.

**markdown-renderer.ts** (2 parseRoadmap + 2 parsePlan — intentional disk-vs-DB comparison):
- Moved `parseRoadmap` and `parsePlan` from module-level import to lazy `createRequire` inside `detectStaleRenders()`. Parser calls kept as-is because they intentionally compare disk state against DB state for staleness detection.
- Added `createRequire` from `node:module` as module-level import.

**Final verification:** `grep -rn 'import.*parseRoadmap|import.*parsePlan|import.*parseRoadmapSlices' src/resources/extensions/gsd/*.ts | grep -v '/tests/' | grep -v 'md-importer' | grep -v 'files.ts'` returns zero results — no module-level parser imports remain anywhere in the codebase.

## Verification

All 4 verification commands pass:
1. Final grep for module-level parser imports → exit code 1 (no matches found) ✅
2. auto-recovery.test.ts → 33 pass, 0 fail ✅
3. markdown-renderer.test.ts → 106 pass, 0 fail ✅
4. planning-crossval.test.ts → 65 pass, 0 fail ✅

Regression suites all pass:
5. doctor.test.ts → 55 pass ✅
6. auto-dashboard.test.ts → 24 pass ✅
7. derive-state-db.test.ts → 105 pass ✅
8. derive-state-crossval.test.ts → 189 pass ✅
9. flag-file-db.test.ts → 14 pass ✅
10. gsd-recover.test.ts → 65 pass ✅

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `grep -rn 'import.*parseRoadmap\|import.*parsePlan\|import.*parseRoadmapSlices' src/resources/extensions/gsd/*.ts | grep -v '/tests/' | grep -v 'md-importer' | grep -v 'files.ts'` | 1 | ✅ pass | 50ms |
| 2 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/auto-recovery.test.ts` | 0 | ✅ pass | 3100ms |
| 3 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/markdown-renderer.test.ts` | 0 | ✅ pass | 3100ms |
| 4 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/planning-crossval.test.ts` | 0 | ✅ pass | 3100ms |
| 5 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/doctor.test.ts` | 0 | ✅ pass | 3700ms |
| 6 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/auto-dashboard.test.ts` | 0 | ✅ pass | 3700ms |
| 7 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/derive-state-db.test.ts` | 0 | ✅ pass | 3700ms |
| 8 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/derive-state-crossval.test.ts` | 0 | ✅ pass | 3700ms |
| 9 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/flag-file-db.test.ts` | 0 | ✅ pass | 3700ms |
| 10 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/gsd-recover.test.ts` | 0 | ✅ pass | 3700ms |


## Deviations

Plan referenced `buildResumeContextListing()` at line ~1603 — actual function is `buildRewriteDocsPrompt()` at that location. The parsePlan call site was identical; migrated correctly. Plan referenced `findStaleArtifacts()` in markdown-renderer.ts — actual function is `detectStaleRenders()` (synchronous, not async). Used `createRequire` instead of dynamic `import()` accordingly.

## Known Issues

None.

## Diagnostics

- **Final parser import audit:** `grep -rn 'import.*parseRoadmap\|import.*parsePlan\|import.*parseRoadmapSlices' src/resources/extensions/gsd/*.ts | grep -v '/tests/' | grep -v 'md-importer' | grep -v 'files.ts'` — zero results confirms all module-level parser imports eliminated.
- **auto-prompts.ts migration:** 6 call sites migrated; each has DB-primary path with lazy async fallback. `grep -c 'isDbAvailable\|lazyParseRoadmap\|lazyParsePlan' src/resources/extensions/gsd/auto-prompts.ts` shows helpers and gates.
- **markdown-renderer.ts:** Parser calls remain in `detectStaleRenders()` (intentional disk-vs-DB comparison) but import is lazy createRequire, not module-level.

## Files Created/Modified

- `src/resources/extensions/gsd/auto-prompts.ts`
- `src/resources/extensions/gsd/auto-recovery.ts`
- `src/resources/extensions/gsd/auto-direct-dispatch.ts`
- `src/resources/extensions/gsd/auto-worktree.ts`
- `src/resources/extensions/gsd/reactive-graph.ts`
- `src/resources/extensions/gsd/markdown-renderer.ts`
