/**
 * `liftLegacyLayoutsToHammer` — core lift primitive for the `/migrate` rework.
 *
 * Detects `.planning/` (GSD-1) and `.gsd/` (GSD-2) independently and lifts each
 * to `.hammer/` atomically per source. After a successful lift, the source
 * layout is renamed to `.{layout}.migrated-{timestamp}/` (non-destructive — the
 * user can roll back manually if needed).
 *
 * Both-present resolution (D014):
 *   When both `.planning/` and `.gsd/` are present, `.gsd/` is treated as the
 *   current source of truth and is lifted to `.hammer/` via a recursive
 *   directory copy. `.planning/` is renamed to `.planning.migrated-<ts>/`
 *   *without* re-parsing — it is assumed to be a stale prior-migration source
 *   and re-running the GSD-1 → GSD-2 transform would overwrite freshly-edited
 *   GSD-2 state. Rationale: D014 (`/migrate` source-handling posture).
 *
 * Idempotency:
 *   If `.hammer/` already exists and is non-empty AND no un-renamed legacy
 *   sources remain on disk, returns `{ status: 'already-migrated', layouts }`
 *   without modifying anything.
 *
 * Partial-failure resume:
 *   If `.hammer/` exists and is non-empty but a source layout has not yet been
 *   renamed (the lift was interrupted between copy/write and rename), the
 *   pending rename is finished and the result reports `status: 'resumed'`.
 *
 * Observability:
 *   Caller may pass a `notify` callback. Each stage emits a structured line
 *   tagged `[lift:<stage>]` (`detect`, `copy`, `rename-source`,
 *   `skip-already-migrated`, `resume-detected`). Failures throw a `LiftError`
 *   carrying `.stage`, `.layout`, and `.pathOnDisk` so upstream display can
 *   reconstruct enough state for manual recovery.
 */

import {
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { cp, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { _clearGsdRootCache } from '../paths.js';
import { parsePlanningDirectory } from './parser.js';
import { transformToGSD } from './transformer.js';
import { writeGSDDirectory } from './writer.js';

// ─── Types ─────────────────────────────────────────────────────────────────

/** Which legacy layout a stage operated on. */
export type LiftLayout = 'planning' | 'gsd';

/** Stage names emitted via the `notify` callback and on `LiftError.stage`. */
export type LiftStage =
  | 'detect'
  | 'copy'
  | 'rename-source'
  | 'skip-already-migrated'
  | 'resume-detected';

/** Outcome of a single legacy-layout lift pass. */
export interface LiftResult {
  /**
   * - `lifted`            — at least one layout was copied/written and renamed.
   * - `resumed`           — `.hammer/` was already populated, but a pending
   *                         source rename was finished this call.
   * - `already-migrated`  — `.hammer/` is already populated and no un-renamed
   *                         legacy sources remain. No-op.
   * - `no-legacy`         — no legacy source layouts detected. No-op.
   */
  status: 'lifted' | 'resumed' | 'already-migrated' | 'no-legacy';
  /** Layouts touched in this call (lifted, resumed, or detected as already-migrated). */
  layouts: LiftLayout[];
  /** Absolute path of the `.hammer/` directory on disk. */
  hammerPath: string;
  /** Source directories that were renamed this call. */
  renamed: { layout: LiftLayout; from: string; to: string }[];
}

/** Detection snapshot used by `detectLegacyLayouts`. */
export interface LegacyLayoutDetection {
  /** True if a current (un-renamed) `.planning/` directory exists. */
  hasPlanning: boolean;
  /** True if a current (un-renamed) `.gsd/` directory exists. */
  hasGsd: boolean;
  /** True if `.hammer/` exists at the base path. */
  hasHammer: boolean;
  /** Directory names matching `.planning.migrated-*` (timestamped renames). */
  planningRenamed: string[];
  /** Directory names matching `.gsd.migrated-*` (timestamped renames). */
  gsdRenamed: string[];
}

/** Optional caller-supplied levers — primarily for tests and UI integration. */
export interface LiftOptions {
  /** Receives stage-tagged status lines. Caller wires this to `ctx.ui.notify`. */
  notify?: (message: string, level?: 'info' | 'warning' | 'error') => void;
  /** Returns the timestamp suffix used in `.{layout}.migrated-<ts>/`. Default: `Date.now()`. */
  timestamp?: () => string;
}

/**
 * Error thrown when a lift stage fails. The `.stage`/`.layout`/`.pathOnDisk`
 * properties allow the caller to display enough context for the user to resume
 * manually.
 */
export class LiftError extends Error {
  readonly stage: LiftStage;
  readonly layout?: LiftLayout;
  readonly pathOnDisk?: string;
  constructor(
    message: string,
    init: {
      stage: LiftStage;
      layout?: LiftLayout;
      pathOnDisk?: string;
      cause?: unknown;
    },
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'LiftError';
    this.stage = init.stage;
    this.layout = init.layout;
    this.pathOnDisk = init.pathOnDisk;
  }
}

// ─── Detection ─────────────────────────────────────────────────────────────

/**
 * Snapshot which legacy layouts (current and previously-renamed) exist at
 * `basePath`. Pure: does not mutate the filesystem.
 */
export function detectLegacyLayouts(basePath: string): LegacyLayoutDetection {
  return {
    hasPlanning: dirExists(join(basePath, '.planning')),
    hasGsd: dirExists(join(basePath, '.gsd')),
    hasHammer: dirExists(join(basePath, '.hammer')),
    planningRenamed: listMigrationRenames(basePath, '.planning'),
    gsdRenamed: listMigrationRenames(basePath, '.gsd'),
  };
}

// ─── Core ──────────────────────────────────────────────────────────────────

/**
 * Lift any detected legacy layouts at `basePath` into `.hammer/`. See module
 * docstring for both-present resolution, idempotency, and partial-failure
 * resume semantics.
 */
export async function liftLegacyLayoutsToHammer(
  basePath: string,
  opts: LiftOptions = {},
): Promise<LiftResult> {
  const notify = opts.notify ?? noopNotify;
  const stamp = opts.timestamp ?? defaultTimestamp;

  // Stage: detect ───────────────────────────────────────────────────────────
  let detection: LegacyLayoutDetection;
  try {
    detection = detectLegacyLayouts(basePath);
  } catch (err) {
    throw new LiftError('Failed to detect legacy layouts', {
      stage: 'detect',
      pathOnDisk: basePath,
      cause: err,
    });
  }
  notify(
    `[lift:detect] hasPlanning=${detection.hasPlanning} hasGsd=${detection.hasGsd} hasHammer=${detection.hasHammer}`,
    'info',
  );

  const hammerPath = join(basePath, '.hammer');
  const hammerPopulated = detection.hasHammer && !isDirEmpty(hammerPath);

  // Idempotency / partial-failure resume gate. If `.hammer/` is already
  // populated, decide whether this is a clean already-migrated state or a
  // mid-flight crash that needs its source rename finished.
  if (hammerPopulated) {
    const pending: LiftLayout[] = [];
    if (detection.hasPlanning) pending.push('planning');
    if (detection.hasGsd) pending.push('gsd');

    if (pending.length === 0) {
      const layouts = layoutsFromRenamed(detection);
      notify(
        `[lift:skip-already-migrated] .hammer/ already populated; no un-renamed legacy sources`,
        'info',
      );
      return {
        status: 'already-migrated',
        layouts,
        hammerPath,
        renamed: [],
      };
    }

    notify(
      `[lift:resume-detected] .hammer/ populated but ${pending.join(' + ')} not yet renamed; finishing rename`,
      'warning',
    );
    const renamed: LiftResult['renamed'] = [];
    for (const layout of pending) {
      renamed.push(await renameSource(basePath, layout, stamp(), notify));
    }
    return {
      status: 'resumed',
      layouts: pending,
      hammerPath,
      renamed,
    };
  }

  // No legacy sources — nothing to do.
  if (!detection.hasPlanning && !detection.hasGsd) {
    return {
      status: 'no-legacy',
      layouts: [],
      hammerPath,
      renamed: [],
    };
  }

  // Stage: copy ─────────────────────────────────────────────────────────────
  // Both-present case (D014): `.gsd/` wins. `.planning/` is renamed without
  // being re-parsed — re-running the GSD-1 → GSD-2 transform on a stale
  // prior-migration source would overwrite freshly-edited GSD-2 state.
  const liftedLayouts: LiftLayout[] = [];
  const renamed: LiftResult['renamed'] = [];

  // Cache the resolved gsdRoot lazily — `writeGSDDirectory` calls `gsdRoot()`
  // which is process-global. Clearing avoids returning a stale `.gsd/` path
  // captured before this call (e.g. from a parent walk-up scan).
  _clearGsdRootCache();

  if (detection.hasGsd) {
    notify(`[lift:copy] .gsd/ → .hammer/ (recursive copy)`, 'info');
    try {
      await cp(join(basePath, '.gsd'), hammerPath, {
        recursive: true,
        errorOnExist: false,
        force: true,
      });
    } catch (err) {
      throw new LiftError('Failed to copy .gsd/ → .hammer/', {
        stage: 'copy',
        layout: 'gsd',
        pathOnDisk: hammerPath,
        cause: err,
      });
    }
    liftedLayouts.push('gsd');
  } else if (detection.hasPlanning) {
    // .planning-only: parse → transform → writeGSDDirectory (which targets
    // `.hammer/` via gsdRoot()'s creation-fallback when `.hammer` and `.gsd`
    // are both absent).
    notify(`[lift:copy] .planning/ → .hammer/ (parse + transform + write)`, 'info');
    try {
      const planningPath = join(basePath, '.planning');
      const parsed = await parsePlanningDirectory(planningPath);
      const project = transformToGSD(parsed);
      await writeGSDDirectory(project, basePath);
    } catch (err) {
      throw new LiftError('Failed to lift .planning/ → .hammer/', {
        stage: 'copy',
        layout: 'planning',
        pathOnDisk: hammerPath,
        cause: err,
      });
    }
    liftedLayouts.push('planning');
  }

  // Stage: rename-source ───────────────────────────────────────────────────
  // Always rename every detected legacy source — including `.planning/` in the
  // both-present case (it gets renamed without being re-parsed per D014).
  if (detection.hasGsd) {
    renamed.push(await renameSource(basePath, 'gsd', stamp(), notify));
  }
  if (detection.hasPlanning) {
    if (!liftedLayouts.includes('planning')) {
      // Both-present case: record .planning as a "lifted" layout for caller
      // bookkeeping even though its content was superseded by `.gsd/`.
      liftedLayouts.push('planning');
    }
    renamed.push(await renameSource(basePath, 'planning', stamp(), notify));
  }

  // Invalidate the gsdRoot cache so subsequent callers see `.hammer/`.
  _clearGsdRootCache();

  return {
    status: 'lifted',
    layouts: liftedLayouts,
    hammerPath,
    renamed,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function noopNotify(_msg: string, _level?: 'info' | 'warning' | 'error'): void {
  /* no-op */
}

function defaultTimestamp(): string {
  return String(Date.now());
}

function dirExists(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isDirEmpty(p: string): boolean {
  try {
    return readdirSync(p).length === 0;
  } catch {
    // Treat unreadable as non-empty defensively — we'd rather skip than clobber.
    return false;
  }
}

function listMigrationRenames(basePath: string, layout: '.planning' | '.gsd'): string[] {
  const prefix = `${layout}.migrated-`;
  let entries: string[];
  try {
    entries = readdirSync(basePath);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(prefix))
    .filter((name) => dirExists(join(basePath, name)))
    .sort();
}

function layoutsFromRenamed(detection: LegacyLayoutDetection): LiftLayout[] {
  const out: LiftLayout[] = [];
  if (detection.planningRenamed.length > 0) out.push('planning');
  if (detection.gsdRenamed.length > 0) out.push('gsd');
  return out;
}

async function renameSource(
  basePath: string,
  layout: LiftLayout,
  ts: string,
  notify: NonNullable<LiftOptions['notify']>,
): Promise<{ layout: LiftLayout; from: string; to: string }> {
  const sourceName = layout === 'planning' ? '.planning' : '.gsd';
  const from = join(basePath, sourceName);
  const to = join(basePath, `${sourceName}.migrated-${ts}`);
  notify(`[lift:rename-source] ${sourceName} → ${sourceName}.migrated-${ts}`, 'info');
  try {
    await rename(from, to);
  } catch (err) {
    throw new LiftError(`Failed to rename ${sourceName} → ${sourceName}.migrated-${ts}`, {
      stage: 'rename-source',
      layout,
      pathOnDisk: from,
      cause: err,
    });
  }
  return { layout, from, to };
}
