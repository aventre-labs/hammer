# Omega-Driven Phases, IAM, and No-Guardrails Posture

> **Fork bridge.** Hammer is a fork of GSD-2. Most surfaces, prompts, and CLI flows look the same. Hammer adds a small set of structural commitments — Omega-driven phases, IAM (Integrated Awareness Model) gating, and an explicit no-guardrails posture — that this page documents in one place so operators know where the fork actually changes behavior.

Hammer's auto-mode is not a freeform agent loop. Every dispatched unit runs inside an Omega-driven phase that is selected, gated, and audited. This page explains the three Hammer-specific structural commitments and how they interact:

1. **Omega-driven phases** — the 10-stage Omega Protocol governs research, planning, execution, and validation transitions.
2. **IAM (Integrated Awareness Model)** — fail-closed policy + provenance gate that runs before subagent dispatch and around tool boundaries.
3. **No-guardrails posture** — Hammer ships no soft warnings, nag prompts, or "are you sure?" guards. The IAM gate is the **only** structural guardrail.

The three are designed to compose: phases declare what Omega stage they are running, IAM enforces evidence-of-awareness before dispatch, and the no-guardrails posture means there is exactly one place a contributor must look when something feels missing — IAM. Do not bypass it.

## Omega-Driven Phases

Auto-mode units run inside named phases (`research`, `plan-milestone`, `plan-slice`, `execute-task`, `complete-task`, `complete-slice`, `reassess-roadmap`, `validate-milestone`, …). Each phase is bound to one or more Omega stages from the canonical 10-stage Omega Protocol. The protocol is implemented by `hammer_canonical_spiral` and surfaced via the `mcp__gsd-workflow__hammer_canonical_spiral` MCP tool.

Why phases are Omega-driven rather than ad-hoc:

- **Stage-typed dispatch.** A `plan-slice` phase cannot quietly do `execute-task` work — the Omega manifest tied to its dispatch declares which stages are in scope.
- **Provenance.** Every phase emits an Omega run record consumable by `hammer_journal_query` and the forensics surface, so agents can reconstruct *why* a downstream decision was made.
- **No drift between phases.** When a phase finishes, the next phase reads the prior Omega manifest as part of its dispatch context, not just the rendered SUMMARY.md text.

Operators should not invent new phase names or bypass the Omega manifest write — both will show up as missing-stage findings in `hammer_volvox_diagnose` and block downstream dispatch.

### The 10 Stages, In Order

The 10-stage Omega Protocol sequences awareness through: surface intent, gather signals, refract through lenses, surface tensions, propose options, assess SAVESUCCESS pillars, commit decision, persist provenance, broadcast to graph, and re-enter.

When you read "Omega-driven" or "10-stage" in any Hammer doc, this is the protocol referenced.

## IAM Integration

IAM (Integrated Awareness Model) is the structural fail-closed gate that runs around subagent dispatch and key tool boundaries. It is enforced by `iam-subagent-policy.ts` and the `IAM_SUBAGENT_CONTRACT` constant — those names are the canonical pointers for anyone investigating the gate.

Where IAM gates fire:

- **Subagent dispatch.** Every subagent call is checked against `IAM_SUBAGENT_CONTRACT`. Missing manifest, stale Omega run, or unsigned provenance → hard reject.
- **Question rounds.** `gsd_question_round_spiral` (and its `hammer_*` alias) gates `ask_user_questions` so a planner cannot fabricate question rounds without an Omega manifest.
- **Recovery handoffs.** `RECOVERY_VERDICT` writes are gated so a recover-and-resume cycle cannot silently launder away a prior failure.

IAM is **not** advisory. It returns a hard policy block, not a warning. There is no `--no-iam` escape hatch. If you are tempted to add one, that is the signal to stop and surface a blocker instead.

### Why Fail-Closed

IAM is the only structural guardrail in Hammer (see "No-Guardrails Posture" below). Making it advisory would mean Hammer ships with zero structural guardrails. The fork's architectural commitment is: one gate, fail-closed, no bypass.

If an IAM check is wrong, the fix is to update the contract or the manifest writer — never to bypass the check, never to comment out the policy file, never to add a feature flag that turns it off.

## No-Guardrails Posture

Hammer is a no-guardrails tool by deliberate design. There are no:

- "Are you sure?" confirmation prompts before destructive operations
- Soft warnings about cost, model choice, or scope
- Auto-correction of human-typed plans
- Coaching prompts when a plan looks underspecified
- Throttles, nags, or "did you mean…" suggestions

The IAM gate is the only structural guardrail. Everything else trusts the operator and the Omega-driven phase contract.

Why this matters in practice:

- **No surprise reversals.** A `/hammer auto` run will not pause to ask "are you sure" before executing the plan it was given. The plan IS the contract.
- **No nagware.** Hammer will not interrupt a flow to suggest a different model, a different prompt, or a different cadence.
- **One guard surface.** When something fails, contributors look at IAM. They don't grep for which of 12 warning systems silently aborted.

If a contributor adds a "warning when X" or "soft-block when Y" code path outside IAM, that is a violation of the no-guardrails posture and should be removed in review.

## How They Compose

A typical auto-mode unit:

1. Phase dispatches with an Omega manifest declaring which stages it covers.
2. IAM checks the manifest exists, is fresh, and matches `IAM_SUBAGENT_CONTRACT`.
3. The unit runs with no soft guardrails — no nags, no "are you sure", no auto-correct.
4. On completion, the unit writes its Omega run record and any `RECOVERY_VERDICT` if a recovery path was traversed.
5. Next phase's dispatch reads the prior Omega manifest as part of its context.

The composition guarantee: if you bypass IAM, you break Omega provenance. If you break Omega provenance, the next phase's dispatch context is incomplete. So the only safe path is: keep the gate, write the manifest, trust the operator.

## See Also

- [Auto Mode](auto-mode.md) — the loop that runs Omega-driven phases, including the recover-and-resume section.
- [Project Structure](project-structure.md) — where Omega run records and IAM artifacts live on disk.
- [Step Mode](step-mode.md) — the human-in-the-loop counterpart that uses the same Omega phases one at a time.
