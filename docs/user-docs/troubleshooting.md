# Troubleshooting

> **Hammer fork notice.** This is the troubleshooting reference for **Hammer**, the no-guardrails fork of GSD-2 (`github.com/gsd-build/GSD-2`). Internal-implementation surfaces are preserved verbatim throughout — `.gsd/` filesystem paths, `gsd_*` MCP tool names, `gsd-sandbox` container, the `gsd` binary, `GSD_*` environment variables, and the `gsd.*` VS Code setting prefix all keep their GSD identifiers. Only user-facing prose, the `/hammer …` slash commands, and the `@hammer` chat handle are rebranded.

## `/hammer doctor`

The built-in diagnostic tool validates `.gsd/` integrity:

```
/hammer doctor
```

It checks:
- File structure and naming conventions
- Roadmap ↔ slice ↔ task referential integrity
- Completion state consistency
- Git worktree health (worktree and branch modes only — skipped in none mode)
- Stale lock files and orphaned runtime records
- Disk-only orphan milestone stub directories

## Common Issues

### Auto mode loops on the same unit

**Symptoms:** The same unit (e.g., `research-slice` or `plan-slice`) dispatches repeatedly, then auto mode pauses with an "Artifact still missing..." error after 3 artifact verification retries.

**Causes:**
- Stale cache after a crash — the in-memory file listing doesn't reflect new artifacts
- The LLM didn't produce the expected artifact file

**Fix:** Run `/hammer doctor` to repair state, then resume with `/hammer auto`. If the issue persists, check that the expected artifact file exists on disk.

### Auto mode stops with "Loop detected"

**Cause:** The sliding-window detector found a repeated dispatch pattern that did not recover after the diagnostic retry. Missing expected artifacts usually surface through the bounded 3-attempt artifact verification retry path instead.

**Fix:** Check the task plan for clarity. If the plan is ambiguous, refine it manually, then `/hammer auto` to resume.

### Wrong files in worktree

**Symptoms:** Planning artifacts or code appear in the wrong directory.

**Cause:** The LLM wrote to the main repo instead of the worktree.

**Fix:** This was fixed in v2.14+. If you're on an older version, update. The dispatch prompt now includes explicit working directory instructions.

### `command not found: gsd` after install

**Symptoms:** `npm install -g gsd-pi` succeeds but `gsd` isn't found.

**Cause:** npm's global bin directory isn't in your shell's `$PATH`.

**Fix:**

```bash
# Find where npm installed the binary
npm prefix -g
# Output: /opt/homebrew (Apple Silicon) or /usr/local (Intel Mac)

# Add the bin directory to your PATH if missing
echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Workaround:** Run `npx gsd-pi` or `$(npm prefix -g)/bin/gsd` directly.

**Common causes:**
- **Homebrew Node** — `/opt/homebrew/bin` should be in PATH but sometimes isn't if Homebrew init is missing from your shell profile
- **Version manager (nvm, fnm, mise)** — global bin is version-specific; ensure your version manager initializes in your shell config
- **oh-my-zsh** — the `gitfast` plugin aliases `gsd` to `git svn dcommit`. Check with `alias gsd` and unalias if needed

### `npm install -g gsd-pi` fails

**Common causes:**
- Missing workspace packages — fixed in v2.10.4+
- `postinstall` hangs on Linux (Playwright `--with-deps` triggering sudo) — fixed in v2.3.6+
- Node.js version too old — requires ≥ 22.0.0

### Provider errors during auto mode

**Symptoms:** Auto mode pauses with a provider error (rate limit, server error, auth failure).

**How Hammer handles it (v2.26):**

| Error type | Auto-resume? | Delay |
|-----------|-------------|-------|
| Rate limit (429, "too many requests") | ✅ Yes | retry-after header or 60s |
| Server error (500, 502, 503, "overloaded") | ✅ Yes | 30s |
| Auth/billing ("unauthorized", "invalid key") | ❌ No | Manual resume |

For transient errors, Hammer pauses briefly and resumes automatically. For permanent errors, configure fallback models:

```yaml
models:
  execution:
    model: claude-sonnet-4-6
    fallbacks:
      - openrouter/minimax/minimax-m2.5
```

**Headless mode:** `gsd headless auto` auto-restarts the entire process on crash (default 3 attempts with exponential backoff). Combined with provider error auto-resume, this enables true overnight unattended execution.

For common provider setup issues (role errors, streaming errors, model ID mismatches), see the [Provider Setup Guide — Common Pitfalls](./providers.md#common-pitfalls).

### Budget ceiling reached

**Symptoms:** Auto mode pauses with "Budget ceiling reached."

**Fix:** Increase `budget_ceiling` in preferences, or switch to `budget` token profile to reduce per-unit cost, then resume with `/hammer auto`.

### Stale lock file

**Symptoms:** Auto mode won't start, says another session is running.

**Fix:** Hammer automatically detects stale locks — if the owning PID is dead, the lock is cleaned up and re-acquired on the next `/hammer auto`. This includes stranded `.gsd.lock/` directories left by `proper-lockfile` after crashes. If automatic recovery fails, delete `.gsd/auto.lock` and the `.gsd.lock/` directory manually:

```bash
rm -f .gsd/auto.lock
rm -rf "$(dirname .gsd)/.gsd.lock"
```

### Git merge conflicts

**Symptoms:** Worktree merge fails on `.gsd/` files.

**Fix:** Hammer auto-resolves conflicts on `.gsd/` runtime files. For content conflicts in code files, the LLM is given an opportunity to resolve them via a fix-merge session. If that fails, manual resolution is needed.

### Pre-dispatch says the milestone integration branch no longer exists

**Symptoms:** Auto mode or `/hammer doctor` reports that a milestone recorded an integration branch that no longer exists in git.

**What it means:** The milestone's `.gsd/milestones/<MID>/<MID>-META.json` still points at the branch that was active when the milestone started, but that branch has since been renamed or deleted.

**Current behavior:**
- If Hammer can deterministically recover to a safe branch, it no longer hard-stops auto mode.
- Safe fallbacks are:
  - explicit `git.main_branch` when configured and present
  - the repo's detected default integration branch (for example `main` or `master`)
- In that case `/hammer doctor` reports a warning and `/hammer doctor fix` rewrites the stale metadata to the effective branch.
- Hammer still blocks when no safe fallback branch can be determined.

**Fix:**
- Run `/hammer doctor fix` to rewrite the stale milestone metadata automatically when the fallback is obvious.
- If Hammer still blocks, recreate the missing branch or update your git preferences so `git.main_branch` points at a real branch.

### `/hammer doctor` reports `orphan_milestone_dir`

**Symptoms:** `/hammer doctor` shows a warning like `Orphan milestone directory: M003` with issue code `orphan_milestone_dir`.

**What it means:** `.gsd/milestones/<MID>/` exists on disk, but Hammer cannot find a DB milestone row, a matching `.gsd/worktrees/<MID>/` worktree, or any milestone content files. These disk-only stub directories can be left behind by interrupted or stale forward references and can skew the next milestone ID that Hammer generates.

**Fix:** Run `/hammer doctor fix` to remove the orphan milestone stub directory automatically. The auto-fix only targets disk-only stubs with no DB row, no worktree, and no content files; populated milestone directories and in-flight worktree-only milestones are not removed.

### Transient `EBUSY` / `EPERM` / `EACCES` while writing `.gsd/` files

**Symptoms:** On Windows, auto mode or doctor occasionally fails while updating `.gsd/` files with errors like `EBUSY`, `EPERM`, or `EACCES`.

**Cause:** Antivirus, indexers, editors, or filesystem watchers can briefly lock the destination or temp file just as Hammer performs the atomic rename.

**Current behavior:** Hammer now retries those transient rename failures with a short bounded backoff before surfacing an error. The retry is intentionally limited so genuine filesystem problems still fail loudly instead of hanging forever.

**Fix:**
- Re-run the operation; most transient lock races clear quickly.
- If the error persists, close tools that may be holding the file open and then retry.
- If repeated failures continue, run `/hammer doctor` to confirm the repo state is still healthy and report the exact path + error code.

### Node v24 web boot failure

**Symptoms:** `gsd --web` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` on Node v24.

**Cause:** Node v24 changed type-stripping behavior for `node_modules`, breaking the Next.js web build.

**Fix:** Fixed in v2.42.0+ (#1864). Upgrade to the latest version.

### Orphan web server process

**Symptoms:** `gsd --web` fails because port 3000 is already in use, even though no Hammer session is running.

**Cause:** A previous web server process was not cleaned up on exit.

**Fix:** Fixed in v2.42.0+. Hammer now cleans up stale web server processes automatically. If you're on an older version, kill the orphan process manually: `lsof -ti:3000 | xargs kill`.

### Non-JS project blocked by worktree health check

**Symptoms:** Worktree health check fails or blocks auto-mode in projects that don't use Node.js (e.g., Rust, Go, Python).

**Cause:** The worktree health check only recognized JavaScript ecosystems prior to v2.42.0.

**Fix:** Fixed in v2.42.0+ (#1860). The health check now supports 17+ ecosystems. Upgrade to the latest version.

### German/non-English locale git errors

**Symptoms:** Git commands fail or produce unexpected results when the system locale is non-English (e.g., German).

**Cause:** Hammer parsed git output assuming English locale strings.

**Fix:** Fixed in v2.42.0+. All git commands now force `LC_ALL=C` to ensure consistent English output regardless of system locale.

## Hammer IAM Integration

Hammer integrates with the Identity & Awareness Mesh (IAM) via the `iam-subagent-policy` chokepoint. The contract is **fail-closed**: any malformed envelope, missing required field, or unmet provenance requirement results in a hard error rather than a soft-fail or warning. This is a deliberate consequence of Hammer's no-guardrails posture — IAM is the one place we *do* gate, so when it fails it must fail visibly.

### Auto mode pauses with `IAM_SUBAGENT_CONTRACT` envelope error

**Symptoms:** Auto-mode dispatch pauses with an error referencing `IAM_SUBAGENT_CONTRACT`, `iam-subagent-policy`, or "envelope shape invalid". The error typically points at `iam-subagent-policy.ts:88` or a similar marker chokepoint location.

**Cause:** A subagent dispatch sent an IAM envelope that did not satisfy the contract — a required field is missing (e.g., `provenance`, `awareness`, `verdict`), the field types don't match, or no-degradation evidence was not produced. The policy is fail-closed by design: there is no soft-fail path that would let the dispatch proceed with a half-formed envelope.

**Fix:**
- Read the structured remediation hint included in the error — it names the exact missing or malformed field.
- For subagent authors: re-emit the envelope with all required fields populated. Do not work around this by patching the policy to accept the malformed shape — the gate exists because Hammer has no other guardrail.
- If the failure is in a third-party extension, file an issue against that extension. Do not bypass the policy by editing `iam-subagent-policy.ts`.
- After fixing, resume with `/hammer auto`. The recover-and-resume loop (below) will re-dispatch and re-evaluate the envelope.

### IAM provenance/awareness evidence missing on completion

**Symptoms:** Task or slice completion is rejected with a message about missing provenance, missing awareness evidence, or no-degradation evidence not produced.

**Cause:** Hammer treats IAM evidence as a non-skippable completion artifact (per R031/R037 — see [auto-mode.md → Omega-Driven Phases](./auto-mode.md#omega-driven-phases)). If the canonical Omega phases did not run to ALGIZ/JERA, or per-stage artifacts under `.gsd/omega/phases/<unitType>/<unitId>/<runId>/` are absent, completion is blocked.

**Fix:**
- Inspect `.gsd/omega/phases/<unitType>/<unitId>/<runId>/phase-manifest.json` to see which canonical stage did not finalize.
- If a stage failed mid-flight, resume `/hammer auto` — it will re-enter the failed phase rather than skip it.
- Do not delete the manifest to "force progress" — that turns a recoverable pause into a silent loss of provenance.

## Recover-and-Resume Issues

Hammer's only structural guardrail is the **3-strike consecutive-recovery cap**. The recovery loop is documented in detail at [auto-mode.md → Recover-and-Resume](./auto-mode.md#recover-and-resume); this section covers operator-facing diagnostics.

### Auto mode halted with "consecutive recovery failures"

**Symptoms:** Auto-mode stopped and the surface message says "consecutive recovery failures reached cap" or similar. The lock file has incremented `consecutiveRecoveryFailures` to 3.

**Cause:** Three back-to-back recovery dispatches emitted `give-up` verdicts (or malformed/missing `RECOVERY_VERDICT` trailers, which count as `give-up` for cap purposes). The cap is the deliberate halt condition — Hammer will not loop infinitely in recovery.

**Fix:**
- Inspect the current counter:
  ```bash
  cat .hammer/auto-MID.lock | jq '.consecutiveRecoveryFailures'
  ```
  (Replace `MID` with the active milestone ID. Legacy installations may use `.gsd/auto.lock`.)
- Read the most recent dispatch stdout under `.hammer/exec/<sessionId>.stdout` to see what the recovery agent attempted and why it gave up.
- Open the failing task's `T##-PLAN.md` and the most recent recovery briefing in `.gsd/dispatch-briefings/` — the briefing names the artifacts the recovery agent had access to. If the recovery agent was missing context (e.g., a lift-over from legacy `.gsd/` was incomplete), run `/hammer migrate` first.
- After resolving the underlying blocker manually, reset the counter by editing the lock file or by completing one task successfully — `fix-applied` verdicts reset the counter.

### Recovery dispatch loops without progress

**Symptoms:** The same task is re-dispatched repeatedly, the counter increments slowly, and each dispatch ends with a `RECOVERY_VERDICT: give-up` trailer.

**Cause:** Either (a) the underlying blocker is not fixable from inside the recovery loop (e.g., a missing API key, unreachable external service, or human-decision blocker), or (b) the recovery briefing is omitting context the agent needs.

**Fix:**
- File the blocker explicitly via `/hammer blocker` so the next recovery emits `blocker-filed` (clean exit, does not increment) instead of `give-up`.
- If the briefing is the problem, look for malformed artifacts in `.gsd/dispatch-briefings/` and `.hammer/auto-MID.lock` — stale entries can sometimes be cleared with `/hammer doctor fix`.
- Resume with `/hammer auto`. The blocker exit gives you a clean state from which to address the issue without burning the cap.

### `RECOVERY_VERDICT` trailer missing or malformed

**Symptoms:** The recovery loop counts a dispatch as a failure even though the agent appears to have succeeded; the counter increments unexpectedly.

**Cause:** A missing or malformed `RECOVERY_VERDICT: <verdict>` trailer at the end of a recovery dispatch is treated identically to `give-up`. There is no fall-through: the trailer is the only signal Hammer reads. This is a deliberate fail-closed decision — silent successes would mask runaway loops.

**Fix:**
- For built-in recovery agents: this should not happen on supported versions. File an issue with the dispatch transcript.
- For custom recovery extensions: the agent must emit `RECOVERY_VERDICT: fix-applied`, `RECOVERY_VERDICT: blocker-filed`, or `RECOVERY_VERDICT: give-up` as the literal final trailer. No other tokens count, and there is no clarification re-dispatch — malformed = failure.

### Lock file shows stale `consecutiveRecoveryFailures`

**Symptoms:** A counter from a previous run did not reset when a successful task completed.

**Cause:** Counter resets are emitted on `fix-applied` verdicts during recovery dispatches. Manual interventions that bypass the recovery loop don't reset the counter.

**Fix:** Edit `.hammer/auto-MID.lock` (or legacy `.gsd/auto.lock`) and set `consecutiveRecoveryFailures` to 0, or run `/hammer doctor fix` which will normalize the value when no recovery is in flight.

## MCP Client Issues

### `mcp_servers` shows no configured servers

**Symptoms:** `mcp_servers` reports no servers configured.

**Common causes:**
- No `.mcp.json` or `.gsd/mcp.json` file exists in the current project
- The config file is malformed JSON
- The server is configured in a different project directory than the one where you launched Hammer

**Fix:**
- Add the server to `.mcp.json` or `.gsd/mcp.json`
- Verify the file parses as JSON
- Re-run `mcp_servers(refresh=true)`

### `mcp_discover` times out

**Symptoms:** `mcp_discover` fails with a timeout.

**Common causes:**
- The server process starts but never completes the MCP handshake
- The configured command points to a script that hangs on startup
- The server is waiting on an unavailable dependency or backend service

**Fix:**
- Run the configured command directly outside Hammer and confirm the server actually starts
- Check that any backend URLs or required services are reachable
- For local custom servers, verify the implementation is using an MCP SDK or a correct stdio protocol implementation

### `mcp_discover` reports connection closed

**Symptoms:** `mcp_discover` fails immediately with a connection-closed error.

**Common causes:**
- Wrong executable path
- Wrong script path
- Missing runtime dependency
- The server crashes before responding

**Fix:**
- Verify `command` and `args` paths are correct and absolute
- Run the command manually to catch import/runtime errors
- Check that the configured interpreter or runtime exists on the machine

### `mcp_call` fails because required arguments are missing

**Symptoms:** A discovered MCP tool exists, but calling it fails validation because required fields are missing.

**Common causes:**
- The call shape is wrong
- The target server's tool schema changed
- You're calling a stale server definition or stale branch build

**Fix:**
- Re-run `mcp_discover(server="name")` and confirm the exact required argument names
- Call the tool with `mcp_call(server="name", tool="tool_name", args={...})`
- If you're developing Hammer itself, rebuild after schema changes with `npm run build`

### Local stdio server works manually but not in Hammer

**Symptoms:** Running the server command manually seems fine, but Hammer can't connect.

**Common causes:**
- The server depends on shell state that Hammer doesn't inherit
- Relative paths only work from a different working directory
- Required environment variables exist in your shell but not in the MCP config

**Fix:**
- Use absolute paths for `command` and script arguments
- Set required environment variables in the MCP config's `env` block
- If needed, set `cwd` explicitly in the server definition

### Session lock stolen by `/hammer` in another terminal

**Symptoms:** Running `/hammer` (step mode) in a second terminal causes a running auto-mode session to lose its lock.

**Fix:** Fixed in v2.36.0. Bare `/hammer` no longer steals the session lock from a running auto-mode session. Upgrade to the latest version.

### Worktree commits landing on main instead of milestone branch

**Symptoms:** Auto-mode commits in a worktree end up on `main` instead of the `milestone/<MID>` branch.

**Fix:** Fixed in v2.37.1. CWD is now realigned before dispatch and stale merge state is cleaned on failure. Upgrade to the latest version.

### Extension loader fails with subpath export error

**Symptoms:** Extension fails to load with a `Cannot find module` error referencing npm subpath exports.

**Cause:** Dynamic imports in the extension loader didn't resolve npm subpath exports (e.g., `@pkg/foo/bar`).

**Fix:** Fixed in v2.38+. The extension loader now auto-resolves npm subpath exports and creates a `node_modules` symlink for dynamic import resolution. Upgrade to the latest version.

## Recovery Procedures

### Reset auto mode state

```bash
rm .gsd/auto.lock
rm .gsd/completed-units.json
```

Then `/hammer auto` to restart from current disk state.

### Reset routing history

If adaptive model routing is producing bad results, clear the routing history:

```bash
rm .gsd/routing-history.json
```

### Full state rebuild

```
/hammer doctor
```

Doctor rebuilds `STATE.md` from plan and roadmap files on disk and fixes detected inconsistencies.

## Getting Help

- **GitHub Issues:** [github.com/gsd-build/GSD-2/issues](https://github.com/gsd-build/GSD-2/issues)
- **Dashboard:** `Ctrl+Alt+G` or `/hammer status` for real-time diagnostics
- **Forensics:** `/hammer forensics` for structured post-mortem analysis of auto-mode failures
- **Session logs:** `.gsd/activity/` contains JSONL session dumps for crash forensics

## iTerm2-Specific Issues

### Ctrl+Alt shortcuts trigger the wrong action (e.g., Ctrl+Alt+G opens external editor instead of Hammer dashboard)

**Symptoms:** Pressing Ctrl+Alt+G opens the external editor prompt (Ctrl+G) instead of the Hammer dashboard. Other Ctrl+Alt shortcuts behave as their Ctrl-only counterparts.

**Cause:** iTerm2's default Left Option Key setting is "Normal", which swallows the Alt modifier for Ctrl+Alt key combinations. The terminal receives only the Ctrl key, so Ctrl+Alt+G arrives as Ctrl+G.

**Fix:** In iTerm2, go to **Profiles → Keys → General** and set **Left Option Key** to **Esc+**. This makes Alt/Option send an escape prefix that terminal applications can detect, enabling Ctrl+Alt shortcuts to work correctly.

## Windows-Specific Issues

### LSP returns ENOENT on Windows (MSYS2/Git Bash)

**Symptoms:** LSP initialization fails with `ENOENT` or resolves POSIX-style paths like `/c/Users/...` instead of `C:\Users\...`.

**Cause:** The `which` command in MSYS2/Git Bash returns POSIX paths that Node.js `spawn()` can't resolve.

**Fix:** Updated in v2.29+ to use `where.exe` on Windows. Upgrade to the latest version.

### EBUSY errors during WXT/extension builds

**Symptoms:** `EBUSY: resource busy or locked, rmdir .output/chrome-mv3` when building browser extensions.

**Cause:** A Chromium browser has the extension loaded from the build output directory, preventing deletion.

**Fix:** Close the browser extension, or set a different `outDirTemplate` in your WXT config to avoid the locked directory.

## Database Issues

### "GSD database is not available"

**Symptoms:** `gsd_decision_save` (or its alias `gsd_save_decision`), `gsd_requirement_update` (or `gsd_update_requirement`), or `gsd_summary_save` (or `gsd_save_summary`) fail with this error.

**Cause:** The SQLite database wasn't initialized. This happens in manual `/hammer` sessions (non-auto mode) on versions before v2.29.

**Fix:** Updated in v2.29+ to auto-initialize the database on first tool call. Upgrade to the latest version.

## Verification Issues

### Verification gate fails with shell syntax error

**Symptoms:** `stderr: /bin/sh: 1: Syntax error: "(" unexpected` during verification checks.

**Cause:** A description-like string (e.g., `All 10 checks pass (build, lint)`) was treated as a shell command. This can happen when task plans have `verify:` fields with prose instead of actual commands.

**Fix:** Updated in v2.29+ to filter preference commands through `isLikelyCommand()`. Ensure `verification_commands` in preferences contains only valid shell commands, not descriptions.

## LSP (Language Server Protocol)

### "LSP isn't available in this workspace"

Hammer auto-detects language servers based on project files (e.g. `package.json` → TypeScript, `Cargo.toml` → Rust, `go.mod` → Go). If no servers are detected, the agent skips LSP features.

**Check status:**
```
lsp status
```

This shows which servers are active and, if none are found, diagnoses why — including which project markers were detected but which server commands are missing.

**Common fixes:**

| Project type | Install command |
|-------------|-----------------|
| TypeScript/JavaScript | `npm install -g typescript-language-server typescript` |
| Python | `pip install pyright` or `pip install python-lsp-server` |
| Rust | `rustup component add rust-analyzer` |
| Go | `go install golang.org/x/tools/gopls@latest` |

After installing, run `lsp reload` to restart detection without restarting Hammer.

## Notifications

### Notifications not appearing on macOS

**Symptoms:** `notifications.enabled: true` in preferences, but no desktop notifications appear during auto-mode (no milestone complete alerts, no budget warnings, no error notifications). No error messages logged.

**Cause:** Hammer uses `osascript display notification` as a fallback on macOS. This command is attributed to your terminal app (Ghostty, iTerm2, Alacritty, Kitty, Warp, etc.). If that app doesn't have notification permissions in System Settings → Notifications, macOS silently drops the notification — `osascript` exits 0 with no error.

Most terminal apps don't appear in the Notifications settings panel until they've successfully delivered at least one notification, creating a chicken-and-egg problem.

**Fix (recommended):** Install `terminal-notifier`, which registers as its own Notification Center app:

```bash
brew install terminal-notifier
```

Hammer automatically prefers `terminal-notifier` when available. On first use, macOS will prompt you to allow notifications — this is the expected behavior.

**Fix (alternative):** Go to **System Settings → Notifications** and enable notifications for your terminal app. If your terminal doesn't appear in the list, try sending a test notification from Terminal.app first to register "Script Editor":

```bash
osascript -e 'display notification "test" with title "Hammer"'
```

**Verify:** After applying either fix, test with:

```bash
terminal-notifier -title "Hammer" -message "working!" -sound Glass
```

### Telegram notifications not arriving

**Symptoms:** Auto-mode is running, Telegram is configured as the remote channel, but milestone completions, budget alerts, and other informational notifications are not appearing in the Telegram chat.

**Causes and fixes:**

- **`notifications.enabled` is not set** — ensure `notifications.enabled: true` is present in preferences alongside the `remote_questions` configuration. Informational notifications require both to be set.
- **Bot token is incorrect or expired** — run `/hammer remote status` to confirm the configuration is saved, then `/hammer remote telegram` to re-run setup and re-validate the token.
- **Bot is not a member of the target chat** — the bot must be added to the group chat (or the configured chat ID must match a private chat with the bot). Send `/help` directly to the bot in Telegram to confirm it is reachable.
- **Wrong `channel_id`** — verify the chat ID in `~/.gsd/PREFERENCES.md` matches the chat where you expect notifications. For group chats, the ID is typically a negative number (e.g., `-1001234567890`).
- **Network or firewall issue** — Hammer must be able to reach `api.telegram.org`. Test with `curl https://api.telegram.org` from the machine running Hammer.

### Telegram commands not responding

**Symptoms:** Sending `/status`, `/pause`, or other Telegram commands to the bot produces no response.

**Causes and fixes:**

- **Auto-mode is not running** — background polling only operates while auto-mode is active. Start auto-mode with `/hammer auto` and then retry the command.
- **Wrong chat** — commands are only processed from the chat configured in `remote_questions.channel_id`. Confirm you are sending from the correct chat.
- **Bot token mismatch** — the `TELEGRAM_BOT_TOKEN` environment variable or the token in `~/.gsd/PREFERENCES.md` may not match the bot you are messaging. Run `/hammer remote status` to confirm which bot token is active.
- **Polling not started** — if Hammer was already running when the Telegram configuration was added, restart auto-mode (`/hammer stop`, then `/hammer auto`) so polling initializes with the new configuration.
- **Send `/help` first** — if the bot responds to `/help`, polling is working correctly. If a specific command like `/pause` does not respond, check for typos (commands are case-sensitive).
