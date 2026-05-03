/**
 * m002-integration-static.test.ts — M002/S09/T04
 *
 * Static-surface invariants pinning §5 invariants 9 and 10 of the M002 slice
 * acceptance matrix as cheap structural checks. No tmpdir, no production
 * dispatch, no real Omega run — these tests guard the *source-shape* contracts
 * the runtime integration test (m002-integration.test.ts) assumes:
 *
 *   1. S06 strip is clean: neither
 *      `src/resources/extensions/mcp-client/index.ts` nor
 *      `src/resources/extensions/gsd/auto.ts` contains the legacy
 *      `assertTrustedStdioServer` / `GSD_MCP_AUTO_APPROVE_TRUST` symbols. If
 *      either reappears, the no-prompt MCP guarantee has regressed.
 *   2. S08 graduated identity ruleset stays green over the M002 integration
 *      fixture corpus: spawning `node scripts/check-hammer-identity.mjs`
 *      against the fixture path exits 0 (the scanner ignores positional path
 *      arguments and scans all tracked files, but the contract is "the
 *      scanner runs over the project — including this fixture — and produces
 *      no scanner-fault exit"). A non-zero exit means the scanner itself
 *      faulted, which is the stronger regression signal.
 *   3. Cross-cutting drift pin: `RECOVERY_FAILURE_CAP === 3` and
 *      `OMEGA_STAGES.length === 10` — accidental constant changes would
 *      silently invalidate the §5 invariant-7 and invariant-1 contracts the
 *      runtime test pins. Imports come from the production modules so a
 *      rename or value drift surfaces here at type-check time too.
 *
 * No production code change. Read-only on source.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RECOVERY_FAILURE_CAP } from "../auto/recovery.ts";
import { OMEGA_STAGES } from "../../../../iam/omega.ts";

// ─── Path anchors ────────────────────────────────────────────────────────

const TESTS_DIR = fileURLToPath(new URL("./", import.meta.url));
// tests/ → gsd/ → extensions/ → resources/ → src/ → <project root>
const PROJECT_ROOT = resolve(TESTS_DIR, "..", "..", "..", "..", "..");

const MCP_CLIENT_INDEX_PATH = resolve(
  PROJECT_ROOT,
  "src/resources/extensions/mcp-client/index.ts",
);
const GSD_AUTO_PATH = resolve(
  PROJECT_ROOT,
  "src/resources/extensions/gsd/auto.ts",
);
const HAMMER_IDENTITY_SCRIPT = resolve(
  PROJECT_ROOT,
  "scripts/check-hammer-identity.mjs",
);
const FIXTURE_PATH = resolve(
  PROJECT_ROOT,
  "src/resources/extensions/gsd/tests/fixtures/m002-integration/",
);

// ─── §5 invariant 9: MCP no-prompt symbols stripped ──────────────────────

test("S06 strip stays clean: no assertTrustedStdioServer / GSD_MCP_AUTO_APPROVE_TRUST in mcp-client/index.ts and gsd/auto.ts", () => {
  for (const targetPath of [MCP_CLIENT_INDEX_PATH, GSD_AUTO_PATH]) {
    const source = readFileSync(targetPath, "utf-8");

    assert.equal(
      /\bassertTrustedStdioServer\b/.test(source),
      false,
      `assertTrustedStdioServer must NOT appear in ${targetPath} ` +
        `(S06 trust-prompt strip regression — re-run the S06 audit).`,
    );

    assert.equal(
      /\bGSD_MCP_AUTO_APPROVE_TRUST\b/.test(source),
      false,
      `GSD_MCP_AUTO_APPROVE_TRUST must NOT appear in ${targetPath} ` +
        `(S06 trust-prompt strip regression — re-run the S06 audit).`,
    );
  }
});

// ─── §5 invariant 10: identity scanner clean over fixture corpus ─────────

test("S08 graduated identity ruleset: scanner exits 0 over the m002-integration fixture corpus", () => {
  const result = spawnSync(
    process.execPath,
    [HAMMER_IDENTITY_SCRIPT, FIXTURE_PATH],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  assert.equal(
    result.status,
    0,
    `node scripts/check-hammer-identity.mjs <fixture> exited ${result.status}.\n` +
      `script: ${HAMMER_IDENTITY_SCRIPT}\n` +
      `fixture: ${FIXTURE_PATH}\n` +
      `stdout: ${result.stdout ?? ""}\n` +
      `stderr: ${result.stderr ?? ""}`,
  );

  assert.match(
    result.stdout ?? "",
    /Unclassified visible GSD references:\s*\n\s*none/,
    `Identity scanner reported unclassified findings (S08 graduation regression).\n` +
      `stdout: ${result.stdout ?? ""}`,
  );
});

// ─── Cross-cutting shape pins ────────────────────────────────────────────

test("Drift pin: RECOVERY_FAILURE_CAP === 3 and OMEGA_STAGES.length === 10", () => {
  assert.equal(
    RECOVERY_FAILURE_CAP,
    3,
    `RECOVERY_FAILURE_CAP changed from 3 to ${RECOVERY_FAILURE_CAP}; ` +
      `the §5 invariant-7 (cap-3 pause) contract pins this constant. ` +
      `Update the slice plan and m002-integration.test.ts before changing this value.`,
  );

  assert.equal(
    OMEGA_STAGES.length,
    10,
    `OMEGA_STAGES.length changed from 10 to ${OMEGA_STAGES.length}; ` +
      `the §5 invariant-1 (canonical 10-stage Omega tree) contract pins this length. ` +
      `Update the slice plan, omega-phase-artifacts.ts, and m002-integration.test.ts ` +
      `before changing the canonical stage count.`,
  );
});
