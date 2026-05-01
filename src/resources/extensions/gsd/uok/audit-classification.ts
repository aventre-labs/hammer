/**
 * audit-classification.ts — M002/S02/T05 (R033 surface 3d)
 *
 * Per `T01-AUDIT.md` §4.2, IAM-classified audit emissions must fail closed
 * rather than swallow on-disk write or DB-projection errors. This module
 * provides the predicate and the structured error class consumed by
 * `uok/audit.ts` and the three IAM subagent caller sites in
 * `iam-subagent-runtime.ts`.
 *
 * Design notes:
 *  - Lives outside `contracts.ts` so the pure-types contract module stays
 *    runtime-export-free (matches the T04 decision to keep helpers
 *    surface-local rather than mixing concerns into contracts.ts).
 *  - The `failingStage` union mirrors the per-surface taxonomy in
 *    T01-AUDIT §4.2: `audit-write` for filesystem-side failures and
 *    `audit-projection` for DB-insert failures.
 *  - Shape is isomorphic to S01's `RunPhaseSpiralFailure`
 *    ({ failingStage, missingArtifacts, remediation }) modulo the thrown-error
 *    transport — call sites already in production expect synchronous
 *    side-effect-only semantics from `emitUokAuditEvent`.
 */

import type { AuditEventEnvelope } from "./contracts.js";

export type AuditFailClosedFailingStage = "audit-write" | "audit-projection";

/**
 * IAM-classified audit events are the four `iam-subagent-*` event types in
 * the `execution` category (per `IamSubagentAuditEventEnvelope` in
 * contracts.ts:211-219). Non-IAM audit events retain today's best-effort
 * semantics on write/projection failure.
 */
export function isIAMClassifiedEvent(event: AuditEventEnvelope): boolean {
  return event.category === "execution" && event.type.startsWith("iam-subagent-");
}

/**
 * AuditFailClosedError is the structured remediation transport for
 * surface 3d. It carries the same `{failingStage, missingArtifacts,
 * remediation}` triple as the other S02 surfaces so S03's recovery agent
 * can grep one shape across all four surfaces.
 *
 * The IAM error kind for cross-surface S03 classification is
 * `"audit-fail-closed"` (declared in `src/iam/types.ts:179-191`). The
 * surface-local `failingStage` discriminates further between filesystem
 * and DB failure modes.
 */
export class AuditFailClosedError extends Error {
  readonly failingStage: AuditFailClosedFailingStage;
  readonly missingArtifacts: string[];
  readonly remediation: string;
  readonly iamErrorKind: "audit-fail-closed" = "audit-fail-closed";

  constructor(args: {
    failingStage: AuditFailClosedFailingStage;
    missingArtifacts: string[];
    remediation: string;
    cause?: unknown;
  }) {
    super(`audit fail-closed (${args.failingStage}): ${args.remediation}`);
    this.name = "AuditFailClosedError";
    this.failingStage = args.failingStage;
    this.missingArtifacts = args.missingArtifacts;
    this.remediation = args.remediation;
    if (args.cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = args.cause;
    }
  }
}

/** Type-narrowing predicate so callers can `if (isAuditFailClosedError(err))`. */
export function isAuditFailClosedError(err: unknown): err is AuditFailClosedError {
  return err instanceof AuditFailClosedError;
}
