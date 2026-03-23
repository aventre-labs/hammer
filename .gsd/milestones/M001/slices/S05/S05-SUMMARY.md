---
id: S05
parent: M001
milestone: M001
provides:
  - Zero module-level parseRoadmap/parsePlan/parseRoadmapSlices imports in non-test, non-md-importer, non-files.ts source files
  - Schema v10 with replan_triggered_at column on slices
  - deriveStateFromDb() uses DB for REPLAN and REPLAN-TRIGGER flag-file detection
  - migrateHierarchyToDb() populates v8 planning columns (vision, successCriteria, boundaryMapMarkdown, goal, files, verify)
  - All callers use isDbAvailable() + lazy createRequire fallback — no caller depends on parser imports
requires:
  - slice: S03
    provides: replan_history table populated with actual replan events, assessments table populated
  - slice: S04
    provides: Hot-path callers migrated to DB, isDbAvailable() + lazy createRequire pattern established, sequence-aware query ordering, cross-validation infrastructure
  - slice: S01
    provides: Schema v8 migration, insertMilestone/insertSlice/insertTask query functions, renderRoadmapFromDb
  - slice: S02
    provides: getSliceTasks/getTask query functions, renderPlanFromDb/renderTaskPlanFromDb
affects:
  - S06
key_files:
  - src/resources/extensions/gsd/gsd-db.ts
  - src/resources/extensions/gsd/state.ts
  - src/resources/extensions/gsd/triage-resolution.ts
  - src/resources/extensions/gsd/md-importer.ts
  - src/resources/extensions/gsd/doctor.ts
  - src/resources/extensions/gsd/doctor-checks.ts
  - src/resources/extensions/gsd/visualizer-data.ts
  - src/resources/extensions/gsd/workspace-index.ts
  - src/resources/extensions/gsd/dashboard-overlay.ts
  - src/resources/extensions/gsd/auto-dashboard.ts
  - src/resources/extensions/gsd/guided-flow.ts
  - src/resources/extensions/gsd/auto-prompts.ts
  - src/resources/extensions/gsd/auto-recovery.ts
  - src/resources/extensions/gsd/auto-direct-dispatch.ts
  - src/resources/extensions/gsd/auto-worktree.ts
  - src/resources/extensions/gsd/reactive-graph.ts
  - src/resources/extensions/gsd/markdown-renderer.ts
  - src/resources/extensions/gsd/tests/flag-file-db.test.ts
  - src/resources/extensions/gsd/tests/gsd-recover.test.ts
key_decisions:
  - deriveStateFromDb uses getReplanHistory().length for loop protection instead of disk REPLAN.md check
  - deriveStateFromDb uses getSlice().replan_triggered_at for trigger detection instead of disk REPLAN-TRIGGER.md check
  - triage-resolution.ts DB write is best-effort with silent catch — disk file remains primary for _deriveStateImpl fallback
  - v8 planning columns populated only with parser-extractable fields; tool-only fields (keyRisks, requirementCoverage, proofLevel) left empty per D004
  - Boundary map extracted via inline string operations rather than importing extractSection — avoids coupling to unexported function
  - All migrated files use file-local lazy parser singletons via createRequire — consistent pattern, no shared utility module
  - auto-prompts.ts uses file-local async lazyParseRoadmap/lazyParsePlan helpers to centralize fallback across 6 call sites
  - markdown-renderer.ts detectStaleRenders() parser calls kept as-is (intentional disk-vs-DB comparison) — only import moved to lazy createRequire
patterns_established:
  - isDbAvailable() + lazy createRequire fallback pattern now applied to ALL non-test, non-md-importer source files — the entire codebase is DB-primary
  - File-local lazy parser singletons via createRequire(import.meta.url) with try .ts / catch .js extension resolution — established as the universal fallback pattern
  - For async-heavy callers like auto-prompts.ts, file-local async lazyParseRoadmap/lazyParsePlan helpers centralize the createRequire fallback across multiple call sites
  - SliceRow.status === 'complete' mapped to .done for backward compatibility in all migrated callers
observability_surfaces:
  - SELECT id, replan_triggered_at FROM slices WHERE milestone_id = :mid — shows replan trigger state per slice
  - SELECT * FROM replan_history WHERE milestone_id = :mid AND slice_id = :sid — shows completed replans (loop protection)
  - SELECT vision, success_criteria, boundary_map_markdown FROM milestones WHERE id = :mid — shows migrated milestone planning columns
  - SELECT goal FROM slices WHERE milestone_id = :mid AND id = :sid — shows migrated slice goal
  - SELECT files, verify_command FROM tasks WHERE milestone_id = :mid AND slice_id = :sid — shows migrated task planning columns
  - isDbAvailable() fallback writes to stderr when DB is unavailable — detectable in runtime logs
  - PRAGMA user_version returns 10 confirming schema v10
drill_down_paths:
  - .gsd/milestones/M001/slices/S05/tasks/T01-SUMMARY.md
  - .gsd/milestones/M001/slices/S05/tasks/T02-SUMMARY.md
  - .gsd/milestones/M001/slices/S05/tasks/T03-SUMMARY.md
  - .gsd/milestones/M001/slices/S05/tasks/T04-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-23T18:22:06.035Z
blocker_discovered: false
---

# S05: Warm/cold callers + flag files + pre-M002 migration

**All 13 warm/cold parser callers migrated to DB-primary with lazy fallback; schema v10 adds replan_triggered_at column; deriveStateFromDb() uses DB for flag-file detection; migrateHierarchyToDb() populates v8 planning columns — zero module-level parseRoadmap/parsePlan imports remain.**

## What Happened

S05 completed the caller migration started in S04, moving all remaining non-hot-path parseRoadmap/parsePlan callers to DB-primary queries with lazy createRequire fallback.

**T01 — Schema v10 + flag-file DB migration:** Bumped schema to v10 with `replan_triggered_at TEXT DEFAULT NULL` on slices. Rewired `deriveStateFromDb()` to use `getReplanHistory().length > 0` for loop protection (replacing REPLAN.md disk check) and `getSlice().replan_triggered_at` for trigger detection (replacing REPLAN-TRIGGER.md disk check). Updated `triage-resolution.ts executeReplan()` to write the DB column alongside the disk file. The `_deriveStateImpl()` fallback path was left untouched — it still uses disk files. New `flag-file-db.test.ts` with 6 test cases covering all combinations of blocker/trigger/history states plus observability diagnostic.

**T02 — migrateHierarchyToDb v8 column population:** Extended the migration function to pass `planning: { vision, successCriteria, boundaryMapMarkdown }` to `insertMilestone()`, `planning: { goal }` to `insertSlice()`, and `planning: { files, verify }` to `insertTask()`. Boundary map extracted via inline string operations (indexOf + slice). Plan parsing was restructured to happen before insertSlice so goal is available at insertion time. Tool-only fields (keyRisks, requirementCoverage, proofLevel) intentionally left empty per D004. Extended `gsd-recover.test.ts` with 27 new assertions covering all v8 column populations including SQL-level queryability diagnostics.

**T03 — Warm/cold callers batch 1 (7 files):** Applied the S04 isDbAvailable() + lazy createRequire pattern to doctor.ts (3 parseRoadmap + 1 parsePlan), doctor-checks.ts (2 parseRoadmap), visualizer-data.ts (1+1), workspace-index.ts (2+1), dashboard-overlay.ts (1+1), auto-dashboard.ts (1+1), guided-flow.ts (2 parseRoadmap). Each file uses file-local lazy parser singletons consistent with dispatch-guard.ts reference pattern. SliceRow.status === 'complete' mapped to .done for all DB paths.

**T04 — Warm/cold callers batch 2 (6 files) + final verification:** Migrated auto-prompts.ts (6 call sites, most complex), auto-recovery.ts (2), auto-direct-dispatch.ts (2), auto-worktree.ts (1), reactive-graph.ts (1), markdown-renderer.ts (2+2 — parser calls intentionally kept in detectStaleRenders() for disk-vs-DB comparison, import moved to lazy). auto-prompts.ts uses file-local async lazyParseRoadmap/lazyParsePlan helpers to centralize fallback across its 6 call sites. Final grep confirms zero module-level parser imports in the entire codebase (non-test, non-md-importer, non-files.ts).

## Verification

All slice-level verification checks passed:

1. **Zero module-level parser imports:** `grep -rn 'import.*parseRoadmap|import.*parsePlan|import.*parseRoadmapSlices' src/resources/extensions/gsd/*.ts | grep -v '/tests/' | grep -v 'md-importer' | grep -v 'files.ts'` → exit code 1 (no matches).

2. **flag-file-db.test.ts:** 14 assertions across 6 test cases — blocker+no-history→replanning, blocker+history→loop-protection, trigger+no-history→replanning, trigger+history→loop-protection, baseline→executing, column-queryability diagnostic. All pass.

3. **gsd-recover.test.ts:** 65 assertions including 27 new v8 column population assertions. All pass.

4. **Regression suites (all pass):**
   - doctor.test.ts: 55 pass
   - auto-recovery.test.ts: 33 pass
   - auto-dashboard.test.ts: 24 pass
   - derive-state-db.test.ts: 105 pass
   - derive-state-crossval.test.ts: 189 pass
   - planning-crossval.test.ts: 65 pass
   - markdown-renderer.test.ts: 106 pass

5. **Observability surface:** `SELECT id, replan_triggered_at FROM slices WHERE milestone_id = :mid` confirms trigger state is queryable. `SELECT * FROM replan_history WHERE milestone_id = :mid AND slice_id = :sid` confirms replan completion is queryable.

## Requirements Advanced

- R011 — REPLAN.md → replan_history table check and REPLAN-TRIGGER.md → replan_triggered_at column check migrated in deriveStateFromDb(). CONTINUE.md and CONTEXT-DRAFT.md deferred per D003.

## Requirements Validated

- R010 — All 13 warm/cold caller files migrated. grep returns zero module-level parser imports. doctor.test.ts 55/55, auto-dashboard.test.ts 24/24, auto-recovery.test.ts 33/33, markdown-renderer.test.ts 106/106 all pass.
- R017 — migrateHierarchyToDb() populates vision, successCriteria, boundaryMapMarkdown on milestones; goal on slices; files and verify on tasks. gsd-recover.test.ts 65/65 with 27 new v8 column assertions including SQL-level queryability.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T01: Updated derive-state-db.test.ts Test 16 to seed replan_triggered_at DB column (test was relying on disk-based detection now replaced by DB). T02: parsePlan() preserves backtick formatting in verify fields — adjusted test expectations. Restructured roadmap parsing to avoid double parseRoadmap() call. T03: Replaced isMilestoneComplete(roadmap) with inline check in doctor.ts; adjusted guided-flow.ts guard to allow DB-backed operation without roadmap file. T04: Plan referenced buildResumeContextListing — actual function is buildRewriteDocsPrompt. Plan referenced findStaleArtifacts — actual function is detectStaleRenders. Both migrated correctly despite name mismatches.

## Known Limitations

CONTINUE.md and CONTEXT-DRAFT.md flag-file detection NOT migrated to DB per D003 (non-revisable, deferred to M002). R011 is therefore only partially validated. github-sync.ts was listed in R010 but not in the slice plan and not migrated (it's not a parser caller). workspace-index.ts titleFromRoadmapHeader kept as lazy-parser-only (no DB path) because it extracts title from raw markdown header with no direct DB equivalent.

## Follow-ups

S06 (parser deprecation + cleanup) is now unblocked — all callers are migrated, parsers can be removed from hot paths.

## Files Created/Modified

- `src/resources/extensions/gsd/gsd-db.ts` — Schema v10: added replan_triggered_at TEXT DEFAULT NULL to slices DDL and migration block; updated SliceRow interface and rowToSlice()
- `src/resources/extensions/gsd/state.ts` — deriveStateFromDb() uses getReplanHistory() and getSlice().replan_triggered_at for flag-file detection instead of disk resolveSliceFile()
- `src/resources/extensions/gsd/triage-resolution.ts` — executeReplan() writes replan_triggered_at column via UPDATE alongside disk file, using lazy createRequire + isDbAvailable() gate
- `src/resources/extensions/gsd/md-importer.ts` — migrateHierarchyToDb() passes planning columns to insertMilestone (vision, successCriteria, boundaryMapMarkdown), insertSlice (goal), and insertTask (files, verify)
- `src/resources/extensions/gsd/doctor.ts` — Removed 3 parseRoadmap + 1 parsePlan module-level imports; added isDbAvailable() + lazy createRequire fallback at all call sites
- `src/resources/extensions/gsd/doctor-checks.ts` — Removed 2 parseRoadmap module-level imports; added isDbAvailable() + lazy createRequire fallback for git health checks
- `src/resources/extensions/gsd/visualizer-data.ts` — Removed 1 parseRoadmap + 1 parsePlan module-level imports; added isDbAvailable() + lazy createRequire fallback
- `src/resources/extensions/gsd/workspace-index.ts` — Removed 2 parseRoadmap + 1 parsePlan module-level imports; titleFromRoadmapHeader uses lazy parser only
- `src/resources/extensions/gsd/dashboard-overlay.ts` — Removed 1 parseRoadmap + 1 parsePlan module-level imports; loadData() uses DB-primary path
- `src/resources/extensions/gsd/auto-dashboard.ts` — Removed 1 parseRoadmap + 1 parsePlan module-level imports; updateSliceProgressCache() uses createRequire fallback (synchronous)
- `src/resources/extensions/gsd/guided-flow.ts` — Removed 2 parseRoadmap module-level imports; adjusted guard to allow DB-backed operation without roadmap file
- `src/resources/extensions/gsd/auto-prompts.ts` — Removed parseRoadmap + parsePlan module-level imports; added async lazyParseRoadmap/lazyParsePlan helpers; 6 call sites migrated to DB-primary
- `src/resources/extensions/gsd/auto-recovery.ts` — Removed parseRoadmap + parsePlan module-level imports; 2 call sites migrated to DB-primary with createRequire fallback
- `src/resources/extensions/gsd/auto-direct-dispatch.ts` — Removed parseRoadmap module-level import; 2 call sites use getMilestoneSlices() with createRequire fallback
- `src/resources/extensions/gsd/auto-worktree.ts` — Removed parseRoadmap module-level import; mergeMilestoneToMain uses getMilestoneSlices() with id+title mapping
- `src/resources/extensions/gsd/reactive-graph.ts` — Removed parsePlan module-level import; loadSliceTaskIO uses getSliceTasks() with createRequire fallback
- `src/resources/extensions/gsd/markdown-renderer.ts` — Moved parseRoadmap + parsePlan from module-level import to lazy createRequire inside detectStaleRenders(); parser calls kept (intentional disk-vs-DB comparison)
- `src/resources/extensions/gsd/tests/flag-file-db.test.ts` — New: 6 test cases covering DB-based flag-file detection in deriveStateFromDb()
- `src/resources/extensions/gsd/tests/gsd-recover.test.ts` — Extended with 27 new assertions for v8 column population verification
- `src/resources/extensions/gsd/tests/derive-state-db.test.ts` — Updated Test 16 to seed replan_triggered_at DB column since DB path no longer reads disk flag files
