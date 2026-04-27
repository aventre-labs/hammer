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

test("tracks S08 and S09 prompt/workflow surfaces from git inventory", () => {
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/prompts/system.md"), true);
  assert.equal(shouldScanSurfacePath("src/resources/GSD-WORKFLOW.md"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/workflow-templates/registry.json"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/workflow-templates/docs-sync.yaml"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/commands-workflow-templates.ts"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/unit-context-manifest.ts"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/templates/task-summary.md"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/docs/preferences-reference.md"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/generated-docs/example.md"), true);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/generated-templates/example.md"), true);
  assert.equal(shouldScanSurfacePath("gsd-orchestrator/SKILL.md"), true);
  assert.equal(shouldScanSurfacePath("gsd-orchestrator/references/commands.md"), true);

  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/templates/rendered.bin"), false);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/docs/notes.txt"), false);
  assert.equal(shouldScanSurfacePath("gsd-orchestrator/scripts/example.ts"), false);
  assert.equal(shouldScanSurfacePath(".gsd/milestones/M001/ROADMAP.md"), false);
  assert.equal(shouldScanSurfacePath("src/resources/extensions/gsd/prompts/rendered.bin"), false);
});

test("S09 surfaces are scanned rather than allowlisted", () => {
  const inventory = collectPromptWorkflowInventory([
    "src/resources/extensions/gsd/prompts/system.md",
    "gsd-orchestrator/SKILL.md",
    "src/resources/extensions/gsd/templates/task-summary.md",
    "src/resources/extensions/gsd/docs/preferences-reference.md",
    "README.md",
  ]);

  assert.deepEqual(inventory.scannedFiles, [
    "gsd-orchestrator/SKILL.md",
    "src/resources/extensions/gsd/docs/preferences-reference.md",
    "src/resources/extensions/gsd/prompts/system.md",
    "src/resources/extensions/gsd/templates/task-summary.md",
  ]);
  assert.deepEqual(inventory.allowlistedFiles, []);
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
  assert.equal(result.summary.scannedFileCount, 3);
  assert.equal(result.summary.allowlistedCount, 0);
  assert.deepEqual(result.allowlistedFiles, []);
  assert.equal(typeof result.summary.countsByFindingKind, "object");
  assert.equal(result.errors.length, 0);
});

test("S09 scanned surfaces fail stale prose and missing markers before rewrite tasks", () => {
  const result = scanPromptWorkflowTexts({
    "src/resources/extensions/gsd/templates/task-summary.md": BASE_GOOD_TEXT,
    "src/resources/extensions/gsd/docs/preferences-reference.md": `${BASE_GOOD_TEXT}\nUse GSD in this template.\n`,
    "gsd-orchestrator/SKILL.md": "Hammer orchestrator docs without the required marker.\n",
    "README.md": "Use GSD outside the scanned S09 surfaces.\n",
  });

  assert.deepEqual(result.scannedFiles, [
    "gsd-orchestrator/SKILL.md",
    "src/resources/extensions/gsd/docs/preferences-reference.md",
    "src/resources/extensions/gsd/templates/task-summary.md",
  ]);
  assert.equal(result.summary.allowlistedCount, 0);
  assert.deepEqual(result.allowlistedFiles, []);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.filePath === "src/resources/extensions/gsd/docs/preferences-reference.md" &&
        finding.kind === FINDING_KINDS.STALE_LEGACY_TOKEN,
    ),
    true,
  );
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.filePath === "gsd-orchestrator/SKILL.md" &&
        finding.kind === FINDING_KINDS.MISSING_AWARENESS_MARKER,
    ),
    true,
  );
});

test("S09 bridge fixtures allow only local legacy state and DB-backed tool compatibility rationale", () => {
  const result = scanPromptWorkflowTexts({
    "src/resources/extensions/gsd/templates/task-summary.md": `${BASE_GOOD_TEXT}\nRead \`.gsd\` only as a legacy state bridge while \`.hammer\` is canonical.\n`,
    "gsd-orchestrator/references/commands.md": `${BASE_GOOD_TEXT}\nCall \`gsd_plan_slice\` as the DB-backed tool-name compatibility bridge.\n`,
    "src/resources/extensions/gsd/docs/preferences-reference.md": `${BASE_GOOD_TEXT}\nCreate new project artifacts under \`.gsd/workflows\`.\nPrefer gsd_plan_slice for all new Hammer planning prose.\n`,
  });

  const staleFindings = result.findings.filter((finding) => finding.kind === FINDING_KINDS.STALE_LEGACY_TOKEN);
  assert.deepEqual(
    staleFindings.map((finding) => [finding.filePath, finding.terms]),
    [
      ["src/resources/extensions/gsd/docs/preferences-reference.md", [".gsd/workflows"]],
      ["src/resources/extensions/gsd/docs/preferences-reference.md", ["gsd_plan_slice"]],
    ],
  );
});

test("actual bundled prompt/workflow/S09 surfaces are covered; downstream rewrite findings are reported", async () => {
  const result = await runPromptWorkflowCoverageScan({ root: process.cwd() });
  assert.deepEqual(
    result.allowlistedFiles,
    [],
    `S09 files should be scanned directly, not allowlisted:\n${result.allowlistedFiles
      .map((entry) => `${entry.filePath} [${entry.ruleId}]`)
      .join("\n")}`,
  );
  assert.equal(result.summary.allowlistedCount, 0);
  assert.equal(result.scannedFiles.includes("src/resources/extensions/gsd/templates/task-summary.md"), true);
  assert.equal(result.scannedFiles.includes("src/resources/extensions/gsd/docs/preferences-reference.md"), true);
  assert.equal(result.scannedFiles.includes("gsd-orchestrator/SKILL.md"), true);

  const nonS09Findings = result.findings.filter(
    (finding) =>
      !finding.filePath.startsWith("src/resources/extensions/gsd/templates/") &&
      !finding.filePath.startsWith("src/resources/extensions/gsd/docs/") &&
      !finding.filePath.startsWith("src/resources/extensions/gsd/generated-docs/") &&
      !finding.filePath.startsWith("src/resources/extensions/gsd/generated-templates/") &&
      !finding.filePath.startsWith("gsd-orchestrator/"),
  );
  assert.deepEqual(
    nonS09Findings,
    [],
    `Non-S09 workflow/prompt coverage findings should stay zero after the S08 rewrite:\n${nonS09Findings
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
