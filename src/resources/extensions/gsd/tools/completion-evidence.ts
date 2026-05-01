/**
 * tools/completion-evidence.ts — IAM completion-evidence assertion (T03,
 * surface 3b of T01-AUDIT).
 *
 * Per M002/S02 R033 fail-closed hardening, every closing tool surface
 * (`complete-task`, `complete-slice`, `complete-milestone`) must verify
 * that the artifact provenance required to mark a unit complete is on
 * disk + in the database BEFORE any `transaction(...)` runs. This module
 * is the single, pure entry point invoked as the first guard inside each
 * handler.
 *
 * The fail-closed shape is shape-isomorphic to the auto/phase-spiral
 * (`run-phase-spiral.ts:157-167`) and auto/phase-envelope
 * (`auto/phase-envelope.ts`) surfaces modulo a per-surface `failingStage`
 * union — `envelope-missing | evidence-missing | ownership-mismatch |
 * summary-missing | gate-pending` — so S03's recovery agent can grep one
 * predicate across all three surfaces (T01-AUDIT §6).
 *
 * Pure, side-effect-free except for read-only filesystem and DB lookups.
 * Never mutates state, never throws. Callers are responsible for
 * pattern-matching `{ok: false}` and short-circuiting BEFORE invoking
 * `transaction(...)`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  assertPhaseEnvelopePresent,
  type PhaseEnvelopeAssertionInput,
} from "../auto/phase-envelope.js";
import {
  getOmegaPhaseArtifact,
  getPendingGatesForTurn,
  getSliceTasks,
  getMilestoneSlices,
} from "../gsd-db.js";
import { resolveSlicePath, resolveMilestonePath } from "../paths.js";
import type { CompleteTaskParams, CompleteSliceParams } from "../types.js";

/**
 * Per-surface failing-stage union (T01-AUDIT §3b.2).
 *
 * - `envelope-missing`: caller passed an explicit envelope, but it failed
 *   `assertPhaseEnvelopePresent` (collapses both envelope-missing and
 *   awareness-missing from the phase-envelope helper into one stage tag
 *   for this surface).
 * - `evidence-missing`: required input evidence (verification text,
 *   verificationEvidence array, uatContent, omega artifact, …) is absent
 *   or empty.
 * - `ownership-mismatch`: caller-claimed actor cannot be reconciled with
 *   the unit's ownership claim (currently delegated to `checkOwnership`
 *   upstream; reserved here for forthcoming subagent-claim plumbing).
 * - `summary-missing`: required narrative / oneLiner / verificationPassed
 *   field is absent or empty.
 * - `gate-pending`: at least one gate-registry row owned by the closing
 *   turn is still in a non-terminal state.
 */
export type CompletionEvidenceFailingStage =
  | "envelope-missing"
  | "evidence-missing"
  | "ownership-mismatch"
  | "summary-missing"
  | "gate-pending";

export type CompletionEvidenceUnitType = "task" | "slice" | "milestone";

export interface CompletionEvidenceFailure {
  ok: false;
  failingStage: CompletionEvidenceFailingStage;
  missingArtifacts: string[];
  remediation: string;
}

export interface CompletionEvidenceOk {
  ok: true;
}

export type CompletionEvidenceResult =
  | CompletionEvidenceOk
  | CompletionEvidenceFailure;

/**
 * Subset of completion-tool params this assertion inspects. Captures
 * just the fields shared between `CompleteTaskParams`,
 * `CompleteSliceParams`, and the in-tree milestone-completion params,
 * plus an optional caller-provided IAM envelope for subagent-grade
 * provenance.
 */
export interface CompletionEvidenceParams {
  milestoneId: string;
  sliceId?: string;
  taskId?: string;
  oneLiner?: string;
  narrative?: string;
  verification?: string;
  uatContent?: string;
  verificationPassed?: boolean;
  verificationEvidence?: ReadonlyArray<unknown>;
  iamEnvelope?: PhaseEnvelopeAssertionInput;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Translate a phase-envelope failure into the surface-3b taxonomy.
 *
 * Both `envelope-missing` and `awareness-missing` from
 * `assertPhaseEnvelopePresent` collapse to `envelope-missing` here so
 * grep-by-predicate (`failingStage === "envelope-missing"`) covers any
 * envelope shortcoming that lands on this surface.
 */
function toEnvelopeFailure(
  unitType: CompletionEvidenceUnitType,
  unitLabel: string,
  envelope: PhaseEnvelopeAssertionInput,
): CompletionEvidenceFailure | null {
  const result = assertPhaseEnvelopePresent(unitType, envelope);
  if (result.ok) return null;
  return {
    ok: false,
    failingStage: "envelope-missing",
    missingArtifacts: result.missingArtifacts,
    remediation:
      `Completion of ${unitType} "${unitLabel}" requires an IAM_SUBAGENT_CONTRACT envelope ` +
      `(envelopeId, parentUnit, mutationBoundary). ${result.remediation}`,
  };
}

/**
 * Task-surface evidence checks. The conservative envelope here is:
 * verification + summary text on the params; pending execute-task gates
 * empty; slice plan file exists on disk so plan-checkbox rendering can
 * succeed downstream.
 */
function assertTaskEvidence(
  params: CompletionEvidenceParams,
  basePath: string,
): CompletionEvidenceResult {
  const milestoneId = params.milestoneId;
  const sliceId = params.sliceId ?? "";
  const taskId = params.taskId ?? "";
  const unitLabel = `${milestoneId}/${sliceId}/${taskId}`;

  if (params.iamEnvelope !== undefined) {
    const envFail = toEnvelopeFailure("task", unitLabel, params.iamEnvelope);
    if (envFail) return envFail;
  }

  if (!isNonEmptyString(params.verification)) {
    return {
      ok: false,
      failingStage: "evidence-missing",
      missingArtifacts: ["verification"],
      remediation:
        `Task ${unitLabel} cannot be completed without a non-empty verification ` +
        `narrative. Provide the proof-of-work command output / verdict in the ` +
        `verification field before calling complete-task.`,
    };
  }

  if (!isNonEmptyString(params.oneLiner) || !isNonEmptyString(params.narrative)) {
    return {
      ok: false,
      failingStage: "summary-missing",
      missingArtifacts: [
        ...(isNonEmptyString(params.oneLiner) ? [] : ["oneLiner"]),
        ...(isNonEmptyString(params.narrative) ? [] : ["narrative"]),
      ],
      remediation:
        `Task ${unitLabel} cannot be completed without both a non-empty oneLiner ` +
        `and a non-empty narrative — these populate the SUMMARY.md handoff record.`,
    };
  }

  // NOTE: the slice-plan anchor is intentionally not gated here. It is a
  // slice-level artifact whose absence is correctly surfaced by the
  // downstream `renderPlanCheckboxes` rollback path (see #2724). Gating
  // it at the task surface would over-strict the closing tool and hide
  // the rollback semantics that test asserts.

  // Pending execute-task gates must all have been resolved (pass / fail /
  // override). An empty result is fine — it means no gates are wired up
  // for this task / turn yet.
  const pendingGates = safePendingGates(milestoneId, sliceId, "execute-task", taskId);
  if (pendingGates.length > 0) {
    return {
      ok: false,
      failingStage: "gate-pending",
      missingArtifacts: pendingGates.map(g => `gate:${g}`),
      remediation:
        `Task ${unitLabel} has ${pendingGates.length} unresolved execute-task gate(s) ` +
        `(${pendingGates.join(", ")}). Resolve each gate (pass / fail / override) before ` +
        `calling complete-task.`,
    };
  }

  return { ok: true };
}

/**
 * Slice-surface evidence checks. Requires verification + uatContent
 * narrative, an Omega plan-slice artifact for the slice, and zero
 * pending complete-slice gates.
 */
function assertSliceEvidence(
  params: CompletionEvidenceParams,
  basePath: string,
): CompletionEvidenceResult {
  const milestoneId = params.milestoneId;
  const sliceId = params.sliceId ?? "";
  const unitLabel = `${milestoneId}/${sliceId}`;

  if (params.iamEnvelope !== undefined) {
    const envFail = toEnvelopeFailure("slice", unitLabel, params.iamEnvelope);
    if (envFail) return envFail;
  }

  const missingEvidence: string[] = [];
  if (!isNonEmptyString(params.verification)) missingEvidence.push("verification");
  if (!isNonEmptyString(params.uatContent)) missingEvidence.push("uatContent");
  if (missingEvidence.length > 0) {
    return {
      ok: false,
      failingStage: "evidence-missing",
      missingArtifacts: missingEvidence,
      remediation:
        `Slice ${unitLabel} cannot be completed without non-empty verification ` +
        `and uatContent narratives — both populate the SUMMARY.md and UAT.md ` +
        `handoff records.`,
    };
  }

  if (!isNonEmptyString(params.narrative) || !isNonEmptyString(params.oneLiner)) {
    return {
      ok: false,
      failingStage: "summary-missing",
      missingArtifacts: [
        ...(isNonEmptyString(params.oneLiner) ? [] : ["oneLiner"]),
        ...(isNonEmptyString(params.narrative) ? [] : ["narrative"]),
      ],
      remediation:
        `Slice ${unitLabel} cannot be completed without both a non-empty oneLiner ` +
        `and a non-empty narrative.`,
    };
  }

  // Slice plan anchor must exist on disk so roadmap-checkbox rendering
  // can find the slice entry.
  const sliceDir = resolveSlicePath(basePath, milestoneId, sliceId);
  const slicePlanPath = sliceDir ? join(sliceDir, `${sliceId}-PLAN.md`) : null;
  if (!slicePlanPath || !existsSync(slicePlanPath)) {
    return {
      ok: false,
      failingStage: "evidence-missing",
      missingArtifacts: [`${sliceId}-PLAN.md`],
      remediation:
        `Slice ${unitLabel} cannot be completed without a slice plan anchor at ` +
        `${slicePlanPath ?? `${milestoneId}/${sliceId}/${sliceId}-PLAN.md`}. ` +
        `Run gsd_plan_slice first.`,
    };
  }

  // All child tasks must already be in a closed status — duplicates the
  // in-transaction check but surfaces it before the transaction so the
  // failure stage is named.
  const incompleteTasks = safeIncompleteTasks(milestoneId, sliceId);
  if (incompleteTasks.length > 0) {
    return {
      ok: false,
      failingStage: "evidence-missing",
      missingArtifacts: incompleteTasks.map(t => `task:${t}`),
      remediation:
        `Slice ${unitLabel} has ${incompleteTasks.length} task(s) not yet complete ` +
        `(${incompleteTasks.join(", ")}). Complete every child task before calling complete-slice.`,
    };
  }

  // Pending complete-slice gates must all be resolved.
  const pendingGates = safePendingGates(milestoneId, sliceId, "complete-slice");
  if (pendingGates.length > 0) {
    return {
      ok: false,
      failingStage: "gate-pending",
      missingArtifacts: pendingGates.map(g => `gate:${g}`),
      remediation:
        `Slice ${unitLabel} has ${pendingGates.length} unresolved complete-slice gate(s) ` +
        `(${pendingGates.join(", ")}). Resolve each gate before calling complete-slice.`,
    };
  }

  return { ok: true };
}

/**
 * Milestone-surface evidence checks. Requires `verificationPassed === true`
 * (already enforced upstream but re-asserted under the unified surface
 * taxonomy), narrative, a roadmap anchor on disk, and that every child
 * slice be in a closed status.
 */
function assertMilestoneEvidence(
  params: CompletionEvidenceParams,
  basePath: string,
): CompletionEvidenceResult {
  const milestoneId = params.milestoneId;
  const unitLabel = milestoneId;

  if (params.iamEnvelope !== undefined) {
    const envFail = toEnvelopeFailure("milestone", unitLabel, params.iamEnvelope);
    if (envFail) return envFail;
  }

  if (params.verificationPassed !== true) {
    return {
      ok: false,
      failingStage: "evidence-missing",
      missingArtifacts: ["verificationPassed"],
      remediation:
        `Milestone ${unitLabel} cannot be completed unless verificationPassed === true. ` +
        `Run all milestone-level verification steps and explicitly set verificationPassed.`,
    };
  }

  if (!isNonEmptyString(params.narrative) || !isNonEmptyString(params.oneLiner)) {
    return {
      ok: false,
      failingStage: "summary-missing",
      missingArtifacts: [
        ...(isNonEmptyString(params.oneLiner) ? [] : ["oneLiner"]),
        ...(isNonEmptyString(params.narrative) ? [] : ["narrative"]),
      ],
      remediation:
        `Milestone ${unitLabel} cannot be completed without both a non-empty oneLiner ` +
        `and a non-empty narrative.`,
    };
  }

  // Roadmap anchor must exist on disk.
  const milestoneDir = resolveMilestonePath(basePath, milestoneId);
  const roadmapPath = milestoneDir ? join(milestoneDir, `${milestoneId}-ROADMAP.md`) : null;
  if (!roadmapPath || !existsSync(roadmapPath)) {
    return {
      ok: false,
      failingStage: "evidence-missing",
      missingArtifacts: [`${milestoneId}-ROADMAP.md`],
      remediation:
        `Milestone ${unitLabel} cannot be completed without a roadmap anchor at ` +
        `${roadmapPath ?? `${milestoneId}/${milestoneId}-ROADMAP.md`}.`,
    };
  }

  // Every child slice must be closed.
  const incompleteSlices = safeIncompleteSlices(milestoneId);
  if (incompleteSlices.length > 0) {
    return {
      ok: false,
      failingStage: "evidence-missing",
      missingArtifacts: incompleteSlices.map(s => `slice:${s}`),
      remediation:
        `Milestone ${unitLabel} has ${incompleteSlices.length} slice(s) not yet complete ` +
        `(${incompleteSlices.join(", ")}). Complete every child slice before calling complete-milestone.`,
    };
  }

  // The validate-milestone Omega artifact is the canonical provenance
  // record that this milestone's verification was generated under
  // governed orchestration. Fail closed when it's missing.
  const omegaArtifact = safeOmegaArtifact("validate-milestone", milestoneId);
  if (!omegaArtifact) {
    return {
      ok: false,
      failingStage: "evidence-missing",
      missingArtifacts: ["omega:validate-milestone"],
      remediation:
        `Milestone ${unitLabel} cannot be completed without a validate-milestone ` +
        `Omega phase artifact. Run the validate-milestone governed phase first.`,
    };
  }

  return { ok: true };
}

/**
 * Wrapper around `getPendingGatesForTurn` that returns gate ids and
 * never throws. Returns `[]` when the database is closed or the call
 * fails for any reason — the upstream transaction will re-check on its
 * own, so a transient DB failure here just falls through.
 */
function safePendingGates(
  milestoneId: string,
  sliceId: string,
  turn: "gate-evaluate" | "execute-task" | "complete-slice" | "validate-milestone",
  taskId?: string,
): string[] {
  try {
    const rows = getPendingGatesForTurn(milestoneId, sliceId, turn, taskId);
    return Array.isArray(rows)
      ? rows.map(r => (r as { id?: string }).id ?? "").filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function safeIncompleteTasks(milestoneId: string, sliceId: string): string[] {
  try {
    const tasks = getSliceTasks(milestoneId, sliceId);
    if (!Array.isArray(tasks)) return [];
    return tasks
      .filter(t => {
        const status = (t as { status?: string }).status ?? "";
        return status !== "complete" && status !== "completed" && status !== "skipped";
      })
      .map(t => (t as { id?: string }).id ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeIncompleteSlices(milestoneId: string): string[] {
  try {
    const slices = getMilestoneSlices(milestoneId);
    if (!Array.isArray(slices)) return [];
    return slices
      .filter(s => {
        const status = (s as { status?: string }).status ?? "";
        return status !== "complete" && status !== "completed" && status !== "skipped";
      })
      .map(s => (s as { id?: string }).id ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeOmegaArtifact(unitType: string, unitId: string): unknown {
  try {
    return getOmegaPhaseArtifact(unitType, unitId);
  } catch {
    return null;
  }
}

/**
 * Assert that completion evidence is present and minimally well-formed
 * before any DB transaction in `complete-task`, `complete-slice`, or
 * `complete-milestone`.
 *
 * Pure return — never throws, never mutates state. Read-only filesystem
 * and DB lookups only. Callers MUST pattern-match `{ok: false}` and
 * short-circuit before invoking `transaction(...)`.
 */
export function assertCompletionEvidence(
  params:
    | CompleteTaskParams
    | CompleteSliceParams
    | CompletionEvidenceParams,
  basePath: string,
  unitType: CompletionEvidenceUnitType,
): CompletionEvidenceResult {
  const normalized: CompletionEvidenceParams = {
    milestoneId: (params as { milestoneId?: string }).milestoneId ?? "",
    sliceId: (params as { sliceId?: string }).sliceId,
    taskId: (params as { taskId?: string }).taskId,
    oneLiner: (params as { oneLiner?: string }).oneLiner,
    narrative: (params as { narrative?: string }).narrative,
    verification: (params as { verification?: string }).verification,
    uatContent: (params as { uatContent?: string }).uatContent,
    verificationPassed: (params as { verificationPassed?: boolean }).verificationPassed,
    verificationEvidence: (params as { verificationEvidence?: ReadonlyArray<unknown> }).verificationEvidence,
    iamEnvelope: (params as { iamEnvelope?: PhaseEnvelopeAssertionInput }).iamEnvelope,
  };

  switch (unitType) {
    case "task":
      return assertTaskEvidence(normalized, basePath);
    case "slice":
      return assertSliceEvidence(normalized, basePath);
    case "milestone":
      return assertMilestoneEvidence(normalized, basePath);
  }
}
