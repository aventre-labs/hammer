import test from "node:test";
import assert from "node:assert/strict";

import {
  filterScannableTrackedFiles,
  hasEnforcementFailures,
  loadHammerIdentityCompatibilityRules,
  renderHammerIdentityReport,
  scanText,
  shouldScanPath,
  summarizeFindings,
  UNCLASSIFIED_CATEGORY,
} from "../../scripts/check-hammer-identity.mjs";

test("scanner flags unclassified visible GSD help strings", async () => {
  const rules = await loadHammerIdentityCompatibilityRules();
  const findings = scanText(
    "src/help-text.ts",
    'export const help = "GSD help is shown to users";\n',
    rules,
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, UNCLASSIFIED_CATEGORY);
  assert.equal(findings[0].ruleId, null);
  assert.deepEqual(findings[0].terms, ["GSD"]);
  assert.equal(hasEnforcementFailures(findings), true);
});

test("explicit legacy alias and internal path examples pass only through compatibility rules", async () => {
  const rules = await loadHammerIdentityCompatibilityRules();

  const legacyAlias = scanText(
    "src/legacy-command-alias.ts",
    'const oldSlashCommand = "/gsd"; // legacy alias for /hammer during compatibility window\n',
    rules,
  );
  assert.equal(legacyAlias.length, 1);
  assert.equal(legacyAlias[0].category, "legacy-alias");
  assert.equal(legacyAlias[0].ruleId, "explicit-legacy-alias-marker");

  const internalPath = scanText(
    "src/internal-paths.ts",
    'const bundledPath = "src/resources/extensions/gsd/index.ts";\n',
    rules,
  );
  assert.equal(internalPath.length, 1);
  assert.equal(internalPath[0].category, "internal-implementation-path");
  assert.equal(internalPath[0].ruleId, "private-extension-path-reference");

  assert.equal(hasEnforcementFailures([...legacyAlias, ...internalPath]), false);
});

test("bootstrap and downstream references require matching explanatory context", async () => {
  const rules = await loadHammerIdentityCompatibilityRules();

  const bootstrap = scanText(
    "src/loader.ts",
    'const legacyHome = ".gsd"; // migrate legacy state into .hammer on first launch\n',
    rules,
  );
  assert.equal(bootstrap.length, 1);
  assert.equal(bootstrap[0].category, "bootstrap-migration");
  assert.equal(bootstrap[0].ruleId, "bootstrap-state-migration");

  const downstream = scanText(
    "src/prompt-follow-up.ts",
    "// TODO(S01 prompt follow-up): replace GSD wording in prompt fixtures\n",
    rules,
  );
  assert.equal(downstream.length, 1);
  assert.equal(downstream[0].category, "downstream-follow-up");
  assert.equal(downstream[0].ruleId, "marked-downstream-follow-up");

  const barePrompt = scanText(
    "src/prompt-follow-up.ts",
    'export const prompt = "Use GSD to plan this workflow";\n',
    rules,
  );
  assert.equal(barePrompt.length, 1);
  assert.equal(barePrompt[0].category, UNCLASSIFIED_CATEGORY);
});

test("core prompt and workflow paths do not inherit broad extension compatibility", async () => {
  const rules = await loadHammerIdentityCompatibilityRules();

  const promptVisible = scanText(
    "src/resources/extensions/gsd/prompts/example.md",
    'export const prompt = "Use GSD to plan this workflow";\n',
    rules,
  );
  assert.equal(promptVisible.length, 1);
  assert.equal(promptVisible[0].category, UNCLASSIFIED_CATEGORY);
  assert.equal(promptVisible[0].ruleId, null);

  const workflowVisible = scanText(
    "src/resources/extensions/gsd/workflow-templates/example.md",
    "Use GSD to plan this workflow.\n",
    rules,
  );
  assert.equal(workflowVisible.length, 1);
  assert.equal(workflowVisible[0].category, UNCLASSIFIED_CATEGORY);
  assert.equal(workflowVisible[0].ruleId, null);

  const dbBackedToolBridge = scanText(
    "src/resources/extensions/gsd/prompts/example.md",
    "Call `gsd_plan_slice` as the DB-backed tool-name compatibility bridge.\n",
    rules,
  );
  assert.equal(dbBackedToolBridge.length, 1);
  assert.equal(dbBackedToolBridge[0].category, "legacy-alias");
  assert.ok(
    ["explicit-legacy-alias-marker", "s08-db-backed-tool-name-bridge"].includes(
      dbBackedToolBridge[0].ruleId ?? "",
    ),
  );

  const legacyStateBridge = scanText(
    "src/resources/extensions/gsd/prompts/example.md",
    "Read `.gsd` only as a legacy state bridge while `.hammer` is canonical.\n",
    rules,
  );
  assert.equal(legacyStateBridge.length, 1);
  assert.equal(legacyStateBridge[0].category, "bootstrap-migration");
  assert.equal(legacyStateBridge[0].ruleId, "s08-legacy-state-path-bridge");
});

test("scanner filters ignored and generated state before reading files", () => {
  assert.equal(shouldScanPath("src/hammer-identity/index.ts"), true);
  assert.equal(shouldScanPath("scripts/check-hammer-identity.mjs"), true);

  for (const ignoredPath of [
    ".gsd/STATE.md",
    ".planning/notes.md",
    ".audits/report.md",
    "node_modules/pkg/index.js",
    "dist/loader.js",
    "dist-test/src/tests/example.test.js",
    "coverage/lcov.info",
    ".cache/cache.json",
    "tmp/scratch.txt",
    "build/output.js",
    "packages/pi-coding-agent/dist/index.js",
  ]) {
    assert.equal(shouldScanPath(ignoredPath), false, `${ignoredPath} should not be scanned`);
  }

  assert.deepEqual(
    filterScannableTrackedFiles([
      "src/hammer-identity/index.ts",
      ".gsd/STATE.md",
      "dist/loader.js",
      "scripts/check-hammer-identity.mjs",
    ]),
    ["src/hammer-identity/index.ts", "scripts/check-hammer-identity.mjs"],
  );
});

test("report includes counts and actionable file:line findings", async () => {
  const rules = await loadHammerIdentityCompatibilityRules();
  const findings = [
    ...scanText("src/help-text.ts", 'export const help = "GSD help";\n', rules),
    ...scanText(
      "src/legacy-command-alias.ts",
      'const oldSlashCommand = "/gsd"; // legacy alias for /hammer during compatibility window\n',
      rules,
    ),
  ];
  const summary = summarizeFindings(findings, 2);
  const report = renderHammerIdentityReport(summary, findings);

  assert.equal(summary.scannedFileCount, 2);
  assert.equal(summary.findingCount, 2);
  assert.equal(summary.unclassifiedCount, 1);
  assert.match(report, /Counts by category:/);
  assert.match(report, /unclassified-visible-gsd: 1/);
  assert.match(report, /legacy-alias: 1/);
  assert.match(report, /src\/help-text\.ts:1:22 \[GSD\]/);
  assert.doesNotMatch(report, /legacy-command-alias\.ts:1/);

  const classifiedReport = renderHammerIdentityReport(summary, findings, { includeClassified: true });
  assert.match(classifiedReport, /legacy-alias\/explicit-legacy-alias-marker/);
});
