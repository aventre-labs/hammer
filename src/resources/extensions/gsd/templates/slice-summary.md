---
id: {{sliceId}}
parent: {{milestoneId}}
milestone: {{milestoneId}}
provides:
  - {{whatThisSliceProvides}}
requires:
  - slice: {{depSliceId}}
    provides: {{whatWasConsumed}}
affects:
  - {{downstreamSliceId}}
key_files:
  - {{filePath}}
key_decisions:
  - {{decision}}
patterns_established:
  - {{pattern}}
observability_surfaces:
  - {{status endpoint, structured log, persisted failure state, diagnostic command, or none}}
drill_down_paths:
  - {{pathToTaskSummary}}
duration: {{duration}}
verification_result: passed
completed_at: {{date}}
---

# {{sliceId}}: {{sliceTitle}}

<!-- One-liner must say what actually shipped for Hammer, not just that work completed.
     Good: "Structured job status endpoint with persisted failure diagnostics"
     Bad: "Status feature implemented" -->

**{{oneLiner}}**

## Hammer Awareness Handoff

This slice summary is the handoff from one Hammer work queue segment to the next. Preserve IAM provenance for consumed upstream artifacts, produced downstream contracts, and verification evidence; missing awareness or no-degradation proof is a blocking gap, not a silent fallback.

## What Happened

{{narrative — compress task summaries into a coherent story}}

## Verification

{{whatWasVerifiedAcrossAllTasks — tests, builds, manual checks, Hammer/IAM scanners, no-degradation evidence}}

<!-- If the project has no REQUIREMENTS.md, omit all four requirement sections below entirely — do not fill them with "none". These sections only apply when requirements are being actively tracked. -->
## Requirements Advanced

- {{requirementId}} — {{howThisSliceAdvancedIt}}

## Requirements Validated

- {{requirementId}} — {{whatProofNowMakesItValidated}}

## New Requirements Surfaced

- {{newRequirementOr_none}}

## Requirements Invalidated or Re-scoped

- {{requirementIdOr_none}} — {{what changed}}

## Operational Readiness

<!-- Q8: How will ops know Hammer is healthy/broken? OMIT ENTIRELY for simple slices with no runtime concerns. -->

- **Health signal**: {{howToConfirmHealthy — health endpoint, heartbeat log, metric, Hammer/IAM scanner ok JSON, or N/A}}
- **Failure signal**: {{howToDetectBroken — error rate spike, alert, log pattern, missing awareness/provenance marker, or N/A}}
- **Recovery**: {{selfRecoverOrRestart — auto-reconnect, circuit breaker, manual restart, structured remediation, or N/A}}
- **Monitoring gaps**: {{silentFailureModes — background jobs, cache eviction, memory pressure, Trinity/VOLVOX drift, or none}}

## Deviations

<!-- Deviations are unplanned changes to the written plan, not ordinary debugging inside the plan's intended scope. -->

{{deviationsFromPlan_OR_none}}

## Known Limitations

<!-- Known limitations are real gaps, rough edges, or deferred constraints that still exist after this slice shipped. -->

{{whatDoesntWorkYet_OR_whatWasDeferredToLaterSlices}}

## Follow-ups

<!-- Follow-ups are concrete next actions discovered during execution, not a restatement of known limitations. -->

{{workDeferredOrDiscoveredDuringExecution_OR_none}}

## Files Created/Modified

- `{{filePath}}` — {{description}}
- `{{filePath}}` — {{description}}

## Forward Intelligence

<!-- Write what you wish you'd known at the start of this slice.
     This section is read by the next slice's planning and research steps.
     Be specific and concrete — this is the most valuable context you can transfer. -->

### What the next slice should know
- {{insightThatWouldHelpDownstreamWork}}

### What's fragile
- {{fragileAreaOrThinImplementation}} — {{whyItMatters}}

### Authoritative diagnostics
- {{whereAFutureAgentShouldLookFirst}} — {{whyThisSignalIsTrustworthy, including Hammer/IAM/provenance or no-degradation checks}}

### What assumptions changed
- {{originalAssumption}} — {{whatActuallyHappened}}

### Continuity to preserve
- {{TrinityMemoryOrVOLVOXLifecycleOrGeneratedArtifactContinuitySignal}} — {{why downstream agents should not regress it}}
