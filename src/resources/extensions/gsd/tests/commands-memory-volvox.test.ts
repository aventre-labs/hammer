import { test } from 'node:test';
import assert from 'node:assert/strict';

import { _getAdapter, closeDatabase, openDatabase } from '../gsd-db.ts';
import { createMemory, runVolvoxEpoch } from '../memory-store.ts';
import { handleMemory } from '../commands-memory.ts';

type Notification = { message: string; level: string };

function makeCtx() {
  const notifications: Notification[] = [];
  return {
    notifications,
    ctx: {
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    },
  };
}

const pi = { sendMessage() {} };

async function runMemoryCommand(args: string): Promise<Notification[]> {
  const { ctx, notifications } = makeCtx();
  await handleMemory(args, ctx as never, pi as never);
  return notifications;
}

test('commands-memory: volvox status summarizes lifecycle state and latest epoch without raw JSON', async () => {
  openDatabase(':memory:');
  try {
    createMemory({ category: 'pattern', content: 'germline command status' });
    createMemory({ category: 'gotcha', content: 'dormant command status' });
    _getAdapter()!.prepare(
      `UPDATE memories
          SET volvox_cell_type = 'GERMLINE',
              volvox_role_stability = 0.91,
              volvox_lifecycle_phase = 'mature',
              volvox_propagation_eligible = 1,
              volvox_kirk_step = 7
        WHERE id = 'MEM001'`,
    ).run();
    _getAdapter()!.prepare(
      `UPDATE memories
          SET volvox_cell_type = 'DORMANT',
              volvox_lifecycle_phase = 'dormant',
              volvox_dormancy_cycles = 12
        WHERE id = 'MEM002'`,
    ).run();
    runVolvoxEpoch({ trigger: 'status-command', now: '2026-04-27T00:00:00.000Z', dryRun: false });

    const notifications = await runMemoryCommand('volvox status');
    const message = notifications.at(-1)?.message ?? '';

    assert.equal(notifications.at(-1)?.level, 'info');
    assert.match(message, /Hammer VOLVOX Status/);
    assert.match(message, /Latest epoch: volvox-/);
    assert.match(message, /trigger=status-command/);
    assert.match(message, /By cell type:/);
    assert.match(message, /GERMLINE:/);
    assert.match(message, /DORMANT:/);
    assert.match(message, /Propagation eligible:/);
    assert.match(message, /Dormant:/);
    assert.match(message, /Next: \/hammer memory volvox diagnose/);
    assert.doesNotMatch(message, /diagnostics_json|thresholds_json|\{\"/);
  } finally {
    closeDatabase();
  }
});

test('commands-memory: volvox epoch supports dry-run and surfaces blocking diagnostics actionably', async () => {
  openDatabase(':memory:');
  try {
    createMemory({ category: 'gotcha', content: 'false germline command claimant' });
    _getAdapter()!.prepare(
      `UPDATE memories
          SET volvox_cell_type = 'SOMATIC_SENSOR',
              volvox_lifecycle_phase = 'juvenile',
              volvox_propagation_eligible = 1
        WHERE id = 'MEM001'`,
    ).run();

    const dryRunNotifications = await runMemoryCommand('volvox epoch --dry-run');
    const dryRun = dryRunNotifications.at(-1)?.message ?? '';
    assert.match(dryRun, /Hammer VOLVOX epoch dry-run/);
    assert.match(dryRun, /Persisted: no/);
    assert.equal(
      _getAdapter()!.prepare('SELECT count(*) as cnt FROM volvox_epochs').get()?.['cnt'],
      0,
      'dry-run must not persist an epoch audit row',
    );

    const notifications = await runMemoryCommand('volvox epoch');
    const message = notifications.at(-1)?.message ?? '';
    assert.equal(notifications.at(-1)?.level, 'warning');
    assert.match(message, /Hammer VOLVOX epoch blocked/);
    assert.match(message, /Blocking diagnostics: 1/);
    assert.match(message, /false-germline/);
    assert.match(message, /Next: \/hammer memory volvox diagnose/);
    assert.equal(
      _getAdapter()!.prepare('SELECT count(*) as cnt FROM volvox_epochs').get()?.['cnt'],
      1,
      'non-dry epoch should persist an audit row even when blocked',
    );
  } finally {
    closeDatabase();
  }
});

test('commands-memory: volvox diagnose validates ids and shows scoped diagnostics for archived rows', async () => {
  openDatabase(':memory:');
  try {
    createMemory({ category: 'gotcha', content: 'archived false germline claimant' });
    _getAdapter()!.prepare(
      `UPDATE memories
          SET volvox_cell_type = 'SOMATIC_SENSOR',
              volvox_lifecycle_phase = 'juvenile',
              volvox_propagation_eligible = 1,
              volvox_archived_at = '2026-04-27T00:00:00.000Z'
        WHERE id = 'MEM001'`,
    ).run();
    runVolvoxEpoch({ trigger: 'diagnose-command', now: '2026-04-27T00:01:00.000Z' });

    const invalidNotifications = await runMemoryCommand('volvox diagnose BAD');
    assert.equal(invalidNotifications.at(-1)?.level, 'warning');
    assert.match(invalidNotifications.at(-1)?.message ?? '', /Usage: \/hammer memory volvox diagnose \[MEM###\]/);

    const notifications = await runMemoryCommand('volvox diagnose MEM001');
    const message = notifications.at(-1)?.message ?? '';

    assert.equal(notifications.at(-1)?.level, 'warning');
    assert.match(message, /Hammer VOLVOX Diagnose/);
    assert.match(message, /Memory: MEM001/);
    assert.match(message, /Archived: 2026-04-27T00:00:00.000Z/);
    assert.match(message, /No diagnostics found for MEM001/);
    assert.match(message, /Next: \/hammer memory volvox epoch --dry-run/);
    assert.doesNotMatch(message, /diagnostics_json|raw transcript|secret/i);
  } finally {
    closeDatabase();
  }
});

test('commands-memory: memory list, show, and stats expose compact VOLVOX state', async () => {
  openDatabase(':memory:');
  try {
    createMemory({ category: 'pattern', content: 'operator list state' });
    _getAdapter()!.prepare(
      `UPDATE memories
          SET volvox_cell_type = 'GERMLINE',
              volvox_role_stability = 0.85,
              volvox_lifecycle_phase = 'juvenile',
              volvox_propagation_eligible = 1,
              volvox_kirk_step = 7,
              volvox_dormancy_cycles = 0,
              volvox_archived_at = NULL
        WHERE id = 'MEM001'`,
    ).run();

    const list = (await runMemoryCommand('list')).at(-1)?.message ?? '';
    assert.match(list, /VOLVOX cell=GERMLINE stability=0.85 lifecycle=juvenile kirk=7 dormant=0 eligible=true archived=false/);

    const show = (await runMemoryCommand('show MEM001')).at(-1)?.message ?? '';
    assert.match(show, /VOLVOX:/);
    assert.match(show, /Cell type: GERMLINE/);
    assert.match(show, /Role stability: 0.85/);
    assert.match(show, /Lifecycle\/Kirk: juvenile \/ 7/);
    assert.match(show, /Dormancy cycles: 0/);
    assert.match(show, /Propagation eligible: true/);
    assert.match(show, /Archived: false/);

    const stats = (await runMemoryCommand('stats')).at(-1)?.message ?? '';
    assert.match(stats, /By VOLVOX cell type:/);
    assert.match(stats, /GERMLINE: 1/);
    assert.match(stats, /By VOLVOX lifecycle:/);
    assert.match(stats, /juvenile: 1/);
    assert.match(stats, /Propagation eligible: 1/);
    assert.match(stats, /Archived: 0/);
  } finally {
    closeDatabase();
  }
});

test('commands-memory: volvox unknown subcommand and bad flags return usage, not stack traces', async () => {
  openDatabase(':memory:');
  try {
    const unknown = (await runMemoryCommand('volvox frobnicate')).at(-1);
    assert.equal(unknown?.level, 'warning');
    assert.match(unknown?.message ?? '', /Unknown Hammer VOLVOX subcommand "frobnicate"/);
    assert.match(unknown?.message ?? '', /Usage: \/hammer memory volvox/);

    const badFlag = (await runMemoryCommand('volvox epoch --force')).at(-1);
    assert.equal(badFlag?.level, 'warning');
    assert.match(badFlag?.message ?? '', /Unknown flag "--force"/);
    assert.match(badFlag?.message ?? '', /Usage: \/hammer memory volvox epoch \[--dry-run\]/);
  } finally {
    closeDatabase();
  }
});
