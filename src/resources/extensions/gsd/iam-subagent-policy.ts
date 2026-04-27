import type {
  IAMContextArtifactKind,
  IAMExpectedArtifactKind,
  IAMSubagentRoleName,
} from "../../../iam/context-envelope.js";
import { getIAMSubagentRoleContract } from "../../../iam/context-envelope.js";
import type { SubagentsPolicy } from "./unit-context-manifest.js";

export interface IAMSubagentPromptMarker {
  readonly role: string | null;
  readonly envelopeId: string | null;
  readonly malformed: boolean;
}

export type IAMSubagentMutationBoundaryLabel =
  | "read-only"
  | "research-artifact-only"
  | "quality-gate-result-only"
  | "task-expected-output-only"
  | "validation-review-only"
  | "validation-artifact-only"
  | "workflow-output-only";

export interface IAMSubagentPromptArtifact {
  readonly id: string;
  readonly kind: IAMExpectedArtifactKind;
  readonly description: string;
  readonly path?: string;
  readonly toolName?: string;
  readonly required?: boolean;
}

export interface IAMSubagentPromptContextReference {
  readonly id: string;
  readonly kind: IAMContextArtifactKind;
  readonly source: string;
  readonly summary: string;
  readonly path?: string;
}

export interface FormatIamSubagentPromptInput {
  readonly role: IAMSubagentRoleName;
  readonly envelopeId: string;
  readonly parentUnit: string;
  readonly objective: string;
  readonly mutationBoundary: IAMSubagentMutationBoundaryLabel;
  readonly expectedArtifacts: readonly IAMSubagentPromptArtifact[];
  readonly provenanceSources: readonly IAMSubagentPromptContextReference[];
  readonly allowedPaths?: readonly string[];
  readonly allowedToolCalls?: readonly string[];
  readonly graphMutation?: "none" | "read-only" | "append-only" | "upsert";
  readonly optionalOmissions?: readonly string[];
  readonly failureDiagnostics?: readonly string[];
  readonly promptBody: string;
}

export interface IAMSubagentInputEntry {
  readonly path: string;
  readonly prompt?: string;
}

export interface IAMSubagentPolicyViolation {
  readonly path: string;
  readonly reason: string;
  readonly role: string | null;
  readonly envelopeId: string | null;
  readonly markerStatus: "missing" | "malformed" | "undeclared-role" | "mismatched-envelope" | "too-many-parallel";
}

export interface IAMSubagentPolicyValidation {
  readonly ok: boolean;
  readonly unitType: string;
  readonly parentUnit: string;
  readonly policyMode: SubagentsPolicy["mode"];
  readonly allowedRoles: readonly string[];
  readonly promptCount: number;
  readonly violations: readonly IAMSubagentPolicyViolation[];
  readonly accepted: ReadonlyArray<{ path: string; role: string; envelopeId: string }>;
}

const SUBAGENT_TOOL_NAMES = new Set(["subagent", "task"]);
const MARKER_RE = /(?:^|\n)\s*IAM_SUBAGENT_CONTRACT\s*:\s*role\s*=\s*([A-Za-z0-9_-]+)\s*;\s*envelopeId\s*=\s*([A-Za-z0-9._:/+-]+)\s*(?:\n|$)/;
const LOOSE_MARKER_RE = /IAM_SUBAGENT_CONTRACT\s*:/;

export function isIAMSubagentTool(toolName: string): boolean {
  return SUBAGENT_TOOL_NAMES.has(toolName);
}

export function formatIAMSubagentContractMarker(role: string, envelopeId: string): string {
  return `IAM_SUBAGENT_CONTRACT: role=${role}; envelopeId=${envelopeId}`;
}

export function formatIamSubagentPrompt(input: FormatIamSubagentPromptInput): string {
  assertKnownRole(input.role);
  assertNonEmpty("envelopeId", input.envelopeId);
  assertNonEmpty("parentUnit", input.parentUnit);
  assertNonEmpty("objective", input.objective);
  assertNonEmpty("mutationBoundary", input.mutationBoundary);
  assertNonEmpty("promptBody", input.promptBody);
  if (input.expectedArtifacts.length === 0) {
    throw new Error("expectedArtifacts must contain at least one artifact");
  }
  if (input.provenanceSources.length === 0) {
    throw new Error("provenanceSources must contain at least one context reference");
  }

  const expectedArtifacts = input.expectedArtifacts.map((artifact) => {
    assertNonEmpty("expectedArtifacts[].id", artifact.id);
    assertNonEmpty(`expectedArtifacts[${artifact.id}].description`, artifact.description);
    return `- \`${artifact.id}\` (\`${artifact.kind}\`) — ${artifact.description}${artifact.path ? ` Path: \`${artifact.path}\`.` : ""}${artifact.toolName ? ` Tool: \`${artifact.toolName}\`.` : ""}${artifact.required === false ? " Required: no." : " Required: yes."}`;
  });
  const provenanceSources = input.provenanceSources.map((source) => {
    assertNonEmpty("provenanceSources[].id", source.id);
    assertNonEmpty(`provenanceSources[${source.id}].source`, source.source);
    assertNonEmpty(`provenanceSources[${source.id}].summary`, source.summary);
    return `- \`${source.id}\` (\`${source.kind}\`) — ${source.source}: ${source.summary}${source.path ? ` Path: \`${source.path}\`.` : ""}`;
  });
  const allowedPaths = input.allowedPaths?.length
    ? input.allowedPaths.map((path) => `- \`${path}\``)
    : ["- (none declared)"];
  const allowedToolCalls = input.allowedToolCalls?.length
    ? input.allowedToolCalls.map((tool) => `- \`${tool}\``)
    : ["- (none declared)"];
  const omissions = input.optionalOmissions?.length
    ? input.optionalOmissions.map((omission) => `- ${omission}`)
    : ["- (none)"];
  const diagnostics = input.failureDiagnostics?.length
    ? input.failureDiagnostics.map((diagnostic) => `- ${diagnostic}`)
    : ["- If you cannot satisfy an expected artifact, return a failure report naming the role, envelope id, parent unit, expected artifact, mutation boundary, and remediation."];
  const graphMutation = input.graphMutation ?? "none";

  return [
    formatIAMSubagentContractMarker(input.role, input.envelopeId),
    "",
    "## IAM Context Envelope",
    `- **Role:** \`${input.role}\``,
    `- **Envelope ID:** \`${input.envelopeId}\``,
    `- **Parent Unit:** \`${input.parentUnit}\``,
    `- **Objective:** ${input.objective}`,
    `- **Mutation Boundary:** \`${input.mutationBoundary}\``,
    `- **Graph Mutation:** \`${graphMutation}\``,
    "",
    "### Expected Artifacts",
    ...expectedArtifacts,
    "",
    "### Provenance Sources",
    ...provenanceSources,
    "",
    "### Allowed Paths",
    ...allowedPaths,
    "",
    "### Allowed Tool Calls",
    ...allowedToolCalls,
    "",
    "## Optional Context Omissions",
    ...omissions,
    "",
    "## Failure Diagnostics",
    ...diagnostics,
    "",
    "## IAM Return Schema",
    "Return a concise audit payload with these fields before any prose summary:",
    "```yaml",
    `role: ${input.role}`,
    `envelopeId: ${input.envelopeId}`,
    `parentUnit: ${input.parentUnit}`,
    "expectedArtifacts:",
    ...input.expectedArtifacts.map((artifact) => `  - id: ${artifact.id}\n    kind: ${artifact.kind}\n    status: present|missing|invalid\n    path: ${artifact.path ?? "<if applicable>"}\n    toolName: ${artifact.toolName ?? "<if applicable>"}`),
    `mutationBoundary: ${input.mutationBoundary}`,
    `graphMutationStatus: ${graphMutation}`,
    "remediation: <required when any expected artifact is missing or invalid>",
    "```",
    "",
    "---",
    "",
    input.promptBody.trim(),
  ].join("\n");
}

export function parseIAMSubagentContractMarker(prompt: string): IAMSubagentPromptMarker {
  const match = prompt.match(MARKER_RE);
  if (match) {
    return { role: match[1] ?? null, envelopeId: match[2] ?? null, malformed: false };
  }
  return {
    role: null,
    envelopeId: null,
    malformed: LOOSE_MARKER_RE.test(prompt),
  };
}

export function extractIAMSubagentPromptEntries(input: unknown): { ok: true; entries: IAMSubagentInputEntry[] } | { ok: false; violations: IAMSubagentPolicyViolation[] } {
  const violations: IAMSubagentPolicyViolation[] = [];
  const entries: IAMSubagentInputEntry[] = [];
  const record = asRecord(input);

  if (typeof record.task === "string") entries.push({ path: "task", prompt: record.task });
  else if (record.task !== undefined) violations.push(malformedInputViolation("task", "task prompt must be a string"));

  if (record.tasks !== undefined) {
    if (!Array.isArray(record.tasks)) {
      violations.push(malformedInputViolation("tasks", "tasks must be an array"));
    } else {
      record.tasks.forEach((item, index) => {
        const itemRecord = asRecord(item);
        if (typeof itemRecord.task === "string") entries.push({ path: `tasks[${index}].task`, prompt: itemRecord.task });
        else violations.push(malformedInputViolation(`tasks[${index}].task`, "parallel task prompt must be a string"));
      });
    }
  }

  if (record.chain !== undefined) {
    if (!Array.isArray(record.chain)) {
      violations.push(malformedInputViolation("chain", "chain must be an array"));
    } else {
      record.chain.forEach((item, index) => {
        const itemRecord = asRecord(item);
        if (typeof itemRecord.task === "string") entries.push({ path: `chain[${index}].task`, prompt: itemRecord.task });
        else violations.push(malformedInputViolation(`chain[${index}].task`, "chain task prompt must be a string"));
      });
    }
  }

  if (entries.length === 0 && violations.length === 0) {
    violations.push(malformedInputViolation("input", "subagent input must include task, tasks[], or chain[] prompt text"));
  }

  return violations.length > 0 ? { ok: false, violations } : { ok: true, entries };
}

export function validateIAMSubagentPolicy(input: {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly unitType: string;
  readonly parentUnit?: string | null;
  readonly policy: SubagentsPolicy | null | undefined;
}): IAMSubagentPolicyValidation {
  const parentUnit = input.parentUnit || "<unknown>";
  const policy = input.policy ?? { mode: "none" as const };
  const allowedRoles = policy.mode === "allowed" ? [...policy.roles] : [];

  if (!isIAMSubagentTool(input.toolName)) {
    return {
      ok: true,
      unitType: input.unitType,
      parentUnit,
      policyMode: policy.mode,
      allowedRoles,
      promptCount: 0,
      violations: [],
      accepted: [],
    };
  }

  const extracted = extractIAMSubagentPromptEntries(input.toolInput);
  const entries = extracted.ok ? extracted.entries : [];
  const violations: IAMSubagentPolicyViolation[] = extracted.ok ? [] : [...extracted.violations];
  const accepted: Array<{ path: string; role: string; envelopeId: string }> = [];

  if (policy.mode !== "allowed") {
    for (const entry of entries.length > 0 ? entries : [{ path: "input", prompt: undefined }]) {
      violations.push({
        path: entry.path,
        reason: `subagent dispatch is not declared for unit type ${input.unitType}`,
        role: null,
        envelopeId: null,
        markerStatus: "missing",
      });
    }
  } else {
    if (policy.maxParallel !== undefined && entries.length > policy.maxParallel) {
      violations.push({
        path: "tasks",
        reason: `subagent dispatch count ${entries.length} exceeds maxParallel ${policy.maxParallel}`,
        role: null,
        envelopeId: null,
        markerStatus: "too-many-parallel",
      });
    }

    for (const entry of entries) {
      const prompt = entry.prompt;
      if (typeof prompt !== "string") continue;
      const marker = parseIAMSubagentContractMarker(prompt);
      if (!marker.role || !marker.envelopeId) {
        violations.push({
          path: entry.path,
          reason: marker.malformed
            ? "IAM_SUBAGENT_CONTRACT marker is malformed; expected: IAM_SUBAGENT_CONTRACT: role=<role>; envelopeId=<id>"
            : "missing IAM_SUBAGENT_CONTRACT marker",
          role: marker.role,
          envelopeId: marker.envelopeId,
          markerStatus: marker.malformed ? "malformed" : "missing",
        });
        continue;
      }
      if (!policy.roles.includes(marker.role as never)) {
        violations.push({
          path: entry.path,
          reason: `role ${marker.role} is not declared for unit type ${input.unitType}`,
          role: marker.role,
          envelopeId: marker.envelopeId,
          markerStatus: "undeclared-role",
        });
        continue;
      }
      if (!envelopeIdMatchesParent(marker.envelopeId, parentUnit)) {
        violations.push({
          path: entry.path,
          reason: `envelope id ${marker.envelopeId} is not bound to parent unit ${parentUnit}`,
          role: marker.role,
          envelopeId: marker.envelopeId,
          markerStatus: "mismatched-envelope",
        });
        continue;
      }
      accepted.push({ path: entry.path, role: marker.role, envelopeId: marker.envelopeId });
    }
  }

  return {
    ok: violations.length === 0,
    unitType: input.unitType,
    parentUnit,
    policyMode: policy.mode,
    allowedRoles,
    promptCount: entries.length,
    violations,
    accepted,
  };
}

export function formatIAMSubagentPolicyBlockReason(validation: IAMSubagentPolicyValidation): string {
  const allowed = validation.allowedRoles.length > 0 ? validation.allowedRoles.join(", ") : "none";
  const compactViolations = validation.violations.slice(0, 8).map((violation) => {
    const role = violation.role ?? "<missing>";
    const envelopeId = violation.envelopeId ?? "<missing>";
    return `${violation.path}: ${violation.markerStatus}; role=${role}; envelopeId=${envelopeId}; ${violation.reason}`;
  });
  const omitted = validation.violations.length > compactViolations.length
    ? `; +${validation.violations.length - compactViolations.length} more invalid prompt(s)`
    : "";

  return [
    `HARD BLOCK: IAM subagent policy rejected dispatch for unit "${validation.unitType}" (${validation.parentUnit}).`,
    `Allowed roles: ${allowed}. Policy mode: ${validation.policyMode}. Prompt count: ${validation.promptCount}.`,
    `Violations: ${compactViolations.join(" | ")}${omitted}.`,
    `Remediation: add a valid IAM_SUBAGENT_CONTRACT marker to each subagent prompt using ` +
      `"IAM_SUBAGENT_CONTRACT: role=<allowed-role>; envelopeId=<parent-unit-bound-id>", ` +
      `then include expected artifact and mutation boundary details in the envelope body; ` +
      `or move markerless dispatch to a unit whose manifest explicitly allows it.`,
  ].join(" ");
}

function malformedInputViolation(path: string, reason: string): IAMSubagentPolicyViolation {
  return {
    path,
    reason,
    role: null,
    envelopeId: null,
    markerStatus: "malformed",
  };
}

function assertKnownRole(role: string): asserts role is IAMSubagentRoleName {
  const contract = getIAMSubagentRoleContract(role);
  if (!contract.ok) {
    throw new Error(contract.error.remediation);
  }
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function envelopeIdMatchesParent(envelopeId: string, parentUnit: string): boolean {
  if (parentUnit === "<unknown>") return true;
  const normalizedParent = parentUnit.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const normalizedEnvelope = envelopeId.toLowerCase();
  const compactParent = normalizedParent.replace(/-/g, "");
  const compactEnvelope = normalizedEnvelope.replace(/[^a-z0-9]+/g, "");
  return normalizedEnvelope === parentUnit.toLowerCase()
    || normalizedEnvelope.startsWith(`${parentUnit.toLowerCase()}:`)
    || normalizedEnvelope.startsWith(`${parentUnit.toLowerCase()}/`)
    || normalizedEnvelope.startsWith(`${normalizedParent}-`)
    || normalizedEnvelope.includes(normalizedParent)
    || (compactParent.length > 0 && compactEnvelope.includes(compactParent));
}
