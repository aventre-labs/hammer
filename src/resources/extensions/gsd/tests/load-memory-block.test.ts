// GSD-2 — loadMemoryBlock tests (ADR-013 step 4 auto-injection parity)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { closeDatabase, openDatabase } from '../gsd-db.ts';
import { createMemory } from '../memory-store.ts';
import { loadMemoryBlock } from '../bootstrap/system-context.ts';

// ─── Success path: critical memories surface in the labeled block ──────────

test('loadMemoryBlock: renders MEMORY block when critical memories exist', async () => {
  openDatabase(':memory:');
  try {
    const id = createMemory({
      category: 'architecture',
      content: 'Use the memories table as the single source of truth for decisions.',
      confidence: 0.95,
      volvox: {
        cellType: 'GERMLINE',
        roleStability: 0.85,
        lifecyclePhase: 'juvenile',
        propagationEligible: true,
      },
    });
    assert.ok(id, 'createMemory should seed a memory');

    const block = await loadMemoryBlock('');
    assert.ok(block.length > 0, 'block should be non-empty when critical memories exist');
    assert.match(block, /\[MEMORY — Critical and prompt-relevant memories/);
    assert.match(block, /memories table as the single source of truth/);
    assert.match(block, /\[VOLVOX: cell=GERMLINE stability=0\.85 lifecycle=juvenile kirk=0 dormant=0 eligible=true\]/);
    assert.doesNotMatch(block, /diagnostics_json|thresholds_json|\{\"/);
  } finally {
    closeDatabase();
  }
});

test('loadMemoryBlock: omits dormant and archived VOLVOX rows from prompt context', async () => {
  openDatabase(':memory:');
  try {
    createMemory({ category: 'architecture', content: 'Active architecture memory.' });
    createMemory({ category: 'architecture', content: 'Dormant architecture memory.' });
    createMemory({ category: 'architecture', content: 'Archived architecture memory.' });

    const { _getAdapter } = await import('../gsd-db.ts');
    _getAdapter()!.prepare(
      "UPDATE memories SET volvox_cell_type = 'DORMANT', volvox_lifecycle_phase = 'dormant' WHERE id = 'MEM002'",
    ).run();
    _getAdapter()!.prepare(
      "UPDATE memories SET volvox_lifecycle_phase = 'archived', volvox_archived_at = '2026-04-27T00:00:00.000Z' WHERE id = 'MEM003'",
    ).run();

    const block = await loadMemoryBlock('architecture');

    assert.match(block, /Active architecture memory/);
    assert.doesNotMatch(block, /Dormant architecture memory/);
    assert.doesNotMatch(block, /Archived architecture memory/);
  } finally {
    closeDatabase();
  }
});

// ─── Failure / degraded path: no DB → returns "" without throwing ───────────

test('loadMemoryBlock: returns empty string when no DB is available', async () => {
  closeDatabase();
  const block = await loadMemoryBlock('anything');
  assert.equal(block, '', 'no DB → empty block (graceful degradation)');
});
