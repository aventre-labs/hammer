import type { FailureClass, GateResult } from "./contracts.js";
import { insertGateRun } from "../gsd-db.js";
import { buildAuditEnvelope, emitUokAuditEvent } from "./audit.js";

export interface GateRunnerContext {
  basePath: string;
  traceId: string;
  turnId: string;
  milestoneId?: string;
  sliceId?: string;
  taskId?: string;
  unitType?: string;
  unitId?: string;
}

export interface GateExecutionInput {
  id: string;
  type: string;
  execute: (ctx: GateRunnerContext, attempt: number) => Promise<{
    outcome: "pass" | "fail" | "retry" | "manual-attention";
    rationale?: string;
    findings?: string;
    failureClass?: FailureClass;
  }>;
}

// ---------------------------------------------------------------------------
// IAM provenance assertion helpers (M002/S02 R033 fail-closed hardening).
//
// Per T01-AUDIT §3 and §6, surface 3c (gate runner) discriminates two
// `gate-policy` failingStages:
//   - `policy-provenance-missing`: registry miss + no IAM provenance record
//     claims this gate id should be registered.
//   - `policy-iam-error`: gate.execute() threw an IAMError-shaped error
//     (carries `iamErrorKind`, possibly via `.cause`).
//
// Both reclassify `failureClass` to `"policy"` (RETRY_MATRIX["policy"] === 0,
// so retry semantics are unchanged) and propagate `iamErrorKind` +
// `provenanceSource` into the audit envelope payload so a 3am operator
// grepping `.gsd/audit/events.jsonl` for `failureClass: policy` sees the
// IAM-classified failures distinctly from generic `unknown` failures.
// ---------------------------------------------------------------------------

/**
 * Per-surface failingStage union for gate-policy failures (T01-AUDIT §3.2).
 */
export type GatePolicyFailingStage =
  | "policy-provenance-missing"
  | "policy-iam-error";

interface GatePolicyProvenanceRecord {
  source: string;
}

const gatePolicyProvenanceRegistry = new Map<string, GatePolicyProvenanceRecord>();

/**
 * Register an IAM provenance claim for a gate id. Tests and production
 * IAM-runtime initialization can populate this so the unknown-gate branch
 * distinguishes "registry miss for an IAM-claimed gate" (a registration
 * bug) from "registry miss for a gate with no IAM provenance" (a policy
 * violation — the call site has no IAM origin).
 */
export function registerGatePolicyProvenance(gateId: string, source: string): void {
  gatePolicyProvenanceRegistry.set(gateId, { source });
}

/**
 * Clear the IAM provenance registry. Test-only helper; production code
 * never clears the registry mid-run.
 */
export function clearGatePolicyProvenanceRegistry(): void {
  gatePolicyProvenanceRegistry.clear();
}

export type GatePolicyProvenanceResult =
  | { ok: true; provenanceSource: string }
  | {
      ok: false;
      failingStage: "policy-provenance-missing";
      provenanceSource: string;
      missingArtifacts: string[];
      remediation: string;
    };

/**
 * Assert that an IAM provenance record claims `gateId` should be
 * registered. Returns `{ok: false}` with structured remediation when no
 * record exists. Pure, never throws.
 */
export function assertGatePolicyProvenance(gateId: string): GatePolicyProvenanceResult {
  const record = gatePolicyProvenanceRegistry.get(gateId);
  if (record) {
    return { ok: true, provenanceSource: record.source };
  }
  // Default expected source — the IAM subagent runtime / governance rune
  // contracts. Operators reading the remediation know where the gate id
  // ought to be declared.
  const expectedSource = "src/resources/extensions/gsd/iam-subagent-runtime.ts";
  return {
    ok: false,
    failingStage: "policy-provenance-missing",
    provenanceSource: expectedSource,
    missingArtifacts: [`IAM provenance record for gate id "${gateId}"`],
    remediation:
      `No IAM provenance for gate id ${gateId}; add it to ${expectedSource} or remove the call site.`,
  };
}

/**
 * Discriminator for IAMError-shaped throws. Returns the iamErrorKind +
 * remediation when `err` (or `err.cause`) carries an `iamErrorKind` field
 * (matching `IAMError` in `src/iam/types.ts`). Returns null otherwise so
 * generic Error throws preserve today's `unknown` classification.
 */
export interface IAMErrorShape {
  iamErrorKind: string;
  remediation?: string;
}

export function isIAMErrorShaped(err: unknown): IAMErrorShape | null {
  if (err === null || err === undefined) return null;
  if (typeof err !== "object") return null;
  const direct = (err as { iamErrorKind?: unknown; remediation?: unknown }).iamErrorKind;
  if (typeof direct === "string" && direct.length > 0) {
    const remediation = (err as { remediation?: unknown }).remediation;
    return {
      iamErrorKind: direct,
      remediation: typeof remediation === "string" ? remediation : undefined,
    };
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== null && cause !== undefined && typeof cause === "object") {
    const causeKind = (cause as { iamErrorKind?: unknown }).iamErrorKind;
    if (typeof causeKind === "string" && causeKind.length > 0) {
      const causeRemediation = (cause as { remediation?: unknown }).remediation;
      return {
        iamErrorKind: causeKind,
        remediation: typeof causeRemediation === "string" ? causeRemediation : undefined,
      };
    }
  }
  return null;
}

const RETRY_MATRIX: Record<FailureClass, number> = {
  none: 0,
  policy: 0,
  input: 0,
  execution: 1,
  artifact: 1,
  verification: 1,
  closeout: 1,
  git: 1,
  timeout: 2,
  "manual-attention": 0,
  unknown: 0,
};

export class UokGateRunner {
  private readonly registry = new Map<string, GateExecutionInput>();

  register(gate: GateExecutionInput): void {
    this.registry.set(gate.id, gate);
  }

  list(): GateExecutionInput[] {
    return Array.from(this.registry.values());
  }

  async run(id: string, ctx: GateRunnerContext): Promise<GateResult> {
    const gate = this.registry.get(id);
    if (!gate) {
      const now = new Date().toISOString();
      // T01-AUDIT §3.3 — fail closed when no IAM provenance record claims
      // this gate id should be registered. `failureClass: "policy"` keeps
      // RETRY_MATRIX["policy"] === 0 retry semantics; the audit envelope
      // payload carries `iamErrorKind` + `provenanceSource` so S03 recovery
      // can grep for IAM-classified gate failures.
      const provenance = assertGatePolicyProvenance(id);
      const isPolicy = !provenance.ok;
      const failureClass: FailureClass = isPolicy ? "policy" : "unknown";
      const rationale = isPolicy
        ? provenance.remediation
        : `Gate ${id} not registered`;
      const findings = isPolicy
        ? `iamErrorKind: gate-policy-missing; failingStage: ${provenance.failingStage}; missingArtifacts: ${JSON.stringify(provenance.missingArtifacts)}`
        : undefined;
      const unknownResult: GateResult = {
        gateId: id,
        gateType: "unknown",
        outcome: "manual-attention",
        failureClass,
        rationale,
        findings,
        attempt: 1,
        maxAttempts: 1,
        retryable: false,
        evaluatedAt: now,
      };

      insertGateRun({
        traceId: ctx.traceId,
        turnId: ctx.turnId,
        gateId: unknownResult.gateId,
        gateType: unknownResult.gateType,
        unitType: ctx.unitType,
        unitId: ctx.unitId,
        milestoneId: ctx.milestoneId,
        sliceId: ctx.sliceId,
        taskId: ctx.taskId,
        outcome: unknownResult.outcome,
        failureClass: unknownResult.failureClass,
        rationale: unknownResult.rationale,
        findings: unknownResult.findings,
        attempt: unknownResult.attempt,
        maxAttempts: unknownResult.maxAttempts,
        retryable: unknownResult.retryable,
        evaluatedAt: unknownResult.evaluatedAt,
      });

      const auditPayload: Record<string, unknown> = {
        gateId: unknownResult.gateId,
        gateType: unknownResult.gateType,
        outcome: unknownResult.outcome,
        failureClass: unknownResult.failureClass,
        attempt: unknownResult.attempt,
        maxAttempts: unknownResult.maxAttempts,
        retryable: unknownResult.retryable,
      };
      if (isPolicy) {
        auditPayload.iamErrorKind = "gate-policy-missing";
        auditPayload.provenanceSource = provenance.provenanceSource;
      }
      emitUokAuditEvent(
        ctx.basePath,
        buildAuditEnvelope({
          traceId: ctx.traceId,
          turnId: ctx.turnId,
          category: "gate",
          type: "gate-run",
          payload: auditPayload,
        }),
      );

      return unknownResult;
    }

    let attempt = 0;
    let final: GateResult | null = null;
    const maxAttemptsByFailureClass = RETRY_MATRIX;
    const maxAttemptsCeiling = Math.max(...Object.values(RETRY_MATRIX)) + 1;

    while (attempt < maxAttemptsCeiling) {
      attempt += 1;
      const now = new Date().toISOString();

      let result: {
        outcome: "pass" | "fail" | "retry" | "manual-attention";
        rationale?: string;
        findings?: string;
        failureClass?: FailureClass;
      };

      // Track IAM-error metadata across the catch → audit-emit boundary so
      // the per-attempt audit envelope can carry `iamErrorKind` /
      // `provenanceSource` only on policy outcomes (T01-AUDIT §3.3).
      let iamErrorMetadata: { iamErrorKind: string; provenanceSource: string } | null = null;

      try {
        result = await gate.execute(ctx, attempt);
      } catch (err) {
        const iamShape = isIAMErrorShaped(err);
        if (iamShape) {
          // Reclassify IAMError-shaped throws to `policy` (T01-AUDIT §3.3).
          // RETRY_MATRIX["policy"] === 0 ensures we don't retry an IAM
          // contract failure — the dispatcher must surface it to recovery.
          const message = err instanceof Error ? err.message : String(err);
          const remediation = iamShape.remediation ?? message;
          result = {
            outcome: "fail",
            failureClass: "policy",
            rationale: remediation,
            findings: `iamErrorKind: ${iamShape.iamErrorKind}; cause: ${message}`,
          };
          iamErrorMetadata = {
            iamErrorKind: iamShape.iamErrorKind,
            provenanceSource: "gate.execute",
          };
        } else {
          // Generic non-IAM throws keep today's `unknown` classification
          // (regression-guarded by gate-runner-iam.test.ts case "c").
          const message = err instanceof Error ? err.message : String(err);
          result = {
            outcome: "fail",
            failureClass: "unknown",
            rationale: message,
          };
        }
      }
      const failureClass = result.failureClass ?? (result.outcome === "pass" ? "none" : "unknown");
      const retryBudget = maxAttemptsByFailureClass[failureClass] ?? 0;
      const retryable = result.outcome !== "pass" && attempt <= retryBudget;

      final = {
        gateId: gate.id,
        gateType: gate.type,
        outcome: retryable ? "retry" : result.outcome,
        failureClass,
        rationale: result.rationale,
        findings: result.findings,
        attempt,
        maxAttempts: retryBudget + 1,
        retryable,
        evaluatedAt: now,
      };

      insertGateRun({
        traceId: ctx.traceId,
        turnId: ctx.turnId,
        gateId: final.gateId,
        gateType: final.gateType,
        unitType: ctx.unitType,
        unitId: ctx.unitId,
        milestoneId: ctx.milestoneId,
        sliceId: ctx.sliceId,
        taskId: ctx.taskId,
        outcome: final.outcome,
        failureClass: final.failureClass,
        rationale: final.rationale,
        findings: final.findings,
        attempt: final.attempt,
        maxAttempts: final.maxAttempts,
        retryable: final.retryable,
        evaluatedAt: final.evaluatedAt,
      });

      const attemptAuditPayload: Record<string, unknown> = {
        gateId: final.gateId,
        gateType: final.gateType,
        outcome: final.outcome,
        failureClass: final.failureClass,
        attempt: final.attempt,
        maxAttempts: final.maxAttempts,
        retryable: final.retryable,
      };
      // T01-AUDIT §3.3 — IAM provenance metadata only flows into the audit
      // envelope on `policy` outcomes (whether from this attempt's IAMError
      // catch or from a future caller-supplied policy classification with
      // attached metadata).
      if (final.failureClass === "policy" && iamErrorMetadata) {
        attemptAuditPayload.iamErrorKind = iamErrorMetadata.iamErrorKind;
        attemptAuditPayload.provenanceSource = iamErrorMetadata.provenanceSource;
      }
      emitUokAuditEvent(
        ctx.basePath,
        buildAuditEnvelope({
          traceId: ctx.traceId,
          turnId: ctx.turnId,
          category: "gate",
          type: "gate-run",
          payload: attemptAuditPayload,
        }),
      );

      if (!retryable) break;
    }

    return final ?? {
      gateId: gate.id,
      gateType: gate.type,
      outcome: "manual-attention",
      failureClass: "unknown",
      attempt: 1,
      maxAttempts: 1,
      retryable: false,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
