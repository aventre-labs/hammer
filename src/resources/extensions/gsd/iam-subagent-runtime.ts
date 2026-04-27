import { createHash } from "node:crypto";

import type {
  FailureClass,
  IamSubagentAuditPayload,
  IamSubagentAuditStatus,
} from "./uok/contracts.js";
import { buildAuditEnvelope, emitUokAuditEvent } from "./uok/audit.js";
import {
  extractIAMSubagentPromptEntries,
  isIAMSubagentTool,
  parseIAMSubagentContractMarker,
  type IAMSubagentPolicyValidation,
  type IAMSubagentPolicyViolation,
} from "./iam-subagent-policy.js";
import { getIAMSubagentRoleContract } from "../../../iam/context-envelope.js";
import type {
  IAMContextArtifactKind,
  IAMExpectedArtifactKind,
} from "../../../iam/context-envelope.js";

export interface IamSubagentRuntimeContext {
  readonly basePath: string;
  readonly traceId?: string | null;
  readonly turnId?: string | null;
  readonly toolCallId?: string | null;
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly unitType?: string | null;
  readonly parentUnit?: string | null;
}

interface PromptSummary {
  readonly path: string;
  readonly role: string | null;
  readonly contractId: string;
  readonly envelopeId: string | null;
  readonly parentUnit: string;
  readonly promptHash: string | null;
  readonly promptCharCount: number;
  readonly contextArtifactIds: readonly string[];
  readonly contextArtifactKinds: readonly IAMContextArtifactKind[];
  readonly expectedArtifacts: Readonly<IamSubagentAuditPayload["expectedArtifacts"]>;
  readonly expectedArtifactIds: readonly string[];
  readonly provenanceReadSources: readonly string[];
  readonly mutationBoundary: string;
  readonly graphMutationClaim: string;
  readonly memoryMutationClaim: string;
  readonly markerStatus: IAMSubagentPolicyViolation["markerStatus"] | "present";
}

interface RuntimeRecord {
  readonly context: IamSubagentRuntimeContext;
  readonly dispatchIds: readonly string[];
  readonly summaries: readonly PromptSummary[];
  readonly startedAt: string;
}

const MAX_PROMPT_SUMMARIES = 50;
const MAX_VALUE_LENGTH = 500;
const runtimeByToolCallId = new Map<string, RuntimeRecord>();
const finalizedToolCallIds = new Set<string>();

export function recordIAMSubagentDispatch(context: IamSubagentRuntimeContext): void {
  if (!isIAMSubagentTool(context.toolName)) return;
  if (context.toolCallId) finalizedToolCallIds.delete(context.toolCallId);

  const summaries = summarizeToolInput(context.toolInput, context.parentUnit ?? "<unknown>");
  const payloads = summaries.slice(0, MAX_PROMPT_SUMMARIES).map((summary) => buildPayload({
    context,
    summary,
    status: "dispatched",
    failureClass: "none",
  }));

  for (const payload of payloads) {
    emitIamSubagentAuditEvent(context, "iam-subagent-dispatch", payload);
  }

  if (context.toolCallId) {
    runtimeByToolCallId.set(context.toolCallId, {
      context,
      dispatchIds: payloads.map((payload) => payload.dispatchId),
      summaries,
      startedAt: new Date().toISOString(),
    });
  }
}

export function recordIAMSubagentPolicyBlock(args: {
  readonly context: IamSubagentRuntimeContext;
  readonly validation: IAMSubagentPolicyValidation;
  readonly reason: string;
}): void {
  if (!isIAMSubagentTool(args.context.toolName)) return;

  const summaries = summarizeToolInput(args.context.toolInput, args.validation.parentUnit);
  const summariesByPath = new Map(summaries.map((summary) => [summary.path, summary]));

  for (const violation of args.validation.violations) {
    const summary = summariesByPath.get(violation.path) ?? summaryFromViolation(violation, args.validation.parentUnit);
    const payload = buildPayload({
      context: args.context,
      summary: {
        ...summary,
        role: violation.role ?? summary.role,
        envelopeId: violation.envelopeId ?? summary.envelopeId,
        markerStatus: violation.markerStatus,
      },
      status: "policy-blocked",
      failureClass: "policy",
      blockReason: args.reason,
      remediation: remediationForPolicyBlock(args.reason),
      violation,
    });
    emitIamSubagentAuditEvent(args.context, "iam-subagent-policy-block", payload);
  }

  if (contextHasToolCallId(args.context)) {
    runtimeByToolCallId.delete(args.context.toolCallId);
    finalizedToolCallIds.add(args.context.toolCallId);
  }
}

export function recordIAMSubagentToolResult(context: IamSubagentRuntimeContext & {
  readonly isError?: boolean;
  readonly result?: unknown;
  readonly details?: unknown;
}): void {
  if (!isIAMSubagentTool(context.toolName)) return;
  if (context.toolCallId && finalizedToolCallIds.has(context.toolCallId)) return;

  const runtime = context.toolCallId ? runtimeByToolCallId.get(context.toolCallId) : undefined;
  const summaries = runtime?.summaries.length
    ? runtime.summaries
    : summarizeToolInput(context.toolInput, context.parentUnit ?? "<unknown>");
  const failureClass = classifyResultFailure(context);
  const status: IamSubagentAuditStatus = context.isError ? "failed" : "completed";
  const eventType = context.isError ? "iam-subagent-failed" : "iam-subagent-complete";

  for (const summary of summaries.slice(0, MAX_PROMPT_SUMMARIES)) {
    const payload = buildPayload({
      context,
      summary,
      status,
      failureClass,
      resultStatus: summarizeResult(context.result ?? context.details, context.isError === true),
      startedAt: runtime?.startedAt,
    });
    emitIamSubagentAuditEvent(context, eventType, payload);
  }

  if (context.toolCallId) {
    runtimeByToolCallId.delete(context.toolCallId);
    finalizedToolCallIds.add(context.toolCallId);
  }
}

export function clearIAMSubagentRuntimeForTest(): void {
  runtimeByToolCallId.clear();
  finalizedToolCallIds.clear();
}

function buildPayload(args: {
  readonly context: IamSubagentRuntimeContext;
  readonly summary: PromptSummary;
  readonly status: IamSubagentAuditStatus;
  readonly failureClass: FailureClass;
  readonly blockReason?: string;
  readonly remediation?: string;
  readonly violation?: IAMSubagentPolicyViolation;
  readonly resultStatus?: IamSubagentAuditPayload["actualArtifactStatus"];
  readonly startedAt?: string;
}): IamSubagentAuditPayload {
  const expectedArtifacts = args.summary.expectedArtifacts.length > 0
    ? args.summary.expectedArtifacts
    : [{
        id: "<missing>",
        kind: "diagnostic" as IAMExpectedArtifactKind,
        required: true,
      }];

  return jsonSafeRecord({
    dispatchId: stableDispatchId(args.context, args.summary),
    toolCallId: args.context.toolCallId ?? "<unknown>",
    toolName: args.context.toolName,
    status: args.status,
    role: args.summary.role ?? "<missing>",
    contractId: args.summary.contractId,
    envelopeId: args.summary.envelopeId ?? "<missing>",
    parentUnit: args.summary.parentUnit,
    unitType: args.context.unitType ?? "<unknown>",
    promptPath: args.summary.path,
    markerStatus: args.summary.markerStatus,
    promptHash: args.summary.promptHash,
    promptCharCount: args.summary.promptCharCount,
    contextArtifactIds: args.summary.contextArtifactIds,
    contextArtifactKinds: args.summary.contextArtifactKinds,
    expectedArtifactIds: expectedArtifacts.map((artifact) => artifact.id),
    expectedArtifacts,
    actualArtifactStatus: args.resultStatus ?? {
      status: args.status === "completed" ? "unknown" : args.status === "failed" ? "failed" : "not-observed",
      toolResultShape: "not-observed",
    },
    provenanceReadSources: args.summary.provenanceReadSources,
    graphMutationClaim: args.summary.graphMutationClaim,
    memoryMutationClaim: args.summary.memoryMutationClaim,
    mutationBoundary: args.summary.mutationBoundary,
    failureClass: args.failureClass,
    blockReason: args.blockReason,
    remediation: args.remediation ?? defaultRemediation(args.summary, args.status),
    startedAt: args.startedAt,
    observedAt: new Date().toISOString(),
    violation: args.violation ? {
      path: args.violation.path,
      reason: args.violation.reason,
      markerStatus: args.violation.markerStatus,
      role: args.violation.role ?? "<missing>",
      envelopeId: args.violation.envelopeId ?? "<missing>",
    } : undefined,
  }) as unknown as IamSubagentAuditPayload;
}

function emitIamSubagentAuditEvent(
  context: IamSubagentRuntimeContext,
  type: "iam-subagent-dispatch" | "iam-subagent-policy-block" | "iam-subagent-complete" | "iam-subagent-failed",
  payload: IamSubagentAuditPayload,
): void {
  try {
    emitUokAuditEvent(
      context.basePath,
      buildAuditEnvelope({
        traceId: context.traceId ?? `iam-subagent:${payload.parentUnit}`,
        turnId: context.turnId ?? undefined,
        causedBy: context.toolCallId ?? undefined,
        category: "execution",
        type,
        payload: payload as unknown as Record<string, unknown>,
      }),
    );
  } catch {
    // Best-effort observability: audit emission must never block subagent execution.
  }
}

function summarizeToolInput(toolInput: unknown, fallbackParentUnit: string): PromptSummary[] {
  const extracted = extractIAMSubagentPromptEntries(toolInput);
  if (!extracted.ok) {
    return extracted.violations.map((violation) => summaryFromViolation(violation, fallbackParentUnit));
  }
  return extracted.entries.map((entry) => summarizePrompt(entry.path, entry.prompt ?? "", fallbackParentUnit));
}

function summarizePrompt(path: string, prompt: string, fallbackParentUnit: string): PromptSummary {
  const marker = parseIAMSubagentContractMarker(prompt);
  const role = marker.role;
  const contract = role ? getIAMSubagentRoleContract(role) : null;
  const envelopeId = marker.envelopeId;
  const envelopeSection = sectionBetween(prompt, "## IAM Context Envelope", "### Expected Artifacts");
  const expectedSection = sectionBetween(prompt, "### Expected Artifacts", "### Provenance Sources");
  const provenanceSection = sectionBetween(prompt, "### Provenance Sources", "### Allowed Paths");

  const expectedArtifacts = parseExpectedArtifacts(expectedSection);
  const contextArtifacts = parseContextArtifacts(provenanceSection);
  const mutationBoundary = matchField(envelopeSection, /- \*\*Mutation Boundary:\*\* `([^`]+)`/) ?? "<missing>";
  const graphMutation = matchField(envelopeSection, /- \*\*Graph Mutation:\*\* `([^`]+)`/) ?? "unknown";

  return {
    path,
    role,
    contractId: contract?.ok ? contract.value.contractId : "<unknown>",
    envelopeId,
    parentUnit: matchField(envelopeSection, /- \*\*Parent Unit:\*\* `([^`]+)`/) ?? fallbackParentUnit,
    promptHash: prompt ? createHash("sha256").update(prompt).digest("hex") : null,
    promptCharCount: prompt.length,
    contextArtifactIds: contextArtifacts.map((artifact) => artifact.id),
    contextArtifactKinds: unique(contextArtifacts.map((artifact) => artifact.kind)),
    expectedArtifacts,
    expectedArtifactIds: expectedArtifacts.map((artifact) => artifact.id),
    provenanceReadSources: contextArtifacts.map((artifact) => artifact.source).filter(Boolean),
    mutationBoundary,
    graphMutationClaim: graphMutation,
    memoryMutationClaim: mutationBoundary === "read-only" || graphMutation === "read-only" || graphMutation === "none" ? "none" : "unknown",
    markerStatus: marker.role && marker.envelopeId ? "present" : marker.malformed ? "malformed" : "missing",
  };
}

function parseExpectedArtifacts(section: string): IamSubagentAuditPayload["expectedArtifacts"] {
  const artifacts: Array<{ id: string; kind: IAMExpectedArtifactKind; path?: string; toolName?: string; required?: boolean }> = [];
  const re = /^- `([^`]+)` \(`([^`]+)`\)([^\n]*)$/gm;
  for (const match of section.matchAll(re)) {
    const tail = match[3] ?? "";
    artifacts.push({
      id: match[1] ?? "<missing>",
      kind: (match[2] ?? "diagnostic") as IAMExpectedArtifactKind,
      path: matchField(tail, /Path: `([^`]+)`/),
      toolName: matchField(tail, /Tool: `([^`]+)`/),
      required: !/Required:\s*no\./i.test(tail),
    });
  }
  return artifacts;
}

function parseContextArtifacts(section: string): Array<{ id: string; kind: IAMContextArtifactKind; source: string }> {
  const artifacts: Array<{ id: string; kind: IAMContextArtifactKind; source: string }> = [];
  const re = /^- `([^`]+)` \(`([^`]+)`\) — ([^:\n]+):/gm;
  for (const match of section.matchAll(re)) {
    artifacts.push({
      id: match[1] ?? "<missing>",
      kind: (match[2] ?? "uok-audit") as IAMContextArtifactKind,
      source: match[3] ?? "<missing>",
    });
  }
  return artifacts;
}

function sectionBetween(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  if (startIndex === -1) return "";
  const bodyStart = startIndex + start.length;
  const endIndex = text.indexOf(end, bodyStart);
  return text.slice(bodyStart, endIndex === -1 ? undefined : endIndex);
}

function matchField(text: string, re: RegExp): string | undefined {
  return text.match(re)?.[1];
}

function summaryFromViolation(violation: IAMSubagentPolicyViolation, fallbackParentUnit: string): PromptSummary {
  const contract = violation.role ? getIAMSubagentRoleContract(violation.role) : null;
  return {
    path: violation.path,
    role: violation.role,
    contractId: contract?.ok ? contract.value.contractId : "<unknown>",
    envelopeId: violation.envelopeId,
    parentUnit: fallbackParentUnit,
    promptHash: null,
    promptCharCount: 0,
    contextArtifactIds: [],
    contextArtifactKinds: [],
    expectedArtifacts: [{ id: "<missing>", kind: "diagnostic", required: true }],
    expectedArtifactIds: ["<missing>"],
    provenanceReadSources: [],
    mutationBoundary: "<missing>",
    graphMutationClaim: "unknown",
    memoryMutationClaim: "unknown",
    markerStatus: violation.markerStatus,
  };
}

function summarizeResult(result: unknown, isError: boolean): IamSubagentAuditPayload["actualArtifactStatus"] {
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const content = Array.isArray(record.content) ? record.content : [];
  const text = content
    .map((item) => item && typeof item === "object" && "text" in item ? String((item as Record<string, unknown>).text ?? "") : "")
    .join("\n");
  return {
    status: isError ? "failed" : inferArtifactStatus(text),
    toolResultShape: Array.isArray(record.content) ? "content-array" : typeof result,
    resultHash: createHash("sha256").update(jsonStableStringify(jsonSafe(result))).digest("hex"),
    errorMessage: isError ? redactAndTruncate(text || String(result ?? "")) : undefined,
  };
}

function inferArtifactStatus(text: string): string {
  if (/status:\s*(missing|invalid|failed)/i.test(text)) return "missing-or-invalid";
  if (/status:\s*present/i.test(text)) return "present";
  return "unknown";
}

function classifyResultFailure(context: { readonly isError?: boolean; readonly result?: unknown; readonly details?: unknown }): FailureClass {
  if (!context.isError) return "none";
  const text = JSON.stringify(jsonSafe(context.result ?? context.details)).toLowerCase();
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (text.includes("policy") || text.includes("hard block")) return "policy";
  return "execution";
}

function stableDispatchId(context: IamSubagentRuntimeContext, summary: PromptSummary): string {
  return createHash("sha256")
    .update(JSON.stringify({
      toolCallId: context.toolCallId ?? "",
      toolName: context.toolName,
      path: summary.path,
      role: summary.role,
      envelopeId: summary.envelopeId,
      parentUnit: summary.parentUnit,
      promptHash: summary.promptHash,
    }))
    .digest("hex")
    .slice(0, 16);
}

function remediationForPolicyBlock(reason: string): string {
  const match = reason.match(/Remediation:\s*(.*)$/i);
  return match?.[1]?.trim() || "Provide a valid IAM subagent envelope before dispatch.";
}

function defaultRemediation(summary: PromptSummary, status: IamSubagentAuditStatus): string {
  if (status === "dispatched") return "Await subagent completion or failure event for actual artifact status.";
  if (status === "completed") return "Inspect subagent return schema and expected artifact status if downstream validation fails.";
  return `Inspect role ${summary.role ?? "<missing>"}, envelope ${summary.envelopeId ?? "<missing>"}, expected artifacts ${summary.expectedArtifactIds.join(", ") || "<missing>"}, and mutation boundary ${summary.mutationBoundary}.`;
}

function jsonSafeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const safe = jsonSafe(record);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? safe as Record<string, unknown> : {};
}

function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactAndTruncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Error) return { name: value.name, message: redactAndTruncate(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => jsonSafe(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      if (isSensitiveKey(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = jsonSafe(child, seen);
      }
    }
    seen.delete(value);
    return out;
  }
  return String(value);
}

function redactAndTruncate(value: string): string {
  const redacted = value
    .replace(/sk-[A-Za-z0-9][A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/(?:api[_-]?key|token|secret|password|credential|auth)[_-]?\w*\s*[:=]\s*['\"]?[^\s'\"]{8,}/gi, (match) => {
      const idx = Math.max(match.indexOf("="), match.indexOf(":"));
      return `${match.slice(0, idx + 1)}[REDACTED]`;
    });
  return redacted.length > MAX_VALUE_LENGTH ? `${redacted.slice(0, MAX_VALUE_LENGTH)}…[truncated]` : redacted;
}

function isSensitiveKey(key: string): boolean {
  return /(?:api[_-]?key|token|secret|password|credential|auth)/i.test(key);
}

function jsonStableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      return Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)));
    }
    return child;
  });
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function contextHasToolCallId(context: IamSubagentRuntimeContext): context is IamSubagentRuntimeContext & { toolCallId: string } {
  return typeof context.toolCallId === "string" && context.toolCallId.length > 0;
}
