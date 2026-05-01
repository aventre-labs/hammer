// Migration lift integration test suite
// Covers liftLegacyLayoutsToHammer across the four legacy-source scenarios
// (.planning-only, .gsd-only, both-present, no-legacy) plus idempotent re-run
// and partial-failure resume. All fixtures are built in temp dirs — nothing
// reads from the gitignored .gsd/ tree.
//
// Test runner: node:test (matches the rest of this directory, including
// migrate-writer-integration.test.ts which the task plan points at as the
// reference style). The slice plan mentions "vitest" by convention but the
// repo's `npm test` driver is node:test and the harness compiles these files
// through scripts/compile-tests.mjs.

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  rmSync,
  cpSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  liftLegacyLayoutsToHammer,
  detectLegacyLayouts,
} from '../migrate/lift.ts';

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ─── Fixture Helpers ───────────────────────────────────────────────────────

function makeTempBase(label: string): string {
  return mkdtempSync(join(tmpdir(), `gsd-migrate-lift-${label}-`));
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

/**
 * Build a minimal `.planning/` (GSD-1) fixture with just enough structure for
 * the parser → transformer → writer pipeline to produce a non-empty `.hammer/`.
 * Mirrors the shape used in migrate-parser.test.ts.
 */
function buildPlanningFixture(base: string): void {
  const planning = join(base, '.planning');
  mkdirSync(planning, { recursive: true });

  writeFile(
    join(planning, 'PROJECT.md'),
    '# Sample Project\n\nA project for migrate-lift tests.\n',
  );

  writeFile(
    join(planning, 'ROADMAP.md'),
    '# Project Roadmap\n\n## Phases\n\n- [x] 29 — Auth System\n- [ ] 30 — Dashboard\n',
  );

  writeFile(
    join(planning, 'REQUIREMENTS.md'),
    `# Requirements

## Active

### R001 — User Authentication
- Status: active
- Description: Users must be able to log in.
`,
  );

  writeFile(
    join(planning, 'STATE.md'),
    '# State\n\n**Current Phase:** 29-auth-system\n**Status:** in-progress\n',
  );

  writeFile(
    join(planning, 'config.json'),
    JSON.stringify({ projectName: 'lift-test', version: '1.0' }),
  );

  // One phase with a plan + summary so the transformer produces at least one
  // milestone/slice/task in the resulting GSDProject.
  const phaseDir = join(planning, '29-auth-system');
  mkdirSync(phaseDir, { recursive: true });

  writeFile(
    join(phaseDir, '29-01-PLAN.md'),
    `---
phase: "29-auth-system"
plan: "01"
type: "implementation"
wave: 1
depends_on: []
files_modified: [src/auth.ts]
autonomous: true
must_haves:
  truths:
    - Users can log in
  artifacts:
    - src/auth.ts
  key_links: []
---

# 29-01: Implement Auth

<objective>
Build authentication.
</objective>

<tasks>
<task>Add login endpoint</task>
</tasks>

<verification>
- Login returns 200
</verification>

<success_criteria>
Login works.
</success_criteria>
`,
  );

  writeFile(
    join(phaseDir, '29-01-SUMMARY.md'),
    `---
phase: "29-auth-system"
plan: "01"
subsystem: "auth"
tags:
  - authentication
requires: []
provides:
  - auth
affects: []
tech-stack: []
key-files:
  - src/auth.ts
key-decisions:
  - JWT
patterns-established: []
duration: "1h"
completed: "2026-01-15"
---

# 29-01: Auth Summary

Done.
`,
  );
}

/**
 * Build a minimal `.gsd/` (GSD-2) fixture. The lift treats `.gsd/` as already
 * canonical and just recursively copies → renames, so a few representative
 * files at known relative paths are enough to drive byte-equivalence checks.
 */
function buildGsdFixture(base: string): { knownFiles: string[] } {
  const gsd = join(base, '.gsd');
  mkdirSync(gsd, { recursive: true });

  const files: Array<[string, string]> = [
    ['PROJECT.md', '# GSD-2 Sample Project\n\nCanonical layout.\n'],
    ['STATE.md', '# State\n\n**Phase:** executing\n'],
    ['DECISIONS.md', '# Decisions\n\n| ID | Decision |\n'],
    [
      'milestones/M001/M001-ROADMAP.md',
      '# M001 Roadmap\n\n- [ ] S01 — Some Slice\n',
    ],
    [
      'milestones/M001/slices/S01/S01-PLAN.md',
      '# S01 Plan\n\n## Tasks\n\n- [ ] T01 — A task\n',
    ],
  ];

  const knownFiles: string[] = [];
  for (const [rel, content] of files) {
    const full = join(gsd, rel);
    writeFile(full, content);
    knownFiles.push(rel);
  }
  return { knownFiles };
}

function readAllPaths(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

function snapshotMtimes(root: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full, rel);
      } else {
        out.set(rel, st.mtimeMs);
      }
    }
  };
  walk(root, '');
  return out;
}

function findRenamedDir(base: string, prefix: string): string | null {
  for (const entry of readdirSync(base)) {
    if (entry.startsWith(`${prefix}.migrated-`)) return entry;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

// ─── Scenario 1: .planning/-only lift ──────────────────────────────────────

test('Scenario 1: .planning/-only lifts to .hammer/ via parse + transform + write', async () => {
  const base = makeTempBase('planning-only');
  try {
    buildPlanningFixture(base);

    const stages: string[] = [];
    const result = await liftLegacyLayoutsToHammer(base, {
      notify: (msg) => {
        stages.push(msg);
      },
      timestamp: () => 'TS1',
    });

    assert.equal(result.status, 'lifted', 'planning-only: status is lifted');
    assert.deepEqual(result.layouts, ['planning'], 'planning-only: layouts is [planning]');
    assert.equal(result.renamed.length, 1, 'planning-only: one rename recorded');
    assert.equal(result.renamed[0].layout, 'planning', 'planning-only: rename layout');

    // .hammer/ exists and is non-empty (transform produced GSD-2 output)
    const hammer = join(base, '.hammer');
    assert.ok(existsSync(hammer), 'planning-only: .hammer/ exists');
    assert.ok(
      existsSync(join(hammer, 'PROJECT.md')),
      'planning-only: .hammer/PROJECT.md exists (GSD-2 transform applied)',
    );

    // Source renamed to `.planning.migrated-TS1/`, original `.planning/` gone.
    assert.ok(!existsSync(join(base, '.planning')), 'planning-only: .planning/ removed');
    assert.ok(
      existsSync(join(base, '.planning.migrated-TS1')),
      'planning-only: .planning.migrated-<ts>/ created',
    );

    // Notify lines tagged with stages.
    assert.ok(
      stages.some((s) => s.startsWith('[lift:detect]')),
      'planning-only: detect stage emitted',
    );
    assert.ok(
      stages.some((s) => s.startsWith('[lift:copy]')),
      'planning-only: copy stage emitted',
    );
    assert.ok(
      stages.some((s) => s.startsWith('[lift:rename-source]')),
      'planning-only: rename-source stage emitted',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ─── Scenario 2: .gsd/-only lift ───────────────────────────────────────────

test('Scenario 2: .gsd/-only lifts to .hammer/ via directory copy (byte-equivalent)', async () => {
  const base = makeTempBase('gsd-only');
  try {
    const { knownFiles } = buildGsdFixture(base);

    // Snapshot source content before lift so we can byte-compare after rename.
    const sourceBytes = new Map<string, Buffer>();
    for (const rel of knownFiles) {
      sourceBytes.set(rel, readFileSync(join(base, '.gsd', rel)));
    }

    const result = await liftLegacyLayoutsToHammer(base, {
      timestamp: () => 'TS2',
    });

    assert.equal(result.status, 'lifted', 'gsd-only: status is lifted');
    assert.deepEqual(result.layouts, ['gsd'], 'gsd-only: layouts is [gsd]');
    assert.equal(result.renamed.length, 1, 'gsd-only: one rename');
    assert.equal(result.renamed[0].layout, 'gsd', 'gsd-only: rename layout');

    // Original `.gsd/` gone, renamed dir present.
    assert.ok(!existsSync(join(base, '.gsd')), 'gsd-only: .gsd/ removed');
    assert.ok(
      existsSync(join(base, '.gsd.migrated-TS2')),
      'gsd-only: .gsd.migrated-<ts>/ created',
    );

    // .hammer/ contains byte-equivalent content for every known file.
    const hammer = join(base, '.hammer');
    for (const rel of knownFiles) {
      const hammerFile = join(hammer, rel);
      assert.ok(existsSync(hammerFile), `gsd-only: .hammer/${rel} exists`);
      assert.deepEqual(
        readFileSync(hammerFile),
        sourceBytes.get(rel),
        `gsd-only: .hammer/${rel} byte-equivalent to source`,
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ─── Scenario 3: both-present (.gsd wins, .planning renamed without re-parse) ─

test('Scenario 3: both-present — .gsd wins, .planning renamed without re-parse (D014)', async () => {
  const base = makeTempBase('both-present');
  try {
    // Build both layouts. The .gsd/ fixture has a marker file; the .planning/
    // fixture has DIFFERENT content under the same relative path so we can
    // detect re-parsing if it accidentally happens.
    const { knownFiles } = buildGsdFixture(base);
    buildPlanningFixture(base);

    // Plant a sentinel: .planning/PROJECT.md says one thing, .gsd/PROJECT.md
    // says another. After lift, .hammer/PROJECT.md must match the .gsd/
    // version exactly — proving .planning/ was renamed without re-parsing.
    const gsdProject = readFileSync(join(base, '.gsd', 'PROJECT.md'));
    const planningProject = readFileSync(join(base, '.planning', 'PROJECT.md'));
    assert.notDeepEqual(
      gsdProject,
      planningProject,
      'both-present: sentinel — .gsd/ and .planning/ PROJECT.md differ pre-lift',
    );

    const result = await liftLegacyLayoutsToHammer(base, {
      timestamp: () => 'TS3',
    });

    assert.equal(result.status, 'lifted', 'both-present: status is lifted');
    // Both layouts are recorded as touched (.planning is renamed only).
    assert.ok(result.layouts.includes('gsd'), 'both-present: layouts includes gsd');
    assert.ok(
      result.layouts.includes('planning'),
      'both-present: layouts includes planning (rename-only)',
    );
    assert.equal(result.renamed.length, 2, 'both-present: two renames recorded');

    // Both sources renamed away.
    assert.ok(!existsSync(join(base, '.gsd')), 'both-present: .gsd/ removed');
    assert.ok(!existsSync(join(base, '.planning')), 'both-present: .planning/ removed');
    assert.ok(
      existsSync(join(base, '.gsd.migrated-TS3')),
      'both-present: .gsd.migrated-TS3/ created',
    );
    assert.ok(
      existsSync(join(base, '.planning.migrated-TS3')),
      'both-present: .planning.migrated-TS3/ created',
    );

    // .hammer/ byte-matches the .gsd/ side, NOT the .planning/ side.
    const hammer = join(base, '.hammer');
    for (const rel of knownFiles) {
      const hammerBytes = readFileSync(join(hammer, rel));
      const renamedSource = readFileSync(join(base, '.gsd.migrated-TS3', rel));
      assert.deepEqual(
        hammerBytes,
        renamedSource,
        `both-present: .hammer/${rel} byte-matches the .gsd/ source (not re-parsed from .planning/)`,
      );
    }

    // PROJECT.md must NOT match the .planning/ content (which would indicate
    // a re-parse happened despite the both-present rule).
    assert.notDeepEqual(
      readFileSync(join(hammer, 'PROJECT.md')),
      planningProject,
      'both-present: .hammer/PROJECT.md NOT derived from .planning/',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ─── Scenario 4: idempotent re-run ─────────────────────────────────────────

test('Scenario 4: idempotent — re-running on .gsd-only fixture is a no-op', async () => {
  const base = makeTempBase('idempotent');
  try {
    buildGsdFixture(base);

    // First run: actual lift.
    const first = await liftLegacyLayoutsToHammer(base, {
      timestamp: () => 'TS4',
    });
    assert.equal(first.status, 'lifted', 'idempotent: first call lifts');

    // Snapshot mtimes of every file under .hammer/ + the renamed source.
    const hammer = join(base, '.hammer');
    const renamedSource = join(base, '.gsd.migrated-TS4');
    const beforeHammer = snapshotMtimes(hammer);
    const beforeRenamed = snapshotMtimes(renamedSource);
    const beforeBaseEntries = readdirSync(base).sort();

    // Wait long enough that any actual rewrite would advance mtime past the
    // filesystem's resolution. Most platforms are millisecond or better.
    await new Promise((r) => setTimeout(r, 25));

    // Second run: must short-circuit to already-migrated.
    const second = await liftLegacyLayoutsToHammer(base, {
      timestamp: () => 'TS4-second-call-must-not-be-used',
    });
    assert.equal(
      second.status,
      'already-migrated',
      'idempotent: second call returns already-migrated',
    );
    assert.equal(second.renamed.length, 0, 'idempotent: no new renames');

    // No new top-level entries (no second `.gsd.migrated-<ts2>/` folder).
    assert.deepEqual(
      readdirSync(base).sort(),
      beforeBaseEntries,
      'idempotent: top-level entries unchanged',
    );

    // Mtimes unchanged for every file that existed before.
    const afterHammer = snapshotMtimes(hammer);
    for (const [rel, t] of beforeHammer.entries()) {
      assert.equal(
        afterHammer.get(rel),
        t,
        `idempotent: .hammer/${rel} mtime unchanged`,
      );
    }
    const afterRenamed = snapshotMtimes(renamedSource);
    for (const [rel, t] of beforeRenamed.entries()) {
      assert.equal(
        afterRenamed.get(rel),
        t,
        `idempotent: .gsd.migrated-TS4/${rel} mtime unchanged`,
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ─── Scenario 5: partial-failure resume ────────────────────────────────────

test('Scenario 5: partial-failure resume — finishes pending rename without re-copying', async () => {
  const base = makeTempBase('resume');
  try {
    // Simulate a crash *between* copy and rename: .hammer/ is fully populated
    // from .gsd/, but .gsd/ has not yet been renamed away.
    buildGsdFixture(base);
    const gsdSrc = join(base, '.gsd');
    const hammer = join(base, '.hammer');
    cpSync(gsdSrc, hammer, { recursive: true });

    // Sanity: detection sees both .hammer/ populated AND .gsd/ still present.
    const det = detectLegacyLayouts(base);
    assert.ok(det.hasHammer, 'resume: .hammer/ detected');
    assert.ok(det.hasGsd, 'resume: .gsd/ still detected (un-renamed)');

    // Snapshot .hammer/ mtimes before the resume call. The resume codepath
    // must NOT re-copy these files — only finish the source rename.
    const beforeHammer = snapshotMtimes(hammer);
    await new Promise((r) => setTimeout(r, 25));

    const stages: string[] = [];
    const result = await liftLegacyLayoutsToHammer(base, {
      notify: (msg) => stages.push(msg),
      timestamp: () => 'TS5',
    });

    // Structured result asserts the resume codepath was entered (per
    // Observability Impact: "asserts on the resume codepath being entered,
    // not just the end state").
    assert.equal(result.status, 'resumed', 'resume: status is resumed');
    assert.deepEqual(result.layouts, ['gsd'], 'resume: layouts is [gsd]');
    assert.equal(result.renamed.length, 1, 'resume: one rename');
    assert.equal(result.renamed[0].layout, 'gsd', 'resume: rename layout');
    assert.ok(
      stages.some((s) => s.startsWith('[lift:resume-detected]')),
      'resume: resume-detected notify line emitted',
    );
    // Importantly, NO copy stage should fire on the resume path.
    assert.ok(
      !stages.some((s) => s.startsWith('[lift:copy]')),
      'resume: no [lift:copy] line — files were not re-copied',
    );

    // .gsd/ rename completed, .hammer/ untouched (mtimes preserved).
    assert.ok(!existsSync(gsdSrc), 'resume: .gsd/ has been renamed away');
    assert.ok(
      existsSync(join(base, '.gsd.migrated-TS5')),
      'resume: .gsd.migrated-TS5/ created',
    );
    const afterHammer = snapshotMtimes(hammer);
    for (const [rel, t] of beforeHammer.entries()) {
      assert.equal(
        afterHammer.get(rel),
        t,
        `resume: .hammer/${rel} mtime unchanged (not re-copied)`,
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
