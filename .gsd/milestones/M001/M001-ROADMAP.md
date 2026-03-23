# M001: Tool-Driven Planning State Capture

**Vision:** Complete the markdown→DB migration for planning state, eliminating 57+ parseRoadmap() callers, 42+ parsePlan() callers, and the 12-variant regex cascade. The LLM produces creative planning work via structured tool calls. TypeScript owns all state transitions. Markdown files become rendered views, not sources of truth.

## Success Criteria

- Auto-mode completes a full planning cycle (plan milestone → plan slice → execute → replan → reassess) using tool calls with zero parseRoadmap/parsePlan calls in the dispatch loop
- Replan that references a completed task is structurally rejected by the tool handler
- Pre-M002 project with existing ROADMAP.md and PLAN.md auto-migrates to DB on first open
- deriveStateFromDb() resolves planning state without filesystem scanning for flag files

## Key Risks / Unknowns

- LLM compliance with multi-tool planning sequence — mitigated by flat schemas, TypeBox validation, clear errors
- Renderer fidelity during transition window — mitigated by cross-validation tests
- CONTINUE.md is a structured resume contract, not a flag — migration must preserve hook writers, prompt construction, cleanup semantics
- Prompt migration complexity — planning prompts are more complex than execution prompts

## Proof Strategy

- LLM schema compliance → retire in S01/S02 by proving the tools accept valid input and reject invalid input via unit tests
- Renderer fidelity → retire in S04 by proving DB state matches rendered-then-parsed state via cross-validation tests
- CONTINUE.md complexity → retire in S05 by proving auto-mode resume flow works after flag file migration
- Prompt quality → retire in S01/S02/S03 by verifying prompts produce valid tool calls in integration tests

## Verification Classes

- Contract verification: unit tests for tool handlers (validation, DB writes, rendering), cross-validation tests (DB↔parsed parity), parser removal doesn't break test suite
- Integration verification: auto-mode dispatch loop uses DB queries, planning prompts produce valid tool calls
- Operational verification: pre-M002 project migration, gsd recover handles v8 columns
- UAT / human verification: auto-mode runs a real milestone end-to-end using new tools

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 5 planning tools are registered and functional (plan_milestone, plan_slice, plan_task, replan_slice, reassess_roadmap)
- Zero parseRoadmap()/parsePlan()/parseRoadmapSlices() calls in the dispatch loop hot path
- Replan and reassess structurally enforce preservation of completed tasks/slices
- deriveStateFromDb() covers planning data — flag file checks moved to DB columns
- Cross-validation tests prove DB state matches rendered-then-parsed state
- All existing tests pass (no regressions)
- Pre-M002 projects auto-migrate via migrateHierarchyToDb() with best-effort v8 column population
- Planning prompts produce valid tool calls (not direct file writes)

## Requirement Coverage

- Covers: R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011, R012, R013, R014, R015, R016, R017, R018, R019
- Partially covers: none
- Leaves for later: R020 (parseSummary), R021 (StateEngine), R022 (native parser bridge)
- Orphan risks: none

## Slices

- [x] **S01: Schema v8 + plan_milestone tool + ROADMAP renderer** `risk:high` `depends:[]`
  > After this: gsd_plan_milestone tool accepts structured params, writes to DB, renders ROADMAP.md from DB state. Parsers still work as fallback. Schema v8 migration runs on existing DBs. Rogue detection extended for ROADMAP writes.

- [x] **S02: plan_slice + plan_task tools + PLAN/task-plan renderers** `risk:high` `depends:[S01]`
  > After this: gsd_plan_slice and gsd_plan_task tools accept structured params, write to DB, render S##-PLAN.md and T##-PLAN.md from DB. Task plan files pass existence checks. Prompt migration for plan-slice.md complete.

- [x] **S03: replan_slice + reassess_roadmap with structural enforcement** `risk:medium` `depends:[S01,S02]`
  > After this: gsd_replan_slice rejects mutations to completed tasks, gsd_reassess_roadmap rejects mutations to completed slices. replan_history and assessments tables populated. REPLAN.md and ASSESSMENT.md rendered from DB.

- [x] **S04: Hot-path caller migration + cross-validation tests** `risk:medium` `depends:[S01,S02]`
  > After this: dispatch-guard.ts, auto-dispatch.ts (4 rules), auto-verification.ts, parallel-eligibility.ts read from DB. Cross-validation tests prove DB↔rendered parity. Sequence-aware query ordering in getMilestoneSlices/getSliceTasks.

- [x] **S05: Warm/cold callers + flag files + pre-M002 migration** `risk:medium` `depends:[S03,S04]`
  > After this: doctor, visualizer, github-sync, workspace-index, dashboard-overlay, guided-flow, reactive-graph, auto-recovery use DB queries. REPLAN/ASSESSMENT/CONTINUE/CONTEXT-DRAFT/REPLAN-TRIGGER tracked in DB. migrateHierarchyToDb() populates v8 columns. gsd recover upgraded.

- [ ] **S06: Parser deprecation + cleanup** `risk:low` `depends:[S05]`
  > After this: parseRoadmapSlices() removed from hot paths (~271 lines). parsePlan() task parsing removed (~120 lines). parseRoadmap() slice extraction removed (~85 lines). Parsers kept only in md-importer for migration. Zero parseRoadmap/parsePlan calls in dispatch loop. Test suite passes with parsers removed from hot paths.

## Boundary Map

### S01 → S02

Produces:
- `gsd-db.ts` → schema v8 migration (new columns on milestones, slices, tasks tables; replan_history, assessments tables)
- `gsd-db.ts` → `insertMilestonePlanning()`, `getMilestonePlanning()` query functions
- `gsd-db.ts` → `insertSlicePlanning()`, `getSlicePlanning()` query functions (columns only — S02 populates them)
- `tools/plan-milestone.ts` → `gsd_plan_milestone` tool handler pattern (validate → transaction → render → invalidate)
- `markdown-renderer.ts` → `renderRoadmapFromDb(basePath, milestoneId)` — full ROADMAP.md generation from DB
- `auto-post-unit.ts` → rogue detection for ROADMAP.md writes

Consumes:
- nothing (first slice)

### S01 → S03

Produces:
- Schema v8 tables: `replan_history`, `assessments` (created in S01 migration, populated in S03)
- Tool handler pattern established in `tools/plan-milestone.ts`
- `renderRoadmapFromDb()` — reused by reassess for re-rendering after modification

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- `gsd-db.ts` → `getSliceTasks()`, `getTask()` query functions
- `tools/plan-slice.ts`, `tools/plan-task.ts` → handler patterns
- `markdown-renderer.ts` → `renderPlanFromDb()`, `renderTaskPlanFromDb()`

Consumes from S01:
- Schema v8 columns on slices and tasks tables
- Tool handler pattern from `tools/plan-milestone.ts`

### S02 → S04

Produces:
- `gsd-db.ts` → `getSliceTasks()`, `getTask()` with `verify_command`, `files`, `steps` columns populated
- `renderPlanFromDb()`, `renderTaskPlanFromDb()` for artifacts table population

Consumes from S01:
- Schema v8, query functions

### S01,S02 → S04

Produces (from S01+S02 combined):
- All planning data in DB (milestones, slices, tasks with v8 columns)
- All query functions needed by callers
- Rendered markdown in artifacts table

Consumes:
- S01: schema, milestone query functions, ROADMAP renderer
- S02: slice/task query functions, PLAN/task-plan renderers

### S03 → S05

Produces:
- `replan_history` table populated with actual replan events
- `assessments` table populated with actual assessments
- REPLAN.md and ASSESSMENT.md rendered from DB (flag file equivalents)

Consumes from S01, S02:
- Schema, query functions, renderers

### S04 → S05

Produces:
- Hot-path callers migrated to DB — dispatch loop no longer parses markdown
- Sequence-aware query ordering proven in getMilestoneSlices/getSliceTasks
- Cross-validation test infrastructure

Consumes from S01, S02:
- Query functions, renderers, DB-populated planning data

### S05 → S06

Produces:
- All callers migrated to DB queries
- Flag files migrated to DB columns
- migrateHierarchyToDb() populates v8 columns
- No caller depends on parseRoadmap/parsePlan/parseRoadmapSlices except md-importer

Consumes from S03, S04:
- replan/assessment DB tables, hot-path migration complete, query functions
