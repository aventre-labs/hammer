import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ExtensionContext } from "@gsd/pi-coding-agent";

import {
  buildBeforeAgentStartResult,
  loadKnowledgeBlock,
} from "../bootstrap/system-context.ts";
import { clearPathCache } from "../paths.ts";
import { _clearPromptTemplateCacheForTests } from "../prompt-loader.ts";
import {
  closeDatabase,
  insertMilestone,
  insertSlice,
  insertTask,
  openDatabase,
} from "../gsd-db.ts";

const tmpDirs: string[] = [];
let savedCwd: string | undefined;
let savedHammerHome: string | undefined;
let savedGsdHome: string | undefined;

function makeTempProject(prefix = "hammer-system-context-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeCtx(notifications: Array<{ message: string; level?: string }> = []): ExtensionContext {
  return {
    ui: {
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
    },
  } as unknown as ExtensionContext;
}

function seedExecutingState(base: string): void {
  mkdirSync(join(base, ".hammer", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
  writeFileSync(
    join(base, ".hammer", "milestones", "M001", "M001-ROADMAP.md"),
    [
      "# M001: Test",
      "",
      "**Vision:** Test state.",
      "",
      "## Slices",
      "",
      "- [ ] **S01: Test Slice** `risk:low` `depends:[]`",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(base, ".hammer", "milestones", "M001", "slices", "S01", "S01-PLAN.md"),
    [
      "# S01: Test Slice",
      "",
      "**Goal:** Test Hammer context.",
      "**Demo:** Visible context injection.",
      "",
      "## Verification",
      "- run tests",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(base, ".hammer", "milestones", "M001", "slices", "S01", "tasks", "T01-PLAN.md"),
    [
      "# T01: Test Task",
      "",
      "## Steps",
      "1. Verify Hammer guided injection.",
      "",
    ].join("\n"),
  );

  openDatabase(join(base, ".hammer", "gsd.db"));
  insertMilestone({ id: "M001", title: "Test", status: "active" });
  insertSlice({ id: "S01", milestoneId: "M001", title: "Test Slice", status: "pending", risk: "low", depends: [] });
  insertTask({ id: "T01", sliceId: "S01", milestoneId: "M001", title: "Test Task", status: "pending" });
}

afterEach(() => {
  try { closeDatabase(); } catch { /* best-effort */ }
  if (savedCwd !== undefined) {
    try { process.chdir(savedCwd); } catch { /* best-effort */ }
    savedCwd = undefined;
  }
  if (savedHammerHome === undefined) delete process.env.HAMMER_HOME;
  else process.env.HAMMER_HOME = savedHammerHome;
  if (savedGsdHome === undefined) delete process.env.GSD_HOME;
  else process.env.GSD_HOME = savedGsdHome;
  savedHammerHome = undefined;
  savedGsdHome = undefined;
  clearPathCache();
  _clearPromptTemplateCacheForTests();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildBeforeAgentStartResult injects Hammer-facing system context labels", async () => {
  const base = makeTempProject();
  const hammerHome = makeTempProject("hammer-home-");
  mkdirSync(join(base, ".hammer"), { recursive: true });
  writeFileSync(
    join(base, ".hammer", "PREFERENCES.md"),
    [
      "---",
      "version: 1",
      "always_use_skills:",
      "  - does-not-exist",
      "---",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(base, ".hammer", "CODEBASE.md"),
    [
      "# CODEBASE",
      "",
      "Generated: 2026-04-27T00:00:00.000Z",
      "",
      "Hammer test map.",
      "",
    ].join("\n"),
  );

  savedCwd = process.cwd();
  savedHammerHome = process.env.HAMMER_HOME;
  savedGsdHome = process.env.GSD_HOME;
  process.env.HAMMER_HOME = hammerHome;
  delete process.env.GSD_HOME;
  process.chdir(base);

  const notifications: Array<{ message: string; level?: string }> = [];
  const result = await buildBeforeAgentStartResult(
    { prompt: "hello", systemPrompt: "base system" },
    makeCtx(notifications),
  );

  assert.ok(result, "Hammer project should receive injected system context");
  assert.match(result!.systemPrompt, /\[SYSTEM CONTEXT — HAMMER\]/);
  assert.match(result!.systemPrompt, /## Hammer Skill Preferences/);
  assert.match(result!.systemPrompt, /\[PROJECT CODEBASE — Hammer file structure and descriptions/);
  assert.match(result!.systemPrompt, /use \/hammer codebase stats for status/);
  assert.doesNotMatch(result!.systemPrompt, /\[SYSTEM CONTEXT — GSD\]/);
  assert.doesNotMatch(result!.systemPrompt, /^## GSD Skill Preferences/m);
  assert.ok(
    notifications.some((note) => note.message.startsWith("Hammer skill preferences:")),
    `expected Hammer skill warning, got ${JSON.stringify(notifications)}`,
  );
});

test("buildBeforeAgentStartResult guided execute context uses Hammer labels and preserves legacy DB-backed resolution", async () => {
  const base = makeTempProject();
  savedCwd = process.cwd();
  savedHammerHome = process.env.HAMMER_HOME;
  savedGsdHome = process.env.GSD_HOME;
  process.env.HAMMER_HOME = makeTempProject("hammer-home-");
  delete process.env.GSD_HOME;
  process.chdir(base);
  seedExecutingState(base);

  const result = await buildBeforeAgentStartResult(
    {
      prompt: 'Execute the next task: T01 ("Test Task") in slice S01 of milestone M001',
      systemPrompt: "base system",
    },
    makeCtx(),
  );

  assert.ok(result?.message, "guided execution should inject a context message");
  assert.equal(result!.message!.customType, "gsd-guided-context");
  assert.match(result!.message!.content, /\[Hammer Guided Execute Context\]/);
  assert.match(result!.message!.content, /preserve IAM awareness\/provenance/);
  assert.match(result!.message!.content, /Source: `.gsd\/milestones\/M001\/slices\/S01\/tasks\/T01-PLAN\.md`/);
  assert.doesNotMatch(result!.message!.content, /\[GSD Guided Execute Context\]/);
});

test("loadKnowledgeBlock uses Hammer label and falls back to legacy global knowledge bridge", () => {
  const base = makeTempProject();
  const hammerHome = makeTempProject("hammer-home-");
  const legacyHome = makeTempProject("legacy-gsd-home-");
  mkdirSync(join(base, ".hammer"), { recursive: true });
  mkdirSync(join(legacyHome, "agent"), { recursive: true });
  writeFileSync(join(legacyHome, "agent", "KNOWLEDGE.md"), "K001: Legacy global bridge knowledge.");

  savedGsdHome = process.env.GSD_HOME;
  process.env.GSD_HOME = legacyHome;

  const result = loadKnowledgeBlock(hammerHome, base, legacyHome);
  assert.match(result.block, /\[KNOWLEDGE — Hammer rules, patterns, and lessons learned\]/);
  assert.match(result.block, /Legacy global bridge knowledge/);
});
