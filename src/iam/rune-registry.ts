/**
 * src/iam/rune-registry.ts
 *
 * Canonical IAM governance rune registry — all 12 runes with their obligations,
 * primary artifacts, required sections, minimum bars, and exit criteria.
 *
 * Pure logic module: imports only from src/iam/types.ts. Zero I/O, zero LLM calls.
 */

import type { RuneContract, RuneName, IAMResult } from "./types.js";

// ---------------------------------------------------------------------------
// Registry definition
// ---------------------------------------------------------------------------

export const RUNE_REGISTRY = {
  RIGOR: {
    runeName: "RIGOR",
    obligation: "Evidence and accountability",
    primaryArtifact: "Assumption Ledger",
    requiredSections: [
      "Assumptions list with source",
      "Known unknowns",
      "Evidence quality assessment",
      "Accountability assignments",
    ],
    minimumBar:
      "Every material assumption is named and either supported by evidence or explicitly marked as unknown.",
    exitCriteria:
      "All assumptions named with evidence or marked as unknowns; no hidden premises remain.",
  },
  HUMAN: {
    runeName: "HUMAN",
    obligation: "Lived experience and dignity",
    primaryArtifact: "Impact Map + Friction Analysis",
    requiredSections: [
      "Affected populations inventory",
      "Dignity impact assessment",
      "Friction points and lived-experience gaps",
      "Mitigation strategies",
    ],
    minimumBar:
      "At least one primary affected group is named and their lived-experience perspective is represented.",
    exitCriteria:
      "All significant human impacts mapped; friction points for each affected group identified and addressed.",
  },
  FORGE: {
    runeName: "FORGE",
    obligation: "Craft and production integrity",
    primaryArtifact: "Build Standards",
    requiredSections: [
      "Quality criteria",
      "Production standards",
      "Craft review checklist",
      "Integrity verification steps",
    ],
    minimumBar:
      "Production standards are documented and at least one quality verification mechanism is in place.",
    exitCriteria:
      "All deliverables meet stated craft standards; production integrity verified against build criteria.",
  },
  IMAGINATION: {
    runeName: "IMAGINATION",
    obligation: "Generative possibility",
    primaryArtifact: "Scenario Set",
    requiredSections: [
      "Alternative scenarios (minimum 3)",
      "Edge cases explored",
      "Novel possibilities surfaced",
      "Selected scenario rationale",
    ],
    minimumBar:
      "At least three meaningfully distinct scenarios are articulated, including at least one surprising or non-obvious path.",
    exitCriteria:
      "Scenario set demonstrates genuine exploration of possibility space; selection rationale is explicit.",
  },
  RISK: {
    runeName: "RISK",
    obligation: "Failure modes and consequences",
    primaryArtifact: "Risk Register",
    requiredSections: [
      "Failure mode inventory",
      "Likelihood and severity ratings",
      "Consequence chains",
      "Mitigation owners and timelines",
    ],
    minimumBar:
      "Every significant failure mode is named with at least a rough likelihood/severity rating.",
    exitCriteria:
      "Risk Register complete with owners assigned to all high-severity items; no unacknowledged catastrophic paths remain.",
  },
  STEWARDSHIP: {
    runeName: "STEWARDSHIP",
    obligation: "Long-term responsibility",
    primaryArtifact: "Stewardship Charter",
    requiredSections: [
      "Long-term impact horizon",
      "Sustainability commitments",
      "Future-generation considerations",
      "Ongoing accountability mechanisms",
    ],
    minimumBar:
      "A minimum 5-year consequence horizon is considered and at least one sustainability commitment is named.",
    exitCriteria:
      "Stewardship Charter ratified with named stewards; long-term accountability mechanisms specified.",
  },
  MEANING: {
    runeName: "MEANING",
    obligation: "Purpose and worth",
    primaryArtifact: "Meaning Statement",
    requiredSections: [
      "Core purpose declaration",
      "Worth articulation",
      "Value alignment check",
      "Existential stakes",
    ],
    minimumBar:
      "The core purpose is stated in plain language and the question of whether it is worth doing is explicitly answered.",
    exitCriteria:
      "Meaning Statement approved; purpose and worth are clear to all stakeholders without specialized knowledge.",
  },
  CLARITY: {
    runeName: "CLARITY",
    obligation: "Honest communication",
    primaryArtifact: "Plain Language Audit",
    requiredSections: [
      "Jargon inventory with plain substitutes",
      "Ambiguity log",
      "Audience comprehension check",
      "Communication channel review",
    ],
    minimumBar:
      "All audience-facing materials are comprehensible to a non-specialist; jargon is either eliminated or defined.",
    exitCriteria:
      "Plain Language Audit passed; ambiguities resolved; communication is honest, direct, and accessible.",
  },
  INSIGHT: {
    runeName: "INSIGHT",
    obligation: "Non-obvious discovery",
    primaryArtifact: "Insight Report",
    requiredSections: [
      "Counter-intuitive findings",
      "Hidden patterns surfaced",
      "Second-order effects identified",
      "Blind spot acknowledgements",
    ],
    minimumBar:
      "At least one genuinely non-obvious finding is documented — something that would not be reached by casual observation.",
    exitCriteria:
      "Insight Report contains verifiable non-obvious discoveries; blind spots acknowledged and where possible addressed.",
  },
  GROUNDING: {
    runeName: "GROUNDING",
    obligation: "Return to concrete reality",
    primaryArtifact: "Reality Check",
    requiredSections: [
      "Abstract-to-concrete translation",
      "Real-world constraint inventory",
      "Feasibility verification",
      "Ground-truth validation sources",
    ],
    minimumBar:
      "Every major abstraction is tied to a concrete, verifiable real-world example or constraint.",
    exitCriteria:
      "Reality Check passed; all abstractions grounded in verifiable facts; no floating untested assertions remain.",
  },
  CONVERGENCE: {
    runeName: "CONVERGENCE",
    obligation: "Synthesis to direction",
    primaryArtifact: "Decision Brief",
    requiredSections: [
      "Options considered (minimum 2)",
      "Evaluation criteria",
      "Selected direction with rationale",
      "Dissent acknowledgement",
    ],
    minimumBar:
      "A clear direction is selected from at least two explicit alternatives with documented evaluation criteria.",
    exitCriteria:
      "Decision Brief ratified; direction is unambiguous; dissenting views acknowledged and addressed.",
  },
  PRAXIS: {
    runeName: "PRAXIS",
    obligation: "Theory to action",
    primaryArtifact: "Action Plan",
    requiredSections: [
      "Specific next actions (minimum 3)",
      "Owners and deadlines",
      "Theory-to-practice translation",
      "Progress verification criteria",
    ],
    minimumBar:
      "At least three specific, ownable actions are defined with realistic timelines.",
    exitCriteria:
      "Action Plan adopted; every major theory element has a corresponding action; progress can be independently verified.",
  },
} satisfies Record<RuneName, RuneContract>;

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Direct lookup by RuneName. Throws only if the runtime value is somehow not
 * a valid RuneName — should never happen with the TypeScript type system intact.
 */
export function getRune(name: RuneName): RuneContract {
  const rune = RUNE_REGISTRY[name];
  if (!rune) {
    throw new Error(`IAM: unknown rune "${String(name)}" — this should never happen with a typed RuneName`);
  }
  return rune;
}

/** Returns all 12 rune contracts in insertion order. */
export function listRunes(): RuneContract[] {
  return Object.values(RUNE_REGISTRY) as RuneContract[];
}

/**
 * Validates an array of string names against the known RuneName set.
 *
 * Rules:
 * - Any unrecognised name → `ok:false` with `iamErrorKind: "unknown-rune"`
 * - More than 3 names → `ok:false` with `iamErrorKind: "rune-validation-failed"`
 *   (co-apply validation; the limit check is applied after the name check)
 */
export function validateRuneNames(names: string[]): IAMResult<RuneName[]> {
  const validNames = new Set<string>(Object.keys(RUNE_REGISTRY));

  // Check for unrecognised names first
  const unknown = names.filter((n) => !validNames.has(n));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: {
        iamErrorKind: "unknown-rune",
        persistenceStatus: "not-attempted",
        remediation: `The following rune names are not recognised: ${unknown.join(", ")}. Valid rune names are: ${Array.from(validNames).join(", ")}.`,
      },
    };
  }

  // Co-apply: check the 3-rune limit
  if (names.length > 3) {
    return {
      ok: false,
      error: {
        iamErrorKind: "rune-validation-failed",
        persistenceStatus: "not-attempted",
        remediation:
          "A maximum of 3 rune names may be provided per validation call. Split into batches of 3 or fewer to process more runes.",
      },
    };
  }

  return { ok: true, value: names as RuneName[] };
}
