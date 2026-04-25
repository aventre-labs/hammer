/**
 * Readiness check for the Claude Code CLI provider.
 *
 * Verifies the `claude` binary is installed, responsive, AND authenticated.
 * Results are cached for 30 seconds to avoid shelling out on every
 * model-availability check.
 *
 * Auth verification runs `claude auth status --json` and inspects the
 * `loggedIn` field, falling back to a text heuristic when the JSON shape
 * is unavailable (older Claude CLI builds).
 */

import { execFileSync } from "node:child_process";

/**
 * Candidate executable names for the Claude Code CLI.
 *
 * Keep the explicit win32 ternary selector for regression coverage (Issue #4424):
 * Node's execFileSync must target `claude.cmd` directly on Windows.
 */
const CLAUDE_COMMAND = process.platform === "win32" ? "claude.cmd" : "claude";

/**
 * Windows installs vary: some environments expose `claude.cmd` (npm shim),
 * `claude.exe` (direct binary install), or a bare `claude` shim on PATH
 * (for example Git Bash wrappers). Try all three to avoid false "not
 * installed" results in readiness checks.
 */
const CLAUDE_COMMAND_CANDIDATES = process.platform === "win32" ? [CLAUDE_COMMAND, "claude.exe", "claude"] : [CLAUDE_COMMAND];

// Codes treated as "this candidate didn't run — try the next one" rather than
// fatal failures. ENOENT/EINVAL cover the original Windows .cmd shim cases.
// ETIMEDOUT and EAGAIN cover slow-spawn cases where cmd.exe wrapping plus
// the Claude CLI startup path together exceed the per-attempt timeout
// (Issue #4997 regression on Windows + Node 25).
const SOFT_FAIL_CODES = new Set(["ENOENT", "EINVAL", "ETIMEDOUT", "EAGAIN"]);

// Keep the version probe snappy — `claude --version` is a quick path.
const VERSION_TIMEOUT_MS = 5_000;
// Auth status can be much slower on Windows because the spawn goes through
// cmd.exe → claude.cmd → node → Claude CLI. 15s leaves headroom on cold spawns
// without making startup feel hung when the CLI is genuinely missing.
const AUTH_TIMEOUT_MS = 15_000;

function execClaude(args: string[], timeoutMs: number): Buffer {
	let lastError: unknown;
	for (const command of CLAUDE_COMMAND_CANDIDATES) {
		try {
			return execFileSync(command, args, {
				timeout: timeoutMs,
				stdio: "pipe",
				shell: process.platform === "win32",
			});
		} catch (error) {
			lastError = error;
			const code = (error as NodeJS.ErrnoException | undefined)?.code;
			if (code && SOFT_FAIL_CODES.has(code)) {
				continue;
			}
			throw error;
		}
	}
	throw lastError ?? new Error(`Claude CLI executable not found (tried: ${CLAUDE_COMMAND_CANDIDATES.join(", ")})`);
}

/**
 * Decide auth state from `claude auth status` output.
 *
 * Newer Claude CLI builds emit JSON by default with a `loggedIn` boolean.
 * Older builds emit free-form text. We prefer the structured signal and fall
 * back to a text heuristic. Note: the text heuristic only covers English
 * phrasing — the JSON path is the durable signal.
 */
function parseAuthStatus(output: string): boolean {
	const trimmed = output.trim();
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as { loggedIn?: unknown };
			if (typeof parsed.loggedIn === "boolean") {
				return parsed.loggedIn;
			}
		} catch {
			// Fall through to text heuristic.
		}
	}

	const lower = trimmed.toLowerCase();
	if (/not logged in|no credentials|unauthenticated|not authenticated/.test(lower)) {
		return false;
	}
	// Exit-0 with non-error output and no negative markers — treat as authed.
	return true;
}

let cachedBinaryPresent: boolean | null = null;
let cachedAuthed: boolean | null = null;
let lastCheckMs = 0;
const CHECK_INTERVAL_MS = 30_000;

function refreshCache(): void {
	const now = Date.now();
	if (cachedBinaryPresent !== null && now - lastCheckMs < CHECK_INTERVAL_MS) {
		return;
	}

	// Set timestamp first to prevent re-entrant checks during the same window
	lastCheckMs = now;

	// Check binary presence
	try {
		execClaude(["--version"], VERSION_TIMEOUT_MS);
		cachedBinaryPresent = true;
	} catch {
		cachedBinaryPresent = false;
		cachedAuthed = false;
		return;
	}

	// Request JSON explicitly so older CLI builds that defaulted to text and
	// newer builds that default to JSON produce a consistent shape.
	try {
		const output = execClaude(["auth", "status", "--json"], AUTH_TIMEOUT_MS).toString();
		cachedAuthed = parseAuthStatus(output);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		// Spawn-shape failures (timeout, transient) shouldn't be treated as
		// "definitely not authed" — leave the previous value if we have one,
		// otherwise default to false. The version probe already established
		// the binary works, so a flaky auth probe is more likely transient.
		if (code && SOFT_FAIL_CODES.has(code) && cachedAuthed !== null) {
			return;
		}
		cachedAuthed = false;
	}
}

/**
 * Whether the `claude` binary is installed (regardless of auth state).
 */
export function isClaudeBinaryPresent(): boolean {
	refreshCache();
	return cachedBinaryPresent ?? false;
}

/**
 * Whether the `claude` CLI is authenticated with a valid session.
 * Returns false if the binary is not installed.
 */
export function isClaudeCodeAuthed(): boolean {
	refreshCache();
	return (cachedBinaryPresent ?? false) && (cachedAuthed ?? false);
}

/**
 * Full readiness check: binary installed AND authenticated.
 * This is the gating function used by the provider registration.
 */
export function isClaudeCodeReady(): boolean {
	refreshCache();
	return (cachedBinaryPresent ?? false) && (cachedAuthed ?? false);
}

/**
 * Force-clear the cached readiness state.
 * Useful after the user completes auth setup so the next check is fresh.
 */
export function clearReadinessCache(): void {
	cachedBinaryPresent = null;
	cachedAuthed = null;
	lastCheckMs = 0;
}
