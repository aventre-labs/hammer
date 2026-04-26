#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const COMPATIBILITY_TS_PATH = resolve(PROJECT_ROOT, "src/hammer-identity/compatibility.ts");

export const UNCLASSIFIED_CATEGORY = "unclassified-visible-gsd";

export const GSD_IDENTITY_TOKEN_PATTERN =
  String.raw`(?:Get Shit Done|GSD_[A-Z0-9_]+|gsd_[A-Za-z0-9_]+|\.gsd(?:-id)?|/gsd\b|@gsd(?:[-/][A-Za-z0-9_.-]+)?|gsd(?:-[A-Za-z0-9_.-]+)?\b|GSD\b)`;

export const GSD_IDENTITY_TOKEN_RE = new RegExp(GSD_IDENTITY_TOKEN_PATTERN, "g");

const IGNORED_TRACKED_PATH_RE = /^(?:\.gsd(?:\/|$)|\.planning(?:\/|$)|\.audits(?:\/|$)|node_modules(?:\/|$)|dist(?:\/|$)|dist-test(?:\/|$)|coverage(?:\/|$)|\.cache(?:\/|$)|\.repowise(?:\/|$)|\.artifacts(?:\/|$)|\.bg-shell(?:\/|$)|tmp(?:\/|$)|build(?:\/|$)|\.next(?:\/|$)|packages\/[^/]+\/(?:dist|node_modules)(?:\/|$)|studio\/(?:dist|node_modules|\.next)(?:\/|$)|extensions\/[^/]+\/(?:dist|node_modules)(?:\/|$))/;

const BINARY_EXTENSION_RE = /\.(?:avif|bmp|class|dll|dylib|eot|gif|gz|ico|jar|jpeg|jpg|mov|mp3|mp4|otf|pdf|png|pyc|so|sqlite|sqlite3|tgz|ttf|webm|webp|woff|woff2|zip)$/i;

let cachedCompatibilityRules;

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function unique(values) {
  return [...new Set(values)];
}

function compileRule(rule) {
  return {
    ...rule,
    pathRe: new RegExp(rule.pathPattern, "u"),
    lineRe: new RegExp(rule.linePattern, "u"),
  };
}

export async function loadHammerIdentityCompatibilityRules() {
  if (cachedCompatibilityRules) return cachedCompatibilityRules;

  const tsModule = await import("typescript");
  const ts = tsModule.default ?? tsModule;
  const source = readFileSync(COMPATIBILITY_TS_PATH, "utf8");
  const transpiled = ts.transpileModule(source, {
    fileName: COMPATIBILITY_TS_PATH,
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      sourceMap: false,
    },
  }).outputText;

  const compatibilityUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  const compatibilityModule = await import(compatibilityUrl);
  cachedCompatibilityRules = compatibilityModule.HAMMER_LEGACY_COMPATIBILITY_RULES.map(compileRule);
  return cachedCompatibilityRules;
}

export function shouldScanPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized || normalized.includes("\0")) return false;
  if (IGNORED_TRACKED_PATH_RE.test(normalized)) return false;
  if (BINARY_EXTENSION_RE.test(normalized)) return false;
  return true;
}

export function filterScannableTrackedFiles(filePaths) {
  return filePaths.map(normalizePath).filter(shouldScanPath);
}

export function getTrackedFiles(root = process.cwd()) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return filterScannableTrackedFiles(output.toString("utf8").split("\0").filter(Boolean));
}

export function classifyHammerIdentityLine(filePath, line, rules) {
  const normalized = normalizePath(filePath);
  return rules.find((rule) => rule.pathRe.test(normalized) && rule.lineRe.test(line)) ?? null;
}

export function scanText(filePath, text, rules) {
  const normalized = normalizePath(filePath);
  const findings = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    GSD_IDENTITY_TOKEN_RE.lastIndex = 0;
    const matches = [...line.matchAll(GSD_IDENTITY_TOKEN_RE)];
    if (matches.length === 0) continue;

    const rule = classifyHammerIdentityLine(normalized, line, rules);
    const firstMatch = matches[0];
    findings.push({
      filePath: normalized,
      lineNumber: index + 1,
      column: (firstMatch.index ?? 0) + 1,
      line,
      terms: unique(matches.map((match) => match[0])),
      category: rule?.category ?? UNCLASSIFIED_CATEGORY,
      ruleId: rule?.id ?? null,
      rationale: rule?.rationale ?? "No Hammer compatibility rule matched this visible legacy identity.",
    });
  }

  return findings;
}

export function scanFiles(filePaths, rules, root = process.cwd()) {
  const findings = [];
  let scannedFileCount = 0;

  for (const filePath of filterScannableTrackedFiles(filePaths)) {
    const absolutePath = resolve(root, filePath);
    if (!existsSync(absolutePath)) continue;
    const stat = statSync(absolutePath);
    if (!stat.isFile()) continue;

    const text = readFileSync(absolutePath, "utf8");
    scannedFileCount += 1;
    findings.push(...scanText(filePath, text, rules));
  }

  return { scannedFileCount, findings };
}

export function summarizeFindings(findings, scannedFileCount = 0) {
  const countsByCategory = new Map();
  const countsByRule = new Map();

  for (const finding of findings) {
    countsByCategory.set(finding.category, (countsByCategory.get(finding.category) ?? 0) + 1);
    if (finding.ruleId) {
      countsByRule.set(finding.ruleId, (countsByRule.get(finding.ruleId) ?? 0) + 1);
    }
  }

  return {
    scannedFileCount,
    findingCount: findings.length,
    unclassifiedCount: countsByCategory.get(UNCLASSIFIED_CATEGORY) ?? 0,
    countsByCategory: Object.fromEntries([...countsByCategory.entries()].sort(([a], [b]) => a.localeCompare(b))),
    countsByRule: Object.fromEntries([...countsByRule.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function formatFinding(finding) {
  const termList = finding.terms.join(", ");
  return `${finding.filePath}:${finding.lineNumber}:${finding.column} [${termList}] ${finding.line.trim()}`;
}

export function renderHammerIdentityReport(summary, findings, { includeClassified = false } = {}) {
  const lines = [
    "Hammer identity scan",
    `Scanned files: ${summary.scannedFileCount}`,
    `Findings: ${summary.findingCount}`,
    "Counts by category:",
  ];

  const categoryEntries = Object.entries(summary.countsByCategory);
  if (categoryEntries.length === 0) {
    lines.push("  none: 0");
  } else {
    for (const [category, count] of categoryEntries) {
      lines.push(`  ${category}: ${count}`);
    }
  }

  const unclassified = findings.filter((finding) => finding.category === UNCLASSIFIED_CATEGORY);
  lines.push("");
  lines.push("Unclassified visible GSD references:");
  if (unclassified.length === 0) {
    lines.push("  none");
  } else {
    for (const finding of unclassified) {
      lines.push(`  ${formatFinding(finding)}`);
    }
  }

  if (includeClassified) {
    const classified = findings.filter((finding) => finding.category !== UNCLASSIFIED_CATEGORY);
    lines.push("");
    lines.push("Classified compatibility references:");
    if (classified.length === 0) {
      lines.push("  none");
    } else {
      for (const finding of classified) {
        lines.push(`  ${finding.category}/${finding.ruleId}: ${formatFinding(finding)}`);
      }
    }
  }

  return lines.join("\n");
}

export function hasEnforcementFailures(findings) {
  return findings.some((finding) => finding.category === UNCLASSIFIED_CATEGORY);
}

export async function runHammerIdentityScan({ root = process.cwd(), enforce = false, includeClassified = false, scopes = null } = {}) {
  const rules = await loadHammerIdentityCompatibilityRules();
  const trackedFiles = getTrackedFiles(root);
  const filteredFiles = scopes ? filterByScope(trackedFiles, scopes) : trackedFiles;
  const { scannedFileCount, findings } = scanFiles(filteredFiles, rules, root);
  const summary = summarizeFindings(findings, scannedFileCount);
  const report = renderHammerIdentityReport(summary, findings, { includeClassified });
  return {
    root,
    enforce,
    scopes,
    trackedFileCount: trackedFiles.length,
    scannedFileCount,
    findings,
    summary,
    report,
    exitCode: enforce && hasEnforcementFailures(findings) ? 1 : 0,
  };
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/check-hammer-identity.mjs [--report] [--enforce] [--classified] [--scope <categories>]\n\n`);
  process.stdout.write("Scans git-tracked text files for legacy GSD identity spellings and classifies them against src/hammer-identity/compatibility.ts.\n");
  process.stdout.write("--report         Print the bounded report (default).\n");
  process.stdout.write("--enforce        Exit non-zero when an unclassified visible GSD reference remains.\n");
  process.stdout.write("--classified     Include classified compatibility findings in addition to unclassified findings.\n");
  process.stdout.write("--scope <list>   Comma-separated categories to restrict the scan to. Known scopes:\n");
  process.stdout.write("                   package   root/pkg package manifests (package.json, package-lock.json)\n");
  process.stdout.write("                   cli       loader and CLI entry points (src/loader.ts, src/cli.ts)\n");
  process.stdout.write("                   help      user-visible help text (src/help-text.ts)\n");
  process.stdout.write("                   state     state path resolvers (src/app-paths.ts, src/resources/extensions/gsd/paths.ts, repo-identity.ts, detection.ts, gitignore.ts, migrate-external.ts)\n");
  process.stdout.write("                   extension-command   extension command surface (index.ts, commands/index.ts, catalog.ts, dispatcher.ts, handlers/core.ts)\n");
  process.stdout.write("                   tools     tool registration modules (bootstrap/db-tools.ts, memory-tools.ts, query-tools.ts, exec-tools.ts, journal-tools.ts)\n");
  process.stdout.write("                   headless  headless orchestrator modules (src/headless*.ts)\n");
  process.stdout.write("                   browser   browser slash-command dispatch and surface contract modules\n");
  process.stdout.write("                   mcp       MCP server identity surface (packages/mcp-server package.json, server.ts, cli.ts, workflow-tools.ts, readers/paths.ts)\n");
  process.stdout.write("                 Omit to scan all tracked files.\n");
}

/** Map scope name → path-match function (applied after shouldScanPath filters). */
const SCOPE_PATH_FILTERS = {
  package: (p) => /^(?:package(?:-lock)?\.json|pkg\/package\.json)$/.test(p),
  cli:     (p) => /^src\/(?:loader|cli)\.(?:ts|js)$/.test(p),
  help:    (p) => /^src\/help-text\.(?:ts|js)$/.test(p),
  state:   (p) => /^src\/(?:app-paths|resources\/extensions\/gsd\/(?:paths|repo-identity|detection|gitignore|migrate-external))\.(?:ts|js)$/.test(p),
  "extension-command": (p) => /^src\/resources\/extensions\/gsd\/(?:index|commands\/index|commands\/catalog|commands\/dispatcher|commands\/handlers\/core)\.(?:ts|js)$/.test(p),
  tools:   (p) => /^src\/resources\/extensions\/gsd\/bootstrap\/(?:db-tools|memory-tools|query-tools|exec-tools|journal-tools)\.(?:ts|js)$/.test(p),
  headless: (p) => /^src\/headless(?:-context|-events|-[a-z]+)?\.(?:ts|js)$/.test(p),
  browser:  (p) => /^web\/lib\/(?:browser-slash-command-dispatch|command-surface-contract)\.(?:ts|js)$/.test(p),
  mcp:      (p) => /^packages\/mcp-server\/(?:package\.json|src\/(?:server|cli|workflow-tools|readers\/paths)\.(?:ts|js))$/.test(p),
};

/** Parse --scope a,b,c → array of known scope keys, or null if unset. */
function parseScopeArg(argv) {
  const idx = argv.indexOf("--scope");
  if (idx === -1) return null;
  const raw = argv[idx + 1];
  if (!raw || raw.startsWith("--")) return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Filter a file list to only those matching at least one requested scope. */
export function filterByScope(filePaths, scopes) {
  if (!scopes || scopes.length === 0) return filePaths;
  const filters = scopes.map((s) => SCOPE_PATH_FILTERS[s]).filter(Boolean);
  if (filters.length === 0) return filePaths;
  return filePaths.filter((p) => filters.some((fn) => fn(p)));
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const includeClassified = argv.includes("--classified");
  const enforce = argv.includes("--enforce");
  const scopes = parseScopeArg(argv);
  const result = await runHammerIdentityScan({ root: process.cwd(), enforce, includeClassified, scopes });
  process.stdout.write(`${result.report}\n`);
  return result.exitCode;
}

const directRunPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (directRunPath === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`Hammer identity scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
