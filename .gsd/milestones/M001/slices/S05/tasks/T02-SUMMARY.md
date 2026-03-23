---
id: T02
parent: S05
milestone: M001
key_files:
  - src/resources/extensions/gsd/md-importer.ts
  - src/resources/extensions/gsd/tests/gsd-recover.test.ts
key_decisions:
  - v8 planning columns populated only with parser-extractable fields; tool-only fields (keyRisks, requirementCoverage, proofLevel) left empty per D004
  - Boundary map extracted via inline string operations (indexOf + slice) rather than importing extractSection from files.ts — avoids coupling to unexported function
  - Plan parsing moved before insertSlice to make goal available at insertion time instead of using a post-insert upsert
duration: ""
verification_result: passed
completed_at: 2026-03-23T17:52:14.780Z
blocker_discovered: false
---

# T02: Extend migrateHierarchyToDb to populate v8 planning columns (vision, successCriteria, boundaryMapMarkdown on milestones; goal on slices; files/verify on tasks)

**Extend migrateHierarchyToDb to populate v8 planning columns (vision, successCriteria, boundaryMapMarkdown on milestones; goal on slices; files/verify on tasks)**

## What Happened

Extended `migrateHierarchyToDb()` in `md-importer.ts` to populate v8 planning columns from parsed markdown during recovery/migration.

**Milestone planning columns:** Refactored to parse the roadmap once (not twice) — saved the `parseRoadmap()` result early and reused it. Added inline extraction of the raw `## Boundary Map` section from roadmap markdown (finds heading, takes content until next `##` or EOF). The `insertMilestone()` call now passes `planning: { vision, successCriteria, boundaryMapMarkdown }`. Per D004, tool-only fields (keyRisks, requirementCoverage, proofStrategy, etc.) are left empty.

**Slice planning columns:** Restructured the loop to parse the plan file *before* `insertSlice()` (previously parsed after). The `insertSlice()` call now passes `planning: { goal: plan.goal }`. When no plan file exists, goal defaults to empty string.

**Task planning columns:** The `insertTask()` call now passes `planning: { files: taskEntry.files ?? [], verify: taskEntry.verify ?? '' }` from the `TaskPlanEntry` parsed by `parsePlan()`.

**Test extensions:** Enhanced the `gsd-recover.test.ts` fixtures — added `## Success Criteria` and `## Boundary Map` sections to the ROADMAP fixture, and `- Files:` / `- Verify:` lines to all task entries in both PLAN fixtures. Added a comprehensive test block (Test a2) with 27 assertions verifying: milestone vision matches fixture, success_criteria populated with correct entries, boundary_map_markdown contains expected content, D004 tool-only fields remain empty (key_risks, requirement_coverage, proof_level), slice goals populated for both S01 and S02, task files arrays populated correctly, task verify strings populated (discovered parser preserves backtick formatting), and SQL-level queryability diagnostics for all v8 columns.

## Verification

Ran gsd-recover.test.ts — all 65 assertions pass including 27 new v8 column population assertions. Ran 7 regression suites (migrate-hierarchy.test.ts: 57 pass, derive-state-crossval.test.ts: 189 pass, integration-proof.test.ts: 3 pass, derive-state-db.test.ts: 105 pass, doctor.test.ts: 55 pass, auto-recovery.test.ts: 33 pass, auto-dashboard.test.ts: 24 pass, planning-crossval.test.ts: 65 pass, markdown-renderer.test.ts: 106 pass, flag-file-db.test.ts: 14 pass) — zero regressions.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/gsd-recover.test.ts` | 0 | ✅ pass | 524ms |
| 2 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts` | 0 | ✅ pass | 686ms |
| 3 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/derive-state-crossval.test.ts` | 0 | ✅ pass | 692ms |
| 4 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/integration-proof.test.ts` | 0 | ✅ pass | 756ms |
| 5 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/flag-file-db.test.ts` | 0 | ✅ pass | 176ms |
| 6 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/doctor.test.ts` | 0 | ✅ pass | 1100ms |
| 7 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/auto-recovery.test.ts` | 0 | ✅ pass | 752ms |
| 8 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/derive-state-db.test.ts` | 0 | ✅ pass | 238ms |
| 9 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/auto-dashboard.test.ts` | 0 | ✅ pass | 554ms |
| 10 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/planning-crossval.test.ts` | 0 | ✅ pass | 208ms |
| 11 | `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/markdown-renderer.test.ts` | 0 | ✅ pass | 257ms |


## Deviations

Discovered that parsePlan() preserves backtick formatting in verify fields (e.g. `` `npm test` `` not `npm test`). Adjusted test expectations to match. Refactored roadmap parsing to avoid double parseRoadmap() call — the function was called once for title and again for slices; now parsed once with result reused. Changed the loop guard from `if (!roadmapContent) continue` to `if (!roadmap) continue` to match the refactored variable.

## Known Issues

None.

## Diagnostics

- **Milestone planning columns after migration:** `SELECT vision, success_criteria, boundary_map_markdown, key_risks, requirement_coverage, proof_level FROM milestones WHERE id = ?` — vision/success_criteria/boundary_map_markdown populated from parsed ROADMAP; key_risks/requirement_coverage/proof_level empty (tool-only, per D004).
- **Slice goal after migration:** `SELECT id, goal FROM slices WHERE milestone_id = ?` — goal populated from parsed PLAN file; empty when no plan file existed.
- **Task files/verify after migration:** `SELECT id, files, verify_command FROM tasks WHERE milestone_id = ? AND slice_id = ?` — files is JSON array, verify_command is string (may include backtick formatting from parser).
- **Test suite:** `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/gsd-recover.test.ts` — 27 new assertions in Test a2 covering all v8 column populations.

## Files Created/Modified

- `src/resources/extensions/gsd/md-importer.ts`
- `src/resources/extensions/gsd/tests/gsd-recover.test.ts`
