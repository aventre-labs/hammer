---
unit: M002
artifact: MILESTONE-CONTEXT
fixture: m002-integration
generated_by: tests/fixtures/m002-integration
---

# M002 — Synthetic Integration Milestone Context (Hammer S09 fixture)

This is a synthetic milestone-context document used exclusively by the
M002 / S09 final-integration test suite. It is not a real product
milestone. The S09 integration tests project this file into a per-test
`mkdtempSync` tmpbase and exercise the real Hammer auto-mode helpers
against the projected copy. The original on-disk content here is never
mutated by tests.

## Purpose

Provide a deterministic, identity-scanner-clean stand-in for a real
milestone context so the S09 integration suite can drive
`runPhaseSpiral`, `dispatchRecovery`, `evaluateRecoveryTrigger`,
`persistPhaseOmegaRun`, and `validatePhaseOmegaArtifacts` against a
known shape without touching any user state.

## Scope

The synthetic milestone covers two slices:

- `S01-recoverable` — exercises the recoverable-cycle path: a stubbed
  recovery unit emits `fix-applied`, the dispatcher persists the
  decision, and a follow-up non-recovery `execute-task` success resets
  the recovery counter to zero per Hammer's `R030` reset rule.
- `S02-fatal` — exercises the non-recoverable-cycle path: three
  consecutive `give-up` verdicts drive the recovery counter to
  `RECOVERY_FAILURE_CAP` (3), at which point the dispatcher pauses with
  a `cap-reached` decision and a structured remediation handoff.

## Out of scope for this fixture

This document intentionally carries no production state, no decision
register, no requirement register, and no real artifacts. The Hammer
integration tests build all of those structures into the per-test
tmpbase as needed. Editing this file should be limited to wording
clarifications that preserve the `Hammer` body marker and avoid
introducing legacy unclassified product spellings.
