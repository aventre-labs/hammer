/**
 * completion-evidence.test.ts — per-surface negative coverage for
 * the R033 fail-closed completion-evidence assertion (T03 of M002/S02).
 *
 * Each block drives a real completion handler with deliberately
 * incomplete params and asserts:
 *   1. The handler returns an `error` whose tag matches the expected
 *      surface failingStage (e.g. "evidence-missing" / "summary-missing"
 *      / "envelope-missing" / "gate-pending").
 *   2. NO row was written to the corresponding database table — proving
 *      the assertion truly runs *before* `transaction(...)` so the
 *      failure mode is fail-closed end-to-end (T01-AUDIT §6).
 *
 * Pure-helper unit cases are layered on top so the assertion can be
 * exercised in isolation from handler glue.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  openDatabase,
  closeDatabase,
  _getAdapter,
  insertMilestone,
  insertSlice,
  insertTask,
} from "../gsd-db.ts";
import { handleCompleteTask } from "../tools/complete-task.ts";
import { handleCompleteSlice } from "../tools/complete-slice.ts";
import { handleCompleteMilestone } from "../tools/complete-milestone.ts";
import {
  assertCompletionEvidence,
} from "../tools/completion-evidence.ts";
import { clearPathCache } from "../paths.ts";
import { clearParseCache } from "../files.ts";

function makeTmpBase(): string {
  const base = join(tmpdir(), `gsd-completion-evidence-${randomUUID()}`);
  mkdirSync(join(base, ".gsd", "milestones", "M001", "slices", "S01", "tasks"), { recursive: true });
  return base;
}

function writeSlicePlan(base: string): void {
  writeFileSync(
    join(base, ".gsd", "milestones", "M001", "slices", "S01", "S01-PLAN.md"),
    "# S01 Plan\n\n## Tasks\n\n- [ ] **T01: Test task**\n",
  );
}

function writeRoadmap(base: string): void {
  writeFileSync(
    join(base, ".gsd", "milestones", "M001", "M001-ROADMAP.md"),
    "# M001\n\n## Slices\n- [x] **S01: Test** `risk:low` `depends:[]`\n",
  );
}

function countTaskRows(): number {
  const adapter = _getAdapter();
  if (!adapter) return -1;
  const rows = adapter.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'complete'").all() as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

function countCompleteSliceRows(): number {
  const adapter = _getAdapter();
  if (!adapter) return -1;
  const rows = adapter.prepare("SELECT COUNT(*) AS n FROM slices WHERE status = 'complete'").all() as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

function countCompleteMilestoneRows(): number {
  const adapter = _getAdapter();
  if (!adapter) return -1;
  const rows = adapter.prepare("SELECT COUNT(*) AS n FROM milestones WHERE status = 'complete'").all() as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ─── Pure helper coverage ───────────────────────────────────────────────

describe("assertCompletionEvidence — pure helper", () => {
  let base: string;

  beforeEach(() => {
    base = makeTmpBase();
  });

  afterEach(() => {
    clearPathCache();
    clearParseCache();
    if (base) try { rmSync(base, { recursive: true, force: true }); } catch { /* */ }
  });

  it("task: evidence-missing when verification empty", () => {
    writeSlicePlan(base);
    const result = assertCompletionEvidence(
      {
        milestoneId: "M001",
        sliceId: "S01",
        taskId: "T01",
        oneLiner: "x",
        narrative: "y",
        verification: "",
      },
      base,
      "task",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failingStage, "evidence-missing");
      assert.deepEqual(result.missingArtifacts, ["verification"]);
    }
  });

  it("task: summary-missing when oneLiner + narrative empty", () => {
    writeSlicePlan(base);
    const result = assertCompletionEvidence(
      {
        milestoneId: "M001",
        sliceId: "S01",
        taskId: "T01",
        oneLiner: "",
        narrative: "",
        verification: "ok",
      },
      base,
      "task",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failingStage, "summary-missing");
      assert.ok(result.missingArtifacts.includes("oneLiner"));
      assert.ok(result.missingArtifacts.includes("narrative"));
    }
  });

  it("task: envelope-missing when iamEnvelope present but malformed", () => {
    writeSlicePlan(base);
    const result = assertCompletionEvidence(
      {
        milestoneId: "M001",
        sliceId: "S01",
        taskId: "T01",
        oneLiner: "x",
        narrative: "y",
        verification: "ok",
        iamEnvelope: { envelopeId: "" }, // bad envelope
      },
      base,
      "task",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failingStage, "envelope-missing");
    }
  });

  it("slice: evidence-missing when both verification + uatContent empty", () => {
    writeSlicePlan(base);
    const result = assertCompletionEvidence(
      {
        milestoneId: "M001",
        sliceId: "S01",
        oneLiner: "x",
        narrative: "y",
        verification: "",
        uatContent: "",
      },
      base,
      "slice",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failingStage, "evidence-missing");
      assert.ok(result.missingArtifacts.includes("verification"));
      assert.ok(result.missingArtifacts.includes("uatContent"));
    }
  });

  it("milestone: evidence-missing when verificationPassed is false", () => {
    writeRoadmap(base);
    const result = assertCompletionEvidence(
      {
        milestoneId: "M001",
        oneLiner: "x",
        narrative: "y",
        verificationPassed: false,
      },
      base,
      "milestone",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failingStage, "evidence-missing");
      assert.deepEqual(result.missingArtifacts, ["verificationPassed"]);
    }
  });

  it("milestone: evidence-missing when roadmap anchor absent", () => {
    // Note: deliberately do NOT call writeRoadmap
    const result = assertCompletionEvidence(
      {
        milestoneId: "M001",
        oneLiner: "x",
        narrative: "y",
        verificationPassed: true,
      },
      base,
      "milestone",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failingStage, "evidence-missing");
      assert.ok(result.missingArtifacts.some(a => a.includes("ROADMAP.md")));
    }
  });
});

// ─── End-to-end: complete-task fail-closed proves no DB row written ─────

describe("complete-task fail-closed — DB-no-write proof", () => {
  let base: string;

  beforeEach(() => {
    base = makeTmpBase();
    openDatabase(join(base, ".gsd", "gsd.db"));
    insertMilestone({ id: "M001" });
    insertSlice({ id: "S01", milestoneId: "M001" });
  });

  afterEach(() => {
    clearPathCache();
    clearParseCache();
    try { closeDatabase(); } catch { /* */ }
    if (base) try { rmSync(base, { recursive: true, force: true }); } catch { /* */ }
  });

  it("rejects task completion with empty verification — no complete row written", async () => {
    writeSlicePlan(base);
    const before = countTaskRows();

    const result = await handleCompleteTask(
      {
        milestoneId: "M001",
        sliceId: "S01",
        taskId: "T01",
        oneLiner: "x",
        narrative: "y",
        verification: "",
      },
      base,
    );

    assert.ok("error" in result, "expected error");
    if ("error" in result) {
      assert.match(result.error, /fail-closed \(evidence-missing\)/);
    }
    assert.equal(countTaskRows(), before, "no new complete-status task row was written");
  });

  it("rejects task completion with empty narrative — no complete row written", async () => {
    writeSlicePlan(base);
    const before = countTaskRows();

    const result = await handleCompleteTask(
      {
        milestoneId: "M001",
        sliceId: "S01",
        taskId: "T01",
        oneLiner: "x",
        narrative: "",
        verification: "ok",
      },
      base,
    );

    assert.ok("error" in result, "expected error");
    if ("error" in result) {
      assert.match(result.error, /fail-closed \(summary-missing\)/);
    }
    assert.equal(countTaskRows(), before, "no new complete-status task row was written");
  });
});

// ─── End-to-end: complete-slice fail-closed proves no DB row written ────

describe("complete-slice fail-closed — DB-no-write proof", () => {
  let base: string;

  beforeEach(() => {
    base = makeTmpBase();
    openDatabase(join(base, ".gsd", "gsd.db"));
    insertMilestone({ id: "M001" });
    insertSlice({ id: "S01", milestoneId: "M001" });
    insertTask({ id: "T01", sliceId: "S01", milestoneId: "M001", status: "complete", title: "T1" });
  });

  afterEach(() => {
    clearPathCache();
    clearParseCache();
    try { closeDatabase(); } catch { /* */ }
    if (base) try { rmSync(base, { recursive: true, force: true }); } catch { /* */ }
  });

  it("rejects slice completion when uatContent empty — no complete row written", async () => {
    writeSlicePlan(base);
    const before = countCompleteSliceRows();

    const result = await handleCompleteSlice(
      {
        milestoneId: "M001",
        sliceId: "S01",
        sliceTitle: "Test Slice",
        oneLiner: "x",
        narrative: "y",
        verification: "all green",
        uatContent: "",
        deviations: "None.",
        knownLimitations: "None.",
        followUps: "None.",
      },
      base,
    );

    assert.ok("error" in result, "expected error");
    if ("error" in result) {
      assert.match(result.error, /fail-closed \(evidence-missing\)/);
    }
    assert.equal(countCompleteSliceRows(), before, "no new complete-status slice row was written");
  });
});

// ─── End-to-end: complete-milestone fail-closed proves no DB row written

describe("complete-milestone fail-closed — DB-no-write proof", () => {
  let base: string;

  beforeEach(() => {
    base = makeTmpBase();
    openDatabase(join(base, ".gsd", "gsd.db"));
    insertMilestone({ id: "M001" });
    insertSlice({ id: "S01", milestoneId: "M001", status: "complete" });
  });

  afterEach(() => {
    clearPathCache();
    clearParseCache();
    try { closeDatabase(); } catch { /* */ }
    if (base) try { rmSync(base, { recursive: true, force: true }); } catch { /* */ }
  });

  it("rejects milestone completion when roadmap anchor missing — no complete row written", async () => {
    // deliberately NO roadmap on disk
    const before = countCompleteMilestoneRows();

    const result = await handleCompleteMilestone(
      {
        milestoneId: "M001",
        title: "M001 — Test",
        oneLiner: "x",
        narrative: "y",
        verificationPassed: true,
      },
      base,
    );

    assert.ok("error" in result, "expected error");
    if ("error" in result) {
      assert.match(result.error, /fail-closed \(evidence-missing\)/);
      assert.match(result.error, /ROADMAP\.md/);
    }
    assert.equal(countCompleteMilestoneRows(), before, "no new complete-status milestone row was written");
  });

  it("rejects milestone completion when omega validate-milestone artifact absent — no complete row written", async () => {
    writeRoadmap(base);
    const before = countCompleteMilestoneRows();

    const result = await handleCompleteMilestone(
      {
        milestoneId: "M001",
        title: "M001 — Test",
        oneLiner: "x",
        narrative: "y",
        verificationPassed: true,
      },
      base,
    );

    // Either the omega-artifact check OR an upstream check fires; either
    // way we must NOT have written a complete-status milestone row.
    assert.ok("error" in result, "expected error");
    if ("error" in result) {
      assert.match(result.error, /fail-closed \(evidence-missing\)/);
    }
    assert.equal(countCompleteMilestoneRows(), before, "no new complete-status milestone row was written");
  });
});
