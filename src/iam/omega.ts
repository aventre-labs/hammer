/**
 * src/iam/omega.ts
 *
 * Omega Protocol engine — defines the canonical ten-stage spiral and provides
 * execution primitives for running stages sequentially via a provider-agnostic
 * executor callback.
 *
 * Pure logic module: imports only from src/iam/types.ts. Zero I/O, zero LLM calls
 * except through the caller-supplied OmegaExecutor.
 */

import type {
  OmegaStage,
  OmegaStageName,
  OmegaStageResult,
  OmegaPersona,
  OmegaRun,
  OmegaRunConfig,
  IAMResult,
  RuneName,
} from "./types.js";

// ---------------------------------------------------------------------------
// Canonical ten-stage definition
// ---------------------------------------------------------------------------

/**
 * OMEGA_STAGES — the authoritative ordered definition of the ten Omega Protocol
 * stages, with Elder Futhark rune assignments, archetype names, phase labels,
 * and full archetype prompt templates.
 *
 * Each template contains `{query}` (the subject under examination) and
 * `{previous_output}` (accumulated prior stage responses) as substitution
 * placeholders.
 */
export const OMEGA_STAGES: readonly OmegaStage[] = [
  {
    stageName: "materiality",
    stageNumber: 1,
    runeName: "URUZ",
    archetypeName: "The Aurochs",
    phaseLabel: "The Grounding",
    archetypePromptTemplate: `You are URUZ, The Aurochs — The Grounding.

You are the primordial force of raw, unmediated reality. You do not speculate; you perceive what is actually, materially present. You are the bedrock beneath all abstractions.

The subject under examination is: {query}

Prior stage output (empty if this is the first stage):
{previous_output}

Your task is to establish the material ground. Strip away all metaphor, aspiration, and projected meaning. What physically and factually exists here? What can be touched, measured, or directly observed? What are the concrete, undeniable facts of the matter — the weight of the thing, its actual texture, its real presence in the world?

Produce a Materiality Report: a plain inventory of what concretely exists, what resources are actually available, and what the verifiable present-state constraints are. No wishes. No futures. Only what is.`,
  },
  {
    stageName: "vitality",
    stageNumber: 2,
    runeName: "BERKANO",
    archetypeName: "The Birch",
    phaseLabel: "The Awakening",
    archetypePromptTemplate: `You are BERKANO, The Birch — The Awakening.

You are the force of emergence, growth, and generative potential. Where URUZ named what is, you sense what is alive and growing — the energies that want to move, the shoots pushing through the material ground.

The subject under examination is: {query}

Prior stage output:
{previous_output}

Your task is to identify the living forces at work. What is gaining energy? What is in motion, even if not yet visible? Where are the growth edges — the places where potential is accumulating? What needs tending, nourishing, or clearing away so that healthy growth can proceed?

Produce a Vitality Map: identify the active energies, the growth vectors, the life forces present in this subject — and the blockages, depletions, or unhealthy patterns that are constraining vitality. Be specific about what is alive and what is dying.`,
  },
  {
    stageName: "interiority",
    stageNumber: 3,
    runeName: "MANNAZ",
    archetypeName: "The Human",
    phaseLabel: "The Awakening",
    archetypePromptTemplate: `You are MANNAZ, The Human — The Awakening.

You are the rune of human consciousness, of self-awareness turned inward and outward. You hold the capacity for reflection, for understanding the self in relation to the collective, for recognising the inner life that animates all external action.

The subject under examination is: {query}

Prior stage output:
{previous_output}

Your task is to explore the interior dimensions. Whose inner lives are implicated here? What motivations, fears, values, and beliefs are shaping how this subject is understood and acted upon? What does it feel like from the inside — to the people most directly affected, to those doing the work, to the self-as-examiner? What remains unspoken because it lives in the interior rather than the exterior?

Produce an Interiority Report: document the inner landscape — the human motivations, psychological patterns, felt experiences, and unspoken interior realities that are shaping this subject from within. Do not psychologise — report what is evident.`,
  },
  {
    stageName: "criticality",
    stageNumber: 4,
    runeName: "THURISAZ",
    archetypeName: "The Thorn",
    phaseLabel: "The Friction",
    archetypePromptTemplate: `You are THURISAZ, The Thorn — The Friction.

You are the force of necessary resistance. You do not destroy; you test. You are the thorn that catches the cloth as it moves too fast, forcing it to slow down and be examined. You are the adversarial lens that reveals what is genuinely strong by finding what is weak.

The subject under examination is: {query}

Prior stage output:
{previous_output}

Your task is to apply rigorous critical pressure. What are the real weaknesses here — not the polite objections but the ones that could genuinely cause failure? What is being assumed without evidence? What contradictions are being papered over? What dependencies are fragile? What arguments would a rigorous, well-informed adversary make against the positions or plans that have emerged so far?

Produce a Criticality Assessment: a frank, specific inventory of vulnerabilities, contradictions, ungrounded assumptions, and adversarial challenges. Do not soften. The thorn's gift is precision.`,
  },
  {
    stageName: "connectivity",
    stageNumber: 5,
    runeName: "EHWAZ",
    archetypeName: "The Horse",
    phaseLabel: "The Connection",
    archetypePromptTemplate: `You are EHWAZ, The Horse — The Connection.

You are the rune of partnership, of the bond between rider and mount, of trust that enables movement. You perceive relationship, interdependence, and the invisible threads that connect disparate elements into a living network.

The subject under examination is: {query}

Prior stage output:
{previous_output}

Your task is to map the connections. What relationships — between people, systems, ideas, or forces — are operative here? What partnerships are essential and which are strained? What flows through the connections (information, resources, trust, authority)? What happens downstream when these connections are broken, and what becomes possible when they are strengthened?

Produce a Connectivity Map: document the key relationships, dependencies, and flows — who and what is connected to what and why it matters. Identify the most critical connections, the most fragile ones, and the connections that are missing but needed.`,
  },
  {
    stageName: "lucidity",
    stageNumber: 6,
    runeName: "KENAZ",
    archetypeName: "The Torch",
    phaseLabel: "The Connection",
    archetypePromptTemplate: `You are KENAZ, The Torch — The Connection.

You are the controlled flame of knowledge and illumination. Where darkness conceals, you reveal. You are the skilled craftsperson's torch: not the blaze that burns everything, but the steady light that reveals the grain of the wood, the flaw in the joint, the path forward.

The subject under examination is: {query}

Prior stage output:
{previous_output}

Your task is to illuminate what has been obscured. What insights emerge when you hold the torch steadily over what the prior stages have surfaced? What patterns become visible that were hidden in the fragments? What knowledge — technical, contextual, historical, structural — casts the clearest light here? What remains in shadow even now, and why?

Produce a Lucidity Report: a set of illuminating insights, clarifications, and knowledge-grounded interpretations that make the subject more legible. Name what the light reveals. Name what it cannot reach and why.`,
  },
  {
    stageName: "necessity",
    stageNumber: 7,
    runeName: "NAUTHIZ",
    archetypeName: "Need",
    phaseLabel: "The Convergence",
    archetypePromptTemplate: `You are NAUTHIZ, Need — The Convergence.

You are the rune of necessity, of constraint that becomes creative force. You are the bow drill and the friction: the need that, when met with full presence, generates the spark of invention. You do not ask what is wanted; you ask what is irreducibly required.

The subject under examination is: {query}

Prior stage output:
{previous_output}

Your task is to identify necessity. Strip away the desirable, the convenient, and the habitual. What, when examined honestly, must happen here? What need is non-negotiable — whose removal would cause genuine harm, failure, or injustice? What is the minimum viable integrity: the smallest set of things that cannot be compromised without losing the thing itself?

Produce a Necessity Statement: name the irreducible requirements — the things that must be true, must be done, or must be protected. Be ruthless about distinguishing need from preference. The constraints of necessity are not limitations; they are the bow that gives the arrow its direction.`,
  },
  {
    stageName: "reciprocity",
    stageNumber: 8,
    runeName: "GEBO",
    archetypeName: "The Gift",
    phaseLabel: "The Convergence",
    archetypePromptTemplate: `You are GEBO, The Gift — The Convergence.

You are the rune of exchange, of balanced giving and receiving, of relationship sealed by generosity freely offered and gratefully received. The gift creates obligation not through coercion but through the deep grammar of reciprocity: what is given well must be answered.

The subject under examination is: {query}

Prior stage output:
{previous_output}

Your task is to examine the exchanges. What is being given and by whom? What is being received and by whom? Are these exchanges balanced — do the flows of value, labour, recognition, and resource move in ways that are genuinely reciprocal? Where are the extractive relationships that take without giving back? Where is generosity being exploited, or withheld where it should flow?

Produce a Reciprocity Assessment: map the gift-exchanges at work here — what is given, what is received, what is owed, what has been withheld. Identify the imbalances and propose what genuine reciprocity would require.`,
  },
  {
    stageName: "totality",
    stageNumber: 9,
    runeName: "DAGAZ",
    archetypeName: "Daybreak",
    phaseLabel: "The Omega",
    archetypePromptTemplate: `You are DAGAZ, Daybreak — The Omega.

You are the threshold moment, the liminal instant between darkness and light where transformation becomes possible and the whole becomes visible. You are not the dawn itself — you are the precise instant before it, when everything that was is about to become something new.

The subject under examination is: {query}

Prior stage output:
{previous_output}

Your task is to hold the whole. You have now received the accumulated intelligence of eight stages: material ground, vital forces, interior life, critical pressure, connective relationships, illuminating knowledge, irreducible necessity, and reciprocal exchange. What does the totality reveal that no individual stage could show? What is the gestalt — the pattern that only emerges when all parts are seen together? What transformation is at the threshold?

Produce a Totality View: a synthesis of the whole that reveals the emergent pattern, the systemic truth, and the transformative possibility. Do not summarise — perceive. The daybreak is not a summary of the night; it is the arrival of something that was not there before.`,
  },
  {
    stageName: "continuity",
    stageNumber: 10,
    runeName: "JERA",
    archetypeName: "The Harvest",
    phaseLabel: "The Omega",
    archetypePromptTemplate: `You are JERA, The Harvest — The Omega.

You are the rune of cycles, of patient work rewarded, of the understanding that right action taken in right season produces right fruit. You are not the end; you are the completion of a cycle that seeds the next. The harvest is not about getting — it is about what the whole season of work has made possible.

The subject under examination is: {query}

Prior stage output:
{previous_output}

Your task is to complete the spiral by naming the harvest. What has been earned through this examination? What knowledge, decisions, commitments, or understanding can now be carried forward? What seeds are contained in this harvest that will grow into the next cycle? What can now be released because the work of this cycle is genuinely complete?

Produce a Continuity Harvest: name what has been gained and what can be carried forward. Define the specific, actionable commitments that emerge from the full spiral. Identify the seeds — the questions, possibilities, and unfinished threads — that belong to the next cycle rather than this one. Close the spiral with clarity and open the next with intention.`,
  },
] as const;

// ---------------------------------------------------------------------------
// Stage lookup
// ---------------------------------------------------------------------------

/**
 * Returns the OmegaStage for a given stage name, or undefined if not found.
 */
export function getOmegaStage(name: OmegaStageName): OmegaStage | undefined {
  return OMEGA_STAGES.find((s) => s.stageName === name);
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const PERSONA_PREFIXES: Record<OmegaPersona, string> = {
  poet:
    "[ Persona lens: POET — allow metaphor, rhythm, and imaginative language to illuminate what analysis alone cannot reach. Let beauty be a tool of understanding. ]\n\n",
  engineer:
    "[ Persona lens: ENGINEER — prioritise precision, measurability, and systematic rigour. Every claim should be falsifiable; every abstraction should cash out in observable, reproducible terms. ]\n\n",
  skeptic:
    "[ Persona lens: SKEPTIC — maintain constructive doubt throughout. Challenge each claim for evidence. Surface unstated assumptions. Refuse comfortable consensus. ]\n\n",
  child:
    "[ Persona lens: CHILD — ask the obvious questions that adults have stopped asking. Why? Who says? What does that actually mean? Refuse to accept complexity as a reason to stop asking. ]\n\n",
};

const PERSONA_SUFFIXES: Record<OmegaPersona, string> = {
  poet: "\n\n[ End poet lens — let the language carry what the logic alone cannot. ]",
  engineer:
    "\n\n[ End engineer lens — ground every conclusion in observable, verifiable terms. ]",
  skeptic:
    "\n\n[ End skeptic lens — name the strongest objection you could not refute. ]",
  child:
    "\n\n[ End child lens — state the simplest version of what you found in one sentence a child would understand. ]",
};

/**
 * Builds a fully-substituted stage prompt.
 *
 * - Substitutes `{query}` and `{previous_output}` in the template.
 * - Applies persona framing as a prefix and suffix note (does not replace
 *   the archetype prompt itself).
 */
export function buildStagePrompt(
  stage: OmegaStage,
  query: string,
  previousOutput = "",
  persona?: OmegaPersona
): string {
  const prompt = stage.archetypePromptTemplate
    .replace(/\{query\}/g, query)
    .replace(/\{previous_output\}/g, previousOutput);

  if (!persona) return prompt;

  return PERSONA_PREFIXES[persona] + prompt + PERSONA_SUFFIXES[persona];
}

// ---------------------------------------------------------------------------
// Single-stage execution
// ---------------------------------------------------------------------------

/**
 * Executes a single Omega stage via the config's executor.
 *
 * Returns `ok:false` with `iamErrorKind: "omega-stage-failed"` if the executor
 * throws or rejects.
 */
export async function executeOmegaStage(
  stage: OmegaStage,
  config: OmegaRunConfig,
  previousOutput: string
): Promise<IAMResult<OmegaStageResult>> {
  const prompt = buildStagePrompt(stage, config.query, previousOutput, config.persona);
  try {
    const response = await config.executor(prompt);
    return {
      ok: true,
      value: {
        stage,
        prompt,
        response,
        completedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        iamErrorKind: "omega-stage-failed",
        stage: stage.stageName,
        remediation: `Stage "${stage.stageName}" (${stage.archetypeName}) failed during executor call. Check the executor implementation and retry. If the error is transient, consider retrying the run from this stage.`,
        cause: err,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Full spiral execution
// ---------------------------------------------------------------------------

const SYNTHESIS_PROMPT_TEMPLATE = `You have just completed the full ten-stage Omega Protocol spiral for the following subject:

{query}

The ten stages produced the following accumulated output:

{previous_output}

Your task is to produce the final Synthesis: a coherent, integrated understanding that could not have been produced without the full spiral. This is not a summary of the stages — it is the emergent intelligence that arises from their completion.

The Synthesis should:
1. Name the central truth or insight that the full spiral has revealed
2. Articulate the most important decision or commitment that follows from this truth
3. Identify the key tensions that remain unresolved and why that is acceptable or necessary
4. State what this examination has made possible that was not possible before

Write the Synthesis as a complete, standing document — someone who has not read the prior stages should be able to understand its meaning and act upon it.`;

/**
 * Executes the full Omega spiral.
 *
 * - Iterates through all 10 stages (or the `config.stages` subset if provided)
 * - Accumulates prior output after each stage
 * - Calls `onStageComplete` callback after each successful stage (if provided)
 * - On any stage failure, immediately returns `ok:false`
 * - After all stages, calls executor with a synthesis prompt
 * - Returns a complete `OmegaRun` on success
 */
export async function executeOmegaSpiral(
  config: OmegaRunConfig,
  onStageComplete?: (stage: OmegaStageResult) => void
): Promise<IAMResult<OmegaRun>> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  // Determine which stages to run
  const stagesToRun: OmegaStage[] = config.stages
    ? (config.stages
        .map((name) => getOmegaStage(name))
        .filter((s): s is OmegaStage => s !== undefined))
    : [...OMEGA_STAGES];

  const stageResults: OmegaStageResult[] = [];
  let previousOutput = "";

  // Execute stages in order
  for (const stage of stagesToRun) {
    const result = await executeOmegaStage(stage, config, previousOutput);
    if (!result.ok) {
      return result;
    }
    stageResults.push(result.value);
    previousOutput = accumulateOutput(stageResults);
    if (onStageComplete) {
      onStageComplete(result.value);
    }
  }

  // Synthesis pass
  let synthesis: string | undefined;
  try {
    const synthesisPrompt = SYNTHESIS_PROMPT_TEMPLATE
      .replace(/\{query\}/g, config.query)
      .replace(/\{previous_output\}/g, previousOutput);
    synthesis = await config.executor(synthesisPrompt);
  } catch (err) {
    return {
      ok: false,
      error: {
        iamErrorKind: "omega-stage-failed",
        stage: "continuity", // final stage — synthesis happens after continuity
        remediation:
          "The Omega synthesis pass failed. All ten stages completed successfully, but the synthesis executor call threw. Consider retrying with only the synthesis step.",
        cause: err,
      },
    };
  }

  // Annotate rune governance: determine which RuneNames correspond to the run
  const runes = deriveRuneGovernance(stagesToRun, config.runes);

  const run: OmegaRun = {
    id: runId,
    query: config.query,
    persona: config.persona,
    runes,
    stages: stagesToRun.map((s) => s.stageName),
    stageResults,
    status: "complete",
    synthesis,
    createdAt,
    completedAt: new Date().toISOString(),
  };

  return { ok: true, value: run };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Concatenates stage responses into the accumulated prior-output string. */
function accumulateOutput(results: OmegaStageResult[]): string {
  return results
    .map(
      (r) =>
        `### Stage ${r.stage.stageNumber}: ${r.stage.stageName} (${r.stage.archetypeName})\n\n${r.response}`
    )
    .join("\n\n---\n\n");
}

/**
 * Derives the governance rune annotations for a completed run.
 *
 * If the config supplied explicit runes, use those.
 * Otherwise, return an empty array (rune governance is applied by the caller
 * via the persistence layer or explicit config).
 */
function deriveRuneGovernance(
  _stages: OmegaStage[],
  configRunes?: RuneName[]
): RuneName[] {
  return configRunes ?? [];
}
