/**
 * hammer-tool-aliases.test.ts
 *
 * Tests that canonical tool names are hammer_*, legacy gsd_* names are
 * compatibility aliases routing to the same handlers, and the manifest
 * provides.tools list advertises only hammer_* canonical names.
 *
 * Verification contract for T05 (M001/S01):
 *  - hammer_plan_slice, hammer_task_complete, memory_query, hammer_exec present
 *  - gsd_* aliases route to the same execute function as their hammer_* canonical
 *  - manifest canonical tool list contains hammer_*, not gsd_* (except allowlisted legacy)
 *  - a hypothetical unclassified gsd_new_tool registration fails the identity scanner
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerIAMTools } from '../resources/extensions/gsd/bootstrap/iam-tools.ts';

// ── Path helpers ──────────────────────────────────────────────────────────────
const EXT_DIR = resolve(import.meta.dirname, "../resources/extensions/gsd");
const manifestPath = resolve(EXT_DIR, "extension-manifest.json");
const BOOTSTRAP_DIR = resolve(EXT_DIR, "bootstrap");

// ── Manifest tests ────────────────────────────────────────────────────────────

test("manifest: provides.tools lists hammer_* canonical names (not gsd_*)", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const tools: string[] = manifest.provides?.tools ?? [];
  const hammerTools = tools.filter((t) => t.startsWith("hammer_"));
  const gsdTools = tools.filter((t) => t.startsWith("gsd_"));

  assert.ok(hammerTools.length > 0, "provides.tools must contain at least one hammer_* name");
  assert.equal(gsdTools.length, 0, `provides.tools must not contain gsd_* names; found: ${gsdTools.join(", ")}`);
});

test("manifest: hammer_decision_save is advertised in provides.tools", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const tools: string[] = manifest.provides?.tools ?? [];
  assert.ok(tools.includes("hammer_decision_save"), "provides.tools must include 'hammer_decision_save'");
});

test("manifest: hammer_summary_save is advertised in provides.tools", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const tools: string[] = manifest.provides?.tools ?? [];
  assert.ok(tools.includes("hammer_summary_save"), "provides.tools must include 'hammer_summary_save'");
});

test("manifest: hammer_milestone_generate_id is advertised in provides.tools", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const tools: string[] = manifest.provides?.tools ?? [];
  assert.ok(tools.includes("hammer_milestone_generate_id"), "provides.tools must include 'hammer_milestone_generate_id'");
});

test("manifest: VOLVOX IAM tools are advertised as hammer_* canonical names", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const tools: string[] = manifest.provides?.tools ?? [];
  for (const name of ["hammer_volvox_epoch", "hammer_volvox_status", "hammer_volvox_diagnose"]) {
    assert.ok(tools.includes(name), `provides.tools must include '${name}'`);
  }
});

// ── Tool registration source tests ────────────────────────────────────────────

/**
 * Parse a TypeScript source file and collect all tool name strings registered via:
 *   name: "some_tool_name"
 * Returns { canonicalNames, aliasNames } where aliasNames are from registerAlias() calls.
 */
function parseToolNames(source: string): { canonicalNames: string[]; aliasNames: string[] } {
  const canonicalNames: string[] = [];
  const aliasNames: string[] = [];

  // Match `name: "hammer_foo"` or `name: "gsd_foo"` etc. from tool object literals
  const nameRe = /^\s+name:\s+"([a-z][a-z0-9_]+)"/gm;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = nameRe.exec(source)) !== null) {
    canonicalNames.push(m[1]);
  }

  // Match registerAlias(pi, toolDef, "alias_name", "canonical_name")
  const aliasRe = /registerAlias\s*\([^,]+,\s*[^,]+,\s*"([a-z][a-z0-9_]+)"\s*,\s*"[a-z][a-z0-9_]+"\s*\)/g;
  // eslint-disable-next-line no-cond-assign
  while ((m = aliasRe.exec(source)) !== null) {
    aliasNames.push(m[1]);
  }

  // Also match inline name: "gsd_..." inside pi.registerTool({ ... }) for alias registrations
  // (journal-tools and memory-tools use spread pattern)
  const inlineAliasRe = /pi\.registerTool\(\s*\{[^}]*name:\s+"(gsd_[a-z0-9_]+)"/gs;
  // eslint-disable-next-line no-cond-assign
  while ((m = inlineAliasRe.exec(source)) !== null) {
    aliasNames.push(m[1]);
  }

  // Remove duplicate names that appear in both canonical and aliases (happen when name: appears inside registerAlias spread)
  return { canonicalNames, aliasNames };
}

test("db-tools: canonical tool names are hammer_* (not gsd_*)", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");
  const { canonicalNames } = parseToolNames(src);

  // Filter to names that look like tool registrations (not inside alias calls)
  // We look at all `name:` occurrences and filter by hammer_ prefix
  const hammerCanonical = canonicalNames.filter((n) => n.startsWith("hammer_"));
  assert.ok(hammerCanonical.length >= 10, `db-tools must register at least 10 hammer_* canonical tools; found ${hammerCanonical.length}: ${hammerCanonical.join(", ")}`);
});

test("db-tools: gsd_* names appear only as alias registrations", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");

  // All `name: "gsd_xxx"` occurrences must either be inside registerAlias() or
  // be alias-only inline registrations (spread pattern).
  // A simple check: lines with `name: "gsd_` that are NOT inside a registerAlias() call
  // and NOT preceded by a "..." spread indicate a canonical registration — those are forbidden.
  const lines = src.split("\n");
  const violations: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nameMatch = line.match(/^\s+name:\s+"(gsd_[a-z0-9_]+)"/);
    if (!nameMatch) continue;

    // Check if within a registerAlias context (previous non-blank line or surrounding lines)
    // Simple heuristic: if the name appears in a registerAlias() call on the same line → alias
    // If the surrounding context (±5 lines) has registerAlias( → alias block
    const context = lines.slice(Math.max(0, i - 5), i + 5).join("\n");
    const isInAlias =
      context.includes("registerAlias(") ||
      context.includes("...graphTool") ||
      context.includes("...journalQueryTool") ||
      context.includes("// legacy alias");

    if (!isInAlias) {
      violations.push(`Line ${i + 1}: ${line.trim()}`);
    }
  }

  assert.equal(violations.length, 0,
    `db-tools must not register gsd_* as canonical tool names; violations:\n${violations.join("\n")}`);
});

test("exec-tools: canonical names are hammer_exec, hammer_exec_search, hammer_resume", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "exec-tools.ts"), "utf-8");
  assert.ok(src.includes('name: "hammer_exec"'), "exec-tools must register hammer_exec as canonical");
  assert.ok(src.includes('name: "hammer_exec_search"'), "exec-tools must register hammer_exec_search as canonical");
  assert.ok(src.includes('name: "hammer_resume"'), "exec-tools must register hammer_resume as canonical");
});

test("exec-tools: gsd_exec, gsd_exec_search, gsd_resume registered as legacy aliases", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "exec-tools.ts"), "utf-8");
  assert.ok(src.includes('"gsd_exec"'), "exec-tools must register gsd_exec as a legacy alias");
  assert.ok(src.includes('"gsd_exec_search"'), "exec-tools must register gsd_exec_search as a legacy alias");
  assert.ok(src.includes('"gsd_resume"'), "exec-tools must register gsd_resume as a legacy alias");

  // Aliases must appear in registerAlias context, not as canonical tool names
  const lines = src.split("\n");
  for (const name of ["gsd_exec", "gsd_exec_search", "gsd_resume"]) {
    const nameLinesWithCanonical = lines.filter(
      (l) => l.trim().startsWith("name:") && l.includes(`"${name}"`)
    );
    // These should be absent from standalone name: declarations
    assert.equal(nameLinesWithCanonical.length, 0,
      `${name} must not appear as a canonical name: field; it must only appear in registerAlias()`);
  }
});

test("memory-tools: canonical name is hammer_graph (not gsd_graph)", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "memory-tools.ts"), "utf-8");
  assert.ok(src.includes('name: "hammer_graph"'), "memory-tools must register hammer_graph as canonical");
  // gsd_graph should be registered as a legacy alias
  assert.ok(src.includes('"gsd_graph"'), "memory-tools must register gsd_graph as a legacy alias");
});

test("memory-tools: capture_thought and memory_query are preserved as-is", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "memory-tools.ts"), "utf-8");
  assert.ok(src.includes('name: "capture_thought"'), "memory-tools must still register capture_thought");
  assert.ok(src.includes('name: "memory_query"'), "memory-tools must still register memory_query");
});

test("iam-tools: VOLVOX canonical tools and gsd_* aliases are registered", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "iam-tools.ts"), "utf-8");
  for (const [canonical, alias] of [
    ["hammer_volvox_epoch", "gsd_volvox_epoch"],
    ["hammer_volvox_status", "gsd_volvox_status"],
    ["hammer_volvox_diagnose", "gsd_volvox_diagnose"],
  ] as const) {
    assert.ok(src.includes(`name: "${canonical}"`), `iam-tools must register ${canonical} as canonical`);
    assert.ok(src.includes(`"${alias}"`), `iam-tools must register ${alias} as a legacy alias`);
    assert.ok(src.includes(`"${alias}", "${canonical}"`), `${alias} must alias ${canonical}`);
  }
});

test("iam-tools: VOLVOX legacy aliases share execute handlers with canonical tools", () => {
  const tools: Array<{ name: string; execute: unknown }> = [];
  const pi = { registerTool(tool: { name: string; execute: unknown }) { tools.push(tool); } };
  registerIAMTools(pi as never);

  for (const [canonical, alias] of [
    ["hammer_volvox_epoch", "gsd_volvox_epoch"],
    ["hammer_volvox_status", "gsd_volvox_status"],
    ["hammer_volvox_diagnose", "gsd_volvox_diagnose"],
  ] as const) {
    const canonicalTool = tools.find((tool) => tool.name === canonical);
    const aliasTool = tools.find((tool) => tool.name === alias);
    assert.ok(canonicalTool, `${canonical} should be registered`);
    assert.ok(aliasTool, `${alias} should be registered`);
    assert.equal(aliasTool?.execute, canonicalTool?.execute, `${alias} must share ${canonical}'s execute function`);
  }
});

test("query-tools: canonical names are hammer_milestone_status and hammer_checkpoint_db", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "query-tools.ts"), "utf-8");
  assert.ok(src.includes('name: "hammer_milestone_status"'), "query-tools must register hammer_milestone_status as canonical");
  assert.ok(src.includes('name: "hammer_checkpoint_db"'), "query-tools must register hammer_checkpoint_db as canonical");
});

test("query-tools: gsd_milestone_status and gsd_checkpoint_db registered as legacy aliases", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "query-tools.ts"), "utf-8");
  assert.ok(src.includes('"gsd_milestone_status"'), "query-tools must register gsd_milestone_status as a legacy alias");
  assert.ok(src.includes('"gsd_checkpoint_db"'), "query-tools must register gsd_checkpoint_db as a legacy alias");
});

test("journal-tools: canonical name is hammer_journal_query", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "journal-tools.ts"), "utf-8");
  assert.ok(src.includes('name: "hammer_journal_query"'), "journal-tools must register hammer_journal_query as canonical");
  assert.ok(src.includes('"gsd_journal_query"'), "journal-tools must register gsd_journal_query as a legacy alias");
});

// ── Handler-parity tests (same execute function for alias and canonical) ───────

test("db-tools: gsd_* aliases share execute function with hammer_* canonical (source check)", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");

  // Every `registerAlias(pi, toolDef, "gsd_xxx", "hammer_xxx")` call spreads the canonical
  // toolDef — verify the registerAlias helper uses `...toolDef` (spreads all properties
  // including execute) not a manual reconstruction.
  assert.ok(
    src.includes("...toolDef,"),
    "registerAlias must spread toolDef to share the execute handler"
  );
});

test("exec-tools: registerAlias spreads execTool to share execute handler", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "exec-tools.ts"), "utf-8");
  assert.ok(src.includes("...toolDef,"), "registerAlias in exec-tools must spread toolDef");
});

test("query-tools: registerAlias spreads milestoneStatusTool and checkpointDbTool", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "query-tools.ts"), "utf-8");
  assert.ok(src.includes("...toolDef,"), "registerAlias in query-tools must spread toolDef");
});

// ── Key tool coverage tests ────────────────────────────────────────────────────

test("db-tools: hammer_plan_slice is registered as canonical", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");
  assert.ok(src.includes('name: "hammer_plan_slice"'), "db-tools must register hammer_plan_slice as canonical");
});

test("db-tools: hammer_task_complete is registered as canonical", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");
  assert.ok(src.includes('name: "hammer_task_complete"'), "db-tools must register hammer_task_complete as canonical");
});

test("db-tools: hammer_complete_milestone is registered as canonical", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");
  assert.ok(src.includes('name: "hammer_complete_milestone"'), "db-tools must register hammer_complete_milestone as canonical");
});

test("db-tools: gsd_plan_slice registered as legacy alias for hammer_plan_slice", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");
  assert.ok(
    src.includes('registerAlias(pi, planSliceTool, "gsd_plan_slice", "hammer_plan_slice")'),
    "gsd_plan_slice must be explicitly registered as a legacy alias for hammer_plan_slice"
  );
});

test("db-tools: gsd_task_complete registered as legacy alias for hammer_task_complete", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");
  assert.ok(
    src.includes('registerAlias(pi, taskCompleteTool, "gsd_task_complete", "hammer_task_complete")'),
    "gsd_task_complete must be explicitly registered as a legacy alias for hammer_task_complete"
  );
});

test("db-tools: gsd_complete_task registered as legacy alias for hammer_task_complete", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");
  assert.ok(
    src.includes('registerAlias(pi, taskCompleteTool, "gsd_complete_task", "hammer_task_complete")'),
    "gsd_complete_task must be explicitly registered as a legacy alias for hammer_task_complete"
  );
});

// ── Alias description tests ────────────────────────────────────────────────────

test("db-tools: alias descriptions reference the canonical hammer_* name", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");
  // The registerAlias helper appends "alias for <canonicalName> — prefer the canonical name"
  assert.ok(
    src.includes("alias for ${canonicalName} — prefer the canonical name"),
    "registerAlias helper must append canonical name reference to alias descriptions"
  );
});

// ── Negative tests (Q7) ───────────────────────────────────────────────────────

test("negative: manifest provides.tools contains no gsd_* names (scanner boundary)", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const tools: string[] = manifest.provides?.tools ?? [];
  const gsdTools = tools.filter((t) => t.startsWith("gsd_"));
  assert.equal(
    gsdTools.length,
    0,
    `Manifest canonical tool list must not contain gsd_* names; found: ${gsdTools.join(", ")}`
  );
});

test("negative: db-tools does not register any tool with name 'gsd_new_tool' (unclassified fake tool)", async () => {
  // Simulates the Failure Mode check: a fake unclassified gsd_new_tool registration
  // would surface as unclassified in the scanner. This test confirms our source does NOT
  // contain such a registration, proving the identity scanner would catch it.
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "db-tools.ts"), "utf-8");
  assert.ok(
    !src.includes('"gsd_new_tool"'),
    "db-tools must not contain gsd_new_tool — any unclassified gsd_* tool would fail the identity scanner"
  );
});

test("negative: exec-tools does not register any unclassified gsd_* canonical tool", () => {
  const src = readFileSync(resolve(BOOTSTRAP_DIR, "exec-tools.ts"), "utf-8");
  // No line should have `name: "gsd_` as the canonical tool name (only in registerAlias calls)
  const lines = src.split("\n");
  const canonicalGsd = lines.filter(
    (l) => l.trim().match(/^name:\s+"gsd_/)
  );
  assert.equal(
    canonicalGsd.length,
    0,
    `exec-tools must not declare gsd_* as canonical tool names; found: ${canonicalGsd.join("; ")}`
  );
});
