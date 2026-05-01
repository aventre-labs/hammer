/**
 * Hammer extension tool — `gsd_question_round_spiral`.
 *
 * Exposes `runQuestionRoundSpiral` (per-question-round Omega spiral helper) to
 * the LLM so a discuss-* prompt can govern the next question round through the
 * canonical 10-stage Omega Protocol before requesting `ask_user_questions`.
 *
 * The tool is registered under both the canonical name `gsd_question_round_spiral`
 * (which the discuss prompts and the T03 fail-closed gate look for) and the
 * forward-looking `hammer_question_round_spiral` alias, mirroring the alias
 * pattern used in `bootstrap/iam-tools.ts`.
 *
 * On success the tool returns `{runId, manifestPath, synthesisPath, stageCount,
 * unitId, artifactDir}`. On failure it returns the structured remediation shape
 * matching `runIAMTool`'s response convention at `bootstrap/iam-tools.ts`
 * (`{ ok: false, failingStage, missingArtifacts, remediation, iamError? }`).
 *
 * Wiring: the bootstrap layer (T03) calls `registerQuestionRoundSpiralTool(api)`
 * after `registerIAMTools(api)` and supplies the runtime executor via the same
 * ctx-bound pattern (`ctx.omegaExecutor` injection or `buildOmegaExecutor(ctx)`
 * fallback). This module owns the tool schema and result shaping; helper
 * composition stays in `auto/run-question-round-spiral.ts`.
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";

import { buildOmegaExecutor } from "./bootstrap/iam-tools.js";
import {
  runQuestionRoundSpiral,
  type RunQuestionRoundSpiralFailure,
  type RunQuestionRoundSpiralResult,
  type RunQuestionRoundSpiralSuccess,
} from "./auto/run-question-round-spiral.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const questionRoundSpiralParameters = Type.Object({
  milestoneId: Type.String({
    pattern: "^M\\d{3}(?:-[A-Za-z0-9]+)?$",
    description: "Milestone identifier (e.g. M001 or M001-r5jzab).",
  }),
  sliceId: Type.Optional(
    Type.String({
      pattern: "^S\\d{2}(?:-[A-Za-z0-9]+)?$",
      description: "Slice identifier when invoking from slice-discuss; omit for milestone-discuss.",
    }),
  ),
  roundIndex: Type.Integer({
    minimum: 1,
    description: "1-based per-(milestone, slice?) question round counter.",
  }),
  conversationStateMarkdown: Type.String({
    minLength: 1,
    description:
      "Concise markdown summary of conversation state the spiral will govern: what the user has said, what is still unknown, what the next round targets.",
  }),
});

// ─── Result shaping ──────────────────────────────────────────────────────────

function successResponse(value: RunQuestionRoundSpiralSuccess) {
  const payload = {
    ok: true as const,
    runId: value.runId,
    manifestPath: value.manifestPath,
    synthesisPath: value.synthesisPath,
    stageCount: value.stageCount,
    unitId: value.unitId,
    artifactDir: value.artifactDir,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: { status: "ok", kind: "question-round-spiral", ...payload },
  };
}

function failureResponse(value: RunQuestionRoundSpiralFailure) {
  const payload = {
    ok: false as const,
    failingStage: value.failingStage,
    missingArtifacts: value.missingArtifacts,
    remediation: value.remediation,
    unitId: value.unitId,
    ...(value.iamError ? { iamError: { iamErrorKind: value.iamError.iamErrorKind, ...(value.iamError.stage ? { stage: value.iamError.stage } : {}) } } : {}),
  };
  return {
    content: [
      {
        type: "text" as const,
        text: `gsd_question_round_spiral failed at ${value.failingStage}: ${value.remediation}`,
      },
    ],
    isError: true,
    details: payload,
  };
}

function toolResponse(result: RunQuestionRoundSpiralResult) {
  return result.ok ? successResponse(result) : failureResponse(result);
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register the `gsd_question_round_spiral` tool (canonical name) and the
 * `hammer_question_round_spiral` alias on the supplied extension API.
 */
export function registerQuestionRoundSpiralTool(pi: ExtensionAPI): void {
  const ctx = pi as unknown as ExtensionContext;

  const toolDef = {
    name: "gsd_question_round_spiral",
    label: "Discuss Question-Round Omega Spiral",
    description:
      "Run the canonical 10-stage Omega spiral over the current discuss-flow conversation state for one question round. Persists per-stage + manifest + synthesis artifacts under .gsd/milestones/<MID>/(slices/<SID>/)?discuss/round-<N>/omega/<runId>/ and returns {runId, manifestPath, synthesisPath, stageCount, unitId, artifactDir}. Required by the discuss-flow fail-closed gate before ask_user_questions can advance.",
    promptSnippet: "Govern this discuss question round through a per-round Omega spiral",
    promptGuidelines: [
      "Call gsd_question_round_spiral once per question round when in a guided-discuss-* flow.",
      "Pass the current conversation state markdown — what the user has said, what is unknown, what this round targets.",
      "Round index is 1-based and must monotonically increase for each (milestoneId, sliceId?) pair.",
      "On failure inspect failingStage and missingArtifacts; the discuss flow remains blocked until a fresh successful run exists.",
    ],
    parameters: questionRoundSpiralParameters,
    async execute(
      _id: string,
      params: {
        milestoneId: string;
        sliceId?: string;
        roundIndex: number;
        conversationStateMarkdown: string;
      },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      runtimeCtx: unknown,
    ) {
      const basePath =
        (runtimeCtx as { cwd?: string } | undefined)?.cwd ??
        (ctx as { cwd?: string }).cwd ??
        process.cwd();

      const executor = await buildOmegaExecutor(ctx);
      if (!executor.ok) {
        return failureResponse({
          ok: false,
          unitType: "discuss-question-round",
          unitId: params.sliceId
            ? `${params.milestoneId}/${params.sliceId}/round-${params.roundIndex}`
            : `${params.milestoneId}/round-${params.roundIndex}`,
          failingStage: "executor",
          missingArtifacts: [],
          remediation: executor.error.remediation,
          iamError: executor.error,
          durationMs: 0,
        });
      }

      const result = await runQuestionRoundSpiral({
        milestoneId: params.milestoneId,
        ...(params.sliceId ? { sliceId: params.sliceId } : {}),
        roundIndex: params.roundIndex,
        conversationState: params.conversationStateMarkdown,
        executor: executor.executor,
        basePath,
      });

      return toolResponse(result);
    },
  };

  pi.registerTool(toolDef);

  // Forward-looking canonical alias under the hammer_* prefix; the discuss
  // prompts and the T03 fail-closed gate look up the tool by its primary
  // gsd_question_round_spiral name.
  pi.registerTool({
    ...toolDef,
    name: "hammer_question_round_spiral",
    description:
      toolDef.description + " (hammer_* alias of gsd_question_round_spiral — both names invoke the same execute path).",
    promptGuidelines: ["Alias for gsd_question_round_spiral — both names invoke the same per-round Omega spiral path."],
  });
}
