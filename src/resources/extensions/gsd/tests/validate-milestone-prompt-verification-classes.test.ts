import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildValidateMilestonePrompt } from "../auto-prompts.ts";

const promptPath = join(process.cwd(), "src/resources/extensions/gsd/prompts/validate-milestone.md");
const prompt = readFileSync(promptPath, "utf-8");

function makeTmpBase(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-val-vc-prompt-"));
  mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01"), { recursive: true });
  writeFileSync(join(base, ".gsd", "milestones", "M001", "M001-ROADMAP.md"), `# M001: Test Milestone

## Vision
Test

## Success Criteria
- It works

## Slices

- [x] **S01: First slice** \`risk:low\` \`depends:[]\`
  > Done

## Boundary Map

| From | To | Produces | Consumes |
|------|-----|----------|----------|
| S01 | terminal | output | nothing |
`);
  writeFileSync(join(base, ".gsd", "milestones", "M001", "M001-CONTEXT.md"), "# M001 Context\n\nAcceptance criteria.\n");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-SUMMARY.md"), "# S01 Summary\nDelivered.\n");
  writeFileSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-ASSESSMENT.md"), "---\nverdict: PASS\n---\n# Assessment\nEvidence.\n");
  return base;
}

test("validate-milestone rendered reviewer C requires canonical verification class names", async () => {
  const base = makeTmpBase();
  try {
    const rendered = await buildValidateMilestonePrompt("M001", "Test Milestone", base);
    assert.match(rendered, /\*\*Reviewer C[\s\S]*Verification Classes/i);
    assert.match(rendered, /exact class names [`']?Contract[`']?, [`']?Integration[`']?, [`']?Operational[`']?, and [`']?UAT[`']?/i);
    assert.match(rendered, /If no verification classes were planned, say that explicitly/i);
    assert.match(rendered, /expectedValidationSection: Assessment & Acceptance Criteria/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("validate-milestone prompt routes verification class analysis into verificationClasses", () => {
  assert.match(prompt, /pass it in `verificationClasses`/i);
  assert.match(prompt, /Extract the `Verification Classes` subsection from Reviewer C and pass it verbatim in `verificationClasses`/);
  assert.match(prompt, /\{\{reviewerPrompts\}\}/, "reviewer details should be supplied by the IAM renderer variable");
});
