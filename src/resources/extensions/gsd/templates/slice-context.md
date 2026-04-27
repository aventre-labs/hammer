---
id: {{sliceId}}
milestone: {{milestoneId}}
status: {{draft|ready|in_progress|complete}}
---

# {{sliceId}}: {{sliceTitle}} — Context

<!-- Slice-scoped context. Milestone-only sections (acceptance criteria, completion class,
     milestone sequence) do not belong here — those live in the milestone context. -->

## Hammer Awareness Contract

This slice context is a Hammer planning handoff. Carry IAM provenance from milestone decisions into slice scope, name any Omega reasoning that affected order, and block execution if no-degradation or Trinity/VOLVOX continuity requirements are unclear.

## Goal

<!-- One sentence: what this slice delivers when it is done. -->

{{sliceGoal}}

## Why this Slice

<!-- Why this slice is being done now. What does it unblock, and why does order matter? -->

{{whyNowAndWhatItUnblocks}}

## Scope

<!-- What is and is not in scope for this slice. Be explicit about non-goals. -->

### In Scope

- {{inScopeItem}}

### Out of Scope

- {{outOfScopeItem}}

## Constraints

<!-- Known constraints: time-boxes, hard dependencies, prior decisions this slice must respect. -->

- {{constraint}}

## Integration Points

<!-- Artifacts or subsystems this slice consumes and produces. -->

### Consumes

- `{{fileOrArtifact}}` — {{howItIsUsed}}

### Produces

- `{{fileOrArtifact}}` — {{whatItProvides}}

## Awareness Failure Signals

- **Missing provenance:** {{what source/evidence gap should stop execution}}
- **No-degradation boundary:** {{what must block instead of falling back to non-aware behavior}}
- **Continuity risk:** {{Trinity/VOLVOX/memory/lifecycle state to preserve, or N/A}}

## Open Questions

<!-- Unresolved questions at planning time. Answer them before or during execution. -->

- {{question}} — {{currentThinking}}
