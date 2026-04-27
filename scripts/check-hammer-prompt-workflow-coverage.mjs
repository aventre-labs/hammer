#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");

export const FINDING_KINDS = {
  STALE_LEGACY_TOKEN: "stale-legacy-token",
  MISSING_HAMMER_MARKER: "missing-hammer-marker",
  MISSING_AWARENESS_MARKER: "missing-awareness-marker",
  UNGOVERNED_SUBAGENT: "ungoverned-subagent",
  CUSTOM_STEP_POLICY: "custom-step-policy",
};

export const INVENTORY_ERROR_KIND = "inventory-error";

const TARGET_EXACT_FILES = new Set([
  "src/resources/GSD-WORKFLOW.md",
  "src/resources/extensions/gsd/commands-workflow-templates.ts",
  "src/resources/extensions/gsd/workflow-templates.ts",
  "src/resources/extensions/gsd/workflow-dispatch.ts",
  "src/resources/extensions/gsd/custom-workflow-engine.ts",
  "src/resources/extensions/gsd/unit-context-manifest.ts",
  "src/resources/extensions/gsd/iam-subagent-policy.ts",
]);

export const TARGET_SURFACE_RULES = [
  {
    id: "core-prompts",
    scope: "scan",
    description: "Core bundled prompt markdown files owned by S08.",
    pathPattern: String.raw`^src/resources/extensions/gsd/prompts/[^/]+\.md$`,
  },
  {
    id: "core-workflow-resource",
    scope: "scan",
    description: "Bundled workflow protocol resource kept at a legacy path while its visible prose is S08-owned.",
    pathPattern: String.raw`^src/resources/GSD-WORKFLOW\.md$`,
  },
  {
    id: "workflow-templates",
    scope: "scan",
    description: "Bundled workflow template corpus owned by S08.",
    pathPattern: String.raw`^src/resources/extensions/gsd/workflow-templates/.+\.(?:md|ya?ml|json)$`,
  },
  {
    id: "workflow-surface-source",
    scope: "scan",
    description: "Workflow command, dispatch, manifest, and IAM policy source surfaces owned by S08.",
    pathPattern: String.raw`^src/resources/extensions/gsd/(?:commands-workflow-templates|workflow-templates|workflow-dispatch|custom-workflow-engine|unit-context-manifest|iam-subagent-policy)\.ts$`,
  },
  {
    id: "s09-generated-artifact-templates",
    scope: "scan",
    description: "Generated artifact template markdown surfaces owned by S09.",
    pathPattern: String.raw`^src/resources/extensions/gsd/templates/.+\.md$`,
  },
  {
    id: "s09-extension-doc-surfaces",
    scope: "scan",
    description: "Extension-local docs and generated doc/template markdown surfaces owned by S09.",
    pathPattern: String.raw`^src/resources/extensions/gsd/(?:docs|generated-docs|generated-templates)/.+\.md$`,
  },
  {
    id: "s09-gsd-orchestrator-docs",
    scope: "scan",
    description: "gsd-orchestrator markdown and SKILL surfaces owned by S09.",
    pathPattern: String.raw`^gsd-orchestrator/.+\.md$`,
  },
];

export const S09_ALLOWLIST_RULES = [];

const BINARY_EXTENSION_RE = /\.(?:avif|bmp|class|dll|dylib|eot|gif|gz|ico|jar|jpeg|jpg|mov|mp3|mp4|otf|pdf|png|pyc|so|sqlite|sqlite3|tgz|ttf|webm|webp|woff|woff2|zip)$/i;

export const LEGACY_VISIBLE_TOKEN_PATTERN = String.raw`(?:GSD-WORKFLOW|Get Shit Done|\/gsd\b|\.gsd(?:\/[A-Za-z0-9_.\/-]*)?|(?<!@)\bgsd\/[A-Za-z0-9_.\/-]+|\bgsd_[A-Za-z0-9_]+\b|\bGSD\b)`;
export const LEGACY_VISIBLE_TOKEN_RE = new RegExp(LEGACY_VISIBLE_TOKEN_PATTERN, "g");

const HAMMER_MARKER_RE = /(?:\bHammer\b|\/hammer\b|\.hammer\b|\bhammer\/[A-Za-z0-9_.\/-]*)/i;
const AWARENESS_MARKER_RE = /(?:\bIAM\b|\bawareness\b|\bOmega\b|\bTrinity\b|\bVOLVOX\b|\bno[- ]degradation\b)/i;
const SUBAGENT_PROSE_RE = /\bsubagents?\b/i;
const SUBAGENT_GOVERNANCE_RE = /(?:\{\{subagentPrompts\}\}|IAM_SUBAGENT_CONTRACT)/;

const LEGACY_BRIDGE_CONTEXT_RE = /(?:legacy|compat(?:ible|ibility)?|backward[- ]compatible|deprecated|historical|migration|migrate|bootstrap|fallback|bridge|state[- ](?:namespace|path|root|dir)|state\s+bridge|DB-backed|database-backed|execution substrate|tool[- ]?(?:name|schema|call|surface|contract)|available tool|internal|private|file path|artifact path|stop before|before `gsd_)/i;
const GSD_TOOL_TOKEN_RE = /\bgsd_[A-Za-z0-9_]+\b/;
const GSD_STATE_TOKEN_RE = /(?:\.gsd|GSD-WORKFLOW)/;

export function normalizePath(filePath) {
  return String(filePath ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function unique(values) {
  return [...new Set(values)];
}

function compileRule(rule) {
  return { ...rule, pathRe: new RegExp(rule.pathPattern, "u") };
}

export function validatePathRules(rules, { allowedScopes = new Set(["scan", "allowlist"]) } = {}) {
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") {
      throw new Error("Malformed prompt/workflow coverage rule: expected object");
    }
    if (typeof rule.id !== "string" || rule.id.trim().length === 0) {
      throw new Error("Malformed prompt/workflow coverage rule: id is required");
    }
    if (!allowedScopes.has(rule.scope)) {
      throw new Error(`Malformed prompt/workflow coverage rule "${rule.id}": unknown scope "${String(rule.scope)}"`);
    }
    if (typeof rule.pathPattern !== "string" || rule.pathPattern.trim().length === 0) {
      throw new Error(`Malformed prompt/workflow coverage rule "${rule.id}": pathPattern is required`);
    }
    // Compile now so malformed regexes fail before enforcement can pass.
    new RegExp(rule.pathPattern, "u");
  }
}

validatePathRules([...TARGET_SURFACE_RULES, ...S09_ALLOWLIST_RULES]);
const COMPILED_TARGET_RULES = TARGET_SURFACE_RULES.map(compileRule);
const COMPILED_ALLOWLIST_RULES = S09_ALLOWLIST_RULES.map(compileRule);

export class InventoryError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "InventoryError";
    this.kind = INVENTORY_ERROR_KIND;
    this.remediation = "Run this scanner inside a git checkout so `git ls-files` can enumerate tracked prompt/workflow surfaces.";
    this.cause = cause;
  }
}

export function shouldScanSurfacePath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized || normalized.includes("\0")) return false;
  if (BINARY_EXTENSION_RE.test(normalized)) return false;
  if (TARGET_EXACT_FILES.has(normalized)) return true;
  return COMPILED_TARGET_RULES.some((rule) => rule.pathRe.test(normalized));
}

export function findAllowlistRule(filePath, rules = COMPILED_ALLOWLIST_RULES) {
  const normalized = normalizePath(filePath);
  return rules.find((rule) => rule.pathRe.test(normalized)) ?? null;
}

export function getTrackedFiles(root = process.cwd()) {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output.toString("utf8").split("\0").filter(Boolean).map(normalizePath).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    throw new InventoryError("Unable to enumerate git-tracked files for prompt/workflow coverage.", error);
  }
}

export function collectPromptWorkflowInventory(trackedFiles) {
  const scannedFiles = [];
  const allowlistedFiles = [];
  let skippedBinaryCount = 0;
  let skippedNonSurfaceCount = 0;

  for (const rawPath of trackedFiles.map(normalizePath).sort((a, b) => a.localeCompare(b))) {
    if (!rawPath || rawPath.includes("\0")) {
      skippedNonSurfaceCount += 1;
      continue;
    }
    if (BINARY_EXTENSION_RE.test(rawPath)) {
      skippedBinaryCount += 1;
      continue;
    }
    if (shouldScanSurfacePath(rawPath)) {
      scannedFiles.push(rawPath);
      continue;
    }
    const allowlistRule = findAllowlistRule(rawPath);
    if (allowlistRule) {
      allowlistedFiles.push({
        filePath: rawPath,
        ruleId: allowlistRule.id,
        reason: allowlistRule.description,
      });
      continue;
    }
    skippedNonSurfaceCount += 1;
  }

  return {
    scannedFiles,
    allowlistedFiles,
    skippedBinaryCount,
    skippedNonSurfaceCount,
  };
}

function redactLine(line) {
  const compact = String(line ?? "").replace(/\s+/g, " ").trim();
  const redacted = compact
    .replace(/(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, (match) => `${match.slice(0, 6)}…`)
    .replace(/([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)[^\s,;]+/g, "$1<redacted>");
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}

function makeFinding({ kind, filePath, lineNumber = 1, column = 1, terms = [], line = "", remediation }) {
  return {
    kind,
    filePath: normalizePath(filePath),
    lineNumber,
    column,
    terms: unique(terms),
    excerpt: redactLine(line),
    remediation,
  };
}

export function isAllowedLegacyBridgeLine(line) {
  LEGACY_VISIBLE_TOKEN_RE.lastIndex = 0;
  if (!LEGACY_VISIBLE_TOKEN_RE.test(line)) return true;

  const hasBridgeContext = LEGACY_BRIDGE_CONTEXT_RE.test(line);
  if (!hasBridgeContext) return false;

  // gsd_* names are executable substrate/tool names only when locally marked
  // as DB-backed, tool, legacy, or compatibility bridges.
  if (GSD_TOOL_TOKEN_RE.test(line)) {
    return /(?:DB-backed|database-backed|tool[- ]?(?:name|schema|call|surface|contract)|available tool|execution substrate|legacy|compat|stop before)/i.test(line);
  }

  // .gsd and GSD-WORKFLOW pass only when the line says this is state/path or
  // legacy compatibility, not current product prose.
  if (GSD_STATE_TOKEN_RE.test(line)) {
    return /(?:\.hammer|state[- ]?(?:namespace|path|root|dir)|state\s+bridge|legacy|compat|migration|migrate|fallback|bootstrap|file path|artifact path|private|internal)/i.test(line);
  }

  return true;
}

function scanLegacyTokens(filePath, lines) {
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    LEGACY_VISIBLE_TOKEN_RE.lastIndex = 0;
    const matches = [...line.matchAll(LEGACY_VISIBLE_TOKEN_RE)];
    if (matches.length === 0) continue;
    if (isAllowedLegacyBridgeLine(line)) continue;
    findings.push(makeFinding({
      kind: FINDING_KINDS.STALE_LEGACY_TOKEN,
      filePath,
      lineNumber: index + 1,
      column: (matches[0]?.index ?? 0) + 1,
      line,
      terms: matches.map((match) => match[0]),
      remediation: "Rewrite visible product/workflow prose to Hammer (`/hammer`, `.hammer`, `hammer/`) or add a local legacy/tool/state compatibility bridge rationale when the old spelling is still required.",
    }));
  }
  return findings;
}

function scanSubagentGovernance(filePath, text, lines) {
  if (!SUBAGENT_PROSE_RE.test(text) || SUBAGENT_GOVERNANCE_RE.test(text)) return [];
  const lineIndex = lines.findIndex((line) => SUBAGENT_PROSE_RE.test(line));
  return [makeFinding({
    kind: FINDING_KINDS.UNGOVERNED_SUBAGENT,
    filePath,
    lineNumber: lineIndex >= 0 ? lineIndex + 1 : 1,
    column: lineIndex >= 0 ? (lines[lineIndex].search(SUBAGENT_PROSE_RE) + 1) : 1,
    line: lineIndex >= 0 ? lines[lineIndex] : "",
    terms: ["subagent"],
    remediation: "Route subagent dispatch prose through `{{subagentPrompts}}` or require an `IAM_SUBAGENT_CONTRACT` marker so the prompt is governed by the IAM role/envelope policy.",
  })];
}

export function scanPromptWorkflowText(filePath, text) {
  const normalized = normalizePath(filePath);
  const lines = String(text ?? "").split(/\r?\n/);
  const findings = [];

  findings.push(...scanLegacyTokens(normalized, lines));

  if (!HAMMER_MARKER_RE.test(text)) {
    findings.push(makeFinding({
      kind: FINDING_KINDS.MISSING_HAMMER_MARKER,
      filePath: normalized,
      lineNumber: 1,
      column: 1,
      line: lines[0] ?? "",
      remediation: "Add a local or inherited Hammer marker such as `Hammer`, `/hammer`, `.hammer`, or `hammer/` so the surface cannot regress to GSD-first identity silently.",
    }));
  }

  if (!AWARENESS_MARKER_RE.test(text)) {
    findings.push(makeFinding({
      kind: FINDING_KINDS.MISSING_AWARENESS_MARKER,
      filePath: normalized,
      lineNumber: 1,
      column: 1,
      line: lines[0] ?? "",
      remediation: "Add an IAM/awareness/Omega/Trinity/VOLVOX/no-degradation marker or inherited-awareness note so missing awareness semantics fail closed.",
    }));
  }

  findings.push(...scanSubagentGovernance(normalized, String(text ?? ""), lines));

  return findings;
}

function hasCustomStepManifest(manifestText) {
  const text = String(manifestText ?? "");
  const hasKnownUnit = /KNOWN_UNIT_TYPES[\s\S]*["']custom-step["']/.test(text);
  const hasManifestEntry = /["']custom-step["']\s*:\s*\{/.test(text);
  const hasWorkflowWorkerNearCustomStep = /custom-step[\s\S]{0,4000}workflow-worker|workflow-worker[\s\S]{0,4000}custom-step/.test(text);
  const hasDeclaredPolicy = /custom-step[\s\S]{0,4000}\b(?:tools|subagents)\s*:|\b(?:tools|subagents)\s*:[\s\S]{0,4000}custom-step/.test(text);
  return hasKnownUnit && hasManifestEntry && hasWorkflowWorkerNearCustomStep && hasDeclaredPolicy;
}

function findFirstLine(text, pattern) {
  const lines = String(text ?? "").split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index === -1) return { lineNumber: 1, column: 1, line: lines[0] ?? "" };
  return {
    lineNumber: index + 1,
    column: Math.max(1, lines[index].search(pattern) + 1),
    line: lines[index],
  };
}

export function scanCustomStepPolicy(textsByPath) {
  const entries = Object.entries(textsByPath).map(([path, text]) => [normalizePath(path), String(text ?? "")]);
  const customStepEntries = entries.filter(([, text]) => /["']custom-step["']/.test(text));
  if (customStepEntries.length === 0) return [];

  const manifestText = String(textsByPath["src/resources/extensions/gsd/unit-context-manifest.ts"] ?? "");
  if (hasCustomStepManifest(manifestText)) return [];

  const [filePath, text] = customStepEntries.find(([path]) => path.endsWith("custom-workflow-engine.ts")) ?? customStepEntries[0];
  const loc = findFirstLine(text, /custom-step/);
  return [makeFinding({
    kind: FINDING_KINDS.CUSTOM_STEP_POLICY,
    filePath,
    lineNumber: loc.lineNumber,
    column: loc.column,
    line: loc.line,
    terms: ["custom-step"],
    remediation: "Add `custom-step` to KNOWN_UNIT_TYPES/UNIT_MANIFESTS with an explicit workflow-worker IAM policy, tool boundary, and tests so custom workflow steps are not an ungoverned pass-through.",
  })];
}

export function scanPromptWorkflowTexts(textsByPath, { trackedFiles = Object.keys(textsByPath) } = {}) {
  const inventory = collectPromptWorkflowInventory(trackedFiles);
  const findings = [];
  const scannedFiles = [];
  const scannedLineCounts = {};
  const scannedTexts = {};
  let skippedMissingCount = 0;

  for (const filePath of inventory.scannedFiles) {
    if (!Object.prototype.hasOwnProperty.call(textsByPath, filePath)) {
      skippedMissingCount += 1;
      continue;
    }
    const text = String(textsByPath[filePath] ?? "");
    scannedFiles.push(filePath);
    scannedTexts[filePath] = text;
    scannedLineCounts[filePath] = text.split(/\r?\n/).length;
    findings.push(...scanPromptWorkflowText(filePath, text));
  }

  findings.push(...scanCustomStepPolicy(scannedTexts));

  return {
    trackedFileCount: trackedFiles.length,
    scannedFiles,
    scannedLineCounts,
    allowlistedFiles: inventory.allowlistedFiles,
    skippedBinaryCount: inventory.skippedBinaryCount,
    skippedMissingCount,
    skippedNonSurfaceCount: inventory.skippedNonSurfaceCount,
    findings,
    summary: summarizeCoverage({
      trackedFileCount: trackedFiles.length,
      scannedFiles,
      scannedLineCounts,
      allowlistedFiles: inventory.allowlistedFiles,
      skippedBinaryCount: inventory.skippedBinaryCount,
      skippedMissingCount,
      skippedNonSurfaceCount: inventory.skippedNonSurfaceCount,
      findings,
    }),
  };
}

export function readPromptWorkflowSurfaceTexts(root, scannedFiles) {
  const textsByPath = {};
  let skippedMissingCount = 0;
  let skippedBinaryCount = 0;

  for (const filePath of scannedFiles) {
    const absolutePath = resolve(root, filePath);
    if (!existsSync(absolutePath)) {
      skippedMissingCount += 1;
      continue;
    }
    const stat = statSync(absolutePath);
    if (!stat.isFile() || BINARY_EXTENSION_RE.test(filePath)) {
      skippedBinaryCount += 1;
      continue;
    }
    textsByPath[filePath] = readFileSync(absolutePath, "utf8");
  }

  return { textsByPath, skippedMissingCount, skippedBinaryCount };
}

export function summarizeCoverage(result) {
  const countsByFindingKind = {};
  const countsByAllowlistRule = {};
  let scannedLineCount = 0;

  for (const count of Object.values(result.scannedLineCounts ?? {})) {
    scannedLineCount += count;
  }
  for (const finding of result.findings ?? []) {
    countsByFindingKind[finding.kind] = (countsByFindingKind[finding.kind] ?? 0) + 1;
  }
  for (const entry of result.allowlistedFiles ?? []) {
    countsByAllowlistRule[entry.ruleId] = (countsByAllowlistRule[entry.ruleId] ?? 0) + 1;
  }

  return {
    trackedFileCount: result.trackedFileCount ?? 0,
    scannedFileCount: result.scannedFiles?.length ?? 0,
    scannedLineCount,
    allowlistedCount: result.allowlistedFiles?.length ?? 0,
    skippedBinaryCount: result.skippedBinaryCount ?? 0,
    skippedMissingCount: result.skippedMissingCount ?? 0,
    skippedNonSurfaceCount: result.skippedNonSurfaceCount ?? 0,
    findingCount: result.findings?.length ?? 0,
    violationCount: result.findings?.length ?? 0,
    ok: (result.findings?.length ?? 0) === 0,
    countsByFindingKind: Object.fromEntries(Object.entries(countsByFindingKind).sort(([a], [b]) => a.localeCompare(b))),
    countsByAllowlistRule: Object.fromEntries(Object.entries(countsByAllowlistRule).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * @param {{ root?: string, enforce?: boolean, trackedFiles?: string[] | null }} [options]
 */
export async function runPromptWorkflowCoverageScan({ root = process.cwd(), enforce = false, trackedFiles = null } = {}) {
  try {
    const tracked = trackedFiles ? trackedFiles.map(normalizePath).sort((a, b) => a.localeCompare(b)) : getTrackedFiles(root);
    const inventory = collectPromptWorkflowInventory(tracked);
    const readResult = readPromptWorkflowSurfaceTexts(root, inventory.scannedFiles);
    const scannedTexts = readResult.textsByPath;
    const findings = [];
    const scannedFiles = Object.keys(scannedTexts).sort((a, b) => a.localeCompare(b));
    const scannedLineCounts = {};

    for (const filePath of scannedFiles) {
      const text = scannedTexts[filePath];
      scannedLineCounts[filePath] = text.split(/\r?\n/).length;
      findings.push(...scanPromptWorkflowText(filePath, text));
    }
    findings.push(...scanCustomStepPolicy(scannedTexts));

    const summary = summarizeCoverage({
      trackedFileCount: tracked.length,
      scannedFiles,
      scannedLineCounts,
      allowlistedFiles: inventory.allowlistedFiles,
      skippedBinaryCount: inventory.skippedBinaryCount + readResult.skippedBinaryCount,
      skippedMissingCount: readResult.skippedMissingCount,
      skippedNonSurfaceCount: inventory.skippedNonSurfaceCount,
      findings,
    });

    return {
      root,
      enforce,
      ok: summary.ok,
      trackedFileCount: tracked.length,
      scannedFiles,
      allowlistedFiles: inventory.allowlistedFiles,
      skippedBinaryCount: summary.skippedBinaryCount,
      skippedMissingCount: summary.skippedMissingCount,
      skippedNonSurfaceCount: summary.skippedNonSurfaceCount,
      findings,
      errors: [],
      summary,
      exitCode: enforce && !summary.ok ? 1 : 0,
    };
  } catch (error) {
    if (error instanceof InventoryError) {
      const summary = {
        trackedFileCount: 0,
        scannedFileCount: 0,
        scannedLineCount: 0,
        allowlistedCount: 0,
        skippedBinaryCount: 0,
        skippedMissingCount: 0,
        skippedNonSurfaceCount: 0,
        findingCount: 0,
        violationCount: 1,
        ok: false,
        countsByFindingKind: { [INVENTORY_ERROR_KIND]: 1 },
        countsByAllowlistRule: {},
      };
      return {
        root,
        enforce,
        ok: false,
        trackedFileCount: 0,
        scannedFiles: [],
        allowlistedFiles: [],
        skippedBinaryCount: 0,
        skippedMissingCount: 0,
        skippedNonSurfaceCount: 0,
        findings: [],
        errors: [{ kind: error.kind, message: error.message, remediation: error.remediation }],
        summary,
        exitCode: 2,
      };
    }
    throw error;
  }
}

function formatCounts(counts, emptyLabel = "none") {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) return [`  ${emptyLabel}: 0`];
  return entries.map(([kind, count]) => `  ${kind}: ${count}`);
}

export function renderCoverageReport(result, { maxFindings = 200 } = {}) {
  const summary = result.summary;
  const lines = [
    "Hammer prompt/workflow coverage scan",
    `Root: ${result.root}`,
    `Tracked files considered: ${summary.trackedFileCount}`,
    `Scanned prompt/workflow files: ${summary.scannedFileCount}`,
    `Scanned lines: ${summary.scannedLineCount}`,
    `Explicit S09 allowlisted files: ${summary.allowlistedCount}`,
    `Zero-allowlist readiness: ${summary.allowlistedCount === 0 ? "ready" : "blocked"}`,
    `Skipped non-surface files: ${summary.skippedNonSurfaceCount}`,
    `Skipped binary/missing files: ${summary.skippedBinaryCount}/${summary.skippedMissingCount}`,
    `Violations: ${summary.violationCount}`,
    "",
    "Counts by finding kind:",
    ...formatCounts(summary.countsByFindingKind),
    "",
    "Explicit S09 allowlist counts:",
    ...formatCounts(summary.countsByAllowlistRule),
  ];

  if (result.errors?.length) {
    lines.push("", "Errors:");
    for (const error of result.errors) {
      lines.push(`  ${error.kind}: ${error.message}`);
      lines.push(`    Remediation: ${error.remediation}`);
    }
  }

  lines.push("", "Findings:");
  if (!result.findings?.length) {
    lines.push("  none");
  } else {
    for (const finding of result.findings.slice(0, maxFindings)) {
      lines.push(`  ${finding.filePath}:${finding.lineNumber}:${finding.column} [${finding.kind}] ${finding.excerpt}`);
      lines.push(`    Remediation: ${finding.remediation}`);
    }
    if (result.findings.length > maxFindings) {
      lines.push(`  ... ${result.findings.length - maxFindings} more finding(s) omitted; rerun with --json for the full structured inventory.`);
    }
  }

  if (result.allowlistedFiles?.length) {
    lines.push("", "Explicitly allowlisted for S09:");
    for (const entry of result.allowlistedFiles.slice(0, 50)) {
      lines.push(`  ${entry.filePath} [${entry.ruleId}] ${entry.reason}`);
    }
    if (result.allowlistedFiles.length > 50) {
      lines.push(`  ... ${result.allowlistedFiles.length - 50} more allowlisted file(s) omitted.`);
    }
  }

  return lines.join("\n");
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/check-hammer-prompt-workflow-coverage.mjs [--json] [--enforce] [--details]\n\n`);
  process.stdout.write("Scans git-tracked Hammer prompt/workflow surfaces for stale GSD-first wording, missing Hammer/IAM markers, ungoverned subagent prose, and missing custom-step policy coverage.\n");
  process.stdout.write("--json      Print structured JSON with counts and exact findings.\n");
  process.stdout.write("--enforce   Exit non-zero when any violation remains.\n");
  process.stdout.write("--details   In text mode, print all findings instead of the default bounded inventory.\n");
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const json = argv.includes("--json");
  const enforce = argv.includes("--enforce");
  const details = argv.includes("--details");
  const result = await runPromptWorkflowCoverageScan({ root: process.cwd(), enforce });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderCoverageReport(result, { maxFindings: details ? Number.MAX_SAFE_INTEGER : 200 })}\n`);
  }

  return result.exitCode;
}

const directRunPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (directRunPath === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`Hammer prompt/workflow coverage scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
