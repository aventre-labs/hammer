---
# Optional scope estimate — helps the Hammer plan quality validator detect over-scoped tasks.
# Tasks with 10+ estimated steps or 12+ estimated files trigger a warning to consider splitting.
estimated_steps: {{estimatedSteps}}
estimated_files: {{estimatedFiles}}
# Installed skills the planner expects the executor to load before coding.
skills_used:
  - {{skillName}}
---

# {{taskId}}: {{taskTitle}}

**Slice:** {{sliceId}} — {{sliceTitle}}
**Milestone:** {{milestoneId}}

## Hammer Awareness Contract

This task plan is a Hammer work contract. Carry IAM provenance from the slice into concrete implementation steps, verification evidence, and no-degradation handling; if Omega reasoning informed the task, translate it into native Hammer files and checks rather than runtime dependencies.

When the task changes generated artifacts, memory, or lifecycle state, preserve Trinity/VOLVOX continuity and expose a clear diagnostic path for the next agent.

## Description

{{description}}

## Failure Modes

<!-- Q5: What breaks when dependencies fail? OMIT ENTIRELY for tasks with no external dependencies. -->

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| {{dependency}} | {{errorStrategy}} | {{timeoutStrategy}} | {{malformedStrategy}} |

## Load Profile

<!-- Q6: What breaks at 10x load? OMIT ENTIRELY for tasks with no shared resources or scaling concerns. -->

- **Shared resources**: {{sharedResources — DB connections, caches, rate limiters, or none}}
- **Per-operation cost**: {{perOpCost — N API calls, M DB queries, K bytes, or trivial}}
- **10x breakpoint**: {{whatBreaksFirst — pool exhaustion, rate limit, memory, context budget, or N/A}}

## Negative Tests

<!-- Q7: What negative tests prove robustness? OMIT ENTIRELY for trivial tasks. -->

- **Malformed inputs**: {{malformedInputTests — empty string, null, oversized, wrong type}}
- **Error paths**: {{errorPathTests — network timeout, auth failure, 5xx, invalid JSON, missing IAM marker}}
- **Boundary conditions**: {{boundaryTests — empty list, max length, zero, off-by-one, parser-sensitive heading order}}

## Steps

1. {{step}}
2. {{step}}
3. {{step}}

## Must-Haves

- [ ] {{mustHave}}
- [ ] {{mustHave}}

## Verification

- {{howToVerifyThisTaskIsActuallyDone}}
- {{commandToRun_OR_behaviorToCheck}}

## Observability Impact

<!-- OMIT THIS SECTION ENTIRELY for simple tasks that don't touch runtime boundaries,
     async flows, APIs, background processes, or error paths.
     Include it only when the task meaningfully changes how failures are detected or diagnosed. -->

- Signals added/changed: {{structured logs, statuses, errors, metrics, Hammer/IAM scanner diagnostics}}
- How a future agent inspects this: {{command, endpoint, file, UI state}}
- Failure state exposed: {{what becomes visible on failure and what remediation is suggested}}

## Inputs

<!-- Every input MUST be a backtick-wrapped file path. These paths are machine-parsed to
     derive task dependencies — vague descriptions without paths break dependency detection.
     For the first task in a slice with no prior task outputs, list the existing source files
     this task reads or modifies. -->

- `{{filePath}}` — {{whatThisTaskNeedsFromPriorWork}}

## Expected Output

<!-- Every output MUST be a backtick-wrapped file path — the specific files this task creates
     or modifies. These paths are machine-parsed to derive task dependencies.
     This task should produce a real increment toward making the slice goal/demo true. A full
     slice plan should not be able to mark every task complete while the claimed slice behavior
     still does not work at the stated proof level. -->

- `{{filePath}}` — {{whatThisTaskCreatesOrModifies}}
