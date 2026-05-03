// S08 T06 — Compatibility rule graduation
//
// The `docs-and-readme-downstream` and `contributing-and-meta-docs` rules
// were graduated from "absorb every classified path-line match" to
// "absorb only when the file body actually contains \bHammer\b". Files
// that regress to GSD-only language fall through to unclassified-visible-gsd
// so the identity scanner fails closed on documentation drift.
//
// `historical-or-migration-docs` (CHANGELOG.md and friends) is INTENTIONALLY
// left ungraduated — historical/migration content describes the prior identity
// as history and should not be force-rewritten.
//
// These tests prove all three behaviors hold so future doc work can rely on
// the scanner as the durable enforcement gate.

import test from "node:test";
import assert from "node:assert/strict";

import {
  loadHammerIdentityCompatibilityRules,
  scanText,
  UNCLASSIFIED_CATEGORY,
} from "../../../scripts/check-hammer-identity.mjs";

test("docs-and-readme-downstream: file WITH \\bHammer\\b classifies as downstream-follow-up", async () => {
  const rules = await loadHammerIdentityCompatibilityRules();
  // The line uses bare `/gsd` without the words alias/compat/deprecated/backward
  // so it does NOT match the explicit-legacy-alias-marker rule and falls through
  // to the path-scoped docs-and-readme-downstream rule.
  const fileText = [
    "# Hammer Auto-Mode Guide",
    "",
    "Hammer auto-mode runs slices through plan/research/execute/refine.",
    "",
    "Run `/gsd auto` to start auto-mode.",
    "",
  ].join("\n");

  const findings = scanText("docs/user-docs/auto-mode.md", fileText, rules);

  // The visible legacy `/gsd` token must classify under the graduated rule
  // because the file body carries Hammer identity.
  assert.equal(findings.length, 1, "exactly one finding (the /gsd token line)");
  const finding = findings[0];
  assert.equal(finding.category, "downstream-follow-up");
  assert.equal(finding.ruleId, "docs-and-readme-downstream");
  assert.ok(finding.terms.includes("/gsd"), "matched the /gsd token");
});

test("docs-and-readme-downstream: file WITHOUT \\bHammer\\b falls through to unclassified-visible-gsd", async () => {
  const rules = await loadHammerIdentityCompatibilityRules();
  // Same path as the WITH-Hammer test, but the body has regressed to GSD-only
  // prose. Graduation must reject the rule match and let the line fall through
  // to unclassified — the scanner's fail-closed enforcement.
  const fileText = [
    "# Auto-Mode Guide",
    "",
    "GSD auto-mode runs slices through plan/research/execute/refine.",
    "",
    "Run `/gsd auto` to start auto-mode.",
    "",
  ].join("\n");

  const findings = scanText("docs/user-docs/auto-mode.md", fileText, rules);

  // Both visible-GSD lines must be unclassified — neither rule may absorb them
  // because the file body carries no Hammer identity.
  assert.ok(findings.length >= 1, "at least one finding");
  for (const finding of findings) {
    assert.equal(
      finding.category,
      UNCLASSIFIED_CATEGORY,
      `finding on line ${finding.lineNumber} must be unclassified (got ${finding.category}/${finding.ruleId ?? "null"})`,
    );
    assert.equal(finding.ruleId, null);
  }
});

test("historical-or-migration-docs: CHANGELOG.md WITHOUT Hammer still classifies as historical-docs (un-graduated)", async () => {
  const rules = await loadHammerIdentityCompatibilityRules();
  // CHANGELOG.md is historical content. The historical-or-migration-docs rule
  // (compatibility.ts ~line 177) is intentionally left ungraduated so we can
  // preserve historical accuracy. A line presenting GSD as legacy/historical
  // must still classify as historical-docs even when the file has no Hammer
  // mention anywhere.
  const fileText = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "### Changed",
    "- Historically the project was named GSD before the rename.",
    "",
  ].join("\n");

  const findings = scanText("CHANGELOG.md", fileText, rules);

  assert.equal(findings.length, 1, "one finding on the historical line");
  const finding = findings[0];
  // The CHANGELOG.md path is covered by two ungraduated historical-docs rules
  // (historical-or-migration-docs and changelog-historical). Either may absorb
  // the line — the regression guard is that the category remains historical-docs
  // even though the file body carries no \bHammer\b marker.
  assert.equal(finding.category, "historical-docs");
  assert.ok(
    ["historical-or-migration-docs", "changelog-historical"].includes(finding.ruleId ?? ""),
    `expected one of historical-or-migration-docs / changelog-historical, got ${finding.ruleId}`,
  );
});
