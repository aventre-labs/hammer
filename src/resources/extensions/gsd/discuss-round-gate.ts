/**
 * discuss-round-gate — fail-closed structural gate for `ask_user_questions`
 * when invoked under a discuss-* unitType.
 *
 * Read-only inspection of disk artifacts. Returns `{proceed: true}` when no
 * discuss unit is active OR when the highest existing per-round Omega
 * manifest validates (`stageCount === 10`, `status === "complete"`,
 * `unitType === "discuss-question-round"`, `unitId` matches the active
 * discuss unit's milestone/slice). Otherwise returns a structured block
 * payload the caller turns into an `errorResult` and a
 * `question-round-bypass-blocked` journal event.
 *
 * The check triggers ONLY for discuss-* unitTypes — non-discuss callers
 * (clarification prompts in execution flows, etc.) see no behavioral
 * change.
 *
 * Round-counter resolution is on-disk discovery: enumerate `round-<N>/`
 * children of the discuss parent, take `max(N)`. If none exist the gate
 * fails with `expectedRoundIndex: 1`. This mirrors `T01-AUDIT.md` section
 * (d): on-disk evidence is identical between auto-mode and guided-flow,
 * survives session restarts, and is the same evidence
 * `validatePhaseOmegaArtifacts` operates on.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { emitJournalEvent } from "./journal.js";
import type { OmegaPhaseManifest } from "./omega-phase-artifacts.js";
import { gsdRoot } from "./paths.js";
import { listUnitRuntimeRecords, type AutoUnitRuntimeRecord } from "./unit-runtime.js";

export type DiscussRoundGateOutcome =
  | { proceed: true }
  | DiscussRoundGateBlock;

export interface DiscussRoundGateBlock {
  proceed: false;
  unitType: "discuss-milestone" | "discuss-slice";
  milestoneId: string;
  sliceId: string | null;
  expectedRoundIndex: number;
  expectedManifestPath: string;
  missingArtifacts: string[];
  remediation: string;
  errorMessage: string;
}

/**
 * Evaluate the discuss-round gate against disk state at `basePath`.
 * Pure read-only — never throws.
 */
export function evaluateDiscussRoundGate(basePath: string): DiscussRoundGateOutcome {
  const records = safeListRecords(basePath);
  const active = records.find(
    (r) => r.unitType === "discuss-milestone" || r.unitType === "discuss-slice",
  );
  if (!active) {
    return { proceed: true };
  }

  const unitType = active.unitType as "discuss-milestone" | "discuss-slice";
  const segments = active.unitId.split("/").filter(Boolean);
  const milestoneId = segments[0] ?? "";
  const sliceId = unitType === "discuss-slice" ? (segments[1] ?? null) : null;

  if (!milestoneId || (unitType === "discuss-slice" && !sliceId)) {
    return makeBlock({
      unitType,
      milestoneId: milestoneId || "<unknown>",
      sliceId,
      expectedRoundIndex: 1,
      expectedManifestPath: "<unresolved>",
      missingArtifacts: [],
      remediation: `Active discuss unit-runtime record has malformed unitId "${active.unitId}". Cannot resolve per-round Omega manifest path.`,
    });
  }

  const discussDir = sliceId
    ? join(gsdRoot(basePath), "milestones", milestoneId, "slices", sliceId, "discuss")
    : join(gsdRoot(basePath), "milestones", milestoneId, "discuss");

  const rounds = listRoundDirs(discussDir);

  if (rounds.length === 0) {
    const expectedManifestPath = join(discussDir, "round-1", "omega", "<runId>", "phase-manifest.json");
    return makeBlock({
      unitType,
      milestoneId,
      sliceId,
      expectedRoundIndex: 1,
      expectedManifestPath,
      missingArtifacts: [expectedManifestPath],
      remediation: buildRemediation(1, milestoneId, sliceId),
    });
  }

  const currentRound = rounds[rounds.length - 1];
  const omegaParent = join(discussDir, `round-${currentRound}`, "omega");
  const expectedUnitId = sliceId
    ? `${milestoneId}/${sliceId}/round-${currentRound}`
    : `${milestoneId}/round-${currentRound}`;

  const runDirs = listSubdirs(omegaParent);
  const missingArtifacts: string[] = [];

  for (const runId of runDirs) {
    const manifestPath = join(omegaParent, runId, "phase-manifest.json");
    if (!existsSync(manifestPath)) {
      missingArtifacts.push(manifestPath);
      continue;
    }
    const manifest = parseManifest(manifestPath);
    if (!manifest) {
      missingArtifacts.push(manifestPath);
      continue;
    }
    if (
      manifest.stageCount === 10 &&
      manifest.status === "complete" &&
      manifest.unitType === "discuss-question-round" &&
      manifest.unitId === expectedUnitId
    ) {
      return { proceed: true };
    }
    missingArtifacts.push(manifestPath);
  }

  const expectedManifestPath = join(omegaParent, "<runId>", "phase-manifest.json");
  return makeBlock({
    unitType,
    milestoneId,
    sliceId,
    expectedRoundIndex: currentRound,
    expectedManifestPath,
    missingArtifacts: missingArtifacts.length > 0 ? missingArtifacts : [expectedManifestPath],
    remediation: buildRemediation(currentRound, milestoneId, sliceId),
  });
}

/**
 * Emit a `question-round-bypass-blocked` journal event for the given
 * gate block. Caller passes a `flowId` so the event can be correlated
 * with the surrounding tool-call audit chain.
 */
export function emitDiscussRoundBypassBlocked(
  basePath: string,
  block: DiscussRoundGateBlock,
  flowId: string,
): void {
  emitJournalEvent(basePath, {
    ts: new Date().toISOString(),
    flowId,
    seq: 0,
    eventType: "question-round-bypass-blocked",
    data: {
      unitType: block.unitType,
      milestoneId: block.milestoneId,
      sliceId: block.sliceId,
      expectedRoundIndex: block.expectedRoundIndex,
      expectedManifestPath: block.expectedManifestPath,
      missingArtifacts: block.missingArtifacts,
      remediation: block.remediation,
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeListRecords(basePath: string): AutoUnitRuntimeRecord[] {
  try {
    return listUnitRuntimeRecords(basePath);
  } catch {
    return [];
  }
}

function buildRemediation(roundIndex: number, milestoneId: string, sliceId: string | null): string {
  const scope = sliceId ? `${milestoneId}/${sliceId}` : milestoneId;
  return (
    `Call \`gsd_question_round_spiral\` with current conversation state ` +
    `(milestoneId="${milestoneId}"${sliceId ? `, sliceId="${sliceId}"` : ""}, roundIndex=${roundIndex}) ` +
    `before requesting questions for round ${roundIndex} of ${scope}. ` +
    `The spiral writes the per-round Omega manifest the gate enumerates.`
  );
}

interface MakeBlockArgs {
  unitType: "discuss-milestone" | "discuss-slice";
  milestoneId: string;
  sliceId: string | null;
  expectedRoundIndex: number;
  expectedManifestPath: string;
  missingArtifacts: string[];
  remediation: string;
}

function makeBlock(args: MakeBlockArgs): DiscussRoundGateBlock {
  const scope = args.sliceId ? `${args.milestoneId}/${args.sliceId}` : args.milestoneId;
  const errorMessage =
    `ask_user_questions blocked: missing per-round Omega manifest for round ${args.expectedRoundIndex} of ${scope}. ` +
    `Expected manifest at ${args.expectedManifestPath}. ${args.remediation}`;
  return {
    proceed: false,
    unitType: args.unitType,
    milestoneId: args.milestoneId,
    sliceId: args.sliceId,
    expectedRoundIndex: args.expectedRoundIndex,
    expectedManifestPath: args.expectedManifestPath,
    missingArtifacts: args.missingArtifacts,
    remediation: args.remediation,
    errorMessage,
  };
}

function listRoundDirs(parent: string): number[] {
  if (!existsSync(parent)) return [];
  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return [];
  }
  const rounds: number[] = [];
  for (const entry of entries) {
    const m = /^round-(\d+)$/.exec(entry);
    if (!m) continue;
    const full = join(parent, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    rounds.push(Number.parseInt(m[1], 10));
  }
  return rounds.sort((a, b) => a - b);
}

function listSubdirs(parent: string): string[] {
  if (!existsSync(parent)) return [];
  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return [];
  }
  return entries.filter((name) => {
    try {
      return statSync(join(parent, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

function parseManifest(manifestPath: string): OmegaPhaseManifest | null {
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as OmegaPhaseManifest;
  } catch {
    return null;
  }
}
