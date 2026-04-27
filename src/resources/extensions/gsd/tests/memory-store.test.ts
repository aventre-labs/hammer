import {
  openDatabase,
  closeDatabase,
  isDbAvailable,
  _getAdapter,
  SCHEMA_VERSION,
} from '../gsd-db.ts';
import {
  _resetLogs,
  peekLogs,
  setStderrLoggingEnabled,
} from '../workflow-logger.ts';
import {
  getActiveMemories,
  getActiveMemoriesRanked,
  nextMemoryId,
  createMemory,
  updateMemoryContent,
  reinforceMemory,
  supersedeMemory,
  isUnitProcessed,
  markUnitProcessed,
  decayStaleMemories,
  enforceMemoryCap,
  applyMemoryActions,
  queryMemoriesRanked,
  formatMemoriesForPrompt,
  runVolvoxEpoch,
  shouldRunVolvoxEpoch,
  getVolvoxStatus,
} from '../memory-store.ts';
import type { MemoryAction } from '../memory-store.ts';
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: fallback when DB not open
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: fallback returns empty when DB not open', () => {
  closeDatabase();
  assert.ok(!isDbAvailable(), 'DB should not be available');

  assert.deepStrictEqual(getActiveMemories(), [], 'getActiveMemories returns [] when DB closed');
  assert.deepStrictEqual(getActiveMemoriesRanked(), [], 'getActiveMemoriesRanked returns [] when DB closed');
  assert.deepStrictEqual(nextMemoryId(), 'MEM001', 'nextMemoryId returns MEM001 when DB closed');
  assert.deepStrictEqual(createMemory({ category: 'test', content: 'test' }), null, 'createMemory returns null when DB closed');
  assert.ok(!reinforceMemory('MEM001'), 'reinforceMemory returns false when DB closed');
  assert.ok(!isUnitProcessed('test/key'), 'isUnitProcessed returns false when DB closed');
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: CRUD operations
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: create and query memories', () => {
  openDatabase(':memory:');

  // Create memories
  const id1 = createMemory({ category: 'gotcha', content: 'esbuild drops .node binaries' });
  assert.ok(id1 !== null, 'createMemory should return an ID');
  assert.deepStrictEqual(id1, 'MEM001', 'first memory ID should be MEM001');

  const id2 = createMemory({ category: 'convention', content: 'use :memory: for tests', confidence: 0.9 });
  assert.deepStrictEqual(id2, 'MEM002', 'second memory ID should be MEM002');

  const id3 = createMemory({ category: 'architecture', content: 'extensions discovered from src/resources/' });
  assert.deepStrictEqual(id3, 'MEM003', 'third memory ID should be MEM003');

  // Query all active
  const active = getActiveMemories();
  assert.deepStrictEqual(active.length, 3, 'should have 3 active memories');
  assert.deepStrictEqual(active[0].category, 'gotcha', 'first memory category');
  assert.deepStrictEqual(active[0].content, 'esbuild drops .node binaries', 'first memory content');
  assert.deepStrictEqual(active[1].confidence, 0.9, 'second memory confidence');

  closeDatabase();
});

test('memory-store: createMemory persists normalized Trinity metadata', () => {
  openDatabase(':memory:');

  const id = createMemory({
    category: 'pattern',
    content: 'Trinity vector persistence',
    source_unit_type: 'task',
    source_unit_id: 'M001/S04/T01',
    trinity: {
      layer: 'generative',
      ity: { factuality: 2, creativity: 0.25 },
      pathy: { empathy: -1, reciprocity: 0.75 },
      provenance: {
        sourceRelations: [
          { type: 'derived_from', targetId: 'M001-CONTEXT', targetKind: 'artifact', weight: 2 },
        ],
      },
      validation: { state: 'validated', score: 1 },
    },
  });
  assert.equal(id, 'MEM001');

  const memory = getActiveMemories()[0];
  assert.equal(memory.trinity?.layer, 'generative');
  assert.deepStrictEqual(memory.trinity?.ity, { factuality: 1, creativity: 0.25 });
  assert.deepStrictEqual(memory.trinity?.pathy, { empathy: 0, reciprocity: 0.75 });
  assert.deepStrictEqual(memory.trinity?.provenance.sourceRelations, [
    { type: 'derived_from', targetId: 'M001-CONTEXT', targetKind: 'artifact', weight: 1 },
  ]);
  assert.deepStrictEqual(memory.trinity?.validation, { state: 'validated', score: 1 });

  const row = _getAdapter()!.prepare(`
    SELECT trinity_layer, trinity_ity, trinity_pathy, trinity_provenance,
           trinity_validation_state, trinity_validation_score
    FROM memories WHERE id = 'MEM001'
  `).get();
  assert.equal(row?.['trinity_layer'], 'generative');
  assert.equal(row?.['trinity_validation_state'], 'validated');
  assert.equal(row?.['trinity_validation_score'], 1);
  assert.deepStrictEqual(JSON.parse(row?.['trinity_ity'] as string), { creativity: 0.25, factuality: 1 });

  closeDatabase();
});

test('memory-store: legacy callers get deterministic Trinity defaults', () => {
  openDatabase(':memory:');

  createMemory({ category: 'preference', content: 'user likes concise summaries' });
  const memory = getActiveMemories()[0];

  assert.equal(memory.trinity?.layer, 'social');
  assert.deepStrictEqual(memory.trinity?.ity, {});
  assert.deepStrictEqual(memory.trinity?.pathy, {});
  assert.deepStrictEqual(memory.trinity?.provenance, { sourceRelations: [] });
  assert.deepStrictEqual(memory.trinity?.validation, { state: 'unvalidated', score: 0 });

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: update and reinforce
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: update and reinforce', () => {
  openDatabase(':memory:');

  createMemory({ category: 'gotcha', content: 'original content' });

  // Update content
  const updated = updateMemoryContent('MEM001', 'revised content', 0.95);
  assert.ok(updated, 'updateMemoryContent should return true');

  const active = getActiveMemories();
  assert.deepStrictEqual(active[0].content, 'revised content', 'content should be updated');
  assert.deepStrictEqual(active[0].confidence, 0.95, 'confidence should be updated');

  // Reinforce
  const reinforced = reinforceMemory('MEM001');
  assert.ok(reinforced, 'reinforceMemory should return true');

  const after = getActiveMemories();
  assert.deepStrictEqual(after[0].hit_count, 1, 'hit_count should be 1 after reinforce');

  // Reinforce again
  reinforceMemory('MEM001');
  const after2 = getActiveMemories();
  assert.deepStrictEqual(after2[0].hit_count, 2, 'hit_count should be 2 after second reinforce');

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: supersede
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: supersede', () => {
  openDatabase(':memory:');

  createMemory({ category: 'convention', content: 'old convention' });
  createMemory({ category: 'convention', content: 'new convention' });

  supersedeMemory('MEM001', 'MEM002');

  const active = getActiveMemories();
  assert.deepStrictEqual(active.length, 1, 'should have 1 active memory after supersede');
  assert.deepStrictEqual(active[0].id, 'MEM002', 'active memory should be MEM002');

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: ranked query ordering
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: ranked query ordering', () => {
  openDatabase(':memory:');

  // Low confidence, no hits
  createMemory({ category: 'pattern', content: 'low ranking', confidence: 0.5 });
  // High confidence, no hits
  createMemory({ category: 'gotcha', content: 'high confidence', confidence: 0.95 });
  // Medium confidence, many hits
  createMemory({ category: 'convention', content: 'frequently used', confidence: 0.7 });

  // Reinforce MEM003 multiple times to boost its ranking
  for (let i = 0; i < 10; i++) reinforceMemory('MEM003');

  const ranked = getActiveMemoriesRanked(10);
  assert.deepStrictEqual(ranked.length, 3, 'should have 3 ranked memories');
  // MEM003: 0.7 * (1 + 10*0.1) = 0.7 * 2.0 = 1.4
  // MEM002: 0.95 * (1 + 0*0.1) = 0.95
  // MEM001: 0.5 * (1 + 0*0.1) = 0.5
  assert.deepStrictEqual(ranked[0].id, 'MEM003', 'highest ranked should be MEM003 (reinforced)');
  assert.deepStrictEqual(ranked[1].id, 'MEM002', 'second ranked should be MEM002 (high confidence)');
  assert.deepStrictEqual(ranked[2].id, 'MEM001', 'lowest ranked should be MEM001');

  // Test limit
  const limited = getActiveMemoriesRanked(2);
  assert.deepStrictEqual(limited.length, 2, 'limit should cap results');

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: processed unit tracking
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: processed unit tracking', () => {
  openDatabase(':memory:');

  assert.ok(!isUnitProcessed('execute-task/M001/S01/T01'), 'should not be processed initially');

  markUnitProcessed('execute-task/M001/S01/T01', '/path/to/activity.jsonl');

  assert.ok(isUnitProcessed('execute-task/M001/S01/T01'), 'should be processed after marking');
  assert.ok(!isUnitProcessed('execute-task/M001/S01/T02'), 'different key should not be processed');

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: enforce memory cap
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: enforce memory cap', () => {
  openDatabase(':memory:');

  // Create 5 memories with varying confidence
  createMemory({ category: 'gotcha', content: 'mem 1', confidence: 0.9 });
  createMemory({ category: 'gotcha', content: 'mem 2', confidence: 0.5 });
  createMemory({ category: 'gotcha', content: 'mem 3', confidence: 0.3 });
  createMemory({ category: 'gotcha', content: 'mem 4', confidence: 0.95 });
  createMemory({ category: 'gotcha', content: 'mem 5', confidence: 0.7 });

  // Enforce cap of 3
  enforceMemoryCap(3);

  const active = getActiveMemories();
  assert.deepStrictEqual(active.length, 3, 'should have 3 active memories after cap enforcement');

  // The 2 lowest-ranked (MEM003=0.3 and MEM002=0.5) should be superseded
  const ids = active.map(m => m.id).sort();
  assert.ok(ids.includes('MEM001'), 'MEM001 (0.9) should survive');
  assert.ok(ids.includes('MEM004'), 'MEM004 (0.95) should survive');
  assert.ok(ids.includes('MEM005'), 'MEM005 (0.7) should survive');

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: applyMemoryActions transaction
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: applyMemoryActions', () => {
  openDatabase(':memory:');

  const actions: MemoryAction[] = [
    { action: 'CREATE', category: 'gotcha', content: 'first gotcha', confidence: 0.8 },
    { action: 'CREATE', category: 'convention', content: 'first convention', confidence: 0.9 },
  ];

  applyMemoryActions(actions, 'execute-task', 'M001/S01/T01');

  let active = getActiveMemories();
  assert.deepStrictEqual(active.length, 2, 'should have 2 memories after CREATE actions');

  // Now apply UPDATE + REINFORCE
  const updateActions: MemoryAction[] = [
    { action: 'UPDATE', id: 'MEM001', content: 'updated gotcha' },
    { action: 'REINFORCE', id: 'MEM002' },
  ];

  applyMemoryActions(updateActions, 'execute-task', 'M001/S01/T02');

  active = getActiveMemories();
  assert.deepStrictEqual(active.find(m => m.id === 'MEM001')?.content, 'updated gotcha', 'MEM001 should be updated');
  assert.deepStrictEqual(active.find(m => m.id === 'MEM002')?.hit_count, 1, 'MEM002 should be reinforced');

  // SUPERSEDE
  const supersedeActions: MemoryAction[] = [
    { action: 'CREATE', category: 'gotcha', content: 'better gotcha', confidence: 0.95 },
    { action: 'SUPERSEDE', id: 'MEM001', superseded_by: 'MEM003' },
  ];

  applyMemoryActions(supersedeActions, 'execute-task', 'M001/S01/T03');

  active = getActiveMemories();
  assert.deepStrictEqual(active.length, 2, 'should have 2 active after supersede');
  assert.ok(!active.find(m => m.id === 'MEM001'), 'MEM001 should be superseded');
  assert.ok(!!active.find(m => m.id === 'MEM003'), 'MEM003 should be active');

  closeDatabase();
});

test('memory-store: queryMemoriesRanked filters by Trinity layer and prefers vector lens matches', () => {
  openDatabase(':memory:');

  createMemory({
    category: 'pattern',
    content: 'trinity vector ranking shared keyword alpha',
    confidence: 0.8,
    trinity: { layer: 'generative', ity: { creativity: 0.95 }, pathy: { reciprocity: 0.2 } },
  });
  createMemory({
    category: 'architecture',
    content: 'trinity vector ranking shared keyword alpha',
    confidence: 0.99,
    trinity: { layer: 'knowledge', ity: { factuality: 1 }, pathy: { empathy: 1 } },
  });
  createMemory({
    category: 'pattern',
    content: 'trinity vector ranking shared keyword alpha',
    confidence: 0.8,
    trinity: { layer: 'generative', ity: { creativity: 0.1 }, pathy: { reciprocity: 0.1 } },
  });

  const filtered = queryMemoriesRanked({
    query: 'shared keyword alpha',
    k: 10,
    trinityLayer: 'generative',
    trinityLens: { ity: { creativity: 1 }, pathy: { reciprocity: 1 } },
  });

  assert.deepStrictEqual(filtered.map((hit) => hit.memory.id), ['MEM001', 'MEM003']);
  assert.equal(filtered[0].trinityRank, 1);
  assert.equal(filtered[0].trinityLayerMatch, true);
  assert.ok(filtered[0].trinityScore > filtered[1].trinityScore, 'closer vector match should rank first');

  closeDatabase();
});


test('memory-store: create/read defaults include VOLVOX metadata and reinforce updates activation counters', () => {
  openDatabase(':memory:');

  createMemory({ category: 'pattern', content: 'VOLVOX defaults' });
  let memory = getActiveMemories()[0];
  assert.equal(memory.volvox?.cellType, 'UNDIFFERENTIATED');
  assert.equal(memory.volvox?.roleStability, 0);
  assert.equal(memory.volvox?.lifecyclePhase, 'embryonic');
  assert.equal(memory.volvox?.propagationEligible, false);
  assert.equal(memory.volvox?.activationCount, 0);
  assert.equal(memory.volvox?.activationRate, 0);

  assert.equal(reinforceMemory('MEM001'), true);
  memory = getActiveMemories()[0];
  assert.equal(memory.hit_count, 1);
  assert.equal(memory.volvox?.activationCount, 1);
  assert.ok((memory.volvox?.activationRate ?? 0) > 0, 'reinforce should bump activation rate');

  closeDatabase();
});

test('memory-store: VOLVOX epoch persists classification, audit rows, and failed diagnostics', () => {
  openDatabase(':memory:');

  createMemory({ category: 'pattern', content: 'offspring-rich memory', trinity: { layer: 'generative' } });
  createMemory({ category: 'gotcha', content: 'false germline claimant' });

  const adapter = _getAdapter()!;
  adapter.prepare(
    `UPDATE memories
        SET volvox_activation_rate = 0.8,
            volvox_offspring_count = 5,
            volvox_kirk_step = 6
      WHERE id = 'MEM001'`,
  ).run();
  adapter.prepare(
    `UPDATE memories
        SET volvox_propagation_eligible = 1,
            volvox_cell_type = 'SOMATIC_SENSOR',
            volvox_lifecycle_phase = 'juvenile'
      WHERE id = 'MEM002'`,
  ).run();

  const epoch = runVolvoxEpoch({
    trigger: 'test',
    now: '2026-04-27T00:00:00.000Z',
    thresholds: { offspringCount: 3, activationRate: 0.5 },
  });

  assert.equal(epoch.status, 'blocked', 'false-germline should block successful completion');
  assert.equal(epoch.counts.processed, 2);
  assert.ok(epoch.diagnostics.some((d) => d.code === 'false-germline' && d.memoryId === 'MEM002'));

  const germline = getActiveMemories().find((memory) => memory.id === 'MEM001');
  assert.equal(germline?.volvox?.cellType, 'GERMLINE');
  assert.equal(germline?.volvox?.lifecyclePhase, 'juvenile');
  assert.equal(germline?.volvox?.lastEpochId, epoch.epochId);

  const epochRow = adapter.prepare('SELECT status, trigger, processed_count, diagnostics_json FROM volvox_epochs WHERE id = ?').get(epoch.epochId);
  assert.equal(epochRow?.['status'], 'failed');
  assert.equal(epochRow?.['trigger'], 'test');
  assert.equal(epochRow?.['processed_count'], 2);
  assert.ok(String(epochRow?.['diagnostics_json']).includes('false-germline'));

  const mutationRows = adapter.prepare('SELECT memory_id, diagnostics_json FROM volvox_epoch_mutations WHERE epoch_id = ? ORDER BY memory_id').all(epoch.epochId);
  assert.equal(mutationRows.length, 2);
  assert.ok(String(mutationRows[1]?.['diagnostics_json']).includes('false-germline'));

  closeDatabase();
});


test('memory-store: VOLVOX epoch leaves failed audit state when persistence throws', () => {
  openDatabase(':memory:');

  createMemory({ category: 'pattern', content: 'persistence failure' });
  const adapter = _getAdapter()!;
  const originalPrepare = adapter.prepare.bind(adapter);
  const originalPrepareMethod = adapter.prepare;
  adapter.prepare = ((sql: string) => {
    if (sql.includes('UPDATE memories SET') && sql.includes('volvox_cell_type')) {
      const stmt = originalPrepare(sql);
      return {
        run: (..._params: unknown[]) => {
          throw new Error('simulated VOLVOX update failure');
        },
        get: (...params: unknown[]) => stmt.get(...params),
        all: (...params: unknown[]) => stmt.all(...params),
      };
    }
    return originalPrepare(sql);
  }) as typeof adapter.prepare;

  try {
    assert.throws(
      () => runVolvoxEpoch({ trigger: 'persistence-failure', now: '2026-04-27T00:00:00.000Z' }),
      /simulated VOLVOX update failure/,
    );
  } finally {
    adapter.prepare = originalPrepareMethod;
  }

  const failed = adapter.prepare(
    "SELECT status, trigger, error_message FROM volvox_epochs WHERE trigger = 'persistence-failure'",
  ).get();
  assert.equal(failed?.['status'], 'failed');
  assert.match(String(failed?.['error_message']), /simulated VOLVOX update failure/);

  closeDatabase();
});

test('memory-store: VOLVOX filters and legacy ranking compatibility', () => {
  openDatabase(':memory:');

  createMemory({ category: 'pattern', content: 'alpha high', confidence: 0.7 });
  createMemory({ category: 'pattern', content: 'alpha low dormant', confidence: 0.95 });
  reinforceMemory('MEM001');
  reinforceMemory('MEM001');

  const adapter = _getAdapter()!;
  adapter.prepare(
    "UPDATE memories SET volvox_cell_type = 'GERMLINE', volvox_lifecycle_phase = 'mature', volvox_propagation_eligible = 1 WHERE id = 'MEM001'",
  ).run();
  adapter.prepare(
    "UPDATE memories SET volvox_cell_type = 'DORMANT', volvox_lifecycle_phase = 'dormant' WHERE id = 'MEM002'",
  ).run();

  const legacy = getActiveMemoriesRanked(10).map((memory) => memory.id);
  assert.equal(legacy.length, 2, 'legacy ranked listing should still include dormant rows by default');
  assert.ok(legacy.includes('MEM001'));
  assert.ok(legacy.includes('MEM002'));

  const germline = queryMemoriesRanked({ query: 'alpha', k: 10, volvoxCellType: 'GERMLINE' });
  assert.deepStrictEqual(germline.map((hit) => hit.memory.id), ['MEM001']);

  const activeOnly = queryMemoriesRanked({ query: '', k: 10, includeDormant: false });
  assert.deepStrictEqual(activeOnly.map((hit) => hit.memory.id), ['MEM001']);

  const eligible = getActiveMemoriesRanked(10, { propagationEligible: true });
  assert.deepStrictEqual(eligible.map((memory) => memory.id), ['MEM001']);

  closeDatabase();
});

test('memory-store: shouldRunVolvoxEpoch respects query-count and elapsed thresholds', () => {
  assert.equal(shouldRunVolvoxEpoch({ processedQueriesSinceLastEpoch: 4 }), false);
  assert.equal(shouldRunVolvoxEpoch({ processedQueriesSinceLastEpoch: 5 }), true);
  assert.equal(shouldRunVolvoxEpoch({ processedQueriesSinceLastEpoch: 0, lastEpochAt: '2026-04-27T00:00:00.000Z', now: '2026-04-27T00:04:59.000Z', minElapsedMs: 300_000 }), false);
  assert.equal(shouldRunVolvoxEpoch({ processedQueriesSinceLastEpoch: 0, lastEpochAt: '2026-04-27T00:00:00.000Z', now: '2026-04-27T00:05:00.000Z', minElapsedMs: 300_000 }), true);
});

test('memory-store: VOLVOX epoch handles empty and all-dormant tables', () => {
  openDatabase(':memory:');

  const empty = runVolvoxEpoch({ trigger: 'empty', now: '2026-04-27T00:00:00.000Z' });
  assert.equal(empty.status, 'completed');
  assert.equal(empty.counts.processed, 0);

  createMemory({ category: 'gotcha', content: 'dormant only' });
  _getAdapter()!.prepare(
    "UPDATE memories SET volvox_cell_type = 'DORMANT', volvox_lifecycle_phase = 'dormant', volvox_dormancy_cycles = 12 WHERE id = 'MEM001'",
  ).run();

  const dormant = runVolvoxEpoch({ trigger: 'dormant', now: '2026-04-27T00:01:00.000Z' });
  assert.equal(dormant.counts.processed, 1, 'dormant but not archived rows are still settled');
  const activeOnly = queryMemoriesRanked({ query: '', includeDormant: false, k: 10 });
  assert.deepStrictEqual(activeOnly, []);

  closeDatabase();
});

test('memory-store: VOLVOX status surfaces latest epoch and diagnostics', () => {
  openDatabase(':memory:');

  createMemory({ category: 'pattern', content: 'status memory' });
  const epoch = runVolvoxEpoch({ trigger: 'status-test', now: '2026-04-27T00:00:00.000Z', thresholds: { activationRate: -1 } });
  const status = getVolvoxStatus();

  assert.equal(status.latestEpoch?.id, epoch.epochId);
  assert.equal(status.latestEpoch?.trigger, 'status-test');
  assert.equal(status.diagnostics.length, 1);
  assert.equal(status.diagnostics[0].code, 'malformed-threshold');
  assert.equal(status.memories.length, 1);

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: formatMemoriesForPrompt
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: formatMemoriesForPrompt', () => {
  openDatabase(':memory:');

  createMemory({ category: 'gotcha', content: 'esbuild drops .node binaries' });
  createMemory({ category: 'convention', content: 'use :memory: for tests' });
  createMemory({ category: 'architecture', content: 'extensions in src/resources/' });
  createMemory({ category: 'gotcha', content: 'TypeScript path aliases need .js' });

  const memories = getActiveMemoriesRanked(30);
  const formatted = formatMemoriesForPrompt(memories);

  assert.ok(formatted.includes('## Project Memory (auto-learned)'), 'should have header');
  assert.ok(formatted.includes('### Gotcha'), 'should have gotcha category');
  assert.ok(formatted.includes('### Convention'), 'should have convention category');
  assert.ok(formatted.includes('### Architecture'), 'should have architecture category');
  assert.ok(formatted.includes('- esbuild drops .node binaries'), 'should have gotcha content');
  assert.ok(formatted.includes('- use :memory: for tests'), 'should have convention content');

  // Test empty memories
  closeDatabase();
  openDatabase(':memory:');
  const emptyFormatted = formatMemoriesForPrompt([]);
  assert.deepStrictEqual(emptyFormatted, '', 'empty memories should return empty string');

  // Test token budget truncation
  closeDatabase();
  openDatabase(':memory:');
  for (let i = 0; i < 20; i++) {
    createMemory({ category: 'pattern', content: `A very long memory entry that takes up space #${i}: ${'x'.repeat(200)}` });
  }
  const budgetMemories = getActiveMemoriesRanked(30);
  const truncated = formatMemoriesForPrompt(budgetMemories, 500);
  assert.ok(truncated.length < 2500, `formatted length ${truncated.length} should be under budget`);

  closeDatabase();
});

test('memory-store: formatMemoriesForPrompt annotates compact Trinity metadata', () => {
  openDatabase(':memory:');

  createMemory({
    category: 'pattern',
    content: 'compact Trinity prompt annotation',
    trinity: {
      layer: 'generative',
      ity: { creativity: 0.92, factuality: 0.4, risk: 0.1 },
      pathy: { reciprocity: 0.8 },
      validation: { state: 'validated', score: 0.75 },
    },
  });

  const formatted = formatMemoriesForPrompt(getActiveMemoriesRanked(5));

  assert.ok(
    formatted.includes('[layer=generative ity=creativity:0.92,factuality:0.4 pathy=reciprocity:0.8 validation=validated:0.75]'),
    formatted,
  );
  assert.ok(!formatted.includes('sourceRelations'), 'prompt annotations should not dump provenance JSON blobs');

  closeDatabase();
});


test('memory-store: formatMemoriesForPrompt annotates compact VOLVOX metadata', () => {
  openDatabase(':memory:');

  createMemory({
    category: 'pattern',
    content: 'compact VOLVOX prompt annotation',
    volvox: {
      cellType: 'GERMLINE',
      roleStability: 0.85,
      lifecyclePhase: 'mature',
      propagationEligible: true,
    },
  });

  const formatted = formatMemoriesForPrompt(getActiveMemoriesRanked(5));

  assert.ok(
    formatted.includes('[volvox cell=GERMLINE phase=mature stable=0.85 propagation=eligible]'),
    formatted,
  );
  assert.ok(!formatted.includes('diagnostics_json'), 'prompt annotations should not dump VOLVOX audit JSON blobs');

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: ID generation
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: ID generation', () => {
  openDatabase(':memory:');

  assert.deepStrictEqual(nextMemoryId(), 'MEM001', 'first ID should be MEM001');

  createMemory({ category: 'test', content: 'test' });
  assert.deepStrictEqual(nextMemoryId(), 'MEM002', 'after first create, next should be MEM002');

  // Create several more
  for (let i = 0; i < 98; i++) createMemory({ category: 'test', content: `test ${i}` });
  assert.deepStrictEqual(nextMemoryId(), 'MEM100', 'after 99 creates, next should be MEM100');

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// memory-store: schema migration (v2 → v3)
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: schema includes memories table', () => {
  openDatabase(':memory:');

  const adapter = _getAdapter()!;

  // Verify memories table exists
  const memCount = adapter.prepare('SELECT count(*) as cnt FROM memories').get();
  assert.deepStrictEqual(memCount?.['cnt'], 0, 'memories table should exist and be empty');

  // Verify memory_processed_units table exists
  const procCount = adapter.prepare('SELECT count(*) as cnt FROM memory_processed_units').get();
  assert.deepStrictEqual(procCount?.['cnt'], 0, 'memory_processed_units table should exist and be empty');

  // Verify active_memories view exists
  const viewCount = adapter.prepare('SELECT count(*) as cnt FROM active_memories').get();
  assert.deepStrictEqual(viewCount?.['cnt'], 0, 'active_memories view should exist');

  // Verify schema version is current.
  const version = adapter.prepare('SELECT MAX(version) as v FROM schema_version').get();
  assert.deepStrictEqual(version?.["v"], SCHEMA_VERSION, 'schema version should be current');

  closeDatabase();
});

// ═══════════════════════════════════════════════════════════════════════════
// regression #4967 — createMemory must not silently swallow SQL errors
// ═══════════════════════════════════════════════════════════════════════════

test('memory-store: createMemory throws on memory-table SQL errors (regression #4967)', () => {
  openDatabase(':memory:');

  const adapter = _getAdapter()!;
  // Drop FTS + dependents first to satisfy SQLite's trigger ordering, then
  // the base memories table. IF EXISTS makes setup robust against schema
  // versions that may not have created every dependent (e.g. embeddings).
  adapter.prepare('DROP TABLE IF EXISTS memory_embeddings').run();
  adapter.prepare('DROP TABLE IF EXISTS memories_fts').run();
  adapter.prepare('DROP TABLE IF EXISTS memories').run();

  // Pre-fix behaviour: returns null and the caller has no idea why.
  // Post-fix behaviour: throws so the caller can surface the real SQL message.
  assert.throws(
    () => createMemory({ category: 'gotcha', content: 'broken store' }),
    /memories|no such table/i,
    'createMemory must surface SQL errors instead of returning null',
  );

  closeDatabase();
});

test('memory-store: VACUUM retry rolls back partial memory and logs recovery', () => {
  openDatabase(':memory:');

  const adapter = _getAdapter()!;
  const originalPrepareMethod = adapter.prepare;
  const originalPrepare = adapter.prepare.bind(adapter);
  const previousStderrLogging = setStderrLoggingEnabled(false);
  const streamAny = process.stderr as unknown as {
    write: (chunk: string | Uint8Array, ...rest: unknown[]) => boolean;
  };
  const originalStderrWrite = streamAny.write.bind(streamAny);
  let selectFailures = 0;
  let vacuumRuns = 0;
  _resetLogs();

  adapter.prepare = ((sql: string) => {
    if (sql === 'SELECT seq FROM memories WHERE id = :id' && selectFailures === 0) {
      const stmt = originalPrepare(sql);
      return {
        run: (...params: unknown[]) => stmt.run(...params),
        get: (..._params: unknown[]) => {
          selectFailures++;
          throw new Error('database disk image is malformed');
        },
        all: (...params: unknown[]) => stmt.all(...params),
      };
    }

    if (sql === 'VACUUM') {
      const stmt = originalPrepare(sql);
      return {
        run: (...params: unknown[]) => {
          vacuumRuns++;
          return stmt.run(...params);
        },
        get: (...params: unknown[]) => stmt.get(...params),
        all: (...params: unknown[]) => stmt.all(...params),
      };
    }

    return originalPrepare(sql);
  }) as typeof adapter.prepare;
  streamAny.write = (): boolean => true;

  try {
    const id = createMemory({ category: 'gotcha', content: 'recover without duplicate' });
    assert.equal(id, 'MEM001', 'retry should create a single first memory');

    const rows = adapter.prepare('SELECT id FROM memories ORDER BY seq').all();
    assert.deepStrictEqual(
      rows.map((row) => row['id']),
      ['MEM001'],
      'failed first attempt should not leave a live _TMP_ memory behind',
    );
    assert.equal(selectFailures, 1, 'test should simulate one malformed SELECT after INSERT');
    assert.equal(vacuumRuns, 1, 'malformed recovery should run VACUUM once');
    assert.ok(
      peekLogs().some((entry) =>
        entry.component === 'memory-store' &&
        entry.message === 'recovered malformed memory store via VACUUM'
      ),
      'successful VACUUM recovery should be emitted to the workflow logger',
    );
  } finally {
    adapter.prepare = originalPrepareMethod;
    streamAny.write = originalStderrWrite;
    setStderrLoggingEnabled(previousStderrLogging);
    _resetLogs();
    closeDatabase();
  }
});

test('memory-store: applyMemoryActions stays non-fatal when memory store is broken (regression #4967)', () => {
  openDatabase(':memory:');

  const adapter = _getAdapter()!;
  // Drop FTS + dependents first to satisfy SQLite's trigger ordering, then
  // the base memories table. IF EXISTS makes setup robust against schema
  // versions that may not have created every dependent (e.g. embeddings).
  adapter.prepare('DROP TABLE IF EXISTS memory_embeddings').run();
  adapter.prepare('DROP TABLE IF EXISTS memories_fts').run();
  adapter.prepare('DROP TABLE IF EXISTS memories').run();

  // applyMemoryActions wraps createMemory in a transaction with an outer
  // catch. Even with createMemory now throwing, applyMemoryActions must not
  // crash the auto-mode flow that calls it (memory extraction is best-effort).
  const actions: MemoryAction[] = [
    { action: 'CREATE', category: 'gotcha', content: 'inside-transaction call' },
  ];
  assert.doesNotThrow(
    () => applyMemoryActions(actions),
    'applyMemoryActions must absorb thrown errors so callers continue',
  );

  closeDatabase();
});
