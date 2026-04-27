import type { SubagentsPolicy } from "./unit-context-manifest.js";

export interface IAMSubagentPromptMarker {
  readonly role: string | null;
  readonly envelopeId: string | null;
  readonly malformed: boolean;
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
