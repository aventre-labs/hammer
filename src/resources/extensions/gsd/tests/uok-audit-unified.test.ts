import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitJournalEvent } from "../journal.ts";
import { saveActivityLog } from "../activity-log.ts";
import { initMetrics, resetMetrics, snapshotUnitMetrics } from "../metrics.ts";
import { setLogBasePath, logWarning } from "../workflow-logger.ts";
import { gsdRoot } from "../paths.ts";
import { setUnifiedAuditEnabled } from "../uok/audit-toggle.ts";
import { closeDatabase, _getAdapter, openDatabase } from "../gsd-db.ts";
import {
  formatIAMSubagentPolicyBlockReason,
  formatIamSubagentPrompt,
  validateIAMSubagentPolicy,
} from "../iam-subagent-policy.ts";
import {
  clearIAMSubagentRuntimeForTest,
  recordIAMSubagentDispatch,
  recordIAMSubagentPolicyBlock,
  recordIAMSubagentToolResult,
} from "../iam-subagent-runtime.ts";

function readAuditEvents(basePath: string): Array<Record<string, unknown>> {
  const file = join(gsdRoot(basePath), "audit", "events.jsonl");
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf-8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readIamAuditPayloads(basePath: string, type: string): Array<Record<string, unknown>> {
  return readAuditEvents(basePath)
    .filter((event) => event.type === type)
    .map((event) => event.payload as Record<string, unknown>);
}

function readDbAuditRows(): Array<{ type: string; payload: Record<string, unknown> }> {
  const adapter = _getAdapter();
  assert.ok(adapter, "database should be open");
  return adapter
    .prepare("SELECT type, payload_json FROM audit_events ORDER BY ts, event_id")
    .all()
    .map((row) => ({
      type: String(row.type),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    }));
}

const SUBAGENT_POLICY = {
  mode: "allowed" as const,
  roles: ["gate-evaluator" as const],
  requireEnvelope: true,
  maxParallel: 2,
};

function validGatePrompt(overrides: { promptBody?: string; contextMetadata?: Record<string, unknown> } = {}): string {
  return formatIamSubagentPrompt({
    role: "gate-evaluator",
    envelopeId: "M001-S01-gates-Q5-env",
    parentUnit: "M001/S01/gates",
    objective: "Evaluate Q5 without leaking prompt body or secrets.",
    mutationBoundary: "quality-gate-result-only",
    expectedArtifacts: [
      {
        id: "Q5-gate-result",
        kind: "gate-result",
        description: "Persist Q5 with gsd_save_gate_result.",
        toolName: "gsd_save_gate_result",
      },
    ],
    provenanceSources: [
      {
        id: "slice-plan",
        kind: "slice-plan",
        source: "inline test fixture",
        summary: "Slice plan evidence.",
        path: ".gsd/milestones/M001/slices/S01/S01-PLAN.md",
      },
      {
        id: "metadata-fixture",
        kind: "uok-audit",
        source: "inline test fixture",
        summary: "Non-JSON metadata is summarized, not dumped.",
        ...(overrides.contextMetadata ? { metadata: overrides.contextMetadata as never } : {}),
      } as never,
    ],
    allowedPaths: [],
    allowedToolCalls: ["gsd_save_gate_result"],
    graphMutation: "none",
    promptBody: overrides.promptBody ?? "Call gsd_save_gate_result. SECRET_TOKEN=sk-test-uok-audit-secret-12345678901234567890",
  });
}

function assertNoSecretOrPromptBody(payload: Record<string, unknown>): void {
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /sk-test-uok-audit-secret/);
  assert.doesNotMatch(serialized, /Call gsd_save_gate_result/);
  assert.doesNotMatch(serialized, /SECRET_TOKEN/);
}

function makeMockContext(entries: unknown[]): any {
  return {
    sessionManager: {
      getEntries: () => entries,
    },
  };
}

test("unified audit plane bridges journal/activity/metrics/workflow logger into audit envelope log", () => {
  const basePath = mkdtempSync(join(tmpdir(), "gsd-uok-audit-"));
  setUnifiedAuditEnabled(true);
  try {
    emitJournalEvent(basePath, {
      ts: new Date().toISOString(),
      flowId: "trace-123",
      seq: 1,
      eventType: "iteration-start",
      data: { turnId: "turn-123", unitId: "M001/S01/T01" },
    });

    const activityCtx = makeMockContext([
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
    ]);
    const activityPath = saveActivityLog(activityCtx, basePath, "execute-task", "M001/S01/T01");
    assert.ok(activityPath);

    initMetrics(basePath);
    const metricsCtx = makeMockContext([
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: 0.01 },
          content: [],
        },
      },
    ]);
    const unit = snapshotUnitMetrics(
      metricsCtx,
      "execute-task",
      "M001/S01/T01",
      Date.now() - 1000,
      "openai/gpt-5.4",
      { traceId: "trace-123", turnId: "turn-123" },
    );
    assert.ok(unit);
    resetMetrics();

    setLogBasePath(basePath);
    logWarning("engine", "audit bridge check", { id: "turn-123" });

    const events = readAuditEvents(basePath);
    const types = new Set(events.map((event) => String(event.type ?? "")));
    assert.ok(types.has("journal-iteration-start"));
    assert.ok(types.has("activity-log-saved"));
    assert.ok(types.has("unit-metrics-snapshot"));
    assert.ok(types.has("workflow-log-warn"));
  } finally {
    setUnifiedAuditEnabled(false);
    resetMetrics();
    rmSync(basePath, { recursive: true, force: true });
  }
});

test("unified audit bridge is disabled when toggle is off", () => {
  const basePath = mkdtempSync(join(tmpdir(), "gsd-uok-audit-off-"));
  setUnifiedAuditEnabled(false);
  try {
    emitJournalEvent(basePath, {
      ts: new Date().toISOString(),
      flowId: "trace-off",
      seq: 1,
      eventType: "iteration-start",
    });
    const events = readAuditEvents(basePath);
    assert.equal(events.length, 0);
  } finally {
    rmSync(basePath, { recursive: true, force: true });
  }
});

test("IAM subagent runtime emits redaction-safe dispatch and completion audit events", () => {
  const basePath = mkdtempSync(join(tmpdir(), "gsd-iam-audit-dispatch-"));
  const dbDir = mkdtempSync(join(tmpdir(), "gsd-iam-audit-db-"));
  setUnifiedAuditEnabled(true);
  clearIAMSubagentRuntimeForTest();
  try {
    openDatabase(join(dbDir, "gsd.db"));
    const prompt = validGatePrompt({ contextMetadata: { circular: null } });
    const circular: Record<string, unknown> = { label: "loop" };
    circular.self = circular;

    recordIAMSubagentDispatch({
      basePath,
      traceId: "trace-iam",
      turnId: "turn-iam",
      toolCallId: "call-iam-1",
      toolName: "subagent",
      unitType: "gate-evaluate",
      parentUnit: "M001/S01/gates",
      toolInput: {
        task: prompt,
        metadata: circular,
        token: "sk-test-uok-audit-secret-12345678901234567890",
      },
    });

    recordIAMSubagentToolResult({
      basePath,
      traceId: "trace-iam",
      turnId: "turn-iam",
      toolCallId: "call-iam-1",
      toolName: "subagent",
      unitType: "gate-evaluate",
      parentUnit: "M001/S01/gates",
      toolInput: { task: prompt },
      isError: false,
      result: { content: [{ type: "text", text: "role: gate-evaluator\nenvelopeId: M001-S01-gates-Q5-env\nstatus: present" }] },
    });

    const dispatch = readIamAuditPayloads(basePath, "iam-subagent-dispatch")[0];
    assert.ok(dispatch, "dispatch audit event should be written");
    assert.equal(dispatch.role, "gate-evaluator");
    assert.equal(dispatch.contractId, "iam-subagent-role/gate-evaluator/v1");
    assert.equal(dispatch.envelopeId, "M001-S01-gates-Q5-env");
    assert.equal(dispatch.parentUnit, "M001/S01/gates");
    assert.equal(dispatch.mutationBoundary, "quality-gate-result-only");
    assert.equal(dispatch.graphMutationClaim, "none");
    assert.deepEqual(dispatch.contextArtifactIds, ["slice-plan", "metadata-fixture"]);
    assert.deepEqual(dispatch.expectedArtifactIds, ["Q5-gate-result"]);
    assert.match(String(dispatch.promptHash), /^[a-f0-9]{64}$/);
    assert.ok(Number(dispatch.promptCharCount) > 0);
    assertNoSecretOrPromptBody(dispatch);

    const complete = readIamAuditPayloads(basePath, "iam-subagent-complete")[0];
    assert.ok(complete, "completion audit event should be written");
    assert.equal(complete.status, "completed");
    assert.equal((complete.actualArtifactStatus as Record<string, unknown>).status, "present");
    assertNoSecretOrPromptBody(complete);

    const dbRows = readDbAuditRows();
    assert.ok(dbRows.some((row) => row.type === "iam-subagent-dispatch"));
    assert.ok(dbRows.some((row) => row.type === "iam-subagent-complete"));
  } finally {
    closeDatabase();
    clearIAMSubagentRuntimeForTest();
    setUnifiedAuditEnabled(false);
    rmSync(basePath, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test("IAM subagent policy blocks persist deterministic diagnostics without breaking hard-block path", () => {
  const basePath = mkdtempSync(join(tmpdir(), "gsd-iam-audit-block-"));
  setUnifiedAuditEnabled(true);
  clearIAMSubagentRuntimeForTest();
  try {
    const validation = validateIAMSubagentPolicy({
      toolName: "subagent",
      toolInput: { tasks: [{ task: "Evaluate Q5 without an IAM envelope. SECRET_TOKEN=sk-test-uok-audit-secret-12345678901234567890" }] },
      unitType: "gate-evaluate",
      parentUnit: "M001/S01/gates",
      policy: SUBAGENT_POLICY,
    });
    assert.equal(validation.ok, false);
    const reason = formatIAMSubagentPolicyBlockReason(validation);

    recordIAMSubagentPolicyBlock({
      context: {
        basePath,
        traceId: "trace-block",
        turnId: "turn-block",
        toolCallId: "call-block-1",
        toolName: "subagent",
        unitType: "gate-evaluate",
        parentUnit: "M001/S01/gates",
        toolInput: { tasks: [{ task: "Evaluate Q5 without an IAM envelope. SECRET_TOKEN=sk-test-uok-audit-secret-12345678901234567890" }] },
      },
      validation,
      reason,
    });

    assert.match(reason, /HARD BLOCK/);
    assert.match(reason, /gate-evaluate/);
    assert.match(reason, /M001\/S01\/gates/);
    assert.match(reason, /Allowed roles: gate-evaluator/);
    assert.match(reason, /envelopeId=<missing>/);
    assert.match(reason, /expected artifact/i);
    assert.match(reason, /mutation boundary/i);

    const block = readIamAuditPayloads(basePath, "iam-subagent-policy-block")[0];
    assert.ok(block, "policy block audit event should be written");
    assert.equal(block.status, "policy-blocked");
    assert.equal(block.failureClass, "policy");
    assert.equal(block.role, "<missing>");
    assert.equal(block.envelopeId, "<missing>");
    assert.equal(block.parentUnit, "M001/S01/gates");
    assert.equal(block.mutationBoundary, "<missing>");
    assert.deepEqual(block.expectedArtifactIds, ["<missing>"]);
    assert.match(String(block.blockReason), /HARD BLOCK/);
    assert.match(String(block.remediation), /IAM_SUBAGENT_CONTRACT/);
    assert.equal((block.violation as Record<string, unknown>).markerStatus, "missing");
    assertNoSecretOrPromptBody(block);
  } finally {
    clearIAMSubagentRuntimeForTest();
    setUnifiedAuditEnabled(false);
    rmSync(basePath, { recursive: true, force: true });
  }
});

test("IAM subagent failure audit records timeout class and normalizes non-standard result shapes", () => {
  const basePath = mkdtempSync(join(tmpdir(), "gsd-iam-audit-failure-"));
  setUnifiedAuditEnabled(true);
  clearIAMSubagentRuntimeForTest();
  try {
    const prompt = validGatePrompt();
    recordIAMSubagentDispatch({
      basePath,
      traceId: "trace-failed",
      turnId: "turn-failed",
      toolCallId: "call-failed-1",
      toolName: "task",
      unitType: "gate-evaluate",
      parentUnit: "M001/S01/gates",
      toolInput: { task: prompt },
    });

    recordIAMSubagentToolResult({
      basePath,
      traceId: "trace-failed",
      turnId: "turn-failed",
      toolCallId: "call-failed-1",
      toolName: "task",
      unitType: "gate-evaluate",
      parentUnit: "M001/S01/gates",
      toolInput: { task: prompt },
      isError: true,
      result: { error: new Error("subagent timed out with token sk-test-uok-audit-secret-12345678901234567890") },
    });

    const failed = readIamAuditPayloads(basePath, "iam-subagent-failed")[0];
    assert.ok(failed, "failure audit event should be written");
    assert.equal(failed.status, "failed");
    assert.equal(failed.failureClass, "timeout");
    assert.equal((failed.actualArtifactStatus as Record<string, unknown>).toolResultShape, "object");
    assert.match(String((failed.actualArtifactStatus as Record<string, unknown>).resultHash), /^[a-f0-9]{64}$/);
    assertNoSecretOrPromptBody(failed);
  } finally {
    clearIAMSubagentRuntimeForTest();
    setUnifiedAuditEnabled(false);
    rmSync(basePath, { recursive: true, force: true });
  }
});
