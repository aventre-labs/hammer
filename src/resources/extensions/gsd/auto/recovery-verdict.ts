/**
 * recovery-verdict.ts — M002/S03/T02
 *
 * Pure parser that classifies the terminal `RECOVERY_VERDICT:` trailer line
 * emitted by the recovery subagent into one of four shapes. Mirrors the
 * strict + loose regex idiom from `iam-subagent-policy.ts:88-89` so the
 * recovery dispatcher can distinguish a structured verdict from a malformed
 * one without speculative parsing.
 *
 * Behavior summary:
 *   (a) strict match            → typed verdict with the captured field
 *   (b) loose match, no strict  → { kind: "malformed", raw: "<line>" }
 *   (c) no loose match          → { kind: "malformed" } (no raw)
 *   (d) multiple strict matches → return the LAST one (last-wins)
 *
 * Captured payloads are truncated to MAX_PAYLOAD_LEN defensively, and
 * `blocker-filed` paths must match `BLOCKER_PATH_RE` — invalid paths
 * reclassify the verdict as `{ kind: "malformed", raw }`.
 *
 * No external dependencies — this module is intentionally a pure leaf so
 * tests can run via raw `node --test` without a TS resolver hook.
 */

export type RecoveryVerdict =
  | { kind: "fix-applied"; summary: string }
  | { kind: "blocker-filed"; blockerPath: string }
  | { kind: "give-up"; reason: string }
  | { kind: "malformed"; raw?: string };

/** Maximum length of a captured payload (summary / blockerPath / reason). */
const MAX_PAYLOAD_LEN = 400;

/**
 * Strict regex — matches a complete, well-formed RECOVERY_VERDICT trailer.
 *
 * Group 1: the verdict kind keyword (fix-applied | blocker-filed | give-up)
 * Group 2: the captured payload value (≤400 non-newline chars)
 *
 * The field-name token (summary | blockerPath | reason) is intentionally a
 * non-capturing group — we trust the kind keyword and assign the captured
 * value to the field that matches the kind.
 *
 * Anchors are zero-width so consecutive markers on adjacent lines both match
 * during global iteration:
 *   - Leading: alternation of string-start `^` and a lookbehind `(?<=\n)`,
 *     never consuming the preceding newline.
 *   - Trailing: lookahead `(?=\n|$)`, never consuming the trailing newline.
 *
 * The plan-prescribed form `(?:^|\n) ... (?:\n|$)` consumed the boundary
 * newlines, which broke the last-wins iteration: matchAll resumed past the
 * shared `\n` and the second marker no longer satisfied `(?:^|\n)`.
 *
 * `g` flag is required so we can iterate via String.prototype.matchAll for
 * the last-wins rule when the agent streamed multiple drafts before its
 * final.
 */
const STRICT_RE =
  /(?:^|(?<=\n))\s*RECOVERY_VERDICT\s*:\s*(fix-applied|blocker-filed|give-up)\s*;\s*(?:summary|blockerPath|reason)\s*=\s*([^\n]{1,400})\s*(?=\n|$)/g;

/** Loose regex — detects the marker token even when the surrounding form is malformed. */
const LOOSE_MARKER_RE = /RECOVERY_VERDICT\s*:/;

/**
 * `blocker-filed` path validator — paths must point at a markdown artifact
 * under `.gsd/milestones/<MID>/slices/<SID>/...md`. Anything else (relative
 * to repo root, mistyped, or pointing outside the slice tree) reclassifies
 * the verdict as malformed so downstream callers don't try to read a bogus
 * file path.
 */
const BLOCKER_PATH_RE = /^\.gsd\/milestones\/[A-Z0-9-]+\/slices\/[A-Z0-9-]+\/.+\.md$/;

/**
 * Extract the *line* containing the RECOVERY_VERDICT marker so the caller
 * can record the raw form for diagnostic grepping. Returns the trimmed line
 * truncated to MAX_PAYLOAD_LEN, or undefined if no marker line is present.
 */
function extractMarkerLine(stream: string): string | undefined {
  const lineRe = /[^\n]*RECOVERY_VERDICT\s*:[^\n]*/;
  const match = stream.match(lineRe);
  if (!match) return undefined;
  return truncate(match[0].trim());
}

function truncate(value: string): string {
  if (value.length <= MAX_PAYLOAD_LEN) return value;
  return value.slice(0, MAX_PAYLOAD_LEN);
}

/**
 * Classify a recovery subagent message stream into one of four verdict shapes.
 *
 * The parser is total — every input maps to exactly one RecoveryVerdict. It
 * never throws.
 */
export function parseRecoveryVerdict(messageStream: string): RecoveryVerdict {
  if (typeof messageStream !== "string" || messageStream.length === 0) {
    return { kind: "malformed" };
  }

  // Collect all strict matches and pick the last one — partial drafts before
  // the final verdict are a known emission pattern for streaming agents.
  const matches = [...messageStream.matchAll(STRICT_RE)];

  if (matches.length === 0) {
    // No structured verdict — fall through to loose detection so we can tell
    // "marker present but malformed" apart from "no marker at all".
    if (LOOSE_MARKER_RE.test(messageStream)) {
      const raw = extractMarkerLine(messageStream);
      return raw !== undefined ? { kind: "malformed", raw } : { kind: "malformed" };
    }
    return { kind: "malformed" };
  }

  const last = matches[matches.length - 1];
  const kind = last[1] as "fix-applied" | "blocker-filed" | "give-up";
  const payload = truncate(last[2].trim());

  switch (kind) {
    case "fix-applied":
      return { kind: "fix-applied", summary: payload };
    case "blocker-filed": {
      if (!BLOCKER_PATH_RE.test(payload)) {
        // Reclassify invalid paths as malformed — record the raw line so a
        // 3am operator grepping the lock can see what the agent actually said.
        const raw = extractMarkerLine(messageStream);
        return raw !== undefined ? { kind: "malformed", raw } : { kind: "malformed" };
      }
      return { kind: "blocker-filed", blockerPath: payload };
    }
    case "give-up":
      return { kind: "give-up", reason: payload };
  }
}
