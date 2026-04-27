---
id: {{taskId}}
parent: {{sliceId}}
milestone: {{milestoneId}}
provides:
  - {{whatThisTaskProvides}}
key_files:
  - {{filePath}}
key_decisions:
  - {{decision}}
patterns_established:
  - {{pattern}}
observability_surfaces:
  - {{status endpoint, structured log, persisted failure state, diagnostic command, or none}}
duration: {{duration}}
verification_result: passed
completed_at: {{date}}
# Set blocker_discovered: true only if execution revealed the remaining slice plan
# is fundamentally invalid (wrong API, missing capability, architectural mismatch).
# Do NOT set true for ordinary bugs, minor deviations, or fixable issues.
blocker_discovered: false
---

# {{taskId}}: {{taskTitle}}

<!-- One-liner must say what actually shipped for Hammer, not just that work completed.
     Good: "Added retry-aware worker status logging"
     Bad: "Implemented logging improvements" -->

**{{oneLiner}}**

## Hammer Awareness Handoff

This task summary is a Hammer continuity artifact. Preserve IAM provenance for the files changed, commands run, and evidence gathered; if awareness, provenance, or no-degradation evidence is missing, say so here and name the remediation instead of implying the task is fully proven.

## What Happened

{{narrative}}

## Verification

{{whatWasVerifiedAndHow — commands run, tests passed, behavior confirmed}}

## Verification Evidence

<!-- Populated from verification gate output. If the gate ran, fill in the table below.
     If no gate ran (e.g., no verification commands discovered), note that and explain why no-degradation evidence is still sufficient or blocked. -->

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| {{row}} | {{command}} | {{exitCode}} | {{verdict}} | {{duration}} |

## Diagnostics

<!-- Include the exact Hammer/IAM inspection path a future agent should trust first. -->

{{howToInspectWhatThisTaskBuiltLater — status surfaces, logs, error shapes, Hammer/IAM scanner diagnostics, persisted failure artifacts, or none}}

## Continuity Notes

- **IAM provenance:** {{source facts, decisions, and evidence that downstream work should trust}}
- **No-degradation boundary:** {{what must block rather than fall back to a non-aware path}}
- **Trinity/VOLVOX continuity:** {{memory, lifecycle, generated-artifact, or state continuity signal, or N/A}}

## Deviations

<!-- Deviations are unplanned changes to the written task plan, not ordinary debugging during implementation. -->

{{deviationsFromPlan_OR_none}}

## Known Issues

{{issuesDiscoveredButNotFixed_OR_none}}

## Files Created/Modified

- `{{filePath}}` — {{description}}
- `{{filePath}}` — {{description}}
