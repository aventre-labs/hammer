import test from "node:test";
import assert from "node:assert/strict";

import {
  FINDING_KINDS,
  collectPromptWorkflowInventory,
  isAllowedLegacyBridgeLine,
  runPromptWorkflowCoverageScan,
  scanPromptWorkflowText,
  scanPromptWorkflowTexts,
  shouldScanSurfacePath,
  validatePathRules,
} from "../../../../../scripts/check-hammer-prompt-workflow-coverage.mjs";

const BASE_GOOD_TEXT = `# Hammer prompt surface

Hammer uses IAM awareness with Omega, Trinity, VOLVOX, and no-degradation remediation.
`;

function kindsFor(text: string): string[] {
  return scanPromptWorkflowText("src/resources/extensions/gsd/prompts/example.md", text)
    .map((finding) => finding.kind)
    .sort();
}

test("tracks only explicit S08 prompt/workflow surfaces from git inventory", () => {
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/prompts/system.md"), true);
  assert.equal(shouldScanSurfacePath("src/resources/GSD-WORKFLOW.md"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/workflow-templates/registry.json"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/workflow-templates/docs-sync.yaml"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/commands-workflow-templates.ts"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/unit-context-manifest.ts"), true);

  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/templates/task-summary.md"), false);
  assert.equal(shouldScanSurfacePath(".gsd/milestones/M001/ROADMAP.md"), false);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/prompts/rendered.bin"), false);
});

test("S09 allowlist accounting is explicit rather than silently ignored", () => {
  const inventory = collectPromptWorkflowInventory([
    "src/resources/extensions/gsd/prompts/system.md",
    "gsd-orchestrator/SKILL.md",
    "src/resources/extensions/gsd/templates/task-summary.md",
    "README.md",
  ]);

  assert.deepEqual(inventory.scannedFiles, ["src/resources/extensions/gsd/prompts/system.md"]);
  assert.deepEqual(
    inventory.allowlistedFiles.map((entry) => [entry.filePath, entry.ruleId]),
    [
      ["gsd-orchestrator/SKILL.md", "s09-gsd-orchestrator-docs"],
      ["src/resources/extensions/gsd/templates/task-summary.md", "s09-generated-artifact-templates"],
    ],
  );
  assert.equal(inventory.skippedNonSurfaceCount, 1);
});

test("stale visible GSD product prose fails with actionable file and line metadata", () => {
  const findings = scanPromptWorkflowText(
    "src/resources/extensions/gsd/prompts/example.md",
    `${BASE_GOOD_TEXT}\nUse GSD to plan this workflow.\n`,
  );

  const stale = findings.find((finding) => finding.kind === FINDING_KINDS.STALE_LEGACY_TOKEN);
  assert.ok(stale, `expected stale legacy finding, got ${JSON.stringify(findings)}`);
  assert.equal(stale.filePath, "src/resources/extensions/gsd/prompts/example.md");
  assert.equal(stale.lineNumber, 5);
  assert.deepEqual(stale.terms, ["GSD"]);
  assert.match(stale.remediation, /Rewrite visible product\/workflow prose to Hammer/);
});

test("allowed DB-backed gsd_* tool names pass only with local tool compatibility wording", () => {
  const allowed = kindsFor(`${BASE_GOOD_TEXT}\nCall \`gsd_plan_slice\` as the DB-backed tool-name compatibility bridge.\n`);
  assert.equal(allowed.includes(FINDING_KINDS.STALE_LEGACY_TOKEN), false);

  const disallowed = scanPromptWorkflowText(
    "src/resources/extensions/gsd/prompts/example.md",
    `${BASE_GOOD_TEXT}\nPrefer gsd_plan_slice for all new Hammer planning prose.\n`,
  );
  assert.ok(disallowed.some((finding) => finding.kind === FINDING_KINDS.STALE_LEGACY_TOKEN));
});

test("allowed .gsd state wording passes only as a legacy state bridge", () => {
  assert.equal(
    isAllowedLegacyBridgeLine("Read .gsd only as a legacy state bridge while .hammer is canonical."),
    true,
  );
  assert.equal(
    isAllowedLegacyBridgeLine("Create new project artifacts under .gsd/workflows."),
    false,
  );

  const allowed = kindsFor(`${BASE_GOOD_TEXT}\nRead \`.gsd\` only as a legacy state bridge while \`.hammer\` is canonical.\n`);
  assert.equal(allowed.includes(FINDING_KINDS.STALE_LEGACY_TOKEN), false);

  const disallowed = kindsFor(`${BASE_GOOD_TEXT}\nCreate new project artifacts under \`.gsd/workflows\`.\n`);
  assert.ok(disallowed.includes(FINDING_KINDS.STALE_LEGACY_TOKEN));
});

test("missing Hammer marker and missing IAM/awareness marker are distinct failures", () => {
  const noHammer = kindsFor("This surface requires IAM awareness with Omega and no-degradation.\n");
  assert.deepEqual(noHammer, [FINDING_KINDS.MISSING_HAMMER_MARKER]);

  const noAwareness = kindsFor("Hammer prompt text uses /hammer and .hammer but omits the awareness contract.\n".replace("awareness", "context"));
  assert.deepEqual(noAwareness, [FINDING_KINDS.MISSING_AWARENESS_MARKER]);
});

test("markerless subagent prose fails unless governed by template or IAM contract marker", () => {
  const markerless = kindsFor(`${BASE_GOOD_TEXT}\nUse a subagent to review this plan.\n`);
  assert.ok(markerless.includes(FINDING_KINDS.UNGOVERNED_SUBAGENT));

  const templateGoverned = kindsFor(`${BASE_GOOD_TEXT}\nUse subagents through {{subagentPrompts}} so dispatch is governed.\n`);
  assert.equal(templateGoverned.includes(FINDING_KINDS.UNGOVERNED_SUBAGENT), false);

  const contractGoverned = kindsFor(`${BASE_GOOD_TEXT}\nSubagent prompts must carry IAM_SUBAGENT_CONTRACT before dispatch.\n`);
  assert.equal(contractGoverned.includes(FINDING_KINDS.UNGOVERNED_SUBAGENT), false);
});

test("custom-step dispatch requires an explicit manifest policy", () => {
  const result = scanPromptWorkflowTexts({
    "src/resources/extensions/gsd/custom-workflow-engine.ts": `${BASE_GOOD_TEXT}\nreturn { unitType: "custom-step", prompt };\n`,
    "src/resources/extensions/gsd/unit-context-manifest.ts": `${BASE_GOOD_TEXT}\nexport const KNOWN_UNIT_TYPES = ["execute-task"] as const;\n`,
  });

  assert.equal(result.summary.scannedFileCount, 2);
  assert.ok(result.findings.some((finding) => finding.kind === FINDING_KINDS.CUSTOM_STEP_POLICY));
});

test("custom-step manifest policy with workflow-worker role satisfies the custom-step guard", () => {
  const result = scanPromptWorkflowTexts({
    "src/resources/extensions/gsd/custom-workflow-engine.ts": `${BASE_GOOD_TEXT}\nreturn { unitType: "custom-step", prompt };\n`,
    "src/resources/extensions/gsd/unit-context-manifest.ts": `${BASE_GOOD_TEXT}\nexport const KNOWN_UNIT_TYPES = ["custom-step"] as const;\nexport const UNIT_MANIFESTS = { "custom-step": { tools: { mode: "all" }, subagents: { mode: "allowed", roles: ["workflow-worker"] } } };\n`,
  });

  assert.equal(result.findings.some((finding) => finding.kind === FINDING_KINDS.CUSTOM_STEP_POLICY), false);
});

test("malformed compatibility rules fail before enforcement can pass", () => {
  assert.throws(
    () => validatePathRules([{ id: "bad", scope: "unknown", pathPattern: ".*" }]),
    /unknown scope "unknown"/,
  );
  assert.throws(
    () => validatePathRules([{ id: "bad", scope: "scan", pathPattern: "[" }]),
    /Invalid regular expression/,
  );
});

test("report-mode scan returns structured JSON-friendly counts without requiring ignored fixtures", async () => {
  const result = await runPromptWorkflowCoverageScan({
    root: process.cwd(),
    trackedFiles: [
      "src/resources/extensions/gsd/prompts/system.md",
      "gsd-orchestrator/SKILL.md",
      "src/resources/extensions/gsd/templates/task-summary.md",
    ],
  });

  assert.equal(result.summary.trackedFileCount, 3);
  assert.equal(result.summary.scannedFileCount, 1);
  assert.equal(result.summary.allowlistedCount, 2);
  assert.equal(typeof result.summary.countsByFindingKind, "object");
  assert.equal(result.errors.length, 0);
});


test("actual bundled prompts carry Hammer and IAM awareness markers", async () => {
  const result = await runPromptWorkflowCoverageScan({ root: process.cwd() });
  const promptFindings = result.findings.filter((finding) => finding.filePath.includes("/prompts/"));
  assert.deepEqual(
    promptFindings,
    [],
    `Prompt coverage findings should be zero after the S08 prompt rewrite:\n${promptFindings
      .map((finding) => `${finding.filePath}:${finding.lineNumber} [${finding.kind}] ${finding.excerpt}`)
      .join("\n")}`,
  );
});

test("IAM/Omega stop-before lines preserve DB-backed tool names as compatibility bridges", () => {
  const findings = scanPromptWorkflowText(
    "src/resources/extensions/gsd/prompts/example.md",
    `${BASE_GOOD_TEXT}\nIf the Omega run fails, stop before \`gsd_plan_slice\` and report structured remediation.\n`,
  );

  assert.equal(findings.some((finding) => finding.kind === FINDING_KINDS.STALE_LEGACY_TOKEN), false);
});
