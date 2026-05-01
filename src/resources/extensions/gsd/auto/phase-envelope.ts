/**
 * auto/phase-envelope.ts — IAM context-envelope assertion for phase transitions.
 *
 * Per M002/S02 R033 fail-closed hardening (T01-AUDIT §1, §5, §7), every
 * `setCurrentPhase(unitType)` and `clearCurrentPhase()` call site in
 * `auto/phases.ts` must be guarded by this assertion. Governed unit types
 * (the six S01 phase types) already run a full Omega spiral via
 * `runPhaseSpiral`; this helper closes the envelope-presence gap for
 * non-governed unit types (executor, recovery, etc.) so the global
 * `gsd-phase-state` cannot be flipped without IAM provenance.
 *
 * The fail-closed shape is shape-isomorphic to S01's `RunPhaseSpiralFailure`
 * (`run-phase-spiral.ts:157-167`) modulo the surface-local `failingStage`
 * union — `envelope-missing` vs `awareness-missing` — so S03's recovery
 * agent can grep one predicate across both surfaces (T01-AUDIT §6).
 *
 * Pure, side-effect-free, never throws. Callers are responsible for
 * pattern-matching `{ok: false}` and short-circuiting BEFORE invoking
 * `setCurrentPhase` / `clearCurrentPhase`.
 */

/**
 * Per-surface failure stage union (T01-AUDIT §1.2).
 *
 * - `envelope-missing`: no IAM_SUBAGENT_CONTRACT marker / no envelopeId.
 * - `awareness-missing`: marker present but mutation-boundary or parentUnit
 *   malformed — provenance lineage cannot be derived.
 */
export type PhaseEnvelopeFailingStage = "envelope-missing" | "awareness-missing";

/**
 * Minimal envelope shape this assertion inspects. Compatible with
 * `IAMContextEnvelope` (kernel) and with synthesized markers built from
 * dispatcher iteration context (`IterationContext.flowId` + dispatched
 * unitId), so both kernel-grade envelopes and dispatcher synthesis pass
 * through the same gate.
 */
export interface PhaseEnvelopeAssertionInput {
  envelopeId?: unknown;
  parentUnit?: unknown;
  /**
   * Either a string boundary tag (e.g. `"orchestration"`, `"tool-call"`)
   * or an object carrying a `boundary` field — matches kernel
   * `IAMMutationBoundary` shape.
   */
  mutationBoundary?: unknown;
}

export interface PhaseEnvelopeAssertionFailure {
  ok: false;
  failingStage: PhaseEnvelopeFailingStage;
  missingArtifacts: string[];
  remediation: string;
}

export interface PhaseEnvelopeAssertionOk {
  ok: true;
}

export type PhaseEnvelopeAssertionResult =
  | PhaseEnvelopeAssertionOk
  | PhaseEnvelopeAssertionFailure;

/**
 * Assert that an IAM_SUBAGENT_CONTRACT envelope is present and
 * minimally well-formed before a phase-state mutation.
 *
 * Fails closed when the envelope is absent (`envelope-missing`) or when
 * present-but-unusable for awareness lineage (`awareness-missing`):
 *   - missing/empty `envelopeId`               → envelope-missing
 *   - missing/empty `parentUnit`               → awareness-missing
 *   - missing/empty `mutationBoundary` tag     → awareness-missing
 *
 * Never mutates input. Never reads global state. Pure return.
 */
export function assertPhaseEnvelopePresent(
  unitType: string,
  envelope: PhaseEnvelopeAssertionInput | undefined | null,
): PhaseEnvelopeAssertionResult {
  // 1. Envelope object itself must exist — absence implies the dispatcher
  //    never built / propagated an IAM_SUBAGENT_CONTRACT marker.
  if (envelope === undefined || envelope === null || typeof envelope !== "object") {
    return {
      ok: false,
      failingStage: "envelope-missing",
      missingArtifacts: ["IAM_SUBAGENT_CONTRACT envelope"],
      remediation:
        `Phase transition for unit type "${unitType}" requires an IAM_SUBAGENT_CONTRACT envelope ` +
        `(envelopeId, parentUnit, mutationBoundary). Provide a populated envelope ` +
        `before invoking setCurrentPhase / clearCurrentPhase.`,
    };
  }

  const envelopeId = (envelope as { envelopeId?: unknown }).envelopeId;
  if (typeof envelopeId !== "string" || envelopeId.trim().length === 0) {
    return {
      ok: false,
      failingStage: "envelope-missing",
      missingArtifacts: ["envelopeId"],
      remediation:
        `Phase transition for unit type "${unitType}": envelope is missing a non-empty ` +
        `envelopeId. The IAM_SUBAGENT_CONTRACT marker requires envelopeId.`,
    };
  }

  // 2. parentUnit must be a non-empty hierarchical reference so the
  //    awareness lineage (which dispatch unit caused this phase change)
  //    is preserved in journal / audit records.
  const parentUnit = (envelope as { parentUnit?: unknown }).parentUnit;
  if (typeof parentUnit !== "string" || parentUnit.trim().length === 0) {
    return {
      ok: false,
      failingStage: "awareness-missing",
      missingArtifacts: ["parentUnit"],
      remediation:
        `Phase transition for unit type "${unitType}": envelope.parentUnit must be a ` +
        `non-empty unit reference (e.g. "M001/S01/T01") so awareness lineage is preserved.`,
    };
  }

  // 3. mutationBoundary tag must be present so the boundary scope of the
  //    phase mutation is asserted. Accepts either a bare string or the
  //    kernel `IAMMutationBoundary` shape (`{ boundary: "..." }`).
  const rawBoundary = (envelope as { mutationBoundary?: unknown }).mutationBoundary;
  let boundaryTag: string | undefined;
  if (typeof rawBoundary === "string") {
    boundaryTag = rawBoundary;
  } else if (rawBoundary !== null && typeof rawBoundary === "object") {
    const tag = (rawBoundary as { boundary?: unknown }).boundary;
    if (typeof tag === "string") boundaryTag = tag;
  }
  if (typeof boundaryTag !== "string" || boundaryTag.trim().length === 0) {
    return {
      ok: false,
      failingStage: "awareness-missing",
      missingArtifacts: ["mutationBoundary"],
      remediation:
        `Phase transition for unit type "${unitType}": envelope.mutationBoundary must declare a ` +
        `non-empty boundary tag (e.g. "orchestration", "tool-call") so awareness scope is asserted.`,
    };
  }

  return { ok: true };
}

/**
 * Synthesize a minimal phase envelope from dispatcher iteration state.
 *
 * Production call sites in `auto/phases.ts` build the envelope from the
 * existing `IterationContext.flowId` (provenance id), the dispatched
 * `unitId` (parent unit reference), and a boundary tag derived from
 * whether the unit type is governed. This synthesis is provenance-grade
 * because `flowId` is the canonical journal flow identifier and `unitId`
 * is the dispatched parent unit — both are already required upstream.
 *
 * Test call sites pass kernel-grade envelopes directly to
 * `assertPhaseEnvelopePresent`; this synthesis helper is the dispatcher's
 * compatibility shim until full IAM envelope plumbing arrives.
 */
export function deriveDispatchPhaseEnvelope(args: {
  flowId: string;
  unitType: string;
  unitId: string;
  isGovernedPhase: boolean;
}): PhaseEnvelopeAssertionInput {
  return {
    envelopeId: args.flowId,
    parentUnit: args.unitId,
    mutationBoundary: {
      boundary: args.isGovernedPhase ? "orchestration" : "tool-call",
    },
  };
}
