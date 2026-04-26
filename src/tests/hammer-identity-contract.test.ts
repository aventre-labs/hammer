import test from "node:test";
import assert from "node:assert/strict";

import {
  HAMMER_CANONICAL_IDENTITY,
  HAMMER_CLI_COMMAND,
  HAMMER_DISPLAY_NAME,
  HAMMER_ENV_VARS,
  HAMMER_HOME_ENV,
  HAMMER_MCP_SERVER_NAME,
  HAMMER_PACKAGE_NAME,
  HAMMER_PRODUCT_NAME,
  HAMMER_PROJECT_ID_ENV,
  HAMMER_PROJECT_MARKER_FILE,
  HAMMER_PUBLIC_TOOL_PREFIX,
  HAMMER_SLASH_COMMAND,
  HAMMER_STATE_DIR_ENV,
  HAMMER_STATE_DIR_NAME,
  HAMMER_WORKFLOW_EXTENSION_ID,
  HAMMER_WORKFLOW_EXTENSION_NAME,
} from "../hammer-identity/index.ts";
import {
  HAMMER_LEGACY_COMPATIBILITY_CATEGORIES,
  HAMMER_LEGACY_COMPATIBILITY_RULES,
  getHammerCompatibilityRuleIdsByCategory,
  type HammerLegacyCompatibilityCategory,
} from "../hammer-identity/compatibility.ts";

test("Hammer canonical identity values use Hammer product surface names", () => {
  assert.equal(HAMMER_PRODUCT_NAME, "hammer");
  assert.equal(HAMMER_DISPLAY_NAME, "Hammer");
  assert.equal(HAMMER_PACKAGE_NAME, "hammer-pi");
  assert.equal(HAMMER_CLI_COMMAND, "hammer");
  assert.equal(HAMMER_SLASH_COMMAND, "/hammer");
  assert.equal(HAMMER_STATE_DIR_NAME, ".hammer");
  assert.equal(HAMMER_PROJECT_MARKER_FILE, ".hammer-id");
  assert.equal(HAMMER_HOME_ENV, "HAMMER_HOME");
  assert.equal(HAMMER_STATE_DIR_ENV, "HAMMER_STATE_DIR");
  assert.equal(HAMMER_PROJECT_ID_ENV, "HAMMER_PROJECT_ID");
  assert.equal(HAMMER_PUBLIC_TOOL_PREFIX, "hammer_");
  assert.equal(HAMMER_MCP_SERVER_NAME, "hammer");
  assert.equal(HAMMER_WORKFLOW_EXTENSION_ID, "hammer");
  assert.equal(HAMMER_WORKFLOW_EXTENSION_NAME, "Hammer Workflow");

  assert.deepEqual(HAMMER_ENV_VARS, {
    home: "HAMMER_HOME",
    stateDir: "HAMMER_STATE_DIR",
    projectId: "HAMMER_PROJECT_ID",
  });

  assert.equal(HAMMER_CANONICAL_IDENTITY.productName, "hammer");
  assert.equal(HAMMER_CANONICAL_IDENTITY.state.projectStateDirName, ".hammer");
  assert.equal(HAMMER_CANONICAL_IDENTITY.state.env.projectId, "HAMMER_PROJECT_ID");
});

test("canonical visible identity values do not expose legacy GSD names", () => {
  const visibleValues = [
    HAMMER_PRODUCT_NAME,
    HAMMER_DISPLAY_NAME,
    HAMMER_PACKAGE_NAME,
    HAMMER_CLI_COMMAND,
    HAMMER_SLASH_COMMAND,
    HAMMER_STATE_DIR_NAME,
    HAMMER_PROJECT_MARKER_FILE,
    HAMMER_HOME_ENV,
    HAMMER_STATE_DIR_ENV,
    HAMMER_PROJECT_ID_ENV,
    HAMMER_PUBLIC_TOOL_PREFIX,
    HAMMER_MCP_SERVER_NAME,
    HAMMER_WORKFLOW_EXTENSION_ID,
    HAMMER_WORKFLOW_EXTENSION_NAME,
  ];

  for (const value of visibleValues) {
    assert.doesNotMatch(value, /gsd/i, `${value} should be Hammer-branded`);
  }
});

test("legacy compatibility map is finite, categorized, and documented", () => {
  const expectedCategories: HammerLegacyCompatibilityCategory[] = [
    "legacy-alias",
    "bootstrap-migration",
    "historical-docs",
    "internal-implementation-path",
    "downstream-follow-up",
  ];

  assert.deepEqual(
    Object.keys(HAMMER_LEGACY_COMPATIBILITY_CATEGORIES).sort(),
    [...expectedCategories].sort(),
  );

  const ids = new Set<string>();
  for (const rule of HAMMER_LEGACY_COMPATIBILITY_RULES) {
    assert.ok(!ids.has(rule.id), `duplicate rule id ${rule.id}`);
    ids.add(rule.id);
    assert.ok(rule.description.length > 20, `${rule.id} has a useful description`);
    assert.ok(rule.rationale.length > 20, `${rule.id} explains why the allowance remains`);
    assert.ok(rule.allowedUntil.length > 5, `${rule.id} states when the allowance can be revisited`);
    assert.ok(rule.examples.length > 0, `${rule.id} has examples`);
    assert.doesNotThrow(() => new RegExp(rule.pathPattern, "u"), `${rule.id} has a valid pathPattern`);
    assert.doesNotThrow(() => new RegExp(rule.linePattern, "u"), `${rule.id} has a valid linePattern`);
  }

  for (const category of expectedCategories) {
    assert.ok(
      getHammerCompatibilityRuleIdsByCategory(category).length > 0,
      `${category} has at least one compatibility rule`,
    );
  }
});
