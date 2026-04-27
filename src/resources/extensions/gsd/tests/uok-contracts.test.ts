import test from "node:test";
import assert from "node:assert/strict";

import type {
  FailureClass,
  IamSubagentAuditEventEnvelope,
  IamSubagentAuditPayload,
  IamSubagentAuditStatus,
  UokDispatchEnvelope,
  GateResult,
  TurnContract,
  TurnResult,
  UokNodeKind,
  WriteRecord,
  WriterToken,
} from "../uok/contracts.ts";
import { buildAuditEnvelope } from "../uok/audit.ts";
import { buildDispatchEnvelope, explainDispatch } from "../uok/dispatch-envelope.ts";

test("uok contracts serialize/deserialize turn envelopes", () => {
  const contract: TurnContract = {
    traceId: "trace-1",
    turnId: "turn-1",
    iteration: 1,
    basePath: "/tmp/project",
    unitType: "execute-task",
    unitId: "M001.S01.T01",
    startedAt: new Date().toISOString(),
  };

  const gate: GateResult = {
    gateId: "Q3",
    gateType: "policy",
    outcome: "pass",
    failureClass: "none",
    attempt: 1,
    maxAttempts: 1,
    retryable: false,
    evaluatedAt: new Date().toISOString(),
  };

  const result: TurnResult = {
    traceId: contract.traceId,
    turnId: contract.turnId,
    iteration: contract.iteration,
    unitType: contract.unitType,
    unitId: contract.unitId,
    status: "completed",
    failureClass: "none",
    phaseResults: [
      { phase: "dispatch", action: "next", ts: new Date().toISOString() },
      { phase: "unit", action: "continue", ts: new Date().toISOString() },
      { phase: "finalize", action: "next", ts: new Date().toISOString() },
    ],
    gateResults: [gate],
    startedAt: contract.startedAt,
    finishedAt: new Date().toISOString(),
  };

  const roundTrip = JSON.parse(JSON.stringify(result)) as TurnResult;
  assert.equal(roundTrip.turnId, "turn-1");
  assert.equal(roundTrip.gateResults?.[0]?.gateId, "Q3");
  assert.equal(roundTrip.phaseResults.length, 3);
});

test("uok contracts include required DAG node kinds", () => {
  const required: UokNodeKind[] = [
    "unit",
    "hook",
    "subagent",
    "team-worker",
    "verification",
    "reprocess",
    "refine",
  ];
  assert.deepEqual(required.length, 7);
});

test("uok audit envelope includes trace/turn/causality fields", () => {
  const event = buildAuditEnvelope({
    traceId: "trace-xyz",
    turnId: "turn-xyz",
    causedBy: "turn-start",
    category: "orchestration",
    type: "turn-result",
    payload: { status: "completed" },
  });

  assert.equal(event.traceId, "trace-xyz");
  assert.equal(event.turnId, "turn-xyz");
  assert.equal(event.causedBy, "turn-start");
  assert.equal(event.payload.status, "completed");
});

test("uok dispatch envelope carries scheduler reason and constraints", () => {
  const envelope: UokDispatchEnvelope = buildDispatchEnvelope({
    action: "dispatch",
    node: {
      kind: "unit",
      dependsOn: ["plan-gate"],
      reads: ["M001-ROADMAP.md"],
      writes: ["M001/S01/T01-SUMMARY.md"],
    },
    unitType: "execute-task",
    unitId: "M001/S01/T01",
    prompt: "do work",
    reasonCode: "dependency",
    summary: "all dependencies are closed and output path is available",
    evidence: { readyTaskCount: 1 },
  });

  assert.equal(envelope.nodeKind, "unit");
  assert.equal(envelope.reason.reasonCode, "dependency");
  assert.deepEqual(envelope.constraints?.dependsOn, ["plan-gate"]);
  assert.ok(explainDispatch(envelope).includes("execute-task M001/S01/T01"));
});

test("uok writer records serialize sequence metadata", () => {
  const token: WriterToken = {
    tokenId: "token-1",
    traceId: "trace-1",
    turnId: "turn-1",
    acquiredAt: new Date().toISOString(),
    owner: "uok",
  };

  const record: WriteRecord = {
    writerToken: token,
    sequence: { traceId: token.traceId, turnId: token.turnId, sequence: 7 },
    category: "audit",
    operation: "append",
    path: ".gsd/audit/events.jsonl",
    ts: new Date().toISOString(),
  };

  const roundTrip = JSON.parse(JSON.stringify(record)) as WriteRecord;
  assert.equal(roundTrip.writerToken.tokenId, "token-1");
  assert.equal(roundTrip.sequence.sequence, 7);
  assert.equal(roundTrip.category, "audit");
});

test("uok contracts type IAM subagent audit payloads for dispatch and policy failures", () => {
  const status: IamSubagentAuditStatus = "policy-blocked";
  const failureClass: FailureClass = "policy";
  const payload: IamSubagentAuditPayload = {
    dispatchId: "dispatch-1",
    toolCallId: "tool-1",
    toolName: "subagent",
    status,
    role: "gate-evaluator",
    contractId: "iam-subagent-role/gate-evaluator/v1",
    envelopeId: "M001-S01-gates-Q5-env",
    parentUnit: "M001/S01/gates",
    unitType: "gate-evaluate",
    promptPath: "tasks[0].task",
    markerStatus: "missing",
    promptHash: "a".repeat(64),
    promptCharCount: 1200,
    contextArtifactIds: ["S01-plan"],
    contextArtifactKinds: ["slice-plan"],
    expectedArtifactIds: ["Q5-gate-result"],
    expectedArtifacts: [{ id: "Q5-gate-result", kind: "gate-result", toolName: "gsd_save_gate_result", required: true }],
    actualArtifactStatus: { status: "not-observed", toolResultShape: "not-observed" },
    provenanceReadSources: ["slice plan gate evidence"],
    graphMutationClaim: "none",
    memoryMutationClaim: "none",
    mutationBoundary: "quality-gate-result-only",
    failureClass,
    blockReason: "HARD BLOCK: IAM subagent policy rejected dispatch.",
    remediation: "Add a valid IAM_SUBAGENT_CONTRACT marker.",
    observedAt: new Date().toISOString(),
  };

  const event: IamSubagentAuditEventEnvelope = {
    ...buildAuditEnvelope({
      traceId: "trace-iam",
      turnId: "turn-iam",
      causedBy: "tool-1",
      category: "execution",
      type: "iam-subagent-policy-block",
      payload: payload as unknown as Record<string, unknown>,
    }),
    category: "execution",
    type: "iam-subagent-policy-block",
    payload,
  };

  const roundTrip = JSON.parse(JSON.stringify(event)) as IamSubagentAuditEventEnvelope;
  assert.equal(roundTrip.payload.role, "gate-evaluator");
  assert.equal(roundTrip.payload.failureClass, "policy");
  assert.equal(roundTrip.payload.expectedArtifacts[0]?.kind, "gate-result");
  assert.equal(roundTrip.payload.contextArtifactKinds[0], "slice-plan");
});
