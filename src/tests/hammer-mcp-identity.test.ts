/**
 * Hammer MCP identity tests — verifies server metadata, state-path resolution,
 * canonical tool names, legacy alias compatibility, and negative cases.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers to create temp project directories
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "hammer-mcp-test-"));
}

function cleanup(dirs: string[]): void {
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Test: MCP server metadata advertises Hammer identity
// ---------------------------------------------------------------------------

test("MCP SERVER_NAME is 'hammer' not 'gsd'", async () => {
  // Import is dynamic so TS subpath exports work under tsx
  const serverModule = await import("../../packages/mcp-server/src/server.js");
  // SERVER_NAME is not exported directly — verify via createMcpServer behaviour
  // by inspecting the source text for the constant assignment.
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  // Read src file relative to project root since we run from there
  const src = readFileSync(resolve("packages/mcp-server/src/server.ts"), "utf-8");
  assert.match(src, /SERVER_NAME\s*=\s*['"]hammer['"]/,
    "SERVER_NAME must be 'hammer'");
  assert.doesNotMatch(src, /const SERVER_NAME\s*=\s*['"]gsd['"]/,
    "SERVER_NAME must not be 'gsd'");
});

test("MCP package.json description mentions Hammer not GSD", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const pkg = JSON.parse(readFileSync(resolve("packages/mcp-server/package.json"), "utf-8"));
  assert.match(pkg.description, /[Hh]ammer/,
    "package description must mention Hammer");
  assert.doesNotMatch(pkg.description, /\bGSD\b/,
    "package description must not mention GSD");
});

test("MCP package.json has hammer-mcp-server bin entry", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const pkg = JSON.parse(readFileSync(resolve("packages/mcp-server/package.json"), "utf-8"));
  assert.ok("hammer-mcp-server" in pkg.bin,
    "package.json bin must include hammer-mcp-server");
});

test("MCP CLI stderr prefix uses hammer-mcp-server", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const src = readFileSync(resolve("packages/mcp-server/src/cli.ts"), "utf-8");
  assert.match(src, /hammer-mcp-server.*(?:Shutting|started|Fatal)/s,
    "cli.ts startup/shutdown messages must use hammer-mcp-server prefix");
  assert.doesNotMatch(src, /\[gsd-mcp-server\]/,
    "cli.ts must not use [gsd-mcp-server] prefix in startup/shutdown");
});

// ---------------------------------------------------------------------------
// Test: state path resolution — .hammer first, .gsd fallback
// ---------------------------------------------------------------------------

test("resolveHammerRoot: probes .hammer before .gsd in a project with both", async () => {
  const { resolveHammerRoot } = await import("../../packages/mcp-server/src/readers/paths.js");
  const tempDir = makeTempDir();
  const hammerDir = join(tempDir, ".hammer");
  const gsdDir = join(tempDir, ".gsd");
  mkdirSync(hammerDir, { recursive: true });
  mkdirSync(gsdDir, { recursive: true });

  try {
    const resolved = resolveHammerRoot(tempDir);
    assert.equal(resolved, hammerDir,
      "Should resolve to .hammer when both .hammer and .gsd exist");
    assert.doesNotMatch(resolved, /\.gsd/,
      "Must not use .gsd when .hammer is present");
  } finally {
    cleanup([tempDir]);
  }
});

test("resolveHammerRoot: falls back to .gsd for legacy-only projects", async () => {
  const { resolveHammerRoot } = await import("../../packages/mcp-server/src/readers/paths.js");
  const tempDir = makeTempDir();
  const gsdDir = join(tempDir, ".gsd");
  mkdirSync(gsdDir, { recursive: true });

  try {
    const resolved = resolveHammerRoot(tempDir);
    assert.equal(resolved, gsdDir,
      "Should fall back to .gsd when only .gsd exists");
  } finally {
    cleanup([tempDir]);
  }
});

test("resolveHammerRoot: returns .hammer (canonical) when neither exists", async () => {
  const { resolveHammerRoot } = await import("../../packages/mcp-server/src/readers/paths.js");
  const tempDir = makeTempDir();

  try {
    const resolved = resolveHammerRoot(tempDir);
    assert.match(resolved, /\.hammer$/,
      "Should return .hammer as the creation fallback for new projects");
  } finally {
    cleanup([tempDir]);
  }
});

test("resolveGsdRoot is a legacy alias that calls resolveHammerRoot", async () => {
  const { resolveHammerRoot, resolveGsdRoot } = await import("../../packages/mcp-server/src/readers/paths.js");
  const tempDir = makeTempDir();
  const hammerDir = join(tempDir, ".hammer");
  mkdirSync(hammerDir, { recursive: true });

  try {
    // Both should return the same path
    assert.equal(resolveGsdRoot(tempDir), resolveHammerRoot(tempDir),
      "resolveGsdRoot must return the same result as resolveHammerRoot");
  } finally {
    cleanup([tempDir]);
  }
});

// ---------------------------------------------------------------------------
// Test: WORKFLOW_TOOL_NAMES includes hammer_* as canonical
// ---------------------------------------------------------------------------

test("WORKFLOW_TOOL_NAMES includes hammer_* canonical tool names", async () => {
  const { WORKFLOW_TOOL_NAMES } = await import("../../packages/mcp-server/src/workflow-tools.js");
  const names = WORKFLOW_TOOL_NAMES as readonly string[];

  const canonicalExpected = [
    "hammer_decision_save",
    "hammer_plan_milestone",
    "hammer_plan_slice",
    "hammer_task_complete",
    "hammer_slice_complete",
    "hammer_milestone_status",
    "hammer_journal_query",
    "hammer_capture_thought",
    "hammer_memory_query",
    "hammer_memory_graph",
  ];

  for (const name of canonicalExpected) {
    assert.ok(names.includes(name), `WORKFLOW_TOOL_NAMES must include canonical tool '${name}'`);
  }
});

test("WORKFLOW_TOOL_NAMES retains gsd_* legacy aliases", async () => {
  const { WORKFLOW_TOOL_NAMES } = await import("../../packages/mcp-server/src/workflow-tools.js");
  const names = WORKFLOW_TOOL_NAMES as readonly string[];

  const legacyExpected = [
    "gsd_decision_save",
    "gsd_plan_milestone",
    "gsd_plan_slice",
    "gsd_task_complete",
    "gsd_slice_complete",
    "gsd_milestone_status",
    "gsd_journal_query",
    "gsd_capture_thought",
    "gsd_memory_query",
    "gsd_memory_graph",
  ];

  for (const name of legacyExpected) {
    assert.ok(names.includes(name), `WORKFLOW_TOOL_NAMES must retain legacy alias '${name}'`);
  }
});

// ---------------------------------------------------------------------------
// Test: workflow-tools.ts env var names use HAMMER_* with GSD_* fallback
// ---------------------------------------------------------------------------

test("workflow-tools.ts reads HAMMER_WORKFLOW_PROJECT_ROOT env var", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const src = readFileSync(resolve("packages/mcp-server/src/workflow-tools.ts"), "utf-8");
  assert.match(src, /HAMMER_WORKFLOW_PROJECT_ROOT/,
    "workflow-tools.ts must read HAMMER_WORKFLOW_PROJECT_ROOT");
});

test("workflow-tools.ts reads HAMMER_MCP_WORKFLOW_TIMEOUT_MS env var", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const src = readFileSync(resolve("packages/mcp-server/src/workflow-tools.ts"), "utf-8");
  assert.match(src, /HAMMER_MCP_WORKFLOW_TIMEOUT_MS/,
    "workflow-tools.ts must read HAMMER_MCP_WORKFLOW_TIMEOUT_MS");
});

// ---------------------------------------------------------------------------
// Negative tests (Q7)
// ---------------------------------------------------------------------------

test("Q7-NEG: a project with both .hammer and .gsd uses .hammer (not .gsd)", async () => {
  const { resolveHammerRoot } = await import("../../packages/mcp-server/src/readers/paths.js");
  const tempDir = makeTempDir();
  mkdirSync(join(tempDir, ".hammer"), { recursive: true });
  mkdirSync(join(tempDir, ".gsd"), { recursive: true });

  try {
    const result = resolveHammerRoot(tempDir);
    assert.ok(!result.includes(".gsd"), "Must not pick .gsd when .hammer is present");
    assert.ok(result.endsWith(".hammer"), "Must pick .hammer when both directories exist");
  } finally {
    cleanup([tempDir]);
  }
});

test("Q7-NEG: a legacy-only project uses .gsd only when compatibility is active", async () => {
  const { resolveHammerRoot } = await import("../../packages/mcp-server/src/readers/paths.js");
  const tempDir = makeTempDir();
  mkdirSync(join(tempDir, ".gsd"), { recursive: true });
  // No .hammer directory

  try {
    const result = resolveHammerRoot(tempDir);
    // Compatibility: .gsd is used as legacy fallback
    assert.ok(result.endsWith(".gsd"), "Legacy-only project must fall back to .gsd");
    // Canonical form is never .hammer when only .gsd exists
    assert.ok(!result.endsWith(".hammer"), "Must not create phantom .hammer for legacy-only project");
  } finally {
    cleanup([tempDir]);
  }
});

test("Q7-NEG: server.ts tool registrations do not conflate hammer_* and gsd_* canonical descriptions", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const src = readFileSync(resolve("packages/mcp-server/src/server.ts"), "utf-8");

  // The canonical hammer_execute description must not say "GSD auto-mode"
  const hammerExecMatch = src.match(/'hammer_execute'[^;]*?'([^']{5,}?)'/s);
  if (hammerExecMatch) {
    assert.doesNotMatch(hammerExecMatch[0], /GSD auto-mode/,
      "hammer_execute description must not say 'GSD auto-mode'");
  }

  // The legacy gsd_execute description must say "Legacy alias"
  const gsdExecMatch = src.match(/'gsd_execute'[^;]*?'(Legacy[^']{1,200})'/s);
  assert.ok(gsdExecMatch, "gsd_execute must be registered with a 'Legacy alias' description");
});
