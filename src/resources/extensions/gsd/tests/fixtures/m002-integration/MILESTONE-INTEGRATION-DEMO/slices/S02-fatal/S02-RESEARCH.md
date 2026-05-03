---
unit: M002/S02-fatal
artifact: SLICE-RESEARCH
fixture: m002-integration
---

# S02 — Non-recoverable cycle research stub (Hammer S09 fixture)

This synthetic research document seeds the non-recoverable-cycle test
case in the M002 / S09 integration suite. The Hammer auto-mode recovery
helper (`dispatchRecovery`) reads the milestone context and slice
research bodies during prompt substitution; this stub gives that
substitution a deterministic, identity-scanner-clean payload to consume
for the cap-3 fatal path.

The non-recoverable cycle the suite exercises against this slice has
the following shape: a stubbed unit returns three consecutive `give-up`
recovery verdicts, the dispatcher increments the per-slice recovery
counter on each pass, and on the third increment the counter reaches
`RECOVERY_FAILURE_CAP` (defined as `3` in the Hammer recovery module).
At that point `evaluateRecoveryTrigger` returns `cap-reached` and the
dispatcher persists a structured remediation handoff into
`<tmpbase>/.hammer/milestones/M002/slices/S02-fatal/` rather than
spinning further. This research stub contains no production logic — it
exists only so the substitution and projection paths have realistic
seed text to operate on while the integration suite drives the cap
behavior to completion.
