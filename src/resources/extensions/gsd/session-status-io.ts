/**
 * GSD Session Status I/O
 *
 * File-based IPC protocol for coordinator-worker communication in
 * parallel milestone orchestration. Each worker writes its status to a
 * file; the coordinator reads all status files to monitor progress.
 *
 * Atomic writes (write to .tmp, then rename) prevent partial reads.
 * Signal files let the coordinator send pause/resume/stop/rebase to workers.
 * Stale detection combines PID liveness checks with heartbeat timeouts. IAM
 * worker envelopes for child processes are intentionally compact: role +
 * deterministic envelope id in env vars and status files, not prompt bodies.
 */

import type { IAMSubagentRoleName } from "../../../iam/context-envelope.js";
import {
  unlinkSync,
  readdirSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { gsdRoot } from "./paths.js";
import { loadJsonFileOrNull, writeJsonFileAtomic } from "./json-persistence.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkerIAMMetadata {
  role: Extract<IAMSubagentRoleName, "orchestrator-worker" | "workflow-worker">;
  envelopeId: string;
  parentUnit: string;
  transport: "env-status-file";
  diagnostic: string;
}

export interface SessionStatus {
  milestoneId: string;
  pid: number;
  state: "running" | "paused" | "stopped" | "error";
  currentUnit: { type: string; id: string; startedAt: number } | null;
  completedUnits: number;
  cost: number;
  lastHeartbeat: number;
  startedAt: number;
  worktreePath: string;
  /**
   * Additive IAM metadata for child-process workers. Legacy status files may
   * omit this field; when present, it must stay compact so large parallel
   * batches do not persist prompt-sized envelopes into status records.
   */
  iam?: WorkerIAMMetadata;
}

export type SessionSignal = "pause" | "resume" | "stop" | "rebase";

export interface SignalMessage {
  signal: SessionSignal;
  sentAt: number;
  from: "coordinator";
}

// ─── Constants ─────────────────────────────────────────────────────────────

const PARALLEL_DIR = "parallel";
const STATUS_SUFFIX = ".status.json";
const SIGNAL_SUFFIX = ".signal.json";
const DEFAULT_STALE_TIMEOUT_MS = 30_000;
const WORKER_IAM_DIAGNOSTIC = "Child-process workers use env/status-file IAM envelopes; in-process subagent calls use prompt/tool-input envelopes.";
const WORKER_IAM_ROLES = new Set<WorkerIAMMetadata["role"]>(["orchestrator-worker", "workflow-worker"]);

interface CreateWorkerIAMMetadataInput {
  role: WorkerIAMMetadata["role"];
  milestoneId: string;
  workerId: string;
  sliceId?: string;
}

export function createWorkerIAMMetadata(input: CreateWorkerIAMMetadataInput): WorkerIAMMetadata {
  const parts = ["iam-worker", input.milestoneId, input.sliceId, input.workerId]
    .filter((part): part is string => typeof part === "string" && part.length > 0);
  return {
    role: input.role,
    envelopeId: parts.join("/"),
    parentUnit: input.sliceId ? `${input.milestoneId}/${input.sliceId}` : input.milestoneId,
    transport: "env-status-file",
    diagnostic: WORKER_IAM_DIAGNOSTIC,
  };
}

export function workerIAMEnv(iam: WorkerIAMMetadata): Record<"HAMMER_IAM_ROLE" | "HAMMER_IAM_ENVELOPE_ID", string> {
  return {
    HAMMER_IAM_ROLE: iam.role,
    HAMMER_IAM_ENVELOPE_ID: iam.envelopeId,
  };
}

export function validateWorkerIAMMetadata(iam: unknown): string[] {
  if (iam === undefined) return [];
  if (iam === null || typeof iam !== "object") return ["IAM worker metadata must be an object when present"];
  const record = iam as Record<string, unknown>;
  const diagnostics: string[] = [];

  if (typeof record.role !== "string" || !WORKER_IAM_ROLES.has(record.role as WorkerIAMMetadata["role"])) {
    diagnostics.push(`invalid IAM worker role: ${String(record.role)}`);
  }
  if (typeof record.envelopeId !== "string" || record.envelopeId.trim().length === 0) {
    diagnostics.push("missing IAM worker envelope id");
  } else {
    const orchestratorPattern = /^iam-worker\/[^/]+\/[^/]+$/;
    const workflowPattern = /^iam-worker\/[^/]+\/[^/]+\/[^/]+$/;
    const role = typeof record.role === "string" ? record.role : "";
    const envelopeMatchesRole = role === "workflow-worker"
      ? workflowPattern.test(record.envelopeId)
      : role === "orchestrator-worker"
        ? orchestratorPattern.test(record.envelopeId)
        : orchestratorPattern.test(record.envelopeId) || workflowPattern.test(record.envelopeId);
    if (!envelopeMatchesRole) {
      diagnostics.push(`malformed IAM worker envelope id: ${record.envelopeId}`);
    }
  }
  if (typeof record.parentUnit !== "string" || record.parentUnit.trim().length === 0) {
    diagnostics.push("missing IAM worker parent unit");
  }
  if (record.transport !== "env-status-file") {
    diagnostics.push(`invalid IAM worker transport: ${String(record.transport)}`);
  }
  if (typeof record.diagnostic !== "string" || record.diagnostic.trim().length === 0) {
    diagnostics.push("missing IAM worker diagnostic");
  }

  return diagnostics;
}

export function formatWorkerIAMDiagnostic(iam: WorkerIAMMetadata): string {
  return `${iam.diagnostic} role=${iam.role}; envelopeId=${iam.envelopeId}; parentUnit=${iam.parentUnit}`;
}

function isWorkerIAMMetadata(data: unknown): data is WorkerIAMMetadata {
  return validateWorkerIAMMetadata(data).length === 0;
}

function isSessionStatus(data: unknown): data is SessionStatus {
  if (data === null || typeof data !== "object" || !("milestoneId" in data) || !("pid" in data)) {
    return false;
  }
  const record = data as Record<string, unknown>;
  return record.iam === undefined || isWorkerIAMMetadata(record.iam);
}

function isSignalMessage(data: unknown): data is SignalMessage {
  return data !== null && typeof data === "object" && "signal" in data && "sentAt" in data;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parallelDir(basePath: string): string {
  return join(gsdRoot(basePath), PARALLEL_DIR);
}

function statusPath(basePath: string, milestoneId: string): string {
  return join(parallelDir(basePath), `${milestoneId}${STATUS_SUFFIX}`);
}

function signalPath(basePath: string, milestoneId: string): string {
  return join(parallelDir(basePath), `${milestoneId}${SIGNAL_SUFFIX}`);
}

function ensureParallelDir(basePath: string): void {
  const dir = parallelDir(basePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Status I/O ────────────────────────────────────────────────────────────

/** Write session status atomically (write to .tmp, then rename). */
export function writeSessionStatus(basePath: string, status: SessionStatus): void {
  ensureParallelDir(basePath);
  writeJsonFileAtomic(statusPath(basePath, status.milestoneId), status);
}

/** Read a specific milestone's session status. */
export function readSessionStatus(basePath: string, milestoneId: string): SessionStatus | null {
  return loadJsonFileOrNull(statusPath(basePath, milestoneId), isSessionStatus);
}

/** Read all session status files from .gsd/parallel/. */
export function readAllSessionStatuses(basePath: string): SessionStatus[] {
  const dir = parallelDir(basePath);
  if (!existsSync(dir)) return [];

  const results: SessionStatus[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(STATUS_SUFFIX)) continue;
      const status = loadJsonFileOrNull(join(dir, entry), isSessionStatus);
      if (status) results.push(status);
    }
  } catch { /* non-fatal */ }
  return results;
}

/** Remove a milestone's session status file. */
export function removeSessionStatus(basePath: string, milestoneId: string): void {
  try {
    const p = statusPath(basePath, milestoneId);
    if (existsSync(p)) unlinkSync(p);
  } catch { /* non-fatal */ }
}

// ─── Signal I/O ────────────────────────────────────────────────────────────

/** Write a signal file for a worker to consume. */
export function sendSignal(basePath: string, milestoneId: string, signal: SessionSignal): void {
  ensureParallelDir(basePath);
  const msg: SignalMessage = { signal, sentAt: Date.now(), from: "coordinator" };
  writeJsonFileAtomic(signalPath(basePath, milestoneId), msg);
}

/** Read and delete a signal file (atomic consume). Returns null if no signal pending. */
export function consumeSignal(basePath: string, milestoneId: string): SignalMessage | null {
  const p = signalPath(basePath, milestoneId);
  const msg = loadJsonFileOrNull(p, isSignalMessage);
  if (msg) {
    try { unlinkSync(p); } catch { /* non-fatal */ }
  }
  return msg;
}

// ─── Stale Detection ───────────────────────────────────────────────────────

/** Check whether a session is stale (PID dead or heartbeat timed out). */
export function isSessionStale(
  status: SessionStatus,
  timeoutMs: number = DEFAULT_STALE_TIMEOUT_MS,
): boolean {
  if (!isPidAlive(status.pid)) return true;
  const elapsed = Date.now() - status.lastHeartbeat;
  return elapsed > timeoutMs;
}

/** Find and remove stale sessions. Returns the milestone IDs that were cleaned up. */
export function cleanupStaleSessions(
  basePath: string,
  timeoutMs: number = DEFAULT_STALE_TIMEOUT_MS,
): string[] {
  const removed: string[] = [];
  const statuses = readAllSessionStatuses(basePath);

  for (const status of statuses) {
    if (isSessionStale(status, timeoutMs)) {
      removeSessionStatus(basePath, status.milestoneId);
      // Also clean up any lingering signal file
      try {
        const sig = signalPath(basePath, status.milestoneId);
        if (existsSync(sig)) unlinkSync(sig);
      } catch { /* non-fatal */ }
      removed.push(status.milestoneId);
    }
  }

  return removed;
}
