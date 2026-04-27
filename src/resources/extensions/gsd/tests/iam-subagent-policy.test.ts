import test from "node:test";
import assert from "node:assert/strict";

import {
  extractIAMSubagentPromptEntries,
  formatIAMSubagentPolicyBlockReason,
  formatIAMSubagentContractMarker,
  parseIAMSubagentContractMarker,
  validateIAMSubagentPolicy,
} from "../iam-subagent-policy.ts";
import type { SubagentsPolicy } from "../unit-context-manifest.ts";

const GATE_POLICY: SubagentsPolicy = {
  mode: "allowed",
  roles: ["gate-evaluator"],
  requireEnvelope: true,
  maxParallel: 2,
};
const NONE_POLICY: SubagentsPolicy = { mode: "none" };

function markedPrompt(role = "gate-evaluator", envelopeId = "M001-S01-gate-Q3-env"): string {
  return [
    formatIAMSubagentContractMarker(role, envelopeId),
    "Evaluate gate Q3 using the supplied slice plan.",
  ].join("\n");
}

test("IAM subagent marker parser extracts role and envelope id", () => {
  const marker = parseIAMSubagentContractMarker(markedPrompt());
  assert.deepEqual(marker, {
    role: "gate-evaluator",
    envelopeId: "M001-S01-gate-Q3-env",
    malformed: false,
  });
});

test("IAM subagent marker parser reports malformed marker separately from missing marker", () => {
  assert.deepEqual(parseIAMSubagentContractMarker("no marker here"), {
    role: null,
    envelopeId: null,
    malformed: false,
  });
  assert.deepEqual(parseIAMSubagentContractMarker("IAM_SUBAGENT_CONTRACT: role gate-evaluator"), {
    role: null,
    envelopeId: null,
    malformed: true,
  });
});

test("extractIAMSubagentPromptEntries reads task, tasks[], and chain[] prompts", () => {
  const result = extractIAMSubagentPromptEntries({
    task: "single",
    tasks: [{ task: "parallel-a" }, { task: "parallel-b" }],
    chain: [{ task: "chain-a" }],
  });
  assert.ok(result.ok);
  assert.deepEqual(result.entries, [
    { path: "task", prompt: "single" },
    { path: "tasks[0].task", prompt: "parallel-a" },
    { path: "tasks[1].task", prompt: "parallel-b" },
    { path: "chain[0].task", prompt: "chain-a" },
  ]);
});

test("extractIAMSubagentPromptEntries rejects malformed task arrays and non-string prompts", () => {
  const result = extractIAMSubagentPromptEntries({
    tasks: "not-array",
    chain: [{ task: 42 }],
  });
  assert.ok(!result.ok);
  assert.deepEqual(result.violations.map((v) => v.path), ["tasks", "chain[0].task"]);
  assert.equal(result.violations.every((v) => v.markerStatus === "malformed"), true);
});

test("policy validation hard-blocks markerless prompts for governed planning units", () => {
  const result = validateIAMSubagentPolicy({
    toolName: "subagent",
    toolInput: { tasks: [{ task: "Evaluate Q3 without IAM evidence." }] },
    unitType: "gate-evaluate",
    parentUnit: "M001/S01/gates",
    policy: GATE_POLICY,
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.markerStatus, "missing");
  assert.equal(result.violations[0]?.path, "tasks[0].task");

  const reason = formatIAMSubagentPolicyBlockReason(result);
  assert.match(reason, /HARD BLOCK/);
  assert.match(reason, /gate-evaluate/);
  assert.match(reason, /M001\/S01\/gates/);
  assert.match(reason, /Allowed roles: gate-evaluator/);
  assert.match(reason, /missing IAM_SUBAGENT_CONTRACT marker/);
  assert.match(reason, /Remediation:/);
});

test("policy validation rejects undeclared roles and malformed envelope markers", () => {
  const result = validateIAMSubagentPolicy({
    toolName: "subagent",
    toolInput: {
      tasks: [
        { task: markedPrompt("research-scout", "M001-S01-gates-env") },
        { task: "IAM_SUBAGENT_CONTRACT: role=gate-evaluator\nmissing envelope id" },
      ],
    },
    unitType: "gate-evaluate",
    parentUnit: "M001/S01/gates",
    policy: GATE_POLICY,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((v) => v.markerStatus), ["undeclared-role", "malformed"]);
});

test("policy validation rejects envelope ids that are not bound to the parent unit", () => {
  const result = validateIAMSubagentPolicy({
    toolName: "task",
    toolInput: { task: markedPrompt("gate-evaluator", "M999-S99-other-env") },
    unitType: "gate-evaluate",
    parentUnit: "M001/S01/gates",
    policy: GATE_POLICY,
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.markerStatus, "mismatched-envelope");
  assert.match(result.violations[0]?.reason ?? "", /parent unit M001\/S01\/gates/);
});

test("policy validation accepts declared role envelopes without requiring tools.mode all", () => {
  const result = validateIAMSubagentPolicy({
    toolName: "subagent",
    toolInput: {
      tasks: [
        { task: markedPrompt("gate-evaluator", "M001-S01-gates-q3") },
        { task: markedPrompt("gate-evaluator", "M001-S01-gates-q4") },
      ],
    },
    unitType: "gate-evaluate",
    parentUnit: "M001/S01/gates",
    policy: GATE_POLICY,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.accepted.map((entry) => entry.role), ["gate-evaluator", "gate-evaluator"]);
});

test("policy validation enforces maxParallel linearly and reports compact diagnostics", () => {
  const result = validateIAMSubagentPolicy({
    toolName: "subagent",
    toolInput: {
      tasks: [
        { task: markedPrompt("gate-evaluator", "M001-S01-gates-q3") },
        { task: markedPrompt("gate-evaluator", "M001-S01-gates-q4") },
        { task: markedPrompt("gate-evaluator", "M001-S01-gates-q5") },
      ],
    },
    unitType: "gate-evaluate",
    parentUnit: "M001/S01/gates",
    policy: GATE_POLICY,
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.markerStatus, "too-many-parallel");
  assert.match(formatIAMSubagentPolicyBlockReason(result), /exceeds maxParallel 2/);
});

test("policy validation fails closed when subagents are not declared", () => {
  const result = validateIAMSubagentPolicy({
    toolName: "subagent",
    toolInput: { task: markedPrompt("gate-evaluator", "M001-S01-env") },
    unitType: "discuss-milestone",
    parentUnit: "M001",
    policy: NONE_POLICY,
  });
  assert.equal(result.ok, false);
  assert.match(formatIAMSubagentPolicyBlockReason(result), /Policy mode: none/);
});

test("policy validation ignores non-subagent tools", () => {
  const result = validateIAMSubagentPolicy({
    toolName: "read",
    toolInput: { path: "src/index.ts" },
    unitType: "gate-evaluate",
    parentUnit: "M001/S01/gates",
    policy: GATE_POLICY,
  });
  assert.equal(result.ok, true);
  assert.equal(result.promptCount, 0);
});

test("policy diagnostics include observability fields for invalid envelopes", () => {
  const result = validateIAMSubagentPolicy({
    toolName: "subagent",
    toolInput: { tasks: [{ task: "Assess acceptance without an IAM envelope." }] },
    unitType: "validate-milestone",
    parentUnit: "M001",
    policy: { mode: "allowed", roles: ["validation-reviewer"], requireEnvelope: true, maxParallel: 3 },
  });
  assert.equal(result.ok, false);
  const reason = formatIAMSubagentPolicyBlockReason(result);
  assert.match(reason, /validate-milestone/, "names mutation boundary unit type");
  assert.match(reason, /validation-reviewer/, "names expected role");
  assert.match(reason, /M001/, "names parent unit");
  assert.match(reason, /tasks\[0\]\.task/, "names prompt path as audit payload location");
  assert.match(reason, /envelopeId=<missing>/, "names missing envelope id");
  assert.match(reason, /markerless dispatch/, "names marker status in remediation");
  assert.match(reason, /expected artifact/i, "names expected artifact remediation");
  assert.match(reason, /mutation boundary/i, "names mutation boundary remediation");
});
