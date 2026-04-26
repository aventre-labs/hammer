/**
 * src/iam/savesuccess.ts
 *
 * SAVESUCCESS validator — evaluates a ten-pillar scorecard against the IAM
 * white paper's positional key encoding.
 *
 * Pure logic module: imports only from src/iam/types.ts. Zero I/O, zero LLM calls.
 *
 * Positional key encoding:
 *   s  = Serendipity
 *   a  = Artiquity
 *   v  = Vitality
 *   e  = Enginuity
 *   s2 = Synchronicity
 *   u  = Ubiquity
 *   c  = Clarity
 *   c2 = Certainty
 *   e2 = Ethics
 *   s3 = Sagacity
 *   →  Success is emergent (no direct key)
 */

import type {
  SavesuccessPillar,
  SavesuccessScorecard,
  SavesuccessResult,
  IAMResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Pillar ordering and naming
// ---------------------------------------------------------------------------

/** Ordered array of all 10 SAVESUCCESS pillar keys (positional encoding). */
export const SAVESUCCESS_PILLARS: SavesuccessPillar[] = [
  "s",
  "a",
  "v",
  "e",
  "s2",
  "u",
  "c",
  "c2",
  "e2",
  "s3",
];

/** Maps each positional key to its human-readable pillar name. */
export const SAVESUCCESS_PILLAR_NAMES: Record<SavesuccessPillar, string> = {
  s: "Serendipity",
  a: "Artiquity",
  v: "Vitality",
  e: "Enginuity",
  s2: "Synchronicity",
  u: "Ubiquity",
  c: "Clarity",
  c2: "Certainty",
  e2: "Ethics",
  s3: "Sagacity",
};

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

/**
 * Evaluates a SAVESUCCESS scorecard.
 *
 * A blind spot is any pillar scored below 0.5.
 * Success is emergent: it arises only when no blind spots are present.
 */
export function validateSavesuccess(
  scorecard: SavesuccessScorecard
): SavesuccessResult {
  const blindSpots = SAVESUCCESS_PILLARS.filter(
    (pillar) => scorecard[pillar] < 0.5
  );
  return {
    scorecard,
    blindSpots,
    success: blindSpots.length === 0,
    validatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Parses a YAML object using the SAVESUCCESS positional key format.
 *
 * Accepts keys `s`, `a`, `v`, `e`, `s2`, `u`, `c`, `c2`, `e2`, `s3`.
 * All values must be numbers in the closed interval [0, 1].
 *
 * Returns `ok:false` with `iamErrorKind: "savesuccess-blind-spot"` if
 * any key is missing, non-numeric, or outside [0, 1].
 */
export function parseSavesuccessFrontmatter(
  yamlObj: Record<string, unknown>
): IAMResult<SavesuccessScorecard> {
  const scorecard: Partial<SavesuccessScorecard> = {};
  const errors: string[] = [];

  for (const pillar of SAVESUCCESS_PILLARS) {
    const raw = yamlObj[pillar];
    if (raw === undefined || raw === null) {
      errors.push(`Missing pillar "${pillar}" (${SAVESUCCESS_PILLAR_NAMES[pillar]})`);
      continue;
    }
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      errors.push(
        `Pillar "${pillar}" (${SAVESUCCESS_PILLAR_NAMES[pillar]}) is not a number: ${String(raw)}`
      );
      continue;
    }
    if (value < 0 || value > 1) {
      errors.push(
        `Pillar "${pillar}" (${SAVESUCCESS_PILLAR_NAMES[pillar]}) is out of range [0,1]: ${value}`
      );
      continue;
    }
    scorecard[pillar] = value;
  }

  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        iamErrorKind: "savesuccess-blind-spot",
        remediation: `SAVESUCCESS scorecard parsing failed. Issues found:\n${errors.map((e) => `  • ${e}`).join("\n")}\n\nEnsure all 10 positional keys (s, a, v, e, s2, u, c, c2, e2, s3) are present and set to numbers between 0 and 1.`,
      },
    };
  }

  return { ok: true, value: scorecard as SavesuccessScorecard };
}

// ---------------------------------------------------------------------------
// Report formatter
// ---------------------------------------------------------------------------

/**
 * Formats a SAVESUCCESS result as a human-readable multiline string.
 *
 * Each pillar line shows its key, human name, score bar, and numeric score.
 * Blind spots are marked with "⚠".
 * Final line declares overall success or failure.
 */
export function formatSavesuccessReport(result: SavesuccessResult): string {
  const lines: string[] = [
    "── SAVESUCCESS Report ─────────────────────────────────",
    `   Validated: ${result.validatedAt}`,
    "",
  ];

  for (const pillar of SAVESUCCESS_PILLARS) {
    const score = result.scorecard[pillar];
    const name = SAVESUCCESS_PILLAR_NAMES[pillar];
    const isBlind = result.blindSpots.includes(pillar);
    const bar = buildScoreBar(score, 20);
    const flag = isBlind ? " ⚠" : "  ";
    const pct = `${Math.round(score * 100)}%`.padStart(4);
    lines.push(`   ${pillar.padEnd(3)}  ${name.padEnd(16)} [${bar}] ${pct}${flag}`);
  }

  lines.push("");
  if (result.success) {
    lines.push("   ✅ SUCCESS — No blind spots detected. All pillars ≥ 0.5.");
  } else {
    const bsNames = result.blindSpots
      .map((p) => `${p} (${SAVESUCCESS_PILLAR_NAMES[p]})`)
      .join(", ");
    lines.push(`   ❌ FAILURE — ${result.blindSpots.length} blind spot(s): ${bsNames}`);
    lines.push("      Remediation required before success can emerge.");
  }
  lines.push("────────────────────────────────────────────────────────");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildScoreBar(score: number, width: number): string {
  const filled = Math.round(score * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
