// GSD2 — Claude CLI binary detection for onboarding
// Lightweight check used at onboarding time (before extensions load).
// The full readiness check with caching lives in the claude-code-cli extension.

import { execFileSync } from 'node:child_process'

/**
 * Platform-correct binary name for the Claude Code CLI.
 *
 * On Windows, npm-global binaries are installed as `.cmd` shims and
 * `execFileSync` does not auto-resolve the extension — calling bare
 * `claude` would fail with ENOENT even when the CLI is installed and
 * authenticated. Mirrors the `NPM_COMMAND` pattern in
 * `src/resources/extensions/gsd/pre-execution-checks.ts`.
 */
export const CLAUDE_COMMAND = process.platform === 'win32' ? 'claude.cmd' : 'claude'

/**
 * Ordered list of binary names to probe for the Claude Code CLI.
 *
 * Windows installs vary: npm-global installs produce a `claude.cmd` shim,
 * direct binary installs produce `claude.exe`, and Git Bash wrappers may
 * expose a bare `claude` shim. Try all three so no valid install is missed.
 */
const CLAUDE_COMMAND_CANDIDATES: string[] =
  process.platform === 'win32' ? [CLAUDE_COMMAND, 'claude.exe', 'claude'] : [CLAUDE_COMMAND]

// Codes treated as "this candidate didn't run — try the next one" rather than
// fatal failures. ETIMEDOUT/EAGAIN cover slow-spawn cases on Windows where
// cmd.exe wrapping plus the Claude CLI startup path together exceed the
// per-attempt timeout (Issue #4997 regression on Windows + Node 25).
const SOFT_FAIL_CODES = new Set(['ENOENT', 'EINVAL', 'ETIMEDOUT', 'EAGAIN'])

const VERSION_TIMEOUT_MS = 5_000
// Auth probe needs more headroom on Windows because the spawn goes through
// cmd.exe → claude.cmd → node → Claude CLI.
const AUTH_TIMEOUT_MS = 15_000

/**
 * Try to run `args` against each candidate binary.
 * Returns the output buffer on first success, throws the last error if all fail.
 */
function execClaudeCheck(args: string[], timeoutMs: number): Buffer {
  let lastError: unknown
  for (const command of CLAUDE_COMMAND_CANDIDATES) {
    try {
      return execFileSync(command, args, {
        timeout: timeoutMs,
        stdio: 'pipe',
        shell: process.platform === 'win32',
      })
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code && SOFT_FAIL_CODES.has(code)) continue
      throw error
    }
  }
  throw lastError ?? new Error(`Claude CLI not found (tried: ${CLAUDE_COMMAND_CANDIDATES.join(', ')})`)
}

/**
 * Decide auth state from `claude auth status` output.
 *
 * Newer Claude CLI builds emit JSON with a `loggedIn` boolean. Older builds
 * emit free-form text. Prefer the structured signal; fall back to a text
 * heuristic. The text heuristic only covers English phrasing.
 */
function parseAuthStatus(output: string): boolean {
  const trimmed = output.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { loggedIn?: unknown }
      if (typeof parsed.loggedIn === 'boolean') {
        return parsed.loggedIn
      }
    } catch {
      // Fall through to text heuristic.
    }
  }

  const lower = trimmed.toLowerCase()
  if (/not logged in|no credentials|unauthenticated|not authenticated/.test(lower)) {
    return false
  }
  return true
}

/**
 * Check if the `claude` binary is installed (regardless of auth state).
 */
export function isClaudeBinaryInstalled(): boolean {
  try {
    execClaudeCheck(['--version'], VERSION_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

/**
 * Check if the `claude` CLI is installed AND authenticated.
 */
export function isClaudeCliReady(): boolean {
  try {
    execClaudeCheck(['--version'], VERSION_TIMEOUT_MS)
  } catch {
    return false
  }

  try {
    const output = execClaudeCheck(['auth', 'status', '--json'], AUTH_TIMEOUT_MS).toString()
    return parseAuthStatus(output)
  } catch {
    return false
  }
}
