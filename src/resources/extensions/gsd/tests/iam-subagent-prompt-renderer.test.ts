import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildGateEvaluatePrompt,
  buildParallelResearchSlicesPrompt,
  buildReactiveExecutePrompt,
} from "../auto-prompts.ts";
import {
  closeDatabase,
  insertGateRow,
  insertMilestone,
  insertSlice,
  openDatabase,
} from "../gsd-db.ts";
import { parseIAMSubagentContractMarker } from "../iam-subagent-policy.ts";

function setupSlice(base: string, mid = "M001", sid = "S01"): string {
  const sliceDir = join(base, ".gsd", "milestones", mid, "slices", sid);
  mkdirSync(join(sliceDir, "tasks"), { recursive: true });
  writeFileSync(
    join(sliceDir, `${sid}-PLAN.md`),
    [
      `# ${sid}: Prompt Contracts`,
      "",
      "**Goal:** Verify IAM prompt rendering.",
      "**Demo:** Subagent prompts carry envelopes.",
      "",
      "## Tasks",
      "",
      "- [ ] **T01: Build types** `est:15m`",
      "- [ ] **T02: Build models** `est:15m`",
      "",
    ].join("\n"),
  );
  return sliceDir;
}

function writeTaskPlan(sliceDir: string, tid: string, title: string, inputs: string[], outputs: string[]): void {
  writeFileSync(
    join(sliceDir, "tasks", `${tid}-PLAN.md`),
    [
      `# ${tid}: ${title}`,
      "",
      "## Description",
      `Execute ${title}.`,
      "",
      "## Inputs",
      "",
      ...(inputs.length > 0 ? inputs.map((path) => `- \`${path}\` — input`) : ["- (none)"]),
      "",
      "## Expected Output",
      "",
      ...(outputs.length > 0 ? outputs.map((path) => `- \`${path}\` — output`) : ["- (none)"]),
      "",
    ].join("\n"),
  );
}

function seedGateDb(base: string): string {
  const dbDir = mkdtempSync(join(tmpdir(), "iam-gate-db-"));
  openDatabase(join(dbDir, "gsd.db"));
  insertMilestone({ id: "M001", title: "IAM Milestone", status: "active" });
  insertSlice({
    milestoneId: "M001",
    id: "S01",
    title: "Gate Slice",
    status: "pending",
    risk: "medium",
    depends: [],
  });
  insertGateRow({ milestoneId: "M001", sliceId: "S01", gateId: "Q3", scope: "slice" });
  insertGateRow({ milestoneId: "M001", sliceId: "S01", gateId: "Q4", scope: "slice" });
  return dbDir;
}

test("parallel research subagent prompts carry research-scout IAM envelopes with Omega artifact requirements", async () => {
  const repo = mkdtempSync(join(tmpdir(), "iam-research-envelope-"));
  try {
    mkdirSync(join(repo, ".gsd", "milestones", "M001", "slices", "S01"), { recursive: true });
    mkdirSync(join(repo, ".gsd", "milestones", "M001", "slices", "S02"), { recursive: true });

    const prompt = await buildParallelResearchSlicesPrompt(
      "M001",
      "IAM Milestone",
      [
        { id: "S01", title: "Alpha" },
        { id: "S02", title: "Beta" },
      ],
      repo,
      "claude-opus-4-6",
    );

    assert.match(prompt, /IAM_SUBAGENT_CONTRACT: role=research-scout; envelopeId=M001-parallel-research-S01-env/);
    assert.match(prompt, /- \*\*Parent Unit:\*\* `M001\/parallel-research`/);
    assert.match(prompt, /- \*\*Mutation Boundary:\*\* `research-artifact-only`/);
    assert.match(prompt, /`S01-research-report` \(`research-report`\).*S01-RESEARCH\.md/);
    assert.match(prompt, /`S01-omega-manifest` \(`manifest`\).*stageCount=10/);
    assert.match(prompt, /S06 Omega Phase Contract/);
    assert.match(prompt, /hammer_canonical_spiral/);
    assert.match(prompt, /per-slice Omega phase manifest/i);
    assert.match(prompt, /model: "claude-opus-4-6"/);
    assert.match(prompt, /No upstream Omega phase artifact context was found for S01/);
    assert.match(prompt, /research-artifact-only/);

    const marker = parseIAMSubagentContractMarker(prompt);
    assert.equal(marker.role, "research-scout");
    assert.equal(marker.envelopeId, "M001-parallel-research-S01-env");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("gate evaluator subagent prompts require gsd_save_gate_result and forbid unrelated mutations", async () => {
  const repo = mkdtempSync(join(tmpdir(), "iam-gate-envelope-"));
  const dbDir = seedGateDb(repo);
  try {
    setupSlice(repo);

    const prompt = await buildGateEvaluatePrompt(
      "M001",
      "IAM Milestone",
      "S01",
      "Gate Slice",
      repo,
      "claude-haiku-4-5",
    );

    assert.match(prompt, /IAM_SUBAGENT_CONTRACT: role=gate-evaluator; envelopeId=M001-S01-gates[^\n]*-Q3-env/);
    assert.match(prompt, /- \*\*Parent Unit:\*\* `M001\/S01\/gates\+Q3,Q4`/);
    assert.match(prompt, /- \*\*Mutation Boundary:\*\* `quality-gate-result-only`/);
    assert.match(prompt, /`Q3-gate-result` \(`gate-result`\).*gsd_save_gate_result/);
    assert.match(prompt, /Allowed Tool Calls\n- `gsd_save_gate_result`/);
    assert.match(prompt, /Forbid unrelated graph, memory, source, or planning mutations/);
    assert.match(prompt, /slice plan gate evidence/);
    assert.match(prompt, /model: "claude-haiku-4-5"/);
  } finally {
    closeDatabase();
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("reactive task subagent prompts include task IO, dependency paths, graph metrics, and output boundaries", async () => {
  const repo = mkdtempSync(join(tmpdir(), "iam-reactive-envelope-"));
  try {
    const sliceDir = setupSlice(repo);
    writeTaskPlan(sliceDir, "T01", "Build types", ["src/schema.json"], ["src/types.ts"]);
    writeTaskPlan(sliceDir, "T02", "Build models", ["src/config.json"], ["src/models.ts"]);

    const prompt = await buildReactiveExecutePrompt(
      "M001",
      "IAM Milestone",
      "S01",
      "Reactive Slice",
      ["T01", "T02"],
      repo,
      "claude-sonnet-4-5",
    );

    assert.match(prompt, /IAM_SUBAGENT_CONTRACT: role=task-executor; envelopeId=M001-S01-reactive-T01-T02-T01-env/);
    assert.match(prompt, /- \*\*Parent Unit:\*\* `M001\/S01\/reactive\+T01,T02`/);
    assert.match(prompt, /- \*\*Mutation Boundary:\*\* `task-expected-output-only`/);
    assert.match(prompt, /## Reactive Task IO Context/);
    assert.match(prompt, /Inputs: `src\/schema\.json`/);
    assert.match(prompt, /Expected outputs: `src\/types\.ts`/);
    assert.match(prompt, /`T01-output-1` \(`workflow-output`\).*src\/types\.ts/);
    assert.match(prompt, /`T01-task-summary` \(`task-summary`\)/);
    assert.match(prompt, /`T01-completion-tool-call` \(`tool-call`\).*gsd_complete_task/);
    assert.match(prompt, /## Reactive Graph Metrics/);
    assert.match(prompt, /- Tasks: 2/);
    assert.match(prompt, /- Edges: 0/);
    assert.match(prompt, /- Ready set size: 2/);
    assert.match(prompt, /## Dependency Summary Paths\n- \(none available\)/);
    assert.match(prompt, /task-expected-output-only/);
    assert.match(prompt, /model: "claude-sonnet-4-5"/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("reactive task envelope keeps ambiguity diagnostics when task IO is missing", async () => {
  const repo = mkdtempSync(join(tmpdir(), "iam-reactive-ambiguous-envelope-"));
  try {
    const sliceDir = setupSlice(repo);
    writeTaskPlan(sliceDir, "T01", "Build types", [], []);

    const prompt = await buildReactiveExecutePrompt(
      "M001",
      "IAM Milestone",
      "S01",
      "Reactive Slice",
      ["T01"],
      repo,
    );

    assert.match(prompt, /IAM_SUBAGENT_CONTRACT: role=task-executor/);
    assert.match(prompt, /Task T01 has no declared input files/);
    assert.match(prompt, /Task T01 has no declared expected output files/);
    assert.match(prompt, /graphMutationStatus: read-only/);
    assert.match(prompt, /task-expected-output-only/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
