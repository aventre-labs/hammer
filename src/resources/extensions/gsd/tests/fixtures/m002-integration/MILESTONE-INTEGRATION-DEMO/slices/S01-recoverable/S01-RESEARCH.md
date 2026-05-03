---
unit: M002/S01-recoverable
artifact: SLICE-RESEARCH
fixture: m002-integration
---

# S01 — Recoverable cycle research stub (Hammer S09 fixture)

This synthetic research document seeds the recoverable-cycle test case
in the M002 / S09 integration suite. The Hammer auto-mode recovery
helper (`dispatchRecovery`) reads the milestone context and slice
research bodies during prompt substitution; this stub gives that
substitution a deterministic, identity-scanner-clean payload to consume
without depending on any real prior research artifact.

The recoverable cycle the suite exercises against this slice has the
following shape: a stubbed unit returns the `fix-applied` recovery
verdict pointing at a remediation file path under
`<tmpbase>/.hammer/milestones/M002/slices/S01-recoverable/`, the
dispatcher persists the verdict and increments the per-slice recovery
counter, and the very next non-recovery `execute-task` success in the
same flow resets that counter to zero per the Hammer `R030` reset
contract enforced by `shouldResetRecoveryCounter`. This research stub
itself contains no production logic — it exists only so the
substitution and projection paths have realistic seed text to operate
on.
