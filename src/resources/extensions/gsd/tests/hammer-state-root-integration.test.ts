import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ensureDbOpen, resolveProjectRootDbPath } from '../bootstrap/dynamic-tools.ts';
import { closeDatabase, insertMilestone, insertSlice, insertTask } from '../gsd-db.ts';
import { appendEvent, compactMilestoneEvents, readEvents } from '../workflow-events.ts';
import { writeManifest, readManifest } from '../workflow-manifest.ts';
import { renderSummaryProjection, renderStateProjection } from '../workflow-projections.ts';

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `hammer-state-root-${label}-`));
}

function cleanup(dir: string): void {
  try { closeDatabase(); } catch { /* ok */ }
  rmSync(dir, { recursive: true, force: true });
}

function seedCompletedTask(): void {
  insertMilestone({ id: 'M001', title: 'Hammer root' });
  insertSlice({ id: 'S01', milestoneId: 'M001', title: 'State root' });
  insertTask({
    id: 'T01',
    sliceId: 'S01',
    milestoneId: 'M001',
    title: 'Completed task',
    status: 'complete',
    oneLiner: 'Completed through Hammer root.',
    narrative: 'Projection coverage for selected state root.',
    verificationResult: 'passed',
    keyFiles: ['src/resources/extensions/gsd/bootstrap/dynamic-tools.ts'],
  });
}

test('hammer state root: empty .hammer opens DB and does not create .gsd', async () => {
  const base = tempDir('empty');
  try {
    mkdirSync(join(base, '.hammer'), { recursive: true });

    assert.equal(await ensureDbOpen(base), true);

    assert.ok(existsSync(join(base, '.hammer', 'gsd.db')), 'DB should be created in .hammer');
    assert.equal(existsSync(join(base, '.gsd')), false, 'fresh .hammer project must not create .gsd');
  } finally {
    cleanup(base);
  }
});

test('hammer state root: Markdown-bearing .hammer migrates without .gsd side effects', async () => {
  const base = tempDir('markdown');
  try {
    mkdirSync(join(base, '.hammer'), { recursive: true });
    writeFileSync(join(base, '.hammer', 'DECISIONS.md'), [
      '# Decisions',
      '',
      '| # | When | Scope | Decision | Choice | Rationale | Revisable |',
      '|---|------|-------|----------|--------|-----------|-----------|',
      '| D001 | M001 | architecture | Hammer root | .hammer | no degradation | Yes |',
      '',
    ].join('\n'));

    assert.equal(await ensureDbOpen(base), true);

    assert.ok(existsSync(join(base, '.hammer', 'gsd.db')), 'DB should be created in .hammer');
    assert.equal(existsSync(join(base, '.gsd')), false, 'Markdown migration must not create .gsd');
  } finally {
    cleanup(base);
  }
});

test('hammer state root: legacy .gsd-only projects still open as compatibility bridge', async () => {
  const base = tempDir('legacy');
  try {
    mkdirSync(join(base, '.gsd'), { recursive: true });

    assert.equal(await ensureDbOpen(base), true);

    assert.ok(existsSync(join(base, '.gsd', 'gsd.db')), 'legacy DB should remain under .gsd');
    assert.equal(existsSync(join(base, '.hammer')), false, 'legacy bridge must not create .hammer');
  } finally {
    cleanup(base);
  }
});

test('hammer state root: .hammer wins when both .hammer and .gsd exist', async () => {
  const base = tempDir('both');
  try {
    mkdirSync(join(base, '.hammer'), { recursive: true });
    mkdirSync(join(base, '.gsd'), { recursive: true });

    assert.equal(resolveProjectRootDbPath(base), join(base, '.hammer', 'gsd.db'));
    assert.equal(await ensureDbOpen(base), true);

    assert.ok(existsSync(join(base, '.hammer', 'gsd.db')), 'DB should be created in canonical .hammer');
    assert.equal(existsSync(join(base, '.gsd', 'gsd.db')), false, 'compat .gsd should not receive a DB when .hammer exists');
  } finally {
    cleanup(base);
  }
});

test('hammer state root: no state dir remains a non-openable project', async () => {
  const base = tempDir('none');
  try {
    assert.equal(await ensureDbOpen(base), false);
    assert.equal(existsSync(join(base, '.gsd')), false, 'no-state project should not create .gsd');
    assert.equal(existsSync(join(base, '.hammer')), false, 'no-state project should not create .hammer');
  } finally {
    cleanup(base);
  }
});

test('hammer state root: post-mutation artifacts write under selected .hammer root', async () => {
  const base = tempDir('artifacts');
  try {
    mkdirSync(join(base, '.hammer'), { recursive: true });
    assert.equal(await ensureDbOpen(base), true);
    seedCompletedTask();

    renderSummaryProjection(base, 'M001', 'S01', 'T01');
    await renderStateProjection(base);
    writeManifest(base);
    appendEvent(base, {
      cmd: 'complete-task',
      params: { milestoneId: 'M001', sliceId: 'S01', taskId: 'T01' },
      ts: new Date().toISOString(),
      actor: 'agent',
    });
    compactMilestoneEvents(base, 'M001');

    assert.ok(existsSync(join(base, '.hammer', 'milestones', 'M001', 'slices', 'S01', 'tasks', 'T01-SUMMARY.md')));
    assert.ok(readFileSync(join(base, '.hammer', 'STATE.md'), 'utf-8').startsWith('# Hammer State'));
    assert.ok(readManifest(base), 'manifest should be readable from .hammer');
    assert.equal(readEvents(join(base, '.hammer', 'event-log.jsonl')).length, 0, 'active log should be compacted');
    assert.ok(existsSync(join(base, '.hammer', 'event-log-M001.jsonl.archived')), 'archive should write under .hammer');
    assert.equal(existsSync(join(base, '.gsd')), false, 'artifact hooks must not create .gsd');
  } finally {
    cleanup(base);
  }
});

test('hammer state root: legacy worktree and external-state DB path bridges are preserved', () => {
  const projectRoot = '/home/user/project';
  assert.equal(
    resolveProjectRootDbPath(`${projectRoot}/.gsd/worktrees/M001/src`),
    join(projectRoot, '.gsd', 'gsd.db'),
  );

  const externalRoot = '/home/user/.gsd/projects/a1b2c3d4';
  assert.equal(
    resolveProjectRootDbPath(`${externalRoot}/worktrees/M001/src`),
    join(externalRoot, 'gsd.db'),
  );
});
