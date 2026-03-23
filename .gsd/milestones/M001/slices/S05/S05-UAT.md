# S05: Warm/cold callers + flag files + pre-M002 migration — UAT

**Milestone:** M001
**Written:** 2026-03-23T18:22:06.035Z

## Preconditions

- GSD-2 repository checked out on `next` branch
- Node.js 22+ with `--experimental-strip-types` support
- All test commands use the resolver harness: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test`

## Test Cases

### TC1: Zero module-level parser imports remain

**Steps:**
1. Run: `grep -rn 'import.*parseRoadmap\|import.*parsePlan\|import.*parseRoadmapSlices' src/resources/extensions/gsd/*.ts | grep -v '/tests/' | grep -v 'md-importer' | grep -v 'files.ts'`

**Expected:** Exit code 1 (no matches). Zero module-level parseRoadmap/parsePlan/parseRoadmapSlices imports in any non-test, non-md-importer, non-files.ts source file.

### TC2: Flag-file DB migration — replan detection without disk files

**Steps:**
1. Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/flag-file-db.test.ts`

**Expected:** 14 assertions pass across 6 test cases:
- blocker_discovered + no replan_history → phase=replanning-slice
- blocker_discovered + replan_history exists → phase=executing (loop protection)
- replan_triggered_at set + no replan_history → phase=replanning-slice
- replan_triggered_at set + replan_history exists → phase=executing (loop protection)
- no blocker, no trigger → phase=executing (baseline)
- replan_triggered_at column is queryable via SQL

### TC3: migrateHierarchyToDb v8 column population

**Steps:**
1. Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/gsd-recover.test.ts`

**Expected:** 65 assertions pass. Test a2 verifies:
- Milestone has non-empty vision, success_criteria, boundary_map_markdown
- Tool-only fields (key_risks, requirement_coverage, proof_level) are empty (per D004)
- Slice goals populated for both S01 and S02
- Task files arrays populated correctly
- Task verify strings populated (with parser-preserved backtick formatting)
- SQL-level queryability diagnostics pass

### TC4: deriveStateFromDb regression — DB path matches file path

**Steps:**
1. Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/derive-state-db.test.ts`

**Expected:** 105 assertions pass (0 regressions). Test 16 (replanning-slice via DB) uses seeded replan_triggered_at column.

### TC5: Cross-validation parity maintained

**Steps:**
1. Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/derive-state-crossval.test.ts`

**Expected:** 189 assertions pass (0 regressions). DB state matches filesystem state.

### TC6: Doctor regression — migrated caller works correctly

**Steps:**
1. Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/doctor.test.ts`

**Expected:** 55 assertions pass (0 regressions).

### TC7: Auto-recovery regression — migrated caller works correctly

**Steps:**
1. Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/auto-recovery.test.ts`

**Expected:** 33 assertions pass (0 regressions).

### TC8: Auto-dashboard regression — migrated caller works correctly

**Steps:**
1. Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/auto-dashboard.test.ts`

**Expected:** 24 assertions pass (0 regressions).

### TC9: Planning cross-validation parity maintained

**Steps:**
1. Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/planning-crossval.test.ts`

**Expected:** 65 assertions pass — DB→render→parse round-trip parity preserved.

### TC10: Markdown renderer regression — stale detection works with lazy parser

**Steps:**
1. Run: `node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/gsd/tests/markdown-renderer.test.ts`

**Expected:** 106 assertions pass. detectStaleRenders() works correctly with lazy createRequire parser import.

### TC11: Schema version is 10

**Steps:**
1. Open any test DB created by the test suite
2. Run: `PRAGMA user_version`

**Expected:** Returns 10.

### TC12: Observability — replan_triggered_at column is queryable

**Steps:**
1. Seed a test DB with a slice and set `replan_triggered_at = '2026-01-01T00:00:00Z'`
2. Run: `SELECT id, replan_triggered_at FROM slices WHERE milestone_id = 'M001'`

**Expected:** Returns the slice row with non-null replan_triggered_at. (Covered by flag-file-db.test.ts TC6.)

## Edge Cases

- **DB unavailable:** All migrated callers must fall back to lazy createRequire parser without crashing. The isDbAvailable() gate prevents DB calls when provider is null.
- **Empty planning columns after migration:** When no PLAN.md exists for a slice, goal defaults to empty string. When no ROADMAP.md exists, vision/successCriteria/boundaryMapMarkdown remain empty. This is acceptable (best-effort per D004).
- **workspace-index.ts titleFromRoadmapHeader:** Has no DB path — always uses lazy parser because raw markdown header has no direct DB equivalent. Acceptable deviation.
- **markdown-renderer.ts detectStaleRenders:** Parser calls intentionally kept (disk-vs-DB comparison) — only import mechanism changed to lazy.
