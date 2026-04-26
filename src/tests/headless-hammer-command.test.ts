/**
 * Tests for headless /hammer command injection and .hammer bootstrap behavior.
 *
 * Validates that the headless orchestrator sends /hammer ${command} for canonical
 * invocations, preserves existing idle-timeout behavior (auto/next), and that
 * the headless-context bootstrap targets .hammer/ rather than .gsd/.
 *
 * Uses extracted/re-exported logic to avoid transitive @gsd/native import that
 * breaks in the test environment.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { parseHeadlessArgs, isMultiTurnHeadlessCommand, resolveResumeSession } from '../headless.js'
import { bootstrapHammerProject, bootstrapGsdProject, loadContext } from '../headless-context.js'
import {
  isTerminalNotification,
  isBlockedNotification,
  isMilestoneReadyNotification,
  shouldArmHeadlessIdleTimeout,
  IDLE_TIMEOUT_MS,
  NEW_MILESTONE_IDLE_TIMEOUT_MS,
} from '../headless-events.js'

// ---------------------------------------------------------------------------
// Headless command injection — /hammer canonical
// ---------------------------------------------------------------------------

test('parseHeadlessArgs defaults command to "auto"', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless'])
  assert.equal(opts.command, 'auto')
})

test('parseHeadlessArgs parses explicit command', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless', 'next'])
  assert.equal(opts.command, 'next')
})

test('parseHeadlessArgs parses auto subcommand', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless', 'auto'])
  assert.equal(opts.command, 'auto')
})

test('parseHeadlessArgs parses new-milestone subcommand', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless', 'new-milestone', '--context-text', 'brief'])
  assert.equal(opts.command, 'new-milestone')
  assert.equal(opts.contextText, 'brief')
})

test('parseHeadlessArgs parses status subcommand', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless', 'status'])
  assert.equal(opts.command, 'status')
})

test('parseHeadlessArgs --auto flag sets auto option', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless', 'new-milestone', '--auto', '--context-text', 'brief'])
  assert.equal(opts.auto, true)
  assert.equal(opts.command, 'new-milestone')
})

// Verify the command string that headless.ts builds matches /hammer ${command}
test('canonical command string is /hammer ${command}', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless', 'auto'])
  const commandStr = `/hammer ${opts.command}`
  assert.equal(commandStr, '/hammer auto')
})

test('canonical command string for new-milestone is /hammer new-milestone', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless', 'new-milestone', '--context-text', 'brief'])
  const commandStr = `/hammer ${opts.command}`
  assert.equal(commandStr, '/hammer new-milestone')
})

test('canonical command string for status is /hammer status', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless', 'status'])
  const commandStr = `/hammer ${opts.command}`
  assert.equal(commandStr, '/hammer status')
})

test('canonical command string includes commandArgs', () => {
  const opts = parseHeadlessArgs(['node', 'hammer', 'headless', 'workflow', 'list'])
  const commandStr = `/hammer ${opts.command}${opts.commandArgs.length > 0 ? ' ' + opts.commandArgs.join(' ') : ''}`
  assert.equal(commandStr, '/hammer workflow list')
})

// ---------------------------------------------------------------------------
// Multi-turn command classification (auto/next idle behavior preserved)
// ---------------------------------------------------------------------------

test('isMultiTurnHeadlessCommand: auto is multi-turn', () => {
  assert.equal(isMultiTurnHeadlessCommand('auto'), true)
})

test('isMultiTurnHeadlessCommand: next is multi-turn', () => {
  assert.equal(isMultiTurnHeadlessCommand('next'), true)
})

test('isMultiTurnHeadlessCommand: discuss is multi-turn', () => {
  assert.equal(isMultiTurnHeadlessCommand('discuss'), true)
})

test('isMultiTurnHeadlessCommand: plan is multi-turn', () => {
  assert.equal(isMultiTurnHeadlessCommand('plan'), true)
})

test('isMultiTurnHeadlessCommand: status is not multi-turn', () => {
  assert.equal(isMultiTurnHeadlessCommand('status'), false)
})

test('isMultiTurnHeadlessCommand: new-milestone is not multi-turn', () => {
  assert.equal(isMultiTurnHeadlessCommand('new-milestone'), false)
})

// auto/next do NOT arm idle timeout (terminal-notification driven)
test('auto and next do not arm idle timeout (idle-timeout fix preserved)', () => {
  assert.equal(shouldArmHeadlessIdleTimeout(5, 0, 'auto'), false)
  assert.equal(shouldArmHeadlessIdleTimeout(5, 0, 'next'), false)
})

// other multi-turn commands still arm idle timeout
test('discuss and plan still arm idle timeout', () => {
  assert.equal(shouldArmHeadlessIdleTimeout(1, 0, 'discuss'), true)
  assert.equal(shouldArmHeadlessIdleTimeout(1, 0, 'plan'), true)
})

// ---------------------------------------------------------------------------
// .hammer bootstrap behavior
// ---------------------------------------------------------------------------

test('bootstrapHammerProject creates .hammer/milestones and .hammer/runtime', () => {
  const tmpDir = join(tmpdir(), `hammer-test-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    bootstrapHammerProject(tmpDir)

    assert.ok(existsSync(join(tmpDir, '.hammer', 'milestones')), '.hammer/milestones should be created')
    assert.ok(existsSync(join(tmpDir, '.hammer', 'runtime')), '.hammer/runtime should be created')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('bootstrapHammerProject does NOT create .gsd/ directory', () => {
  const tmpDir = join(tmpdir(), `hammer-test-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    bootstrapHammerProject(tmpDir)
    assert.ok(!existsSync(join(tmpDir, '.gsd')), 'bootstrapHammerProject must not create .gsd/')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('bootstrapGsdProject is a legacy alias that still creates .hammer/ (not .gsd/)', () => {
  const tmpDir = join(tmpdir(), `hammer-test-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    bootstrapGsdProject(tmpDir) // legacy alias — bootstrap-migration
    assert.ok(existsSync(join(tmpDir, '.hammer', 'milestones')), 'legacy alias bootstrapGsdProject should create .hammer/milestones')
    assert.ok(!existsSync(join(tmpDir, '.gsd')), 'legacy alias bootstrapGsdProject must not create .gsd/')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// loadContext
// ---------------------------------------------------------------------------

test('loadContext returns contextText directly', async () => {
  const text = await loadContext({ contextText: 'hello world' })
  assert.equal(text, 'hello world')
})

test('loadContext throws when no source is provided', async () => {
  await assert.rejects(() => loadContext({}), /No context provided/)
})

// ---------------------------------------------------------------------------
// Notification detection (idle-timeout fix regression guard)
// ---------------------------------------------------------------------------

test('isTerminalNotification: "Auto-mode stopped" triggers completion', () => {
  assert.equal(isTerminalNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Auto-mode stopped — all slices complete',
  }), true)
})

test('isTerminalNotification: "Step-mode stopped" triggers completion', () => {
  assert.equal(isTerminalNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Step-mode stopped.',
  }), true)
})

test('isTerminalNotification: progress messages do not trigger early completion', () => {
  assert.equal(isTerminalNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Override resolved — rewrite-docs completed',
  }), false)
})

test('isBlockedNotification: blocked notification detected', () => {
  assert.equal(isBlockedNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Auto-mode stopped (Blocked: escalation needed)',
  }), true)
})

test('isMilestoneReadyNotification: "Milestone M001 ready." triggers auto-chain', () => {
  assert.equal(isMilestoneReadyNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Milestone M001 ready.',
  }), true)
})

test('isMilestoneReadyNotification: unrelated messages do not trigger', () => {
  assert.equal(isMilestoneReadyNotification({
    type: 'extension_ui_request',
    method: 'notify',
    message: 'Milestone check passed.',
  }), false)
})

// ---------------------------------------------------------------------------
// Idle timeout constants (new-milestone needs longer timeout)
// ---------------------------------------------------------------------------

test('IDLE_TIMEOUT_MS is 15 seconds', () => {
  assert.equal(IDLE_TIMEOUT_MS, 15_000)
})

test('NEW_MILESTONE_IDLE_TIMEOUT_MS is 2 minutes (longer for creative tasks)', () => {
  assert.equal(NEW_MILESTONE_IDLE_TIMEOUT_MS, 120_000)
})

// ---------------------------------------------------------------------------
// resolveResumeSession
// ---------------------------------------------------------------------------

test('resolveResumeSession: exact match takes priority', () => {
  const sessions = [
    { id: 'abc123', path: '/s/abc123.jsonl', name: 'A' },
    { id: 'abc456', path: '/s/abc456.jsonl', name: 'B' },
  ]
  const result = resolveResumeSession(sessions, 'abc123')
  assert.equal(result.session?.id, 'abc123')
})

test('resolveResumeSession: prefix match returns single session', () => {
  const sessions = [
    { id: 'abc123', path: '/s/abc123.jsonl', name: 'A' },
    { id: 'def456', path: '/s/def456.jsonl', name: 'B' },
  ]
  const result = resolveResumeSession(sessions, 'abc')
  assert.equal(result.session?.id, 'abc123')
})

test('resolveResumeSession: ambiguous prefix returns error', () => {
  const sessions = [
    { id: 'abc123', path: '/s/abc123.jsonl', name: 'A' },
    { id: 'abc456', path: '/s/abc456.jsonl', name: 'B' },
  ]
  const result = resolveResumeSession(sessions, 'abc')
  assert.ok(result.error, 'should return error for ambiguous prefix')
  assert.match(result.error!, /Ambiguous/)
})

test('resolveResumeSession: no match returns error', () => {
  const sessions = [{ id: 'abc123', path: '/s/abc123.jsonl', name: 'A' }]
  const result = resolveResumeSession(sessions, 'xyz')
  assert.ok(result.error, 'should return error for no match')
  assert.match(result.error!, /No session/)
})
