/**
 * src/iam/context-envelope.ts
 *
 * Pure IAM subagent role contracts and strict context-envelope validation.
 * This module deliberately avoids extension-tree, DB, filesystem, Pi SDK, and
 * prompt-renderer imports so runtime adapters can enforce these contracts at
 * manifest and write-gate boundaries.
 */

import type { IAMResult, OmegaStageName } from "./types.js";
import type { TrinityLayer, TrinityVector } from "./trinity.js";
import type { VolvoxCellType, VolvoxLifecyclePhase } from "./volvox.js";

export const IAM_SUBAGENT_ROLE_NAMES = [
  "research-scout",
  "gate-evaluator",
  "task-executor",
  "validation-reviewer",
  "workflow-worker",
  "orchestrator-worker",
] as const;

export type IAMSubagentRoleName = (typeof IAM_SUBAGENT_ROLE_NAMES)[number];

export type IAMContextArtifactKind =
  | "omega-run"
  | "omega-stage"
  | "trinity-memory"
  | "trinity-graph"
  | "volvox-epoch"
  | "uok-audit"
  | "plan"
  | "task-plan"
  | "slice-plan"
  | "requirement"
  | "decision"
  | "summary"
  | "research-report"
  | "validation-report";

export type IAMExpectedArtifactKind =
  | "summary"
  | "research-report"
  | "gate-result"
  | "task-summary"
  | "slice-summary"
  | "milestone-validation"
  | "workflow-output"
  | "audit-event"
  | "tool-call"
  | "manifest"
  | "diagnostic";

export type IAMProvenancePermission =
  | "read-none"
  | "read-omega"
  | "read-trinity"
  | "read-volvox"
  | "read-uok-audit"
  | "write-provenance";

export type IAMMutationBoundaryKind =
  | "read-only"
  | "artifact-only"
  | "tool-call"
  | "graph-memory"
  | "orchestration";

export type IAMGraphMutationTarget = "trinity-graph" | "memory-store" | "volvox-lineage" | "uok-audit";
export type IAMGraphMutationOperation = "none" | "read" | "write" | "append" | "update" | "delete";
export type IAMGraphMutationStatus = "not-requested" | "requested" | "authorized" | "unauthorized" | "completed" | "failed";

export type IAMSubagentEnvelopeFailureClass =
  | "unknown-role"
  | "malformed-envelope"
  | "missing-context"
  | "artifact-mismatch"
  | "mutation-boundary-violation";

export interface IAMSubagentRoleContract {
  role: IAMSubagentRoleName;
  contractId: string;
  summary: string;
  requiredContext: boolean;
  allowedContextArtifactKinds: readonly IAMContextArtifactKind[];
  expectedArtifactKinds: readonly IAMExpectedArtifactKind[];
  provenancePermissions: readonly IAMProvenancePermission[];
  mutationBoundaries: readonly IAMMutationBoundaryKind[];
  allowGraphMutation: boolean;
  allowMemoryMutation: boolean;
  requiredEnvelopeFields: ReadonlyArray<keyof Pick<IAMContextEnvelope,
    "role" | "envelopeId" | "parentUnit" | "objective" | "contextArtifacts" | "expectedArtifacts" | "mutationBoundary"
  >>;
  remediation: string;
}

export interface IAMTrinityContextFilter {
  layer?: TrinityLayer;
  ity?: TrinityVector | Record<string, number>;
  pathy?: TrinityVector | Record<string, number>;
  validationState?: "unvalidated" | "validated" | "contested" | "deprecated";
}

export interface IAMVolvoxContextFilter {
  cellType?: VolvoxCellType;
  lifecyclePhase?: VolvoxLifecyclePhase;
  propagationEligible?: boolean;
}

export interface IAMOmegaContextFilter {
  runId?: string;
  stages?: OmegaStageName[];
  canonical?: boolean;
  artifactDir?: string;
}

export interface IAMContextArtifactReference {
  id: string;
  kind: IAMContextArtifactKind;
  source: string;
  summary: string;
  path?: string;
  omega?: IAMOmegaContextFilter;
  trinity?: IAMTrinityContextFilter;
  volvox?: IAMVolvoxContextFilter;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface IAMArtifactExpectation {
  id: string;
  kind: IAMExpectedArtifactKind;
  boundary: IAMMutationBoundaryKind;
  required: boolean;
  description: string;
  path?: string;
  toolName?: string;
}

export interface IAMExpectedArtifactEvidence {
  id: string;
  kind: IAMExpectedArtifactKind;
  status: "present" | "missing" | "invalid" | "not-applicable";
  boundary: IAMMutationBoundaryKind;
  path?: string;
  toolName?: string;
  detail?: string;
}

export interface IAMMutationBoundary {
  boundary: IAMMutationBoundaryKind;
  allowedPaths: string[];
  allowedToolCalls: string[];
  memoryWrites: "none" | "append-only" | "upsert";
  graphWrites: "none" | "append-only" | "upsert";
}

export interface IAMGraphMutationClaim {
  id: string;
  target: IAMGraphMutationTarget;
  operation: IAMGraphMutationOperation;
  status: IAMGraphMutationStatus;
  rationale: string;
  expectedNodeIds?: string[];
  actualNodeIds?: string[];
}

export interface IAMContextEnvelope {
  role: IAMSubagentRoleName;
  contractId: string;
  envelopeId: string;
  parentUnit: string;
  objective: string;
  contract: IAMSubagentRoleContract;
  contextArtifacts: IAMContextArtifactReference[];
  expectedArtifacts: IAMArtifactExpectation[];
  actualArtifacts: IAMExpectedArtifactEvidence[];
  provenancePermissions: IAMProvenancePermission[];
  mutationBoundary: IAMMutationBoundary;
  graphMutationClaims: IAMGraphMutationClaim[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface BuildIAMContextEnvelopeInput {
  role: IAMSubagentRoleName | string;
  envelopeId: string;
  parentUnit: string;
  objective: string;
  contextArtifacts?: IAMContextArtifactReference[];
  expectedArtifacts?: IAMArtifactExpectation[];
  actualArtifacts?: IAMExpectedArtifactEvidence[];
  provenancePermissions?: IAMProvenancePermission[];
  mutationBoundary?: IAMMutationBoundary;
  graphMutationClaims?: IAMGraphMutationClaim[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface IAMSubagentFailureDiagnostic {
  ok: false;
  role: string;
  contractId: string;
  envelopeId: string;
  parentUnit: string;
  expectedArtifacts: IAMArtifactExpectation[];
  actualArtifacts: IAMExpectedArtifactEvidence[];
  graphMutationStatus: IAMGraphMutationStatus;
  mutationBoundary: IAMMutationBoundaryKind;
  failureClass: IAMSubagentEnvelopeFailureClass;
  remediation: string;
  missingFields: string[];
  details: string[];
}

export interface IAMSubagentValidationOk {
  ok: true;
  role: IAMSubagentRoleName;
  contractId: string;
  envelopeId: string;
  parentUnit: string;
  expectedArtifacts: IAMArtifactExpectation[];
  actualArtifacts: IAMExpectedArtifactEvidence[];
  graphMutationStatus: IAMGraphMutationStatus;
  mutationBoundary: IAMMutationBoundaryKind;
}

export interface IAMContextEnvelopeValidationOptions {
  requireActualArtifacts?: boolean;
}

export type IAMContextEnvelopeValidationResult =
  | { ok: true; value: IAMSubagentValidationOk }
  | { ok: false; value: IAMSubagentFailureDiagnostic };

export type IAMContextEnvelopeValidation = IAMSubagentValidationOk | IAMSubagentFailureDiagnostic;

const VALID_CONTEXT_ARTIFACT_KINDS = new Set<IAMContextArtifactKind>([
  "omega-run",
  "omega-stage",
  "trinity-memory",
  "trinity-graph",
  "volvox-epoch",
  "uok-audit",
  "plan",
  "task-plan",
  "slice-plan",
  "requirement",
  "decision",
  "summary",
  "research-report",
  "validation-report",
]);

const VALID_EXPECTED_ARTIFACT_KINDS = new Set<IAMExpectedArtifactKind>([
  "summary",
  "research-report",
  "gate-result",
  "task-summary",
  "slice-summary",
  "milestone-validation",
  "workflow-output",
  "audit-event",
  "tool-call",
  "manifest",
  "diagnostic",
]);

const VALID_PROVENANCE_PERMISSIONS = new Set<IAMProvenancePermission>([
  "read-none",
  "read-omega",
  "read-trinity",
  "read-volvox",
  "read-uok-audit",
  "write-provenance",
]);

const VALID_MUTATION_BOUNDARIES = new Set<IAMMutationBoundaryKind>([
  "read-only",
  "artifact-only",
  "tool-call",
  "graph-memory",
  "orchestration",
]);

const VALID_GRAPH_STATUSES = new Set<IAMGraphMutationStatus>([
  "not-requested",
  "requested",
  "authorized",
  "unauthorized",
  "completed",
  "failed",
]);

const DEFAULT_REQUIRED_FIELDS: IAMSubagentRoleContract["requiredEnvelopeFields"] = [
  "role",
  "envelopeId",
  "parentUnit",
  "objective",
  "expectedArtifacts",
  "mutationBoundary",
];

export const IAM_SUBAGENT_ROLE_CONTRACTS = {
  "research-scout": {
    role: "research-scout",
    contractId: "iam-subagent-role/research-scout/v1",
    summary: "Reads Omega/Trinity/VOLVOX context and returns grounded research artifacts without mutation authority.",
    requiredContext: true,
    allowedContextArtifactKinds: ["omega-run", "omega-stage", "trinity-memory", "trinity-graph", "volvox-epoch", "plan", "task-plan", "research-report"],
    expectedArtifactKinds: ["research-report", "summary", "diagnostic"],
    provenancePermissions: ["read-omega", "read-trinity", "read-volvox", "read-uok-audit"],
    mutationBoundaries: ["read-only", "artifact-only"],
    allowGraphMutation: false,
    allowMemoryMutation: false,
    requiredEnvelopeFields: [...DEFAULT_REQUIRED_FIELDS, "contextArtifacts"],
    remediation: "Provide a strict research envelope with at least one context artifact and artifact-only expected outputs.",
  },
  "gate-evaluator": {
    role: "gate-evaluator",
    contractId: "iam-subagent-role/gate-evaluator/v1",
    summary: "Evaluates quality gates from supplied evidence and emits gate-result diagnostics.",
    requiredContext: true,
    allowedContextArtifactKinds: ["uok-audit", "summary", "research-report", "validation-report", "plan", "task-plan", "requirement"],
    expectedArtifactKinds: ["gate-result", "diagnostic", "audit-event"],
    provenancePermissions: ["read-uok-audit", "read-trinity"],
    mutationBoundaries: ["artifact-only", "tool-call"],
    allowGraphMutation: false,
    allowMemoryMutation: false,
    requiredEnvelopeFields: [...DEFAULT_REQUIRED_FIELDS, "contextArtifacts"],
    remediation: "Supply gate evidence and restrict the evaluator to gate-result or diagnostic outputs.",
  },
  "task-executor": {
    role: "task-executor",
    contractId: "iam-subagent-role/task-executor/v1",
    summary: "Executes a task under declared artifact and tool-call boundaries.",
    requiredContext: true,
    allowedContextArtifactKinds: ["task-plan", "slice-plan", "plan", "requirement", "decision", "summary", "research-report", "trinity-memory", "volvox-epoch"],
    expectedArtifactKinds: ["task-summary", "summary", "tool-call", "diagnostic"],
    provenancePermissions: ["read-omega", "read-trinity", "read-volvox", "read-uok-audit", "write-provenance"],
    mutationBoundaries: ["artifact-only", "tool-call", "graph-memory"],
    allowGraphMutation: true,
    allowMemoryMutation: true,
    requiredEnvelopeFields: [...DEFAULT_REQUIRED_FIELDS, "contextArtifacts"],
    remediation: "Attach the task plan/context and declare every output artifact or allowed tool call before dispatch.",
  },
  "validation-reviewer": {
    role: "validation-reviewer",
    contractId: "iam-subagent-role/validation-reviewer/v1",
    summary: "Reviews completed artifacts against milestone, UAT, and requirement evidence.",
    requiredContext: true,
    allowedContextArtifactKinds: ["summary", "validation-report", "requirement", "decision", "uok-audit", "trinity-graph"],
    expectedArtifactKinds: ["milestone-validation", "diagnostic", "audit-event"],
    provenancePermissions: ["read-trinity", "read-uok-audit", "write-provenance"],
    mutationBoundaries: ["artifact-only", "tool-call"],
    allowGraphMutation: false,
    allowMemoryMutation: false,
    requiredEnvelopeFields: [...DEFAULT_REQUIRED_FIELDS, "contextArtifacts"],
    remediation: "Provide validation evidence and bind reviewer writes to validation artifacts or audit tool calls.",
  },
  "workflow-worker": {
    role: "workflow-worker",
    contractId: "iam-subagent-role/workflow-worker/v1",
    summary: "Runs a bounded workflow step where instructions may be self-contained and context optional.",
    requiredContext: false,
    allowedContextArtifactKinds: ["plan", "summary", "uok-audit", "decision", "requirement"],
    expectedArtifactKinds: ["workflow-output", "tool-call", "audit-event", "diagnostic"],
    provenancePermissions: ["read-none", "read-uok-audit", "write-provenance"],
    mutationBoundaries: ["tool-call", "artifact-only", "orchestration"],
    allowGraphMutation: false,
    allowMemoryMutation: false,
    requiredEnvelopeFields: DEFAULT_REQUIRED_FIELDS,
    remediation: "Declare the workflow output or tool-call boundary; context artifacts are optional for self-contained workflow steps.",
  },
  "orchestrator-worker": {
    role: "orchestrator-worker",
    contractId: "iam-subagent-role/orchestrator-worker/v1",
    summary: "Coordinates child dispatch and orchestration audit without directly weakening child envelopes.",
    requiredContext: false,
    allowedContextArtifactKinds: ["plan", "slice-plan", "task-plan", "uok-audit", "summary", "validation-report"],
    expectedArtifactKinds: ["manifest", "audit-event", "workflow-output", "diagnostic"],
    provenancePermissions: ["read-uok-audit", "read-trinity", "write-provenance"],
    mutationBoundaries: ["orchestration", "tool-call", "artifact-only"],
    allowGraphMutation: false,
    allowMemoryMutation: false,
    requiredEnvelopeFields: DEFAULT_REQUIRED_FIELDS,
    remediation: "Declare orchestration outputs and require child workers to receive their own role-specific envelopes.",
  },
} satisfies Record<IAMSubagentRoleName, IAMSubagentRoleContract>;

function isKnownRole(role: string): role is IAMSubagentRoleName {
  return (IAM_SUBAGENT_ROLE_NAMES as readonly string[]).includes(role);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function defaultMutationBoundary(): IAMMutationBoundary {
  return {
    boundary: "read-only",
    allowedPaths: [],
    allowedToolCalls: [],
    memoryWrites: "none",
    graphWrites: "none",
  };
}

function emptyDiagnostic(input: {
  role: string;
  contractId?: string;
  envelopeId?: string;
  parentUnit?: string;
  expectedArtifacts?: IAMArtifactExpectation[];
  actualArtifacts?: IAMExpectedArtifactEvidence[];
  graphMutationStatus?: IAMGraphMutationStatus;
  mutationBoundary?: IAMMutationBoundaryKind;
  failureClass: IAMSubagentEnvelopeFailureClass;
  remediation: string;
  missingFields?: string[];
  details?: string[];
}): IAMSubagentFailureDiagnostic {
  return {
    ok: false,
    role: input.role,
    contractId: input.contractId ?? "<unknown>",
    envelopeId: input.envelopeId ?? "<missing>",
    parentUnit: input.parentUnit ?? "<missing>",
    expectedArtifacts: input.expectedArtifacts ?? [],
    actualArtifacts: input.actualArtifacts ?? [],
    graphMutationStatus: input.graphMutationStatus ?? "not-requested",
    mutationBoundary: input.mutationBoundary ?? "read-only",
    failureClass: input.failureClass,
    remediation: input.remediation,
    missingFields: input.missingFields ?? [],
    details: input.details ?? [],
  };
}

export function getIAMSubagentRoleContract(role: IAMSubagentRoleName | string): IAMResult<IAMSubagentRoleContract> {
  if (!isKnownRole(role)) {
    return {
      ok: false,
      error: {
        iamErrorKind: "context-envelope-invalid",
        validationGap: "unknown-role",
        target: String(role),
        remediation: `Unknown IAM subagent role "${String(role)}". Use one of: ${IAM_SUBAGENT_ROLE_NAMES.join(", ")}.`,
      },
    };
  }
  return { ok: true, value: IAM_SUBAGENT_ROLE_CONTRACTS[role] };
}

export function buildIAMContextEnvelope(input: BuildIAMContextEnvelopeInput): IAMResult<IAMContextEnvelope> {
  const contract = getIAMSubagentRoleContract(input.role);
  if (!contract.ok) return contract;

  const envelope: IAMContextEnvelope = {
    role: contract.value.role,
    contractId: contract.value.contractId,
    envelopeId: input.envelopeId,
    parentUnit: input.parentUnit,
    objective: input.objective,
    contract: contract.value,
    contextArtifacts: input.contextArtifacts ?? [],
    expectedArtifacts: input.expectedArtifacts ?? [],
    actualArtifacts: input.actualArtifacts ?? [],
    provenancePermissions: input.provenancePermissions ?? [],
    mutationBoundary: input.mutationBoundary ?? defaultMutationBoundary(),
    graphMutationClaims: input.graphMutationClaims ?? [],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  const validation = validateIAMContextEnvelope(envelope);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        iamErrorKind: "context-envelope-invalid",
        validationGap: validation.value.failureClass,
        target: validation.value.envelopeId,
        remediation: validation.value.remediation,
      },
    };
  }

  return { ok: true, value: envelope };
}

export function validateIAMContextEnvelope(
  envelope: IAMContextEnvelope,
  options: IAMContextEnvelopeValidationOptions = {},
): IAMContextEnvelopeValidationResult {
  const contract = getIAMSubagentRoleContract(envelope.role);
  if (!contract.ok) {
    return {
      ok: false,
      value: emptyDiagnostic({
        role: String(envelope.role),
        envelopeId: nonEmpty(envelope.envelopeId) ? envelope.envelopeId : "<missing>",
        parentUnit: nonEmpty(envelope.parentUnit) ? envelope.parentUnit : "<missing>",
        expectedArtifacts: envelope.expectedArtifacts ?? [],
        actualArtifacts: envelope.actualArtifacts ?? [],
        graphMutationStatus: summarizeGraphMutationStatus(envelope.graphMutationClaims ?? []),
        mutationBoundary: envelope.mutationBoundary?.boundary ?? "read-only",
        failureClass: "unknown-role",
        remediation: contract.error.remediation,
        details: [contract.error.remediation],
      }),
    };
  }

  const missingFields = missingRequiredFields(envelope, contract.value);
  if (missingFields.length > 0) {
    return {
      ok: false,
      value: emptyDiagnostic({
        role: envelope.role,
        contractId: contract.value.contractId,
        envelopeId: nonEmpty(envelope.envelopeId) ? envelope.envelopeId : "<missing>",
        parentUnit: nonEmpty(envelope.parentUnit) ? envelope.parentUnit : "<missing>",
        expectedArtifacts: envelope.expectedArtifacts,
        actualArtifacts: envelope.actualArtifacts,
        graphMutationStatus: summarizeGraphMutationStatus(envelope.graphMutationClaims),
        mutationBoundary: envelope.mutationBoundary.boundary,
        failureClass: "malformed-envelope",
        remediation: `Envelope is missing required field(s): ${missingFields.join(", ")}. Populate them before dispatching ${envelope.role}.`,
        missingFields,
      }),
    };
  }

  const malformed = collectMalformedEnvelopeDetails(envelope, contract.value);
  if (malformed.length > 0) {
    return failure(envelope, contract.value, "malformed-envelope", malformed);
  }

  if (contract.value.requiredContext && envelope.contextArtifacts.length === 0) {
    return failure(envelope, contract.value, "missing-context", [
      `${envelope.role} requires at least one context artifact matching: ${contract.value.allowedContextArtifactKinds.join(", ")}.`,
    ]);
  }

  const artifactMismatches = collectArtifactMismatches(envelope, options);
  if (artifactMismatches.length > 0) {
    return failure(envelope, contract.value, "artifact-mismatch", artifactMismatches);
  }

  const mutationViolations = collectMutationBoundaryViolations(envelope, contract.value);
  if (mutationViolations.length > 0) {
    return failure(envelope, contract.value, "mutation-boundary-violation", mutationViolations, "unauthorized");
  }

  return {
    ok: true,
    value: {
      ok: true,
      role: envelope.role,
      contractId: envelope.contractId,
      envelopeId: envelope.envelopeId,
      parentUnit: envelope.parentUnit,
      expectedArtifacts: envelope.expectedArtifacts,
      actualArtifacts: envelope.actualArtifacts,
      graphMutationStatus: summarizeGraphMutationStatus(envelope.graphMutationClaims),
      mutationBoundary: envelope.mutationBoundary.boundary,
    },
  };
}

function missingRequiredFields(envelope: IAMContextEnvelope, contract: IAMSubagentRoleContract): string[] {
  const missing: string[] = [];
  for (const field of contract.requiredEnvelopeFields) {
    const value = envelope[field];
    if (typeof value === "string" && value.trim().length === 0) missing.push(field);
    else if (Array.isArray(value) && field !== "contextArtifacts" && value.length === 0) missing.push(field);
    else if (value == null) missing.push(field);
  }
  return missing;
}

function collectMalformedEnvelopeDetails(envelope: IAMContextEnvelope, contract: IAMSubagentRoleContract): string[] {
  const details: string[] = [];
  if (envelope.contractId !== contract.contractId) {
    details.push(`Contract id ${envelope.contractId || "<missing>"} does not match role contract ${contract.contractId}.`);
  }
  if (!VALID_MUTATION_BOUNDARIES.has(envelope.mutationBoundary.boundary)) {
    details.push(`Unknown mutation boundary ${String(envelope.mutationBoundary.boundary)}.`);
  }

  const duplicateExpectedIds = duplicates(envelope.expectedArtifacts.map((artifact) => artifact.id));
  if (duplicateExpectedIds.length > 0) {
    details.push(`Duplicate expected artifact ids are not allowed: ${duplicateExpectedIds.join(", ")}.`);
  }

  const duplicateContextIds = duplicates(envelope.contextArtifacts.map((artifact) => artifact.id));
  if (duplicateContextIds.length > 0) {
    details.push(`Duplicate context artifact ids are not allowed: ${duplicateContextIds.join(", ")}.`);
  }

  for (const artifact of envelope.contextArtifacts) {
    if (!nonEmpty(artifact.id)) details.push("Context artifact id must be non-empty.");
    if (!VALID_CONTEXT_ARTIFACT_KINDS.has(artifact.kind)) {
      details.push(`Unknown context artifact kind ${String(artifact.kind)} on ${artifact.id || "<missing>"}.`);
    } else if (!(contract.allowedContextArtifactKinds as readonly string[]).includes(artifact.kind)) {
      details.push(`Context artifact ${artifact.id} kind ${artifact.kind} is not allowed for role ${envelope.role}.`);
    }
    if (!nonEmpty(artifact.source)) details.push(`Context artifact ${artifact.id || "<missing>"} must name its source.`);
    if (!nonEmpty(artifact.summary)) details.push(`Context artifact ${artifact.id || "<missing>"} must include a summary.`);
  }

  for (const artifact of envelope.expectedArtifacts) {
    if (!nonEmpty(artifact.id)) details.push("Expected artifact id must be non-empty.");
    if (!VALID_EXPECTED_ARTIFACT_KINDS.has(artifact.kind)) {
      details.push(`Unknown expected artifact kind ${String(artifact.kind)} on ${artifact.id || "<missing>"}.`);
    } else if (!(contract.expectedArtifactKinds as readonly string[]).includes(artifact.kind)) {
      details.push(`Expected artifact ${artifact.id} kind ${artifact.kind} is not allowed for role ${envelope.role}.`);
    }
    if (!VALID_MUTATION_BOUNDARIES.has(artifact.boundary)) {
      details.push(`Expected artifact ${artifact.id || "<missing>"} has unknown boundary ${String(artifact.boundary)}.`);
    }
  }

  for (const permission of envelope.provenancePermissions) {
    if (!VALID_PROVENANCE_PERMISSIONS.has(permission)) {
      details.push(`Unknown provenance permission ${String(permission)}.`);
    } else if (!(contract.provenancePermissions as readonly string[]).includes(permission)) {
      details.push(`Provenance permission ${permission} is not allowed for role ${envelope.role}.`);
    }
  }

  for (const claim of envelope.graphMutationClaims) {
    if (!nonEmpty(claim.id)) details.push("Graph mutation claim id must be non-empty.");
    if (!VALID_GRAPH_STATUSES.has(claim.status)) details.push(`Graph mutation claim ${claim.id || "<missing>"} has invalid status ${String(claim.status)}.`);
    if (!nonEmpty(claim.rationale)) details.push(`Graph mutation claim ${claim.id || "<missing>"} must include rationale.`);
  }

  return details;
}

function collectArtifactMismatches(envelope: IAMContextEnvelope, options: IAMContextEnvelopeValidationOptions): string[] {
  const details: string[] = [];
  const actualById = new Map(envelope.actualArtifacts.map((artifact) => [artifact.id, artifact]));
  for (const expected of envelope.expectedArtifacts) {
    if (!expected.required) continue;
    const actual = actualById.get(expected.id);
    if (!actual) {
      if (options.requireActualArtifacts === true) {
        details.push(`Required expected artifact ${expected.id} (${expected.kind}) has no evidence.`);
      }
      continue;
    }
    if (actual.status !== "present") {
      details.push(`Required expected artifact ${expected.id} evidence status is ${actual.status}.`);
    }
    if (actual.kind !== expected.kind) {
      details.push(`Expected artifact ${expected.id} kind mismatch: expected ${expected.kind}, actual ${actual.kind}.`);
    }
    if (actual.boundary !== expected.boundary) {
      details.push(`Expected artifact ${expected.id} boundary mismatch: expected ${expected.boundary}, actual ${actual.boundary}.`);
    }
    if (expected.boundary === "artifact-only" && !nonEmpty(actual.path ?? expected.path)) {
      details.push(`Expected artifact ${expected.id} must include a path for artifact-only evidence.`);
    }
    if (expected.boundary === "tool-call" && !nonEmpty(actual.toolName ?? expected.toolName)) {
      details.push(`Expected artifact ${expected.id} must include a toolName for tool-call evidence.`);
    }
  }
  return details;
}

function collectMutationBoundaryViolations(envelope: IAMContextEnvelope, contract: IAMSubagentRoleContract): string[] {
  const details: string[] = [];
  if (!(contract.mutationBoundaries as readonly string[]).includes(envelope.mutationBoundary.boundary)) {
    details.push(`Mutation boundary ${envelope.mutationBoundary.boundary} is not authorized for role ${envelope.role}.`);
  }
  if (envelope.mutationBoundary.memoryWrites !== "none" && !contract.allowMemoryMutation) {
    details.push(`Role ${envelope.role} is not authorized for memory mutation (${envelope.mutationBoundary.memoryWrites}).`);
  }
  if (envelope.mutationBoundary.graphWrites !== "none" && !contract.allowGraphMutation) {
    details.push(`Role ${envelope.role} is not authorized for graph mutation (${envelope.mutationBoundary.graphWrites}).`);
  }
  for (const claim of envelope.graphMutationClaims) {
    const mutates = claim.operation !== "none" && claim.operation !== "read";
    const claimsMutation = claim.status !== "not-requested" || mutates;
    if (claimsMutation && (!contract.allowGraphMutation || envelope.mutationBoundary.graphWrites === "none")) {
      details.push(`Graph mutation claim ${claim.id} is not authorized by ${envelope.role} boundary ${envelope.mutationBoundary.boundary}.`);
    }
    if (claim.status === "unauthorized" || claim.status === "failed") {
      details.push(`Graph mutation claim ${claim.id} reported status ${claim.status}.`);
    }
  }
  return details;
}

function failure(
  envelope: IAMContextEnvelope,
  contract: IAMSubagentRoleContract,
  failureClass: IAMSubagentEnvelopeFailureClass,
  details: string[],
  graphMutationStatus = summarizeGraphMutationStatus(envelope.graphMutationClaims),
): { ok: false; value: IAMSubagentFailureDiagnostic } {
  return {
    ok: false,
    value: emptyDiagnostic({
      role: envelope.role,
      contractId: contract.contractId,
      envelopeId: nonEmpty(envelope.envelopeId) ? envelope.envelopeId : "<missing>",
      parentUnit: nonEmpty(envelope.parentUnit) ? envelope.parentUnit : "<missing>",
      expectedArtifacts: envelope.expectedArtifacts,
      actualArtifacts: envelope.actualArtifacts,
      graphMutationStatus,
      mutationBoundary: envelope.mutationBoundary.boundary,
      failureClass,
      remediation: `${details.join(" ")} ${contract.remediation}`.trim(),
      details,
    }),
  };
}

function summarizeGraphMutationStatus(claims: IAMGraphMutationClaim[]): IAMGraphMutationStatus {
  if (claims.some((claim) => claim.status === "unauthorized" || claim.status === "failed")) return "unauthorized";
  if (claims.some((claim) => claim.status === "requested")) return "unauthorized";
  if (claims.some((claim) => claim.operation !== "none" && claim.operation !== "read" && claim.status !== "not-requested")) return "authorized";
  return "not-requested";
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (!nonEmpty(value)) continue;
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function formatArtifactList(artifacts: Array<IAMArtifactExpectation | IAMExpectedArtifactEvidence>): string {
  if (artifacts.length === 0) return "[]";
  return artifacts
    .map((artifact) => `${artifact.id}:${artifact.kind}:${"required" in artifact ? artifact.boundary : artifact.status}`)
    .join(", ");
}

export function formatIAMSubagentFailureDiagnostic(diagnostic: IAMSubagentFailureDiagnostic): string {
  return [
    "IAM subagent context-envelope validation failed",
    `role: ${diagnostic.role || "<missing>"}`,
    `contractId: ${diagnostic.contractId || "<missing>"}`,
    `envelopeId: ${diagnostic.envelopeId || "<missing>"}`,
    `parentUnit: ${diagnostic.parentUnit || "<missing>"}`,
    `failureClass: ${diagnostic.failureClass}`,
    `mutationBoundary: ${diagnostic.mutationBoundary}`,
    `graphMutationStatus: ${diagnostic.graphMutationStatus}`,
    `expectedArtifacts: ${formatArtifactList(diagnostic.expectedArtifacts)}`,
    `actualArtifacts: ${formatArtifactList(diagnostic.actualArtifacts)}`,
    `missingFields: ${diagnostic.missingFields.length > 0 ? diagnostic.missingFields.join(", ") : "[]"}`,
    `details: ${diagnostic.details.length > 0 ? diagnostic.details.join(" | ") : "[]"}`,
    `remediation: ${diagnostic.remediation}`,
  ].join("\n");
}
