import { appendFileSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { isStaleWrite } from "../auto/turn-epoch.js";
import { withFileLockSync } from "../file-lock.js";
import { gsdRoot } from "../paths.js";
import { isDbAvailable, insertAuditEvent } from "../gsd-db.js";
import type { AuditEventEnvelope } from "./contracts.js";
import {
  AuditFailClosedError,
  isIAMClassifiedEvent,
} from "./audit-classification.js";

function auditLogPath(basePath: string): string {
  return join(gsdRoot(basePath), "audit", "events.jsonl");
}

function ensureAuditDir(basePath: string): void {
  mkdirSync(join(gsdRoot(basePath), "audit"), { recursive: true });
}

export function buildAuditEnvelope(args: {
  traceId: string;
  turnId?: string;
  causedBy?: string;
  category: AuditEventEnvelope["category"];
  type: string;
  payload?: Record<string, unknown>;
}): AuditEventEnvelope {
  return {
    eventId: randomUUID(),
    traceId: args.traceId,
    turnId: args.turnId,
    causedBy: args.causedBy,
    category: args.category,
    type: args.type,
    ts: new Date().toISOString(),
    payload: args.payload ?? {},
  };
}

export function emitUokAuditEvent(basePath: string, event: AuditEventEnvelope): void {
  // Drop writes from a turn superseded by timeout recovery / cancellation.
  if (isStaleWrite("uok-audit")) return;
  const path = auditLogPath(basePath);
  try {
    ensureAuditDir(basePath);
    // proper-lockfile requires the target file to exist before locking.
    // Touch it via open(O_APPEND|O_CREAT) so the first writer wins the race
    // atomically at the kernel level.
    if (!existsSync(path)) closeSync(openSync(path, "a"));
    // onLocked: "skip" — audit writes are best-effort; under heavy contention
    // POSIX O_APPEND atomicity still protects small line writes, so skipping
    // the lock rather than stalling orchestration is the correct tradeoff.
    withFileLockSync(
      path,
      () => {
        appendFileSync(path, `${JSON.stringify(event)}\n`, "utf-8");
      },
      { onLocked: "skip" },
    );
  } catch (err) {
    // R033 surface 3d (T05): IAM-classified audit events MUST fail closed
    // with structured remediation so a 3am operator inspecting
    // .hammer/audit/events.jsonl sees the audit-write failure rather than
    // a silent gap. Non-IAM events keep best-effort semantics — the
    // orchestration-safety promise above remains intact for everything
    // outside the IAM subagent surface.
    if (isIAMClassifiedEvent(event)) {
      throw new AuditFailClosedError({
        failingStage: "audit-write",
        missingArtifacts: [path],
        remediation: `Audit log at ${path} is not writable; resolve filesystem permissions / disk space / lock contention before resuming the IAM subagent unit.`,
        cause: err,
      });
    }
    // Best-effort: non-IAM audit writes must never break orchestration.
  }

  if (!isDbAvailable()) return;
  try {
    insertAuditEvent(event);
  } catch (err) {
    // Same fail-closed branch as the file-write path above: IAM-classified
    // events must surface the DB-projection failure as a distinct
    // failingStage so forensic readers can tell broken-disk from
    // broken-DB-target apart.
    if (isIAMClassifiedEvent(event)) {
      throw new AuditFailClosedError({
        failingStage: "audit-projection",
        missingArtifacts: ["audit_events DB row for eventId=" + event.eventId],
        remediation: `Audit DB projection failed for IAM-classified event ${event.type}; inspect gsd-db state and re-run insertAuditEvent before resuming the unit.`,
        cause: err,
      });
    }
    // Projection failures are non-fatal while legacy readers are still active.
  }
}
