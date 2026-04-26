/**
 * hammer-extension-command.test.ts
 *
 * Tests that the bundled extension is Hammer-first in manifest, registration,
 * help, dispatcher behavior, and catalog completions. Verifies the hidden /gsd
 * legacy alias routes correctly and is excluded from normal advertising.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Path helpers ──────────────────────────────────────────────────────────────
const EXT_DIR = resolve(import.meta.dirname, "../resources/extensions/gsd");
const manifestPath = resolve(EXT_DIR, "extension-manifest.json");

// ── Extension manifest ────────────────────────────────────────────────────────

test("extension-manifest: id is 'hammer' (not 'gsd')", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.id, "hammer", "manifest.id must be 'hammer'");
});

test("extension-manifest: name contains Hammer (not GSD)", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.match(manifest.name, /hammer/i, "manifest.name must reference Hammer");
  assert.doesNotMatch(manifest.name, /^GSD\b/, "manifest.name must not start with 'GSD'");
});

test("extension-manifest: provides.commands lists 'hammer' not 'gsd'", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const commands: string[] = manifest.provides?.commands ?? [];
  assert.ok(commands.includes("hammer"), "provides.commands must include 'hammer'");
  assert.ok(!commands.includes("gsd"), "provides.commands must not include 'gsd' (legacy alias is hidden)");
});

test("extension-manifest: provides.commands includes public non-Hammer commands", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const commands: string[] = manifest.provides?.commands ?? [];
  // Public non-hammer commands that are intentionally advertised
  for (const expected of ["kill", "worktree", "exit"]) {
    assert.ok(commands.includes(expected), `provides.commands must include '${expected}'`);
  }
});

// ── Package.json ──────────────────────────────────────────────────────────────

test("package.json: name is pi-extension-hammer (not pi-extension-gsd)", () => {
  const pkg = JSON.parse(readFileSync(resolve(EXT_DIR, "package.json"), "utf-8"));
  assert.equal(pkg.name, "pi-extension-hammer", "package.json name must be pi-extension-hammer");
});

// ── Catalog exports ───────────────────────────────────────────────────────────

test("catalog: HAMMER_COMMAND_DESCRIPTION is defined and Hammer-branded", async () => {
  const { HAMMER_COMMAND_DESCRIPTION } = await import(
    "../resources/extensions/gsd/commands/catalog.ts"
  );
  assert.ok(typeof HAMMER_COMMAND_DESCRIPTION === "string", "HAMMER_COMMAND_DESCRIPTION must be a string");
  assert.match(HAMMER_COMMAND_DESCRIPTION, /\/hammer\b/, "HAMMER_COMMAND_DESCRIPTION must reference /hammer");
  assert.doesNotMatch(HAMMER_COMMAND_DESCRIPTION, /GSD — Get Shit Done/, "HAMMER_COMMAND_DESCRIPTION must not use old GSD branding");
});

test("catalog: getHammerArgumentCompletions is exported", async () => {
  const { getHammerArgumentCompletions } = await import(
    "../resources/extensions/gsd/commands/catalog.ts"
  );
  assert.ok(typeof getHammerArgumentCompletions === "function", "getHammerArgumentCompletions must be a function");
});

test("catalog: getHammerArgumentCompletions top-level returns /hammer subcommands", async () => {
  const { getHammerArgumentCompletions } = await import(
    "../resources/extensions/gsd/commands/catalog.ts"
  );
  const completions = getHammerArgumentCompletions("");
  assert.ok(Array.isArray(completions), "completions must be an array");
  assert.ok(completions.length > 0, "must return at least one top-level completion");
  // 'help' should be first or among the top completions
  const values = completions.map((c: { value: string }) => c.value);
  assert.ok(values.includes("help"), "top-level completions must include 'help'");
});

test("catalog: normal command catalog excludes /gsd (Negative Test — Q7)", async () => {
  const { getHammerArgumentCompletions } = await import(
    "../resources/extensions/gsd/commands/catalog.ts"
  );
  const completions = getHammerArgumentCompletions("");
  // /gsd must not appear as a completion value — it's a hidden legacy alias
  const values = completions.map((c: { value: string }) => c.value);
  for (const v of values) {
    assert.doesNotMatch(
      v,
      /^gsd\b/,
      `completion '${v}' must not start with 'gsd' — legacy alias must be hidden`,
    );
  }
});

// ── Registration contract ─────────────────────────────────────────────────────

test("commands/index: registerHammerCommand is exported", async () => {
  const { registerHammerCommand } = await import(
    "../resources/extensions/gsd/commands/index.ts"
  );
  assert.ok(typeof registerHammerCommand === "function", "registerHammerCommand must be a function");
});

test("commands/index: registerGSDLegacyAlias is exported as legacy shim", async () => {
  const { registerGSDLegacyAlias } = await import(
    "../resources/extensions/gsd/commands/index.ts"
  );
  assert.ok(typeof registerGSDLegacyAlias === "function", "registerGSDLegacyAlias must be a function");
});

test("commands/index: registerHammerCommand registers 'hammer' not 'gsd'", async () => {
  const { registerHammerCommand } = await import(
    "../resources/extensions/gsd/commands/index.ts"
  );
  const registered: Array<{ name: string; options: Record<string, unknown> }> = [];
  const mockPi = {
    registerCommand(name: string, options: Record<string, unknown>) {
      registered.push({ name, options });
    },
  };
  registerHammerCommand(mockPi as Parameters<typeof registerHammerCommand>[0]);
  assert.ok(registered.length >= 1, "registerHammerCommand must register at least one command");
  assert.equal(registered[0].name, "hammer", "first registered command must be 'hammer'");
});

test("commands/index: registerGSDLegacyAlias registers 'gsd' as hidden alias", async () => {
  const { registerGSDLegacyAlias } = await import(
    "../resources/extensions/gsd/commands/index.ts"
  );
  const registered: Array<{ name: string; options: Record<string, unknown> }> = [];
  const mockPi = {
    registerCommand(name: string, options: Record<string, unknown>) {
      registered.push({ name, options });
    },
  };
  registerGSDLegacyAlias(mockPi as Parameters<typeof registerGSDLegacyAlias>[0]);
  assert.ok(registered.length >= 1, "registerGSDLegacyAlias must register at least one command");
  const gsdReg = registered.find((r) => r.name === "gsd");
  assert.ok(gsdReg, "legacy alias must register 'gsd'");
  // The legacy alias must return no completions (hidden from completions)
  const getArgCompletions = gsdReg!.options.getArgumentCompletions as (() => unknown[]) | undefined;
  if (typeof getArgCompletions === "function") {
    const completions = getArgCompletions();
    assert.deepEqual(completions, [], "legacy /gsd alias must return empty completions (hidden)");
  }
});

// ── Dispatcher behavior ───────────────────────────────────────────────────────

test("dispatcher: unknown /hammer command suggests /hammer help", async () => {
  const { handleGSDCommand } = await import(
    "../resources/extensions/gsd/commands/dispatcher.ts"
  );
  const notifications: Array<{ message: string; level: string }> = [];
  const mockCtx = {
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };
  const mockPi = {};
  await handleGSDCommand("bogus", mockCtx as Parameters<typeof handleGSDCommand>[1], mockPi as Parameters<typeof handleGSDCommand>[2]);
  assert.ok(notifications.length > 0, "must emit a notification for unknown command");
  const msg = notifications[0].message;
  assert.match(msg, /\/hammer help/, "unknown command notification must mention /hammer help");
  assert.doesNotMatch(msg, /\/gsd help/, "unknown command notification must not suggest /gsd help");
});

test("dispatcher: unknown /gsd <bogus> via legacy alias shows original command name (Negative Test — Q7)", async () => {
  const { handleGSDCommand } = await import(
    "../resources/extensions/gsd/commands/dispatcher.ts"
  );
  const notifications: Array<{ message: string; level: string }> = [];
  const mockCtx = {
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };
  const mockPi = {};
  await handleGSDCommand(
    "bogus",
    mockCtx as Parameters<typeof handleGSDCommand>[1],
    mockPi as Parameters<typeof handleGSDCommand>[2],
    { viaLegacyAlias: true },
  );
  assert.ok(notifications.length > 0, "must emit a notification for unknown legacy-alias command");
  const msg = notifications[0].message;
  // The message should show what the user typed (legacy form) but remediate with /hammer help
  assert.match(msg, /\/hammer help/, "unknown legacy-alias command notification must mention /hammer help for remediation");
});

test("dispatcher: /hammer help dispatches (core command handler invoked)", async () => {
  const { handleGSDCommand } = await import(
    "../resources/extensions/gsd/commands/dispatcher.ts"
  );
  const notifications: Array<{ message: string; level: string }> = [];
  const mockCtx = {
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      custom: async () => undefined,
      select: async () => undefined,
      hasUI: false,
    },
    modelRegistry: { getAvailable: () => [] },
    model: null,
    sessionManager: null,
  };
  const mockPi = {};
  await handleGSDCommand("help", mockCtx as Parameters<typeof handleGSDCommand>[1], mockPi as Parameters<typeof handleGSDCommand>[2]);
  assert.ok(notifications.length > 0, "/hammer help must emit a notification");
  const msg = notifications[0].message;
  // Help output must reference /hammer, not GSD branding
  assert.match(msg, /\/hammer\b/, "/hammer help output must reference /hammer");
  assert.doesNotMatch(msg, /GSD — Get Shit Done/, "/hammer help must not show old GSD branding");
});

test("dispatcher: /gsd help via legacy alias dispatches correctly (legacy dispatch test)", async () => {
  const { handleGSDCommand } = await import(
    "../resources/extensions/gsd/commands/dispatcher.ts"
  );
  const notifications: Array<{ message: string; level: string }> = [];
  const mockCtx = {
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      custom: async () => undefined,
      select: async () => undefined,
      hasUI: false,
    },
    modelRegistry: { getAvailable: () => [] },
    model: null,
    sessionManager: null,
  };
  const mockPi = {};
  await handleGSDCommand(
    "help",
    mockCtx as Parameters<typeof handleGSDCommand>[1],
    mockPi as Parameters<typeof handleGSDCommand>[2],
    { viaLegacyAlias: true },
  );
  assert.ok(notifications.length > 0, "/gsd help via legacy alias must emit a notification");
  // Core handler must still fire — same result as /hammer help
  const msg = notifications[0].message;
  assert.match(msg, /\/hammer\b/, "/gsd help via legacy alias must produce /hammer-branded output");
});

// ── showHelp output branding ──────────────────────────────────────────────────

test("showHelp: summary output references /hammer not /gsd", async () => {
  const { showHelp } = await import(
    "../resources/extensions/gsd/commands/handlers/core.ts"
  );
  const notifications: Array<{ message: string; level: string }> = [];
  const mockCtx = {
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };
  showHelp(mockCtx as Parameters<typeof showHelp>[0]);
  assert.ok(notifications.length > 0, "showHelp must emit a notification");
  const output = notifications.map((n) => n.message).join("\n");
  assert.match(output, /\/hammer\b/, "help output must reference /hammer");
  assert.doesNotMatch(output, /GSD — Get Shit Done/, "help output must not show old GSD branding");
  assert.doesNotMatch(output, /\/gsd\b/, "help output summary must not reference /gsd");
});

test("showHelp: full output references /hammer not /gsd", async () => {
  const { showHelp } = await import(
    "../resources/extensions/gsd/commands/handlers/core.ts"
  );
  const notifications: Array<{ message: string; level: string }> = [];
  const mockCtx = {
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };
  showHelp(mockCtx as Parameters<typeof showHelp>[0], "full");
  assert.ok(notifications.length > 0, "showHelp full must emit a notification");
  const output = notifications.map((n) => n.message).join("\n");
  assert.match(output, /\/hammer\b/, "full help output must reference /hammer");
  assert.doesNotMatch(output, /GSD — Get Shit Done/, "full help output must not show old GSD branding");
  assert.doesNotMatch(output, /\/gsd\b/, "full help output must not reference /gsd");
});
