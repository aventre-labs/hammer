/**
 * auto/recovery.ts — M002/S03/T03
 *
 * Recovery dispatcher orchestration. Mints a deterministic envelopeId, loads
 * the bounded recovery prompt template, substitutes context placeholders,
 * runs a single recovery subagent unit via runUnit(), parses the wire-format
 * RECOVERY_VERDICT trailer, and updates the persistent recovery counter on
 * the session lock per the research §4.2 delta rules:
 *
 *     fix-applied   → counter unchanged
 *     blocker-filed → counter unchanged
 *     give-up       → counter +1
 *     malformed     → counter +1
 *
 * Test seams: `_setRunUnitForTest` and `_setRecoveryTemplateForTest` allow the
 * dispatcher tests to inject stubs without touching the production runUnit
 * resolution path or the prompt-loader. Production callers go through the
 * default module-level bindings.
 */

import { readFileSync } from "node:fs";

import type { ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";

import type { AutoSession } from "./session.js";
import type { ErrorContext, UnitResult } from "./types.js";
import { runUnit as defaultRunUnit } from "./run-unit.js";
import { parseRecoveryVerdict, type RecoveryVerdict } from "./recovery-verdict.js";
import {
  readSessionLockData,
  updateSessionLockFields,
} from "../session-lock.js";
import { appendEvent } from "../workflow-events.js";
import type { IAMError } from "../../../../iam/types.js";

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Hard cap on consecutive recovery failures. When the counter reaches this
 * value the recovery dispatcher's caller (T04 dispatch rule) pauses auto-mode.
 * Mirrors the `<<CAP>>` placeholder in prompts/recovery.md.
 */
export const RECOVERY_FAILURE_CAP = 3;

/**
 * Subset of IAMError used by the recovery trigger. We only need the kind and
 * the remediation string to build the prompt — no other fields.
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

export interface RecoveryDispatchResult {
  verdict: RecoveryVerdict;
  counterAfter: number;
  unitResult: UnitResult;
  envelopeId: string;
  unitId: string;
}

// ─── Module-level test seams ─────────────────────────────────────────────────

type RunUnitFn = (
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  s: AutoSession,
  unitType: string,
  unitId: string,
  prompt: string,
) => Promise<UnitResult>;

let _runUnit: RunUnitFn = defaultRunUnit;
let _cachedTemplate: string | undefined;

/** Test-only seam — replace runUnit with a stub. */
export function _setRunUnitForTest(stub: RunUnitFn | null): void {
  _runUnit = stub ?? defaultRunUnit;
}

/** Test-only seam — replace the recovery prompt template body. */
export function _setRecoveryTemplateForTest(template: string | null): void {
  _cachedTemplate = template ?? undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the given unitType is itself a recovery unit. T04's
 * dispatch rule consults this to refuse to recurse into recovery for a
 * recovery failure.
 */
export function isAlreadyRecoveryUnit(unitType: string): boolean {
  return unitType === "recovery";
}

/**
 * Partition failures into "recoverable" / "terminal" / "unknown" per
 * research §2.6:
 *
 *   IAMError.iamErrorKind ∈ {
 *     omega-stage-failed, executor-not-wired, persistence-failed,
 *     completion-evidence-missing, audit-fail-closed, gate-policy-missing
 *   } → recoverable
 *
 *   IAMError.iamErrorKind ∈ {
 *     rune-validation-failed, savesuccess-blind-spot,
 *     invalid-stage-sequence, unknown-rune, context-envelope-invalid
 *   } → terminal
 *
 *   ErrorContext.isTransient === true  → recoverable
 *   ErrorContext.isTransient === false → terminal
 *   ErrorContext.isTransient missing   → unknown
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
  // ErrorContext branch.
  if (failure.isTransient === true) return "recoverable";
  if (failure.isTransient === false) return "terminal";
  return "unknown";
}

/** Normalize trigger.failure to (category, remediation) prompt strings. */
function normalizeFailure(failure: ErrorContext | IAMErrorShape): {
  category: string;
  remediation: string;
} {
  if ("iamErrorKind" in failure) {
    return {
      category: failure.iamErrorKind,
      remediation: failure.remediation,
    };
  }
  return {
    category: failure.category,
    remediation: failure.message ?? "",
  };
}

/** Lazily load (and cache) the recovery prompt template body. */
function loadRecoveryTemplate(): string {
  if (_cachedTemplate !== undefined) return _cachedTemplate;
  const url = new URL("../prompts/recovery.md", import.meta.url);
  _cachedTemplate = readFileSync(url, "utf-8");
  return _cachedTemplate;
}

/**
 * Substitute `<<X>>` placeholders. We use split/join rather than a regex so
 * that placeholder values containing `$&` / `$1` etc. cannot disturb the
 * substitution.
 */
function substituteRecoveryPlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`<<${key}>>`).join(value);
  }
  return out;
}

/**
 * Concatenate the runUnit message stream into a single string for the verdict
 * parser. Messages may be plain strings or structured tool/agent objects;
 * stringify the latter so the marker line still surfaces if it's nested.
 */
function flattenMessageStream(result: UnitResult): string {
  const messages = result.event?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return "";
  return messages
    .map((m) => (typeof m === "string" ? m : safeStringify(m)))
    .join("\n");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Dispatch a single recovery subagent unit for a parent unit failure. Returns
 * the parsed verdict, the post-dispatch counter value, and the underlying
 * UnitResult so callers (T04 dispatch rule) can decide whether to retry the
 * parent or pause auto-mode.
 */
export async function dispatchRecovery(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  s: AutoSession,
  trigger: RecoveryDispatchTrigger,
): Promise<RecoveryDispatchResult> {
  const { parentUnitType, parentUnitId, failure, attemptNumber } = trigger;

  // (1) Mint envelopeId deterministically — same shape used in T01 marker tests.
  const envelopeId = `${parentUnitType}:${parentUnitId}:recover-${attemptNumber}`;
  const unitId = `${parentUnitType}/${parentUnitId}:recover-${attemptNumber}`;

  // (2) Load + substitute placeholders.
  const template = loadRecoveryTemplate();
  const { category, remediation } = normalizeFailure(failure);
  const prompt = substituteRecoveryPlaceholders(template, {
    ENVELOPE_ID: envelopeId,
    PARENT_UNIT_TYPE: parentUnitType,
    PARENT_UNIT_ID: parentUnitId,
    FAILURE_CATEGORY: category,
    FAILURE_REMEDIATION: remediation,
    ATTEMPT_NUMBER: String(attemptNumber),
    CAP: String(RECOVERY_FAILURE_CAP),
  });

  // (3) Run the recovery unit through the standard dispatch envelope. The
  // existing IAM audit fail-closed plumbing observes the prompt's first-line
  // marker and emits an iam-subagent-dispatch row.
  const unitResult = await _runUnit(ctx, pi, s, "recovery", unitId, prompt);

  // (4) Parse the wire-format verdict from the agent's message stream.
  const verdict = parseRecoveryVerdict(flattenMessageStream(unitResult));

  // (5) Compute counter delta per research §4.2.
  const existing = readSessionLockData(s.basePath);
  const previousCounter = existing?.consecutiveRecoveryFailures ?? 0;
  const delta =
    verdict.kind === "give-up" || verdict.kind === "malformed" ? 1 : 0;
  const counterAfter = previousCounter + delta;

  // (6) Persist counter + diagnostics on the lock. Best-effort — the helper
  // is a no-op if the lock file is missing.
  updateSessionLockFields(s.basePath, {
    consecutiveRecoveryFailures: counterAfter,
    lastRecoveryUnitId: unitId,
    lastRecoveryVerdict: verdict.kind,
    lastRecoveryAt: new Date().toISOString(),
  });

  // (7) Emit a journal event so operators can grep recovery dispatches.
  try {
    appendEvent(s.basePath, {
      cmd: "recovery-dispatch",
      params: {
        unitType: "recovery",
        parentUnitType,
        parentUnitId,
        envelopeId,
        verdict: verdict.kind,
        attemptNumber,
        counterAfter,
      },
      ts: new Date().toISOString(),
      actor: "system",
      actor_name: "recovery-dispatcher",
      trigger_reason: `${parentUnitType} failure: ${category}`,
    });
  } catch {
    // Journal append is best-effort — recovery proceeds even if disk write fails.
  }

  return { verdict, counterAfter, unitResult, envelopeId, unitId };
}
