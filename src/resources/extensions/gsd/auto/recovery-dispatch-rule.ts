/**
 * recovery-dispatch-rule.ts — M002/S03/T04
 *
 * Pure leaf module exposing the *decision* helpers used to wire recovery
 * dispatch into auto-mode without dragging the heavy dispatcher imports
 * (which transitively load run-unit.ts) into test files. Two responsibilities:
 *
 *   (1) `evaluateRecoveryTrigger` — given a snapshot of the session lock,
 *       the parent unit type/id, whether the parent unit completed, and the
 *       failure surfaced by that unit, decide whether to dispatch a recovery
 *       subagent or skip. Mirrors the bullet checklist in T04's plan: missing
 *       lock, cap reached, parent completed, anti-recursion, and terminal
 *       failure classification all skip.
 *
 *   (2) `shouldResetRecoveryCounter` — given the just-completed unit's type
 *       and status, return true when the loop should zero the persistent
 *       `consecutiveRecoveryFailures` counter. Only a non-recovery completed
 *       unit resets per R030.
 *
 * No runtime imports — only `import type` references — so the test file can
 * execute under bare `node --test` without the resolve-ts hook.
 *
 * NOTE: `RECOVERY_FAILURE_CAP`, `classifyRecoverability`, and
 * `isAlreadyRecoveryUnit` are intentionally duplicated from `recovery.ts`
 * (rather than imported) to keep this file leaf. The `recovery-dispatch-rule`
 * test asserts the values stay numerically and behaviorally aligned with the
 * recovery dispatcher so drift is impossible without breaking a test.
 */

import type { IAMError } from "../../../../iam/types.js";
import type { ErrorContext } from "./types.js";

// ─── Duplicated leaf-friendly helpers ────────────────────────────────────────

/**
 * Hard cap on consecutive recovery failures. When the counter reaches this
 * value the dispatch rule stops dispatching new recovery units and lets the
 * caller (phase-spiral-blocked branch in phases.ts) fall through to
 * `pauseAuto`. MUST stay in sync with `recovery.ts:RECOVERY_FAILURE_CAP`.
 */
export const RECOVERY_FAILURE_CAP = 3;

/**
 * Subset of IAMError used by the recovery trigger. Mirrors `IAMErrorShape`
 * in `recovery.ts` — kept identical here so the leaf import boundary holds.
 */
export interface IAMErrorShape {
  iamErrorKind: IAMError["iamErrorKind"];
  remediation: string;
}

export interface RecoveryDispatchTrigger {
  parentUnitType: string;
  parentUnitId: string;
  failure: ErrorContext | IAMErrorShape;
  attemptNumber: number;
}

/**
 * Returns true if the given unitType is itself a recovery unit. Mirrors
 * `recovery.ts:isAlreadyRecoveryUnit`. The dispatch rule consults this to
 * refuse to recurse into recovery for a recovery failure.
 */
export function isAlreadyRecoveryUnit(unitType: string): boolean {
  return unitType === "recovery";
}

/**
 * Partition failures into "recoverable" / "terminal" / "unknown" per
 * research §2.6. Mirrors `recovery.ts:classifyRecoverability` — see that
 * function for the canonical kind→category mapping.
 */
export function classifyRecoverability(
  failure: ErrorContext | IAMErrorShape,
): "recoverable" | "terminal" | "unknown" {
  if ("iamErrorKind" in failure) {
    switch (failure.iamErrorKind) {
      case "omega-stage-failed":
      case "executor-not-wired":
      case "persistence-failed":
      case "completion-evidence-missing":
      case "audit-fail-closed":
      case "gate-policy-missing":
        return "recoverable";
      case "rune-validation-failed":
      case "savesuccess-blind-spot":
      case "invalid-stage-sequence":
      case "unknown-rune":
      case "context-envelope-invalid":
        return "terminal";
    }
  }
  if (failure.isTransient === true) return "recoverable";
  if (failure.isTransient === false) return "terminal";
  return "unknown";
}

// ─── Decision helpers ────────────────────────────────────────────────────────

/** Subset of SessionLockData this module reads — kept small to avoid coupling. */
export interface RecoveryLockSnapshot {
  consecutiveRecoveryFailures?: number;
}

export interface EvaluateRecoveryTriggerInput {
  /** Lock contents (null if no lock file exists). */
  lock: RecoveryLockSnapshot | null;
  /** The unitType of the unit whose failure is being considered for recovery. */
  parentUnitType: string;
  /** The unitId of that same unit. */
  parentUnitId: string;
  /** True when that unit *completed* successfully — recovery never fires. */
  parentCompleted: boolean;
  /** The failure surfaced by the parent unit (null when no failure). */
  failure: ErrorContext | IAMErrorShape | null;
}

export type EvaluateRecoveryTriggerSkipReason =
  | "no-lock"
  | "cap-reached"
  | "parent-completed"
  | "anti-recursion"
  | "terminal-failure"
  | "no-failure";

export type EvaluateRecoveryTriggerResult =
  | { skip: true; reason: EvaluateRecoveryTriggerSkipReason }
  | { skip: false; trigger: RecoveryDispatchTrigger };

/**
 * Pure decision helper. The dispatch rule (auto-dispatch.ts) and the
 * phase-spiral-blocked branch (phases.ts) both consume this so the
 * "should we recover?" checklist lives in exactly one place.
 *
 * Skip reasons map 1:1 to the bullet checklist in T04's plan so test
 * failures are diagnosable from the reason string alone.
 */
export function evaluateRecoveryTrigger(
  input: EvaluateRecoveryTriggerInput,
): EvaluateRecoveryTriggerResult {
  const { lock, parentUnitType, parentUnitId, parentCompleted, failure } = input;

  if (!lock) return { skip: true, reason: "no-lock" };

  const counter = lock.consecutiveRecoveryFailures ?? 0;
  if (counter >= RECOVERY_FAILURE_CAP) {
    return { skip: true, reason: "cap-reached" };
  }
  if (parentCompleted) {
    return { skip: true, reason: "parent-completed" };
  }
  if (isAlreadyRecoveryUnit(parentUnitType)) {
    return { skip: true, reason: "anti-recursion" };
  }
  if (failure === null || failure === undefined) {
    return { skip: true, reason: "no-failure" };
  }
  if (classifyRecoverability(failure) === "terminal") {
    return { skip: true, reason: "terminal-failure" };
  }

  return {
    skip: false,
    trigger: {
      parentUnitType,
      parentUnitId,
      failure,
      attemptNumber: counter + 1,
    },
  };
}

/**
 * Returns true when the loop should zero the persistent recovery counter for
 * a just-completed unit. R030 semantics: only a non-recovery successful unit
 * resets the counter — recovery's own success keeps the counter intact so
 * cap behavior is governed by parent-unit progress, not recovery progress.
 *
 * @param justCompletedUnitType - unit type that just finished (e.g. "execute-task")
 * @param justCompletedStatus   - "completed" when the unit succeeded
 */
export function shouldResetRecoveryCounter(
  justCompletedUnitType: string,
  justCompletedStatus: "completed" | "failed" | string,
): boolean {
  if (justCompletedStatus !== "completed") return false;
  if (isAlreadyRecoveryUnit(justCompletedUnitType)) return false;
  return true;
}
