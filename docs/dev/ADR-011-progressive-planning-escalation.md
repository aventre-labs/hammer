# ADR-011: Progressive Planning and Mid-Execution Escalation

**Status:** Proposed
**Date:** 2026-04-17
**Author:** Alan Alwakeel (@OfficialDelta)
**Related:** ADR-003 (pipeline simplification), ADR-009 (orchestration kernel refactor)
**Prior art:** PR #3468 (enhanced verification), PR #3602 (discussion system), PR #3766 (tiered context injection), PR #4079 (layered depth enforcement)

## Context

ADR-009 introduces a Unified Orchestration Kernel (UOK) with six control planes. This ADR proposes two capabilities that map directly onto the Plan Plane and Gate Plane defined in ADR-009:

1. **Progressive Planning** — extends the Plan Plane's `compile` step to support sketch-then-refine slice planning instead of all-or-nothing upfront decomposition.
2. **Mid-Execution Escalation** — operationalizes the Gate Plane's `manual-attention` outcome for task-level ambiguity during execution.

### Problem 1: Stale Plans from Upfront Decomposition

When `plan-milestone` runs, it decomposes all slices in full detail. For a 4-slice milestone, slices S03 and S04 are planned in detail before S01 has executed. By the time S03's plan is dispatched, S01 and S02 have shipped and the codebase has changed. The planner's assumptions about file structures, API shapes, and data models may no longer hold.

The `reassess-roadmap` phase exists to catch stale plans, but as noted in ADR-003, it "almost always says 'roadmap is fine.'" The granularity is too coarse — it evaluates the entire roadmap rather than the specific next slice's assumptions against what prior slices actually built.

**Research backing:**
- Zylos Research (Feb 2026): 95% per-step reliability over 20 steps = 36% success. Planning S04 from a stale snapshot adds compounding unreliability at each step.
- ETH Zurich (Feb 2026): Context quality > quantity. Plans based on stale codebase snapshots are low-quality context that actively hurts execution.

### Problem 2: Binary Escalation (Guess or Blocker)

The current `execute-task` prompt offers two options for handling ambiguity:

1. **Guess** — "Make reasonable assumptions and document them in the task summary"
2. **Blocker** — set `blocker_discovered: true`, triggering a full slice replan

There is no middle ground. The vast space between "trivially resolvable" and "plan-invalidating" falls into the guess bucket. An executor that encounters "should notifications use a separate table or a JSON array on the user table?" makes a guess. Three tasks later, the integration test fails because other components assumed the other approach.

ADR-009's Gate Plane defines `manual-attention` as a gate outcome, but this currently applies only to gate-level decisions (policy, verification, closeout). It does not apply to task-level ambiguity during execution.

**Research backing:**
- Zylos Research (Feb 2026): 65% of AI failures from context drift — small wrong guesses compounding through downstream tasks.
- OpenAI (Sept 2025): Training rewards confident guessing over calibrated uncertainty. Agents are trained to produce answers, not to express uncertainty.
- METR (2025): 39-point perception gap between believed and actual quality of AI-generated output.

## Proposed Changes

### Change 1: Progressive Planning (Sketch-Then-Refine)

**Extends:** Plan Plane (`compile` step), Execution Plane (new `refine` node kind)

Replace all-or-nothing milestone planning with two-tier slice specification:

**During `plan-milestone` (Plan Plane `compile` step):**
- Plan S01 in full detail (task decomposition, must-haves, verification criteria)
- Plan S02+ as **sketches**: title, goal, risk level, dependencies, rough scope (2-3 sentences), key constraints — but NO task decomposition, NO task plans, NO detailed verification

**After each slice completes (Execution Plane, new `refine` node):**
- Before dispatching `plan-slice` for the next slice, the scheduler dispatches a `refine-slice` unit
- The `refine-slice` unit receives: the sketch, the completed prior slice's summary and findings, and the current codebase state
- It converts the sketch into a full plan — same output as `plan-slice`, but with better context

**New node kind in the Execution Plane DAG:**

```
refine — converts a sketch into a full plan using current codebase state
  inputs: sketch (from roadmap), prior slice summary, current codebase
  outputs: PLAN.md, T##-PLAN.md files
  dependencies: prior slice completion
  gate: plan-gate (same as plan-slice)
```

**State derivation:**

A new `refining` phase triggers when:
- The next slice exists as a sketch (has roadmap entry but no PLAN.md)
- The prior slice is complete (has SUMMARY.md)
- The milestone is not blocked

This fits naturally into ADR-009's scheduler model — `refine` is a typed node with explicit inputs, outputs, and gate requirements.

### Change 2: Mid-Execution Escalation

**Extends:** Gate Plane (`manual-attention` outcome), Execution Plane (pause/resume semantics)

Add a third option between "guess" and "blocker" for task executors:

**New artifact: `T##-ESCALATION.json`**

```json
{
  "taskId": "T03",
  "sliceId": "S02",
  "milestoneId": "M001",
  "question": "Should notifications be stored in a separate table or as a JSON array on the user table?",
  "options": [
    {
      "label": "Separate table",
      "tradeoffs": "More flexible for querying, filtering, pagination. Requires migration.",
      "recommendation": false
    },
    {
      "label": "JSON array on user",
      "tradeoffs": "Simpler schema, faster single-user reads. Limited to ~1000 notifications.",
      "recommendation": true
    }
  ],
  "recommendation": "JSON array — scope is single-user display, not cross-user analytics.",
  "continueWithDefault": true
}
```

**Integration with ADR-009's Gate Plane:**

Escalation maps to the `manual-attention` gate outcome:

1. Executor writes `T##-ESCALATION.json`
2. The Gate Plane's `execution-gate` detects the escalation artifact
3. Gate outcome: `manual-attention`
4. The notification system (persistent notification panel, PR #3587) surfaces the escalation
5. User responds via the notification panel
6. The scheduler resumes execution with the user's decision injected into carry-forward context
7. The decision is recorded via `gsd_decision_save` with source: `"escalation"`

**`continueWithDefault` semantics:**
- `true`: The executor continues with its recommended option. If the user later chooses differently, the next task receives a correction in carry-forward: "ESCALATION OVERRIDE: User chose [X] instead of executor's [Y]."
- `false`: The scheduler pauses the execution plane. No work proceeds until the user responds.

**Integration with ADR-009's Audit Plane:**

Every escalation is recorded in the audit ledger:
- Escalation created (timestamp, question, options, recommendation)
- User response (timestamp, chosen option, override status)
- Decision persisted (DECISIONS.md entry with source: "escalation")

## Risks

### Risk 1: Progressive planning adds a new node kind to the DAG scheduler

**Mitigation:** The `refine` node is mechanically identical to `plan-slice` — it dispatches to a prompt builder and writes PLAN.md files. The only difference is what context it receives (sketch + prior summary vs roadmap entry). The scheduler treats it as a standard unit with standard gate requirements.

### Risk 2: Sketches may be too vague for the refiner

**Mitigation:** Sketches include: title, goal, risk, dependencies, rough scope (2-3 sentences), and key constraints. The refiner treats the sketch as a scope constraint and plans within it. Existing plan-gate validation ensures the refined plan meets quality thresholds before execution begins.

### Risk 3: Escalation could cause notification fatigue

**Mitigation:** The `execute-task` prompt constrains escalation: "Escalate ONLY when the answer materially affects downstream tasks AND cannot be derived from the task plan, CONTEXT.md, DECISIONS.md, or codebase evidence." The escalation format requires options with tradeoffs AND a recommendation — the executor must analyze before escalating.

### Risk 4: Escalation timeout with `continueWithDefault: true` creates divergence

**Mitigation:** If the user chooses differently after the executor has continued, the correction is injected into the next task's carry-forward. For critical decisions where divergence is unacceptable, the executor sets `continueWithDefault: false` and the scheduler pauses.

### Risk 5: Interaction with ADR-003 (pipeline simplification)

**Mitigation:** ADR-003 proposes merging research into planning. Progressive planning is compatible — the merged plan-milestone session produces S01 in detail and S02+ as sketches. The `refine` node runs the same planning prompt with better context. Escalation is orthogonal — it adds a pause mechanism alongside the existing blocker mechanism.

## Alternatives Considered

### A. Keep all-or-nothing planning, improve reassess-roadmap

Make reassess-roadmap compare the specific next slice's plan against prior slice summaries.

**Rejected:** This catches staleness after the fact instead of preventing it. The refine-slice approach avoids planning S04 in detail when S01 hasn't shipped yet.

### B. Make escalation preference-only (no scheduler integration)

Add `allow_escalation` preference that adds escalation instructions to execute-task but doesn't integrate with the Gate Plane.

**Rejected:** Without `manual-attention` gate integration, escalation is advisory only — the executor writes the JSON but keeps going. The value is in the pause, not the notification.

### C. Repurpose the blocker mechanism for escalation

Overload `blocker_discovered: true` with metadata to indicate "question, not plan-invalidating."

**Rejected:** Blockers trigger a full slice replan. Escalations should resume the current task, not replan. Overloading creates ambiguity in the Gate Plane's failure reprocessing matrix.

### D. Plan only S01, don't sketch S02+

Only plan S01 during plan-milestone. Don't plan S02–S04 at all until S01 completes.

**Rejected:** The roadmap still needs high-level decomposition for user approval during discussion. Sketches serve as approved scope constraints that the refiner works within.

## Action Items

### Phase 1: Progressive Planning

1. Add sketch format to `plan-milestone.md` template: full decomposition for S01, sketch format for S02+
2. Add sketch detection to state derivation (roadmap entry exists, no PLAN.md)
3. Add `refine` node kind to the Execution Plane DAG
4. Add `buildRefineSlicePrompt()` to prompt builders — inlines prior slice summary + findings + sketch
5. Add `refine-slice.md` prompt template
6. Add plan-gate validation for refined plans (same as plan-slice)
7. Tests: sketch detection, refine dispatch, plan quality from sketch + prior summary

### Phase 2: Mid-Execution Escalation

8. Add `T##-ESCALATION.json` schema to types
9. Update `execute-task.md` with escalation instructions (between "guess" and "blocker")
10. Map escalation to Gate Plane `manual-attention` outcome
11. Add escalation detection to post-unit processing
12. Add escalation display to notification panel with interactive options
13. Wire user response into carry-forward context for resumed/next task
14. Record escalation decisions via `gsd_decision_save` with source: `"escalation"`
15. Add escalation events to Audit Plane ledger
16. Tests: escalation pause, user response injection, `continueWithDefault` behavior, audit trail

### Phase 3: Integration Testing

17. End-to-end: milestone with 3 slices, S01 ships with findings, verify `refine-slice` for S02 incorporates findings
18. End-to-end: executor writes ESCALATION.json, verify scheduler pauses, user responds, execution resumes
19. Verify escalation + blocker in same task (blocker takes priority)
20. Verify interaction with ADR-009 control plane contracts

## Open Questions

1. **Should sketches include rough task count?** A sketch saying "~3 tasks" gives the refiner a scope signal but could over-constrain.
2. **Should escalation have a max-per-milestone cap?** 10+ escalations in one milestone suggests the plan is inadequate — should the system detect this and suggest replanning?
3. **Should `continueWithDefault` be configurable at the preference level?** Some users want all escalations to pause (safe), others want all to continue (fast).
