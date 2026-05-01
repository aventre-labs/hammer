/**
 * src/tests/hammer-iam-context-envelope.test.ts
 *
 * Contract tests for pure IAM subagent role and context-envelope helpers.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  IAM_SUBAGENT_ROLE_CONTRACTS,
  IAM_SUBAGENT_ROLE_NAMES,
  buildIAMContextEnvelope,
  formatIAMSubagentFailureDiagnostic,
  getIAMSubagentRoleContract,
  validateIAMContextEnvelope,
  type IAMContextEnvelope,
  type IAMContextArtifactReference,
  type IAMExpectedArtifactEvidence,
  type IAMSubagentRoleName,
} from "../../src/iam/context-envelope.js";

const allRoleNames: IAMSubagentRoleName[] = [
  "research-scout",
  "gate-evaluator",
  "task-executor",
  "validation-reviewer",
  "workflow-worker",
  "orchestrator-worker",
  "recovery",
];

function validContextArtifact(overrides: Partial<IAMContextArtifactReference> = {}): IAMContextArtifactReference {
  return {
    id: "ctx-omega-1",
    kind: "omega-run",
    source: "M001/S07/T01",
    summary: "Omega Materiality research summary",
    trinity: {
      layer: "knowledge",
      ity: { factuality: 0.9 },
      pathy: { risk: 0.3 },
    },
    volvox: {
      cellType: "STRUCTURAL",
      lifecyclePhase: "mature",
      propagationEligible: false,
    },
    ...overrides,
  };
}

function validExpectedEvidence(overrides: Partial<IAMExpectedArtifactEvidence> = {}): IAMExpectedArtifactEvidence {
  return {
    id: "artifact-summary",
    kind: "summary",
    status: "present",
    boundary: "artifact-only",
    path: ".gsd/milestones/M001/slices/S07/tasks/T01-SUMMARY.md",
    ...overrides,
  };
}

function buildValidEnvelope(overrides: Partial<IAMContextEnvelope> = {}): IAMContextEnvelope {
  const built = buildIAMContextEnvelope({
    role: "research-scout",
    envelopeId: "env-1",
    parentUnit: "M001/S07/T01",
    objective: "Collect context for IAM envelope contracts.",
    contextArtifacts: [validContextArtifact()],
    expectedArtifacts: [
      {
        id: "artifact-summary",
        kind: "summary",
        boundary: "artifact-only",
        required: true,
        description: "Research summary artifact.",
      },
    ],
    provenancePermissions: ["read-trinity", "read-omega", "read-volvox"],
    mutationBoundary: {
      boundary: "artifact-only",
      allowedPaths: [".gsd/milestones/M001/slices/S07/tasks/T01-SUMMARY.md"],
      allowedToolCalls: [],
      memoryWrites: "none",
      graphWrites: "none",
    },
    graphMutationClaims: [
      {
        id: "claim-none",
        target: "trinity-graph",
        operation: "none",
        status: "not-requested",
        rationale: "Research scout only reads context.",
      },
    ],
    actualArtifacts: [validExpectedEvidence()],
  });
  assert.ok(built.ok, "fixture envelope should build");
  return { ...built.value, ...overrides };
}

// ── Registry completeness ────────────────────────────────────────────────────

test("IAM subagent role registry is exhaustive for declared role names", () => {
  assert.deepEqual([...IAM_SUBAGENT_ROLE_NAMES], allRoleNames);
  assert.deepEqual(Object.keys(IAM_SUBAGENT_ROLE_CONTRACTS), allRoleNames);
  for (const roleName of allRoleNames) {
    const result = getIAMSubagentRoleContract(roleName);
    assert.ok(result.ok, `${roleName} should resolve`);
    assert.equal(result.value.role, roleName);
    assert.match(result.value.contractId, /^iam-subagent-role\//);
    assert.ok(result.value.expectedArtifactKinds.length > 0, `${roleName} should declare expected artifacts`);
  }
});

test("unknown role strings return ok:false with an IAM diagnostic instead of throwing", () => {
  const result = getIAMSubagentRoleContract("not-a-role");
  assert.ok(!result.ok);
  assert.equal(result.error.iamErrorKind, "context-envelope-invalid");
  assert.match(result.error.remediation, /research-scout/);
});

// ── Envelope construction and validation ─────────────────────────────────────

test("buildIAMContextEnvelope creates a valid strict envelope with Omega, Trinity, and VOLVOX context", () => {
  const result = buildIAMContextEnvelope({
    role: "research-scout",
    envelopeId: "env-happy",
    parentUnit: "M001/S07/T01",
    objective: "Research context-envelope contracts.",
    contextArtifacts: [validContextArtifact()],
    expectedArtifacts: [
      {
        id: "artifact-research",
        kind: "research-report",
        boundary: "artifact-only",
        required: true,
        description: "Research report returned by scout.",
      },
    ],
    provenancePermissions: ["read-omega", "read-trinity", "read-volvox"],
    mutationBoundary: {
      boundary: "artifact-only",
      allowedPaths: [".gsd/milestones/M001/slices/S07/tasks/T01-CONTEXT.md"],
      allowedToolCalls: [],
      memoryWrites: "none",
      graphWrites: "none",
    },
    graphMutationClaims: [],
    actualArtifacts: [validExpectedEvidence({ id: "artifact-research", kind: "research-report" })],
  });

  assert.ok(result.ok);
  assert.equal(result.value.role, "research-scout");
  assert.equal(result.value.contract.contractId, "iam-subagent-role/research-scout/v1");
  assert.equal(result.value.contextArtifacts[0].trinity?.layer, "knowledge");
  assert.equal(result.value.contextArtifacts[0].volvox?.cellType, "STRUCTURAL");
});

test("buildIAMContextEnvelope permits pre-dispatch envelopes before actual artifacts exist", () => {
  const result = buildIAMContextEnvelope({
    role: "research-scout",
    envelopeId: "env-pre-dispatch",
    parentUnit: "M001/S07/T01",
    objective: "Research context-envelope contracts before execution.",
    contextArtifacts: [validContextArtifact()],
    expectedArtifacts: [
      {
        id: "artifact-research",
        kind: "research-report",
        boundary: "artifact-only",
        required: true,
        description: "Research report returned by scout.",
      },
    ],
    provenancePermissions: ["read-omega", "read-trinity", "read-volvox"],
    mutationBoundary: {
      boundary: "artifact-only",
      allowedPaths: [".gsd/milestones/M001/slices/S07/tasks/T01-CONTEXT.md"],
      allowedToolCalls: [],
      memoryWrites: "none",
      graphWrites: "none",
    },
  });

  assert.ok(result.ok);
  assert.deepEqual(result.value.actualArtifacts, []);
});

test("validateIAMContextEnvelope rejects missing envelope id and parent unit with remediation", () => {
  const envelope = buildValidEnvelope({ envelopeId: "", parentUnit: "" });
  const result = validateIAMContextEnvelope(envelope);

  assert.ok(!result.ok);
  assert.equal(result.value.ok, false);
  assert.equal(result.value.failureClass, "malformed-envelope");
  assert.deepEqual(result.value.missingFields.sort(), ["envelopeId", "parentUnit"]);
  assert.match(result.value.remediation, /envelopeId/);
});

test("validateIAMContextEnvelope rejects unknown context artifact kind", () => {
  const envelope = buildValidEnvelope({
    contextArtifacts: [validContextArtifact({ kind: "mystery-context" as IAMContextArtifactReference["kind"] })],
  });
  const result = validateIAMContextEnvelope(envelope);

  assert.ok(!result.ok);
  assert.equal(result.value.failureClass, "malformed-envelope");
  assert.match(result.value.remediation, /unknown context artifact kind/i);
});

test("role contracts requiring context artifacts reject omitted context", () => {
  const envelope = buildValidEnvelope({
    role: "research-scout",
    contextArtifacts: [],
  });
  const result = validateIAMContextEnvelope(envelope);

  assert.ok(!result.ok);
  assert.equal(result.value.failureClass, "missing-context");
  assert.match(result.value.remediation, /at least one context artifact/i);
});

test("roles without required context allow empty optional Omega/Trinity/VOLVOX context", () => {
  const built = buildIAMContextEnvelope({
    role: "workflow-worker",
    envelopeId: "env-workflow-empty-context",
    parentUnit: "M001/S07/T01",
    objective: "Run workflow step from explicit prompt instructions.",
    contextArtifacts: [],
    expectedArtifacts: [
      {
        id: "workflow-note",
        kind: "workflow-output",
        boundary: "tool-call",
        required: true,
        description: "Workflow worker output.",
      },
    ],
    provenancePermissions: ["read-none"],
    mutationBoundary: {
      boundary: "tool-call",
      allowedPaths: [],
      allowedToolCalls: ["gsd_task_complete"],
      memoryWrites: "none",
      graphWrites: "none",
    },
    graphMutationClaims: [],
    actualArtifacts: [validExpectedEvidence({ id: "workflow-note", kind: "workflow-output", boundary: "tool-call", toolName: "gsd_task_complete" })],
  });

  assert.ok(built.ok);
  assert.equal(built.value.contextArtifacts.length, 0);
});

test("validateIAMContextEnvelope rejects duplicate expected artifact ids", () => {
  const duplicate = {
    id: "duplicate",
    kind: "summary" as const,
    boundary: "artifact-only" as const,
    required: true,
    description: "duplicate fixture",
  };
  const envelope = buildValidEnvelope({ expectedArtifacts: [duplicate, duplicate] });
  const result = validateIAMContextEnvelope(envelope);

  assert.ok(!result.ok);
  assert.equal(result.value.failureClass, "malformed-envelope");
  assert.match(result.value.remediation, /duplicate expected artifact ids/i);
});

test("validateIAMContextEnvelope reports incomplete required expected artifact evidence", () => {
  const envelope = buildValidEnvelope({
    expectedArtifacts: [
      {
        id: "artifact-summary",
        kind: "summary",
        boundary: "artifact-only",
        required: true,
        description: "Task summary.",
      },
    ],
    actualArtifacts: [validExpectedEvidence({ id: "artifact-summary", status: "missing", path: undefined })],
  });
  const result = validateIAMContextEnvelope(envelope, { requireActualArtifacts: true });
  assert.equal(result.value.actualArtifacts[0].status, "missing");
  assert.match(result.value.remediation, /artifact-summary/);
});

test("validateIAMContextEnvelope rejects unauthorized graph mutation claims", () => {
  const envelope = buildValidEnvelope({
    mutationBoundary: {
      boundary: "artifact-only",
      allowedPaths: [".gsd/milestones/M001/slices/S07/tasks/T01-SUMMARY.md"],
      allowedToolCalls: [],
      memoryWrites: "none",
      graphWrites: "none",
    },
    graphMutationClaims: [
      {
        id: "claim-write",
        target: "trinity-graph",
        operation: "write",
        status: "requested",
        rationale: "Attempt to mutate graph without permission.",
      },
    ],
  });
  const result = validateIAMContextEnvelope(envelope);

  assert.ok(!result.ok);
  assert.equal(result.value.failureClass, "mutation-boundary-violation");
  assert.equal(result.value.graphMutationStatus, "unauthorized");
  assert.match(result.value.remediation, /not authorized/i);
});

test("formatted failure diagnostics name role, envelope, parent, artifacts, mutation boundary, and remediation", () => {
  const envelope = buildValidEnvelope({ envelopeId: "" });
  const validation = validateIAMContextEnvelope(envelope);
  assert.ok(!validation.ok);

  const formatted = formatIAMSubagentFailureDiagnostic(validation.value);
  assert.match(formatted, /role: research-scout/);
  assert.match(formatted, /contractId: iam-subagent-role\/research-scout\/v1/);
  assert.match(formatted, /envelopeId: <missing>/);
  assert.match(formatted, /parentUnit: M001\/S07\/T01/);
  assert.match(formatted, /expectedArtifacts:/);
  assert.match(formatted, /actualArtifacts:/);
  assert.match(formatted, /graphMutationStatus:/);
  assert.match(formatted, /mutationBoundary: artifact-only/);
  assert.match(formatted, /remediation:/);
});

test("IAM context-envelope module preserves the pure IAM boundary", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/iam/context-envelope.ts", "utf-8"));
  assert.doesNotMatch(source, /resources\/extensions/);
  assert.doesNotMatch(source, /node:fs|node:path|@modelcontextprotocol|@anthropic-ai/);
});
