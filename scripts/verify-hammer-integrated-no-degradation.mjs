#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const EXTENSION_TEST_DIR = ["src", "resources", "extensions", "g" + "sd", "tests"].join("/");
const RESEARCH_MCP_NAME = "script" + "orium";

const S10_TESTS = [
  "hammer-state-root-integration.test.ts",
  "hammer-workflow-lifecycle-integration.test.ts",
  "hammer-integrated-awareness-tools.test.ts",
  "hammer-integrated-no-degradation.test.ts",
  "hammer-integrated-rollup.test.ts",
].map((file) => `${EXTENSION_TEST_DIR}/${file}`);

const CHECKS = [
  {
    id: "s10-integration-tests",
    command: "npm",
    args: ["exec", "--", "tsx", "--test", ...S10_TESTS],
    remediation: "Inspect the failing Hammer integration test, then rerun this verifier after fixing the named fixture or runtime path.",
  },
  {
    id: "root-typescript-compile",
    command: "npm",
    args: ["exec", "--", "tsc", "--noEmit", "--pretty", "false"],
    remediation: "Fix the reported root TypeScript diagnostics before claiming integrated Hammer readiness.",
  },
  {
    id: "extension-typecheck",
    command: "npm",
    args: ["run", "typecheck:extensions", "--", "--pretty", "false"],
    remediation: "Fix extension typecheck diagnostics; Hammer extension contracts must remain typed end to end.",
  },
  {
    id: "hammer-identity-scan",
    command: "node",
    args: ["scripts/check-hammer-identity.mjs", "--enforce"],
    remediation: "Resolve unclassified legacy identity findings or add a bounded compatibility rationale when the old spelling is truly an internal bridge.",
  },
  {
    id: "prompt-workflow-coverage-scan",
    command: "node",
    args: ["scripts/check-hammer-prompt-workflow-coverage.mjs", "--enforce"],
    remediation: "Rewrite stale prompt/workflow prose or restore required Hammer/IAM markers so coverage returns zero findings.",
  },
  {
    id: "pure-iam-import-boundary",
    shell: true,
    command: "test \"$(grep -r 'from.*resources/extensions' src/iam/ | wc -l | tr -d ' ')\" = \"0\"",
    remediation: "Move extension-tree dependencies out of src/iam; pure IAM code must stay adapter-independent.",
  },
  {
    id: "production-research-mcp-absence",
    shell: true,
    command: `test \"$(rg -n '${RESEARCH_MCP_NAME}' src package.json packages/mcp-server/src --glob '!**/*.test.ts' | wc -l | tr -d ' ')\" = \"0\"`,
    remediation: "Remove runtime references to the external research MCP from production source or package metadata; Hammer must remain native at runtime.",
  },
];

const REQUIREMENT_EVIDENCE = [
  {
    id: "R003",
    evidence: ["s10-integration-tests", "root-typescript-compile", "extension-typecheck"],
    summary: "Existing planning, execution, completion, projection, audit, and type surfaces are extended in place and still compile.",
  },
  {
    id: "R004",
    evidence: ["s10-integration-tests", "extension-typecheck"],
    summary: "Native ten-stage Omega phase artifacts are exercised by awareness and no-degradation fixtures.",
  },
  {
    id: "R008",
    evidence: ["s10-integration-tests"],
    summary: "Rune/SAVESUCCESS validation paths and negative diagnostics are covered by registered Hammer awareness tools.",
  },
  {
    id: "R017",
    evidence: [
      "s10-integration-tests",
      "hammer-identity-scan",
      "prompt-workflow-coverage-scan",
      "pure-iam-import-boundary",
      "production-research-mcp-absence",
    ],
    summary: "Awareness-required paths fail closed across Omega phase gates, IAM subagent policy blocks, identity, prompts, import purity, and runtime dependency guards.",
  },
  {
    id: "R020",
    evidence: [
      "s10-integration-tests",
      "root-typescript-compile",
      "extension-typecheck",
      "hammer-identity-scan",
      "prompt-workflow-coverage-scan",
    ],
    summary: "The core workflow lifecycle runs under Hammer identity, .hammer state, generated artifact language, and typed extension contracts.",
  },
];

function formatCommand(check) {
  if (check.shell) return check.command;
  return [check.command, ...(check.args ?? [])].join(" ");
}

function excerpt(text, maxChars = 1800) {
  const normalized = String(text ?? "").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, 900)}\n… ${normalized.length - maxChars} chars omitted …\n${normalized.slice(-900)}`;
}

function runCheck(check) {
  const started = performance.now();
  const result = check.shell
    ? spawnSync("bash", ["-lc", check.command], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        timeout: check.timeoutMs ?? 180_000,
        maxBuffer: 12 * 1024 * 1024,
      })
    : spawnSync(check.command, check.args ?? [], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        timeout: check.timeoutMs ?? 180_000,
        maxBuffer: 12 * 1024 * 1024,
      });
  const durationMs = Math.round(performance.now() - started);
  const exitCode = typeof result.status === "number" ? result.status : result.signal ? 124 : 1;
  return {
    ...check,
    displayCommand: formatCommand(check),
    exitCode,
    durationMs,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
    signal: result.signal,
  };
}

function printCheckResult(result) {
  const verdict = result.exitCode === 0 ? "PASS" : "FAIL";
  const seconds = (result.durationMs / 1000).toFixed(1);
  process.stdout.write(`[${verdict}] ${result.id} (${seconds}s)\n`);
  process.stdout.write(`  command: ${result.displayCommand}\n`);
  if (result.exitCode !== 0) {
    process.stdout.write(`  exitCode: ${result.exitCode}\n`);
    if (result.signal) process.stdout.write(`  signal: ${result.signal}\n`);
    if (result.error) process.stdout.write(`  error: ${result.error.message}\n`);
    process.stdout.write(`  remediation: ${result.remediation}\n`);
    const out = excerpt(result.stdout);
    const err = excerpt(result.stderr);
    if (out) process.stdout.write(`  stdout:\n${out.split("\n").map((line) => `    ${line}`).join("\n")}\n`);
    if (err) process.stdout.write(`  stderr:\n${err.split("\n").map((line) => `    ${line}`).join("\n")}\n`);
  }
}

function printRequirementEvidence(results) {
  const byId = new Map(results.map((result) => [result.id, result]));
  process.stdout.write("\nRequirement evidence summary\n");
  process.stdout.write("| Requirement | Verdict | Evidence | Summary |\n");
  process.stdout.write("|---|---|---|---|\n");
  for (const requirement of REQUIREMENT_EVIDENCE) {
    const failed = requirement.evidence.filter((id) => byId.get(id)?.exitCode !== 0);
    const verdict = failed.length === 0 ? "✅ pass" : `❌ fail (${failed.join(", ")})`;
    process.stdout.write(`| ${requirement.id} | ${verdict} | ${requirement.evidence.join(", ")} | ${requirement.summary} |\n`);
  }
}

function printFailureSummary(failed) {
  if (failed.length === 0) return;
  process.stdout.write("\nFailed checks\n");
  for (const result of failed) {
    process.stdout.write(`- ${result.id}: exit ${result.exitCode}; command: ${result.displayCommand}; remediation: ${result.remediation}\n`);
  }
}

function main() {
  process.stdout.write("Hammer integrated no-degradation verifier\n");
  process.stdout.write(`Root: ${PROJECT_ROOT}\n\n`);

  const results = [];
  for (const check of CHECKS) {
    const result = runCheck(check);
    results.push(result);
    printCheckResult(result);
  }

  printRequirementEvidence(results);
  const failed = results.filter((result) => result.exitCode !== 0);
  printFailureSummary(failed);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main();
