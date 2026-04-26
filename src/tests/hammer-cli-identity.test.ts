import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// Fixtures — read real files rather than importing dynamic modules, so these
// tests are stable and do not require a build step.
// ---------------------------------------------------------------------------
const rootPkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const pkgPkg = JSON.parse(readFileSync(resolve(ROOT, "pkg/package.json"), "utf8"));
const helpText = readFileSync(resolve(ROOT, "src/help-text.ts"), "utf8");
const loaderText = readFileSync(resolve(ROOT, "src/loader.ts"), "utf8");
const cliText = readFileSync(resolve(ROOT, "src/cli.ts"), "utf8");

// ---------------------------------------------------------------------------
// Package metadata — Hammer-first
// ---------------------------------------------------------------------------

test("root package.json name is hammer-pi", () => {
  assert.equal(rootPkg.name, "hammer-pi");
});

test("root package.json primary bins are hammer and hammer-cli", () => {
  assert.equal(rootPkg.bin.hammer, "dist/loader.js");
  assert.equal(rootPkg.bin["hammer-cli"], "dist/loader.js");
  assert.equal(rootPkg.bin["hammer-pi"], "scripts/install.js");
});

test("root package.json piConfig.name is hammer and configDir is .hammer", () => {
  assert.equal(rootPkg.piConfig?.name, "hammer");
  assert.equal(rootPkg.piConfig?.configDir, ".hammer");
});

test("root package.json description mentions Hammer", () => {
  assert.match(rootPkg.description, /[Hh]ammer/);
});

test("pkg/package.json piConfig.name is hammer and configDir is .hammer", () => {
  assert.equal(pkgPkg.piConfig?.name, "hammer");
  assert.equal(pkgPkg.piConfig?.configDir, ".hammer");
});

// ---------------------------------------------------------------------------
// Legacy bin aliases — gsd bins must still exist for backwards compatibility
// ---------------------------------------------------------------------------

test("root package.json still provides gsd bin as legacy alias", () => {
  assert.ok("gsd" in rootPkg.bin, "gsd bin must be present as legacy alias");
  assert.ok("gsd-cli" in rootPkg.bin, "gsd-cli bin must be present as legacy alias");
  assert.ok("gsd-pi" in rootPkg.bin, "gsd-pi bin must be present as legacy alias");
});

test("gsd bins point to the same loader as hammer bins (no divergence)", () => {
  assert.equal(rootPkg.bin["gsd"], rootPkg.bin["hammer"]);
  assert.equal(rootPkg.bin["gsd-cli"], rootPkg.bin["hammer-cli"]);
});

// ---------------------------------------------------------------------------
// Help text — Hammer-first, gsd never a canonical example
// ---------------------------------------------------------------------------

test("printHelp output begins with Hammer branding", () => {
  assert.match(helpText, /process\.stdout\.write\(`Hammer v/);
});

test("help usage line says hammer, not gsd", () => {
  assert.match(helpText, /Usage: hammer \[options\]/);
});

test("help subcommand examples use hammer, not gsd", () => {
  // Key examples that were previously gsd-branded
  assert.match(helpText, /hammer <subcommand> --help/);
  assert.match(helpText, /hammer auto/);
  assert.match(helpText, /hammer headless/);
  assert.match(helpText, /hammer update/);
  assert.match(helpText, /\/hammer/);
});

test("help text does not direct new users to run gsd as a canonical command", () => {
  // Allow the legacy alias footnote, but not as the primary usage instruction
  const lines = helpText.split("\n");
  for (const line of lines) {
    // Skip comments (TypeScript source comments are allowed to reference legacy names)
    if (line.trim().startsWith("//")) continue;
    // Skip the explicit legacy alias note at the end of printHelp
    if (/legacy alias.*gsd|gsd.*backwards-compatible alias/i.test(line)) continue;
    // Help examples and subcommand-specific help blocks must use hammer
    if (/Usage: gsd\b/.test(line)) {
      assert.fail(`help-text.ts line uses 'Usage: gsd': ${line.trim()}`);
    }
    if (/hammer\s+[a-z].*gsd [a-z]/.test(line)) {
      assert.fail(`help-text.ts example uses 'gsd' as canonical command: ${line.trim()}`);
    }
  }
});

test("wt alias still maps to worktree help", () => {
  assert.match(helpText, /SUBCOMMAND_HELP\['wt'\] = SUBCOMMAND_HELP\['worktree'\]/);
});

test("printSubcommandHelp emits Hammer branding header", () => {
  assert.match(helpText, /process\.stdout\.write\(`Hammer v/);
});

// ---------------------------------------------------------------------------
// Loader identity — process title, banner, env var assignments
// ---------------------------------------------------------------------------

test("loader sets process.title to 'hammer'", () => {
  assert.match(loaderText, /process\.title = 'hammer'/);
  assert.doesNotMatch(loaderText, /process\.title = 'gsd'/);
});

test("loader banner says Hammer, not Get Shit Done", () => {
  assert.match(loaderText, /`  Hammer \${dim}/);
  assert.doesNotMatch(loaderText, /Get Shit Done/);
});

test("loader sets HAMMER_FIRST_RUN_BANNER env var", () => {
  assert.match(loaderText, /process\.env\.HAMMER_FIRST_RUN_BANNER = '1'/);
});

test("loader sets HAMMER_VERSION env var", () => {
  assert.match(loaderText, /process\.env\.HAMMER_VERSION = gsdVersion/);
});

test("loader sets HAMMER_BIN_PATH env var", () => {
  assert.match(loaderText, /process\.env\.HAMMER_BIN_PATH = process\.argv\[1\]/);
});

test("loader sets HAMMER_PKG_ROOT env var", () => {
  assert.match(loaderText, /process\.env\.HAMMER_PKG_ROOT = gsdRoot/);
});

test("loader sets HAMMER_BUNDLED_EXTENSION_PATHS env var", () => {
  assert.match(loaderText, /process\.env\.HAMMER_BUNDLED_EXTENSION_PATHS = /);
});

test("loader broken-install error message says hammer, not gsd", () => {
  assert.match(loaderText, /Hammer installation is broken/);
  assert.match(loaderText, /npm install -g hammer-pi@latest/);
  assert.doesNotMatch(loaderText, /GSD installation is broken/);
});

// ---------------------------------------------------------------------------
// CLI identity — [hammer] stderr prefix, version env, app name
// ---------------------------------------------------------------------------

test("cli.ts does not use [gsd] prefix in stderr output", () => {
  assert.doesNotMatch(cliText, /\[gsd\]/);
});

test("cli.ts uses [hammer] stderr prefix", () => {
  assert.match(cliText, /\[hammer\]/);
});

test("cli.ts appName is 'hammer'", () => {
  assert.match(cliText, /appName: 'hammer'/);
  assert.doesNotMatch(cliText, /appName: 'gsd'/);
});

test("cli.ts reads HAMMER_VERSION before GSD_VERSION (HAMMER takes precedence)", () => {
  assert.match(cliText, /HAMMER_VERSION.*GSD_VERSION/);
});

test("cli.ts non-TTY error uses hammer examples, not gsd", () => {
  assert.match(cliText, /hammer auto/);
  assert.match(cliText, /hammer --print/);
  assert.doesNotMatch(cliText, /'\[hammer\]\s+gsd /);
});

// ---------------------------------------------------------------------------
// Negative tests: gsd should only appear in legacy-alias contexts
// ---------------------------------------------------------------------------

test("help-text.ts only has gsd references in the legacy alias note, not canonical examples", () => {
  const canonicalGsdUsagePattern = /Usage:\s+gsd\b/;
  assert.doesNotMatch(helpText, canonicalGsdUsagePattern);
});

test("package.json primary advertised binary is hammer, not gsd", () => {
  // The "main" entry name should be hammer
  assert.ok(
    Object.keys(rootPkg.bin).indexOf("hammer") < Object.keys(rootPkg.bin).indexOf("gsd"),
    "hammer bin must appear before gsd bin in package.json",
  );
});

test("loader does not assign only GSD_* env vars without a HAMMER_* counterpart for public vars", () => {
  // For each legacy GSD env assignment, there must also be a HAMMER counterpart
  const hammerVars = ["HAMMER_VERSION", "HAMMER_BIN_PATH", "HAMMER_PKG_ROOT", "HAMMER_BUNDLED_EXTENSION_PATHS", "HAMMER_FIRST_RUN_BANNER"];
  for (const v of hammerVars) {
    assert.match(loaderText, new RegExp(`process\\.env\\.${v}\\b`), `${v} must be set in loader`);
  }
});
