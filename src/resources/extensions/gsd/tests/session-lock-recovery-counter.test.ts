/**
 * session-lock-recovery-counter.test.ts — M002/S03/T01
 *
 * Proves the recovery counter durability contract on .gsd/auto-<MID>.lock:
 *   (a) a freshly-created lock has consecutiveRecoveryFailures === 0
 *   (b) updateSessionLockFields({consecutiveRecoveryFailures: 1}) persists
 *   (c) round-trip via readSessionLock returns the value
 *   (d) the field survives a simulated lock-file rewrite (write-read-write-read)
 *
 * Together these guarantee the recovery counter persists across both crash
 * (the lock file remains on disk) and stop+restart (the rewrite path preserves
 * the prior counter via shallow merge inside updateSessionLock).
 */

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import test from "node:test";
import assert from "node:assert/strict";

import {
  acquireSessionLock,
  releaseSessionLock,
  readSessionLock,
  readSessionLockData,
  updateSessionLock,
  updateSessionLockFields,
} from "../session-lock.ts";

function freshTmpProject(): string {
  const base = mkdtempSync(join(tmpdir(), "gsd-recovery-counter-"));
  mkdirSync(join(base, ".gsd"), { recursive: true });
  return base;
}

test("(a) freshly-created lock has consecutiveRecoveryFailures === 0", () => {
  const base = freshTmpProject();
  try {
    const result = acquireSessionLock(base);
    assert.ok(result.acquired, "lock must acquire on a fresh tmp project");

    const data = readSessionLock(base);
    assert.ok(data, "lock data must be readable after acquisition");
    assert.equal(
      data.consecutiveRecoveryFailures,
      0,
      "fresh lock must default consecutiveRecoveryFailures to 0 (not undefined)",
    );

    // readSessionLock and readSessionLockData are aliases — both should agree.
    const dataAlt = readSessionLockData(base);
    assert.deepEqual(dataAlt, data, "readSessionLock and readSessionLockData must return identical state");
  } finally {
    releaseSessionLock(base);
    rmSync(base, { recursive: true, force: true });
  }
});

test("(b) updateSessionLockFields({consecutiveRecoveryFailures: 1}) persists", () => {
  const base = freshTmpProject();
  try {
    assert.ok(acquireSessionLock(base).acquired);

    updateSessionLockFields(base, { consecutiveRecoveryFailures: 1 });

    const data = readSessionLock(base);
    assert.ok(data);
    assert.equal(data.consecutiveRecoveryFailures, 1);
  } finally {
    releaseSessionLock(base);
    rmSync(base, { recursive: true, force: true });
  }
});

test("(c) round-trip via readSessionLock returns the value across all recovery diagnostic fields", () => {
  const base = freshTmpProject();
  try {
    assert.ok(acquireSessionLock(base).acquired);

    const recoveryAt = new Date().toISOString();
    updateSessionLockFields(base, {
      consecutiveRecoveryFailures: 2,
      lastRecoveryUnitId: "M002/S03:recover-1",
      lastRecoveryVerdict: "fix-applied",
      lastRecoveryAt: recoveryAt,
    });

    const data = readSessionLock(base);
    assert.ok(data);
    assert.equal(data.consecutiveRecoveryFailures, 2);
    assert.equal(data.lastRecoveryUnitId, "M002/S03:recover-1");
    assert.equal(data.lastRecoveryVerdict, "fix-applied");
    assert.equal(data.lastRecoveryAt, recoveryAt);
  } finally {
    releaseSessionLock(base);
    rmSync(base, { recursive: true, force: true });
  }
});

test("(d) recovery counter survives a simulated lock-file rewrite (updateSessionLock preserves it)", () => {
  const base = freshTmpProject();
  try {
    assert.ok(acquireSessionLock(base).acquired);

    // Set the counter to a known value.
    updateSessionLockFields(base, {
      consecutiveRecoveryFailures: 2,
      lastRecoveryVerdict: "blocker-filed",
      lastRecoveryUnitId: "M002/S03:recover-2",
    });

    // Write→Read cycle 1 — confirm baseline.
    const after1 = readSessionLock(base);
    assert.ok(after1);
    assert.equal(after1.consecutiveRecoveryFailures, 2);
    assert.equal(after1.lastRecoveryVerdict, "blocker-filed");

    // Simulate a normal unit dispatch — updateSessionLock rewrites the JSON
    // entirely (it's the hot path called on every dispatch). The shallow-merge
    // contract says: unitType/unitId/sessionFile change, but the recovery
    // diagnostic fields must survive.
    updateSessionLock(base, "execute-task", "M002/S03/T02", "session-foo.jsonl");

    // Write→Read cycle 2 — confirm the rewrite preserved the counter.
    const after2 = readSessionLock(base);
    assert.ok(after2);
    assert.equal(after2.unitType, "execute-task", "unit metadata updated");
    assert.equal(after2.unitId, "M002/S03/T02");
    assert.equal(after2.sessionFile, "session-foo.jsonl");
    assert.equal(
      after2.consecutiveRecoveryFailures,
      2,
      "counter must survive updateSessionLock rewrite",
    );
    assert.equal(
      after2.lastRecoveryVerdict,
      "blocker-filed",
      "lastRecoveryVerdict must survive updateSessionLock rewrite",
    );
    assert.equal(
      after2.lastRecoveryUnitId,
      "M002/S03:recover-2",
      "lastRecoveryUnitId must survive updateSessionLock rewrite",
    );

    // Reset to 0 via updateSessionLockFields (mirrors the "successful unit
    // completion resets the counter" path in S03's slice plan) and confirm.
    updateSessionLockFields(base, { consecutiveRecoveryFailures: 0 });
    const after3 = readSessionLock(base);
    assert.ok(after3);
    assert.equal(after3.consecutiveRecoveryFailures, 0);
  } finally {
    releaseSessionLock(base);
    rmSync(base, { recursive: true, force: true });
  }
});
