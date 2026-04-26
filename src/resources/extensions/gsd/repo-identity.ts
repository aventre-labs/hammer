/**
 * GSD Repo Identity — external state directory primitives.
 *
 * Computes a stable per-repo identity hash, resolves the external
 * `~/.gsd/projects/<hash>/` state directory, and manages the
 * `<project>/.gsd → external` symlink.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  HAMMER_STATE_DIR_NAME,
  HAMMER_GLOBAL_HOME_DIR_NAME,
  HAMMER_HOME_ENV,
  HAMMER_STATE_DIR_ENV,
  HAMMER_PROJECT_ID_ENV,
  HAMMER_PROJECT_MARKER_FILE,
  HAMMER_LEGACY_ENV_ALIASES,
} from "../../../hammer-identity/index.js";

// ─── State Root Resolution ───────────────────────────────────────────────────

/**
 * Resolve the canonical Hammer home directory.
 *
 * Priority: HAMMER_HOME > GSD_HOME (legacy import bridge) > ~/.hammer
 * When GSD_HOME is used, a diagnostic is emitted and HAMMER_HOME is back-filled
 * so downstream code only reads the canonical env var.
 *
 * — bootstrap-migration
 */
function resolveHammerHome(): string {
  const canonical = process.env[HAMMER_HOME_ENV];
  if (canonical) return canonical;

  const legacyHome = process.env[HAMMER_LEGACY_ENV_ALIASES.home]; // GSD_HOME — legacy import bridge
  if (legacyHome) {
    process.env[HAMMER_HOME_ENV] = legacyHome; // back-fill canonical — bootstrap-migration
    process.stderr.write(
      `[hammer] Using legacy ${HAMMER_LEGACY_ENV_ALIASES.home} for home directory; ` +
      `set ${HAMMER_HOME_ENV} to suppress this diagnostic — bootstrap-migration compatibility rule applied.\n`
    );
    return legacyHome;
  }

  const defaultHome = join(homedir(), HAMMER_GLOBAL_HOME_DIR_NAME);
  process.env[HAMMER_HOME_ENV] = defaultHome;
  process.env[HAMMER_LEGACY_ENV_ALIASES.home] ??= defaultHome; // legacy alias for compatibility — bootstrap-migration
  return defaultHome;
}

const hammerHome = resolveHammerHome();

// ─── Repo Metadata ───────────────────────────────────────────────────────────

export interface RepoMeta {
  version: number;
  hash: string;
  gitRoot: string;
  remoteUrl: string;
  createdAt: string;
}

function isRepoMeta(value: unknown): value is RepoMeta {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.version === "number"
    && typeof v.hash === "string"
    && typeof v.gitRoot === "string"
    && typeof v.remoteUrl === "string"
    && typeof v.createdAt === "string";
}

/**
 * Write (or refresh) repo metadata into the external state directory.
 * Called on open so metadata tracks repo path moves while keeping createdAt stable.
 * Non-fatal: a metadata write failure must never block project setup.
 */
function writeRepoMeta(externalPath: string, remoteUrl: string, gitRoot: string): void {
  const metaPath = join(externalPath, "repo-meta.json");
  try {
    let createdAt = new Date().toISOString();
    let existing: RepoMeta | null = null;
    if (existsSync(metaPath)) {
      try {
        const parsed = JSON.parse(readFileSync(metaPath, "utf-8"));
        if (isRepoMeta(parsed)) {
          existing = parsed;
          createdAt = parsed.createdAt;
          // Fast path: nothing changed.
          if (
            parsed.version === 1
            && parsed.hash === basename(externalPath)
            && parsed.gitRoot === gitRoot
            && parsed.remoteUrl === remoteUrl
          ) {
            return;
          }
        }
      } catch {
        // Fall through and rewrite invalid metadata.
      }
    }

    const meta: RepoMeta = {
      version: 1,
      hash: basename(externalPath),
      gitRoot,
      remoteUrl,
      createdAt,
    };
    // Keep file format stable even when refreshing.
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
  } catch {
    // Non-fatal — metadata write failure should not block project setup
  }
}

/**
 * Read repo metadata from the external state directory.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function readRepoMeta(externalPath: string): RepoMeta | null {
  const metaPath = join(externalPath, "repo-meta.json");
  try {
    if (!existsSync(metaPath)) return null;
    const raw = readFileSync(metaPath, "utf-8");
    const parsed = JSON.parse(raw);
    return isRepoMeta(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Inherited-Repo Detection ───────────────────────────────────────────────

/**
 * Check whether `basePath` is inheriting a parent directory's git repo
 * rather than being the git root itself.
 *
 * Returns true when ALL of:
 *   1. basePath is inside a git repo (git rev-parse succeeds)
 *   2. The resolved git root is a proper ancestor of basePath
 *   3. There is no *project* state directory (`.hammer` canonical, or `.gsd` legacy import bridge)
 *      at the git root or any intermediate ancestor
 *
 * When true, the caller should run `git init` at basePath so that
 * `repoIdentity()` produces a hash unique to this directory, preventing
 * cross-project state leaks (#1639).
 *
 * When the git root already has a project state dir, the directory is a
 * legitimate subdirectory of an existing Hammer project — `cd src/ && /hammer`
 * should still load the parent project's milestones.
 */
export function isInheritedRepo(basePath: string): boolean {
  try {
    const root = resolveGitRoot(basePath);
    const normalizedBase = canonicalizeExistingPath(basePath);
    const normalizedRoot = canonicalizeExistingPath(root);
    if (normalizedBase === normalizedRoot) return false; // basePath IS the root

    // The git root is a proper ancestor. Check whether it already has a state dir.
    // Probe .hammer first (canonical), then .gsd (legacy import bridge — state-namespace-bridge).
    if (isProjectGsd(join(root, HAMMER_STATE_DIR_NAME)) || isProjectGsd(join(root, ".gsd"))) return false; // legacy import bridge — state-namespace-bridge

    // Walk up from basePath's parent to the git root checking for state dirs.
    let dir = dirname(normalizedBase);
    while (dir !== normalizedRoot && dir !== dirname(dir)) {
      if (isProjectGsd(join(dir, HAMMER_STATE_DIR_NAME)) || isProjectGsd(join(dir, ".gsd"))) return false; // legacy import bridge — state-namespace-bridge
      dir = dirname(dir);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Distinguish a *project* state directory (`.hammer` or legacy `.gsd`) from
 * the global Hammer home directory.
 *
 * A project state directory is either:
 *   - A symlink to an external state directory (normal post-migration layout)
 *   - A legacy real directory that is NOT the global Hammer/GSD home
 *
 * When the user's home directory is itself a git repo (e.g. dotfile managers),
 * `~/.hammer` or `~/.gsd` exists but is the global state directory — not a
 * project state dir. Treating it as a project dir would cause isInheritedRepo()
 * to wrongly conclude that subdirectories are part of the home "project" (#2393).
 *
 * Probes .hammer first (canonical), then .gsd (legacy import bridge — state-namespace-bridge).
 */
function isProjectGsd(gsdPath: string): boolean {
  if (!existsSync(gsdPath)) return false;

  try {
    const stat = lstatSync(gsdPath);

    // Symlinks are always project state dirs (created by ensureGsdSymlink or ensureHammerSymlink).
    if (stat.isSymbolicLink()) return true;

    // For real directories, check that this isn't the global home.
    if (stat.isDirectory()) {
      const currentHammerHome = process.env[HAMMER_HOME_ENV] || join(homedir(), HAMMER_GLOBAL_HOME_DIR_NAME);
      const currentGsdHome = process.env[HAMMER_LEGACY_ENV_ALIASES.home] || join(homedir(), ".gsd"); // legacy import bridge — state-namespace-bridge
      const normalizedPath = canonicalizeExistingPath(gsdPath);
      const normalizedHammerHome = canonicalizeExistingPath(currentHammerHome);
      const normalizedGsdHome = canonicalizeExistingPath(currentGsdHome);
      if (normalizedPath === normalizedHammerHome || normalizedPath === normalizedGsdHome) return false;
      return true;
    }
  } catch {
    // lstat failed — treat as no state dir present
  }

  return false;
}

// ─── Repo Identity ──────────────────────────────────────────────────────────

/**
 * Get the git remote URL for "origin", or "" if no remote is configured.
 * Uses `git config` rather than `git remote get-url` for broader compat.
 */
function getRemoteUrl(basePath: string): string {
  try {
    return execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: basePath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Resolve the git toplevel (real root) for the given path.
 * For worktrees this returns the main repo root, not the worktree path.
 */
function canonicalizeExistingPath(path: string): string {
  try {
    // Use native realpath on Windows to resolve 8.3 short paths (e.g. RUNNER~1)
    return process.platform === "win32" ? realpathSync.native(path) : realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function resolveGitCommonDir(basePath: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: basePath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    const raw = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: basePath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
    return resolve(basePath, raw);
  }
}

function resolveGitRoot(basePath: string): string {
  try {
    const commonDir = resolveGitCommonDir(basePath);
    const normalizedCommonDir = commonDir.replaceAll("\\", "/");

    // Normal repo or worktree with shared common dir pointing at <repo>/.git.
    if (normalizedCommonDir.endsWith("/.git")) {
      return canonicalizeExistingPath(resolve(commonDir, ".."));
    }

    // Some git setups may still expose <repo>/.git/worktrees/<name>.
    const worktreeMarker = "/.git/worktrees/";
    if (normalizedCommonDir.includes(worktreeMarker)) {
      return canonicalizeExistingPath(resolve(commonDir, "..", ".."));
    }

    // Fallback for unusual layouts.
    return canonicalizeExistingPath(execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: basePath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim());
  } catch {
    return resolve(basePath);
  }
}

/**
 * Validate a HAMMER_PROJECT_ID (or legacy GSD_PROJECT_ID) value.
 *
 * Must contain only alphanumeric characters, hyphens, and underscores.
 * Call this once at startup so the user gets immediate feedback on bad values.
 */
export function validateProjectId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Compute a stable identity for a repository.
 *
 * Priority: HAMMER_PROJECT_ID > GSD_PROJECT_ID (legacy import bridge) > hash.
 * When GSD_PROJECT_ID is used, HAMMER_PROJECT_ID is back-filled for downstream
 * code that only reads the canonical env var.
 *
 * — bootstrap-migration
 */
export function repoIdentity(basePath: string): string {
  const projectId = process.env[HAMMER_PROJECT_ID_ENV]; // HAMMER_PROJECT_ID
  if (projectId) {
    return projectId;
  }
  const legacyProjectId = process.env[HAMMER_LEGACY_ENV_ALIASES.projectId]; // GSD_PROJECT_ID — legacy import bridge
  if (legacyProjectId) {
    process.env[HAMMER_PROJECT_ID_ENV] = legacyProjectId; // back-fill canonical — bootstrap-migration
    return legacyProjectId;
  }
  const remoteUrl = getRemoteUrl(basePath);
  if (remoteUrl) {
    // Remote URL alone uniquely identifies the repo — path is redundant.
    // This makes moves transparent for repos with remotes (#2750).
    return createHash("sha256").update(remoteUrl).digest("hex").slice(0, 12);
  }
  // Local-only repo: include git root since there's no remote to anchor identity.
  const root = resolveGitRoot(basePath);
  const input = `\n${root}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

// ─── External State Directory ───────────────────────────────────────────────

/**
 * Resolve the external Hammer state directory base.
 *
 * Priority: HAMMER_STATE_DIR > GSD_STATE_DIR (legacy import bridge) > hammerHome.
 * — state-namespace-bridge
 */
function resolveExternalBase(): string {
  const canonical = process.env[HAMMER_STATE_DIR_ENV];
  if (canonical) return canonical;
  const legacy = process.env[HAMMER_LEGACY_ENV_ALIASES.stateDir]; // GSD_STATE_DIR — legacy import bridge
  if (legacy) return legacy;
  return hammerHome;
}

/**
 * Compute the external Hammer state directory for a repository.
 *
 * Returns `$HAMMER_STATE_DIR/projects/<hash>` if `HAMMER_STATE_DIR` is set,
 * otherwise `$GSD_STATE_DIR/projects/<hash>` (legacy import bridge — state-namespace-bridge),
 * otherwise `~/.hammer/projects/<hash>`.
 */
export function externalGsdRoot(basePath: string): string {
  const base = resolveExternalBase();
  return join(base, "projects", repoIdentity(basePath));
}

/**
 * Resolve the root directory that stores project-scoped external state.
 * Honors HAMMER_STATE_DIR > GSD_STATE_DIR (legacy import bridge) > HAMMER_HOME.
 */
export function externalProjectsRoot(): string {
  return join(resolveExternalBase(), "projects");
}

// ─── Numbered Variant Cleanup ────────────────────────────────────────────────

/**
 * macOS collision pattern: `.gsd 2`, `.gsd 3`, `.gsd 4`, etc.
 *
 * When `symlinkSync` (or Finder) tries to create `.gsd` but a real directory
 * already exists at that path, macOS APFS silently renames the new entry to
 * `.gsd 2`, then `.gsd 3`, and so on. These numbered variants confuse GSD
 * because the canonical `.gsd` path no longer resolves to the external state
 * directory, making tracked planning files appear deleted.
 *
 * This helper scans the project root for entries matching `.gsd <digits>` and
 * removes them. It is called early in `ensureGsdSymlink()` so that the
 * canonical `.gsd` path is always the one in use — state-namespace-bridge
 *
 * @legacy-compat — cleans up legacy .gsd numbered variants — state-namespace-bridge
 */
const GSD_NUMBERED_VARIANT_RE = /^\.gsd \d+$/;
/** Cleans up .hammer numbered variants (macOS APFS collision pattern). */
const HAMMER_NUMBERED_VARIANT_RE = /^\.hammer \d+$/;

export function cleanNumberedGsdVariants(projectPath: string): string[] {
  const removed: string[] = [];
  try {
    const entries = readdirSync(projectPath);
    for (const entry of entries) {
      if (GSD_NUMBERED_VARIANT_RE.test(entry) || HAMMER_NUMBERED_VARIANT_RE.test(entry)) {
        const fullPath = join(projectPath, entry);
        try {
          rmSync(fullPath, { recursive: true, force: true });
          removed.push(entry);
        } catch {
          // Best-effort: if removal fails (e.g. permissions), continue with next
        }
      }
    }
  } catch {
    // Non-fatal: readdir failure should not block symlink creation
  }
  return removed;
}

// ─── .hammer-id Marker (canonical) and .gsd-id Marker (legacy import bridge) ──

/**
 * Write the canonical `.hammer-id` marker file in the project root.
 *
 * This file records the identity hash used for the external state directory.
 * For local-only repos (no remote), this marker survives directory moves and
 * enables automatic recovery of orphaned state (#2750).
 *
 * Also writes the legacy `.gsd-id` marker for backward compatibility
 * with tools that still read the old filename (legacy import bridge — state-namespace-bridge).
 * Non-fatal: failure to write the marker must never block project setup.
 */
function writeGsdIdMarker(projectPath: string, identity: string): void {
  // Write canonical .hammer-id marker
  _writeMarkerFile(join(projectPath, HAMMER_PROJECT_MARKER_FILE), identity);
  // Write legacy .gsd-id for backwards compatibility — legacy import bridge — state-namespace-bridge
  _writeMarkerFile(join(projectPath, ".gsd-id"), identity); // legacy import bridge — state-namespace-bridge
}

function _writeMarkerFile(markerPath: string, identity: string): void {
  try {
    if (existsSync(markerPath)) {
      try {
        if (readFileSync(markerPath, "utf-8").trim() === identity) return;
      } catch { /* fall through and overwrite */ }
    }
    writeFileSync(markerPath, identity + "\n", "utf-8");
  } catch {
    // Non-fatal — marker write failure should not block project setup
  }
}

/**
 * Read the project marker to recover identity.
 *
 * Probe order: .hammer-id (canonical) → .gsd-id (legacy import bridge — state-namespace-bridge).
 * Returns the identity hash, or null if neither marker exists or is readable.
 */
function readGsdIdMarker(projectPath: string): string | null {
  // Try canonical .hammer-id first
  const canonical = _readMarkerFile(join(projectPath, HAMMER_PROJECT_MARKER_FILE));
  if (canonical) return canonical;
  // Fall back to legacy .gsd-id — legacy import bridge — state-namespace-bridge
  return _readMarkerFile(join(projectPath, ".gsd-id")); // legacy import bridge — state-namespace-bridge
}

function _readMarkerFile(markerPath: string): string | null {
  try {
    if (!existsSync(markerPath)) return null;
    const content = readFileSync(markerPath, "utf-8").trim();
    return /^[a-zA-Z0-9_-]+$/.test(content) ? content : null;
  } catch {
    return null;
  }
}

/**
 * Check whether an external state directory has meaningful content.
 * Returns true if the directory contains any files or subdirectories
 * beyond just repo-meta.json.
 */
function hasProjectState(externalPath: string): boolean {
  try {
    if (!existsSync(externalPath)) return false;
    const entries = readdirSync(externalPath);
    return entries.some(e => e !== "repo-meta.json");
  } catch {
    return false;
  }
}

/**
 * Resolve the external state directory, with recovery for relocated projects.
 *
 * For local-only repos where the computed identity produces an empty state dir,
 * checks the `.hammer-id` / `.gsd-id` (legacy import bridge) markers for the
 * original identity hash and recovers the old state directory if it still
 * exists and contains data (#2750).
 *
 * Returns the resolved external path (may differ from the computed identity).
 */
function resolveExternalPathWithRecovery(projectPath: string): string {
  const computedPath = externalGsdRoot(projectPath);
  const computedId = repoIdentity(projectPath);

  // Check if computed path already has state — fast path, no recovery needed.
  if (hasProjectState(computedPath)) {
    return computedPath;
  }

  // Check for .hammer-id / .gsd-id (legacy import bridge — state-namespace-bridge) marker.
  const markerId = readGsdIdMarker(projectPath);
  if (markerId && markerId !== computedId) {
    // The marker points to a different identity — the repo was likely moved.
    const base = resolveExternalBase();
    const markerPath = join(base, "projects", markerId);
    if (hasProjectState(markerPath)) {
      // Recover: use the old state directory and update the marker to the new identity.
      try {
        mkdirSync(computedPath, { recursive: true });
        const entries = readdirSync(markerPath);
        for (const entry of entries) {
          try {
            const src = join(markerPath, entry);
            const dst = join(computedPath, entry);
            try {
              renameSync(src, dst);
            } catch {
              cpSync(src, dst, { recursive: true, force: true });
            }
          } catch { /* continue with remaining entries */ }
        }
        // Clean up old directory after successful migration.
        try { rmSync(markerPath, { recursive: true, force: true }); } catch { /* non-fatal */ }
      } catch {
        // If migration fails, just point at the old directory.
        return markerPath;
      }
    }
  }

  return computedPath;
}

// ─── Symlink Management ─────────────────────────────────────────────────────

/**
 * Ensure the project state directory symlink points to the external state directory.
 *
 * For new projects: creates `<project>/.hammer → external` (canonical).
 * For legacy projects: if `.hammer` is absent and `.gsd` exists, keeps `.gsd` pointing
 *   to external state while emitting a migration diagnostic (legacy import bridge).
 *
 * Algorithm:
 * 1. Clean up any macOS numbered collision variants (`.gsd 2`, `.hammer 2`, etc.)
 * 2. Resolve external dir (with relocation recovery via `.hammer-id`/`.gsd-id` markers)
 * 3. mkdir -p the external dir
 * 4. Prefer `.hammer` as canonical symlink target; fall back to `.gsd` (legacy import bridge)
 * 5. Write `.hammer-id` and `.gsd-id` markers for future relocation recovery
 *
 * Returns the resolved external path.
 */
export function ensureGsdSymlink(projectPath: string): string {
  const result = ensureGsdSymlinkCore(projectPath);

  // Write canonical .hammer-id marker and legacy .gsd-id (state-namespace-bridge).
  if (!isInsideWorktree(projectPath)) {
    writeGsdIdMarker(projectPath, repoIdentity(projectPath));
  }

  return result;
}

function ensureGsdSymlinkCore(projectPath: string): string {
  const externalPath = resolveExternalPathWithRecovery(projectPath);
  const inWorktree = isInsideWorktree(projectPath);

  // Determine which local state path to use.
  // Canonical: .hammer (new projects, or where .hammer already exists)
  // Legacy bridge: .gsd (only when .hammer absent and .gsd already present)
  // — state-namespace-bridge
  const localHammer = join(projectPath, HAMMER_STATE_DIR_NAME); // .hammer
  const localGsd = join(projectPath, ".gsd"); // legacy import bridge — state-namespace-bridge

  // Guard: Never create a symlink at ~/.hammer or ~/.gsd — those are the user-level
  // homes, not project state dirs. This can happen if resolveProjectRoot() returned
  // ~ as the project root (#1676).
  const externalBase = resolveExternalBase();
  const localHammerNorm = localHammer.replaceAll("\\", "/");
  const externalBaseNorm = externalBase.replaceAll("\\", "/");
  if (localHammerNorm === externalBaseNorm) {
    return localHammer;
  }

  // Guard: subdirectory of a git repo that already has a state dir at the git root.
  if (!inWorktree) {
    try {
      const gitRoot = resolveGitRoot(projectPath);
      const normalizedProject = canonicalizeExistingPath(projectPath);
      const normalizedRoot = canonicalizeExistingPath(gitRoot);
      if (normalizedProject !== normalizedRoot) {
        // Check .hammer first, then .gsd (legacy import bridge — state-namespace-bridge)
        const rootHammer = join(gitRoot, HAMMER_STATE_DIR_NAME);
        if (existsSync(rootHammer)) {
          try {
            const rootStat = lstatSync(rootHammer);
            if (rootStat.isSymbolicLink() || rootStat.isDirectory()) {
              return rootStat.isSymbolicLink() ? realpathSync(rootHammer) : rootHammer;
            }
          } catch { /* fall through */ }
        }
        const rootGsd = join(gitRoot, ".gsd"); // legacy import bridge — state-namespace-bridge
        if (existsSync(rootGsd)) {
          try {
            const rootStat = lstatSync(rootGsd);
            if (rootStat.isSymbolicLink() || rootStat.isDirectory()) {
              return rootStat.isSymbolicLink() ? realpathSync(rootGsd) : rootGsd;
            }
          } catch { /* fall through */ }
        }
      }
    } catch {
      // If git root detection fails, fall through to normal logic
    }
  }

  // Clean up macOS numbered collision variants for both .hammer and .gsd.
  cleanNumberedGsdVariants(projectPath);

  // Determine which local path to operate on.
  // Canonical .hammer takes priority; .gsd only used as legacy bridge.
  const localPath = (() => {
    if (existsSync(localHammer)) return localHammer; // canonical already exists
    if (existsSync(localGsd)) {
      // Legacy .gsd exists — emit migration diagnostic and use it as bridge
      // — state-namespace-bridge
      process.stderr.write(
        `[hammer] Project has legacy .gsd state at ${localGsd}; ` +
        `new projects use .hammer — state-namespace-bridge compatibility rule applied.\n`
      );
      return localGsd;
    }
    return localHammer; // neither exists — create canonical .hammer
  })();

  // Ensure external directory exists
  mkdirSync(externalPath, { recursive: true });

  // Write repo metadata
  writeRepoMeta(externalPath, getRemoteUrl(projectPath), resolveGitRoot(projectPath));

  const replaceWithSymlink = (): string => {
    rmSync(localPath, { recursive: true, force: true });
    try { unlinkSync(localPath); } catch { /* already gone */ }
    symlinkSync(externalPath, localPath, "junction");
    return externalPath;
  };

  // Handle dangling symlinks
  if (!existsSync(localPath)) {
    try {
      const stat = lstatSync(localPath);
      if (stat.isSymbolicLink()) {
        return replaceWithSymlink();
      }
    } catch {
      // nothing at this path
    }
    try { unlinkSync(localPath); } catch { /* nothing to remove */ }
    symlinkSync(externalPath, localPath, "junction");
    return externalPath;
  }

  try {
    const stat = lstatSync(localPath);

    if (stat.isSymbolicLink()) {
      const target = realpathSync(localPath);
      if (target === externalPath) {
        return externalPath; // correct symlink, no-op
      }
      if (inWorktree) {
        return replaceWithSymlink();
      }
      if (!hasProjectState(externalPath) && hasProjectState(target)) {
        try {
          mkdirSync(externalPath, { recursive: true });
          const oldEntries = readdirSync(target);
          for (const entry of oldEntries) {
            try {
              const src = join(target, entry);
              const dst = join(externalPath, entry);
              try { renameSync(src, dst); } catch { cpSync(src, dst, { recursive: true, force: true }); }
            } catch { /* continue */ }
          }
          try { rmSync(target, { recursive: true, force: true }); } catch { /* non-fatal */ }
          return replaceWithSymlink();
        } catch {
          return target;
        }
      }
      return target;
    }

    if (stat.isDirectory()) {
      return localPath;
    }
  } catch {
    // lstat failed — path exists but we can't stat it
  }

  return localPath;
}

// ─── Worktree Detection ─────────────────────────────────────────────────────

/**
 * Check if the given directory is a git worktree (not the main repo).
 *
 * Git worktrees have a `.git` *file* (not directory) containing a
 * `gitdir:` pointer. This is git's native worktree indicator — no
 * string marker parsing needed.
 */
export function isInsideWorktree(cwd: string): boolean {
  const gitPath = join(cwd, ".git");
  try {
    const stat = lstatSync(gitPath);
    if (!stat.isFile()) return false;
    const content = readFileSync(gitPath, "utf-8").trim();
    return content.startsWith("gitdir:");
  } catch {
    return false;
  }
}
