// GSD-2 — Regression tests for importLocalModule candidate resolution (#3954)
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { _buildImportCandidates, _formatImportFailure } from "./workflow-tools.js";

describe("_buildImportCandidates", () => {
  it("includes dist/ fallback for src/ paths", () => {
    const candidates = _buildImportCandidates("../../../src/resources/extensions/gsd/db-writer.js");
    assert.ok(
      candidates.some((c) => c.includes("/dist/resources/extensions/gsd/db-writer.js")),
      "should include dist/ swapped candidate",
    );
  });

  it("includes src/ fallback for dist/ paths", () => {
    const candidates = _buildImportCandidates("../../../dist/resources/extensions/gsd/db-writer.js");
    assert.ok(
      candidates.some((c) => c.includes("/src/resources/extensions/gsd/db-writer.js")),
      "should include src/ swapped candidate",
    );
  });

  it("includes .ts variants for .js paths", () => {
    const candidates = _buildImportCandidates("../../../src/resources/extensions/gsd/db-writer.js");
    assert.ok(
      candidates.some((c) => c.endsWith("db-writer.ts") && c.includes("/src/")),
      "should include .ts variant for original src/ path",
    );
    assert.ok(
      candidates.some((c) => c.endsWith("db-writer.ts") && c.includes("/dist/")),
      "should include .ts variant for swapped dist/ path",
    );
  });

  it("returns original path first", () => {
    const input = "../../../src/resources/extensions/gsd/db-writer.js";
    const candidates = _buildImportCandidates(input);
    assert.equal(candidates[0], input, "first candidate should be the original path");
  });

  it("handles paths without src/ or dist/ gracefully", () => {
    const candidates = _buildImportCandidates("./local-module.js");
    assert.equal(candidates.length, 2, "should have original + .ts variant only");
    assert.equal(candidates[0], "./local-module.js");
    assert.equal(candidates[1], "./local-module.ts");
  });
});

describe("_formatImportFailure", () => {
  it("surfaces a real load failure ahead of trailing module-not-found errors", () => {
    // Reproduces the iter-1 dynamic-tools.js failure mode: the dist/.js
    // candidate exists but fails to load (e.g. transitive import error),
    // while the trailing .ts fallback simply doesn't exist. Without
    // classification the caller sees only the misleading "Cannot find module
    // …/.ts" message and assumes the dist build is missing.
    const err = _formatImportFailure("../../../src/foo.js", [
      { candidate: "file:///dist/foo.js", code: "ERR_REQUIRE_ESM", message: "boom: transitive failure" },
      { candidate: "file:///src/foo.ts", code: "ERR_MODULE_NOT_FOUND", message: "Cannot find module …/foo.ts" },
    ]);
    assert.match(err.message, /candidate failed to load/);
    assert.match(err.message, /Most likely cause: boom: transitive failure/);
    assert.match(err.message, /file:\/\/\/dist\/foo\.js \(ERR_REQUIRE_ESM\)/);
    assert.doesNotMatch(err.message, /no candidate resolved/);
  });

  it("falls back to module-not-found when every candidate is missing", () => {
    const err = _formatImportFailure("../../../src/foo.js", [
      { candidate: "file:///src/foo.js", code: "ERR_MODULE_NOT_FOUND", message: "Cannot find module …/src/foo.js" },
      { candidate: "file:///dist/foo.js", code: "ERR_MODULE_NOT_FOUND", message: "Cannot find module …/dist/foo.js" },
    ]);
    assert.match(err.message, /no candidate resolved/);
    assert.match(err.message, /Cannot find module …\/dist\/foo\.js/);
    assert.doesNotMatch(err.message, /candidate failed to load/);
  });

  it("returns a clear error when no attempts were recorded", () => {
    const err = _formatImportFailure("../../../src/foo.js", []);
    assert.match(err.message, /no candidates to try/);
  });
});
