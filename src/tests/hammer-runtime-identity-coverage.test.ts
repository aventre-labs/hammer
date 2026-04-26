/**
 * hammer-runtime-identity-coverage.test.ts
 *
 * Cross-surface runtime identity coverage test.
 *
 * Exercises representative Hammer identity constants/metadata from CLI,
 * state, extension manifest, headless/browser dispatch, MCP server, and
 * shortcut-defs surfaces — ensuring all key surfaces consistently use
 * Hammer-first identity rather than GSD identity.
 *
 * This is the closure test for S01: each surface covered here is one whose
 * identity has been cut over in T01–T07, and this file verifies the
 * cut-over holds as an integrated assertion.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ── Identity constants ──────────────────────────────────────────────────────

import {
  HAMMER_CANONICAL_IDENTITY,
  HAMMER_CLI_COMMAND,
  HAMMER_DISPLAY_NAME,
  HAMMER_PACKAGE_NAME,
  HAMMER_PRODUCT_NAME,
  HAMMER_PUBLIC_TOOL_PREFIX,
  HAMMER_SLASH_COMMAND,
  HAMMER_STATE_DIR_NAME,
  HAMMER_MCP_SERVER_NAME,
  HAMMER_WORKFLOW_EXTENSION_ID,
  HAMMER_WORKFLOW_EXTENSION_NAME,
  HAMMER_LEGACY_CLI_COMMAND,
} from "../hammer-identity/index.ts";

// ── CLI surface ─────────────────────────────────────────────────────────────

test("CLI identity: HAMMER_CLI_COMMAND is 'hammer'", () => {
  assert.equal(HAMMER_CLI_COMMAND, "hammer");
});

test("CLI identity: HAMMER_SLASH_COMMAND is '/hammer'", () => {
  assert.equal(HAMMER_SLASH_COMMAND, "/hammer");
});

test("CLI identity: HAMMER_DISPLAY_NAME is 'Hammer'", () => {
  assert.equal(HAMMER_DISPLAY_NAME, "Hammer");
});

test("CLI identity: HAMMER_PRODUCT_NAME is 'hammer'", () => {
  assert.equal(HAMMER_PRODUCT_NAME, "hammer");
});

test("CLI identity: HAMMER_PACKAGE_NAME is 'hammer-pi'", () => {
  assert.equal(HAMMER_PACKAGE_NAME, "hammer-pi");
});

test("CLI identity: legacy CLI command is 'gsd'", () => {
  assert.equal(HAMMER_LEGACY_CLI_COMMAND, "gsd");
});

// ── State surface ───────────────────────────────────────────────────────────

test("State identity: state dir name is '.hammer'", () => {
  assert.equal(HAMMER_STATE_DIR_NAME, ".hammer");
});

test("State identity: canonical identity object has correct state dir", () => {
  assert.equal(HAMMER_CANONICAL_IDENTITY.state.projectStateDirName, ".hammer");
});

test("State identity: canonical identity has 'HAMMER_HOME' env var", () => {
  assert.equal(HAMMER_CANONICAL_IDENTITY.state.env.home, "HAMMER_HOME");
});

test("State identity: legacy env alias for home is 'GSD_HOME'", () => {
  assert.equal(HAMMER_CANONICAL_IDENTITY.legacyEnvAliases.home, "GSD_HOME");
});

// ── Extension command surface ───────────────────────────────────────────────

test("Extension manifest: id is 'hammer'", () => {
  const manifestPath = resolve(
    import.meta.dirname,
    "../resources/extensions/gsd/extension-manifest.json",
  );
  assert.ok(existsSync(manifestPath), "extension-manifest.json must exist");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.id, "hammer", "manifest id must be 'hammer'");
});

test("Extension manifest: provides.commands includes 'hammer'", () => {
  const manifestPath = resolve(
    import.meta.dirname,
    "../resources/extensions/gsd/extension-manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const commands: string[] = manifest.provides?.commands ?? [];
  assert.ok(
    commands.includes("hammer"),
    `manifest.provides.commands must include 'hammer', got: ${JSON.stringify(commands)}`,
  );
});

test("Extension manifest: provides.commands does NOT include bare 'gsd'", () => {
  const manifestPath = resolve(
    import.meta.dirname,
    "../resources/extensions/gsd/extension-manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const commands: string[] = manifest.provides?.commands ?? [];
  assert.ok(
    !commands.includes("gsd"),
    `manifest.provides.commands must not list 'gsd' (it is a hidden legacy alias), got: ${JSON.stringify(commands)}`,
  );
});

// ── Tool naming surface ─────────────────────────────────────────────────────

test("Tool naming: public tool prefix is 'hammer_'", () => {
  assert.equal(HAMMER_PUBLIC_TOOL_PREFIX, "hammer_");
});

test("Tool naming: canonical identity exposes 'hammer_' prefix", () => {
  assert.equal(HAMMER_CANONICAL_IDENTITY.publicToolPrefix, "hammer_");
});

// ── MCP server surface ──────────────────────────────────────────────────────

test("MCP server: SERVER_NAME constant is 'hammer'", () => {
  assert.equal(HAMMER_MCP_SERVER_NAME, "hammer");
});

test("MCP server: package.json has hammer-mcp-server bin entry", () => {
  const pkgPath = resolve(
    import.meta.dirname,
    "../../packages/mcp-server/package.json",
  );
  assert.ok(existsSync(pkgPath), "mcp-server package.json must exist");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  assert.ok(
    typeof pkg.bin?.["hammer-mcp-server"] === "string",
    `bin.hammer-mcp-server must be defined; got bin: ${JSON.stringify(pkg.bin)}`,
  );
});

// ── Browser/headless surface ────────────────────────────────────────────────

test("Browser dispatch: hammer-* surface names are defined in contract", () => {
  const contractPath = resolve(
    import.meta.dirname,
    "../../web/lib/command-surface-contract.ts",
  );
  assert.ok(existsSync(contractPath), "command-surface-contract.ts must exist");
  const src = readFileSync(contractPath, "utf-8");
  assert.match(src, /["']hammer-status["']/, "contract must include 'hammer-status' surface");
  assert.match(src, /["']hammer-forensics["']/, "contract must include 'hammer-forensics' surface");
  assert.match(src, /["']hammer-doctor["']/, "contract must include 'hammer-doctor' surface");
});

test("Headless: /hammer command is the canonical injection string", () => {
  const headlessPath = resolve(import.meta.dirname, "../headless.ts");
  assert.ok(existsSync(headlessPath), "headless.ts must exist");
  const src = readFileSync(headlessPath, "utf-8");
  // Verify /hammer is the canonical command — /gsd is a legacy alias
  assert.match(src, /["'`]\/hammer\s*\$\{/, "headless.ts must inject /hammer ${command}");
});

// ── Shortcut definitions surface ────────────────────────────────────────────

test("Shortcut defs: dashboard command is '/hammer status'", () => {
  import("../resources/extensions/gsd/shortcut-defs.ts").then((m) => {
    assert.equal(
      m.GSD_SHORTCUTS.dashboard.command,
      "/hammer status",
      "dashboard shortcut command must be '/hammer status'",
    );
  });
});

test("Shortcut defs: dashboard action says 'Hammer' not 'GSD'", async () => {
  const m = await import("../resources/extensions/gsd/shortcut-defs.ts");
  assert.match(
    m.GSD_SHORTCUTS.dashboard.action,
    /Hammer/i,
    "dashboard action must mention 'Hammer'",
  );
  assert.doesNotMatch(
    m.GSD_SHORTCUTS.dashboard.action,
    /^Open GSD\b/,
    "dashboard action must not say 'Open GSD'",
  );
});

test("Shortcut defs: parallel command is '/hammer parallel watch'", async () => {
  const m = await import("../resources/extensions/gsd/shortcut-defs.ts");
  assert.equal(
    m.GSD_SHORTCUTS.parallel.command,
    "/hammer parallel watch",
    "parallel shortcut command must be '/hammer parallel watch'",
  );
});

// ── Installer surface ───────────────────────────────────────────────────────

test("Installer: help output mentions 'Hammer Installer' not 'GSD Installer'", () => {
  const installPath = resolve(import.meta.dirname, "../../scripts/install.js");
  assert.ok(existsSync(installPath), "scripts/install.js must exist");
  const src = readFileSync(installPath, "utf-8");
  assert.match(src, /Hammer Installer/, "installer help must say 'Hammer Installer'");
  assert.doesNotMatch(src, /GSD Installer/, "installer help must not say 'GSD Installer'");
});

test("Installer: recommend 'hammer-pi' not 'gsd-pi'", () => {
  const installPath = resolve(import.meta.dirname, "../../scripts/install.js");
  const src = readFileSync(installPath, "utf-8");
  assert.match(src, /hammer-pi@latest/, "installer must recommend 'hammer-pi@latest'");
  assert.doesNotMatch(
    src,
    /npx gsd-pi@latest\s+Install [A-Z]/,
    "installer must not recommend 'npx gsd-pi@latest' for primary install",
  );
});

test("Installer: ready message says 'Run: hammer'", () => {
  const installPath = resolve(import.meta.dirname, "../../scripts/install.js");
  const src = readFileSync(installPath, "utf-8");
  assert.match(src, /Run:.*hammer/, "installer ready message must say 'Run: hammer'");
  assert.doesNotMatch(src, /Run:.*gsd\b/, "installer ready message must not say 'Run: gsd'");
});

// ── Update check surface ────────────────────────────────────────────────────

test("Update check: NPM_PACKAGE_NAME is 'hammer-pi'", () => {
  const updatePath = resolve(import.meta.dirname, "../update-check.ts");
  assert.ok(existsSync(updatePath), "src/update-check.ts must exist");
  const src = readFileSync(updatePath, "utf-8");
  assert.match(
    src,
    /NPM_PACKAGE_NAME\s*=\s*['"]hammer-pi['"]/,
    "NPM_PACKAGE_NAME must be 'hammer-pi'",
  );
  assert.doesNotMatch(
    src,
    /NPM_PACKAGE_NAME\s*=\s*['"]gsd-pi['"]/,
    "NPM_PACKAGE_NAME must not be 'gsd-pi'",
  );
});

test("Update check: update banner mentions '/hammer update'", () => {
  const updatePath = resolve(import.meta.dirname, "../update-check.ts");
  const src = readFileSync(updatePath, "utf-8");
  assert.match(src, /\/hammer update/, "update banner must mention '/hammer update'");
  assert.doesNotMatch(src, /\/gsd update/, "update banner must not mention '/gsd update'");
});

// ── Workflow extension surface ──────────────────────────────────────────────

test("Workflow extension: extension id is 'hammer'", () => {
  assert.equal(HAMMER_WORKFLOW_EXTENSION_ID, "hammer");
});

test("Workflow extension: extension name is 'Hammer Workflow'", () => {
  assert.equal(HAMMER_WORKFLOW_EXTENSION_NAME, "Hammer Workflow");
});

// ─── Negative tests (Q7) ────────────────────────────────────────────────────

test("NEGATIVE: shortcut commands do not use '/gsd' as canonical", async () => {
  const m = await import("../resources/extensions/gsd/shortcut-defs.ts");
  for (const [id, def] of Object.entries(m.GSD_SHORTCUTS)) {
    assert.doesNotMatch(
      def.command,
      /^\/gsd\b/,
      `GSD_SHORTCUTS.${id}.command must not start with '/gsd' — got '${def.command}'`,
    );
  }
});

test("NEGATIVE: scanner enforcement finds zero unclassified GSD references", async () => {
  const { runHammerIdentityScan } = await import("../../scripts/check-hammer-identity.mjs");
  const result = await runHammerIdentityScan({
    root: resolve(import.meta.dirname, "../.."),
    enforce: true,
  });
  assert.equal(
    result.summary.unclassifiedCount,
    0,
    `Scanner must find zero unclassified references, found ${result.summary.unclassifiedCount}:\n` +
      result.findings
        .filter((f) => f.category === "unclassified-visible-gsd")
        .slice(0, 10)
        .map((f) => `  ${f.filePath}:${f.lineNumber} [${f.terms.join(",")}] ${f.line.trim()}`)
        .join("\n"),
  );
});
