# Troubleshooting

> **Fork bridge.** Hammer is a fork of GSD-2. The on-disk state directory (`.gsd/`), the binary (`gsd`), and the runtime error strings are preserved verbatim from GSD-2 so existing diagnostic muscle memory keeps working. The two new troubleshooting surfaces specific to Hammer are **IAM gate rejections** and **recover-and-resume verdict failures**, both covered below.

## `/hammer doctor`

The built-in diagnostic tool validates `.gsd/` integrity:

```
/hammer doctor
```

It checks file structure, roadmap ↔ slice ↔ task consistency, completion state, git health, stale locks, orphaned records, and disk-only milestone stubs. The `/gsd doctor` form continues to work and dispatches to the same handler.

## Common Issues

### Auto mode loops on the same unit

The same unit dispatches repeatedly.

**Fix:** Run `/hammer doctor` to repair state, then `/hammer auto`. If it persists, check that the expected artifact file exists on disk.

### Auto mode stops with "Loop detected"

A unit failed to produce its expected artifact twice.

**Fix:** Check the task plan for clarity. Refine it manually, then `/hammer auto`. Per the no-guardrails posture this is the only auto-stop heuristic in the dispatch loop — Hammer will not insert soft warnings before reaching it.

### `command not found: gsd` after install

npm's global bin directory isn't in `$PATH`. The binary name is preserved as `gsd` — see the fork bridge note at the top of this page.

**Fix:**
```bash
npm prefix -g
# Add the bin dir to PATH:
echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Common causes:**
- **Homebrew Node** — `/opt/homebrew/bin` missing from PATH
- **Version manager (nvm, fnm, mise)** — global bin is version-specific
- **oh-my-zsh** — `gitfast` plugin aliases `gsd` to `git svn dcommit`; check with `alias gsd`

### Provider errors during auto mode

| Error Type | Auto-Resume? | Delay |
|-----------|-------------|-------|
| Rate limit (429) | Yes | 60s or retry-after header |
| Server error (500, 502, 503) | Yes | 30s |
| Auth/billing ("unauthorized") | No | Manual resume required |

For permanent errors, configure fallback models:

```yaml
models:
  execution:
    model: claude-sonnet-4-6
    fallbacks:
      - openrouter/minimax/minimax-m2.5
```

### Budget ceiling reached

Auto mode pauses with "Budget ceiling reached."

**Fix:** Increase `budget_ceiling` in preferences, or switch to `budget` token profile, then `/hammer auto`.

### Stale lock file

Auto mode won't start, says another session is running.

**Fix:** Hammer auto-detects stale locks (dead PID = auto cleanup). If automatic recovery fails:

```bash
rm -f .gsd/auto.lock
rm -rf "$(dirname .gsd)/.gsd.lock"
```

### Git merge conflicts

Worktree merge fails on `.gsd/` files.

**Fix:** `.gsd/` conflicts are auto-resolved. Code conflicts get an AI fix attempt; if that fails, resolve manually.

### Work stranded in a worktree after an interrupted session

Auto mode was paused, stopped, or crashed mid-milestone, and the work is still on the `milestone/<MID>` branch in `.gsd/worktrees/<MID>/` — never merged back to main. Next session reports the milestone as incomplete or behaving inconsistently.

**Fix:** As of GSD 2.78 (preserved in Hammer), `/hammer auto` bootstrap automatically detects this condition and surfaces a warning naming the branch, commit count, and worktree location. Run `/hammer auto` to re-enter the worktree and resume; or merge `milestone/<MID>` into main manually if abandoning.

**Diagnose:** Run `/hammer forensics` and look at the **Worktree Telemetry** section:
- `Orphans detected > 0` with reason `in-progress-unmerged` confirms the condition
- `Unmerged exits > 0` on the producer side confirms which exit type caused it

**Prevent recurrence:** If your milestones are large or sessions are frequently interrupted, consider setting `git.collapse_cadence: "slice"` in preferences — validated slices merge to main immediately, shrinking the orphan window from milestone-size to slice-size. See [Git & Worktrees](../configuration/git-settings.md#collapse-cadence).

### `orphan_milestone_dir` doctor warning

`/hammer doctor` can report `orphan_milestone_dir` when `.gsd/milestones/<MID>/` exists on disk but has no DB row, no matching `.gsd/worktrees/<MID>/` worktree, and no milestone content files. This is a disk-only stub, not stranded work, and it can skew future milestone ID generation.

**Fix:** Run `/hammer doctor fix` to remove the orphan stub directory automatically. The fix only removes these empty disk-only milestone stubs; populated milestone directories and in-flight worktree-only milestones are preserved.

### Notifications not appearing on macOS

**Fix:** Install `terminal-notifier`:

```bash
brew install terminal-notifier
```

See [Notifications](../configuration/notifications.md) for details.

## IAM Gate Rejections

The IAM (Integrated Awareness Model) gate is the only structural guardrail in Hammer's dispatch path. When a subagent dispatch is rejected by the gate, the symptom is a hard policy block (no warning, no soft prompt) referencing `IAM_SUBAGENT_CONTRACT` or `iam-subagent-policy.ts`.

**The fail-closed contract is intentional.** Do **not** bypass an IAM rejection by editing `iam-subagent-policy.ts`, deleting Omega manifests, or wrapping the dispatch in a workaround. The gate is the only structural guard left after the no-guardrails posture removed soft warnings — silencing it leaves the dispatch path with zero guards.

**How to diagnose a rejection:**

1. Read the rejection message — it names the missing or stale artifact (manifest path, contract field, run id).
2. Run `/hammer forensics` and look for the failing dispatch in the unit trace.
3. If the rejection cites a missing Omega manifest, the upstream phase did not write one — investigate that phase, not the gate.
4. If the rejection cites a stale manifest, the dispatching phase is reusing context from an outdated run — re-run the upstream phase to refresh provenance.

See [Omega-Driven Phases, IAM, and No-Guardrails Posture](../core-concepts/omega-phases.md) for the architectural rationale.

## Recover-and-Resume Failures

Recover-and-resume is one of Hammer's structural commitments — interrupted sessions reconstruct context and write a `RECOVERY_VERDICT` so the recovery itself is auditable. When recover-and-resume fails, the symptom is usually one of:

- Next `/hammer auto` exits immediately citing a missing or malformed `RECOVERY_VERDICT`.
- The recovery briefing is empty even though tool calls reached disk in the prior session.
- IAM rejects the post-recovery dispatch because the verdict record is missing.

**Do not suppress the verdict write or comment out the recovery gate.** The verdict is what makes recover-and-resume an auditable cycle rather than a silent restart. If the verdict cannot be written, the underlying issue is what to fix.

**How to diagnose:**

1. Inspect `.gsd/activity/*.jsonl` for the prior session — confirm tool-call records made it to disk.
2. Check the `RECOVERY_VERDICT` file referenced by the rejection message.
3. If the verdict is malformed, `/hammer doctor` can rebuild it from surviving session evidence.
4. As a last resort, run `/hammer forensics` for a full post-mortem.

## "GSD database is not available"

This runtime error string is preserved verbatim from GSD-2 (internal-implementation surface — the heading remains grep-able from session output).

**Fix:** Confirm `.gsd/gsd.db` exists and is writable. If the file is missing, `/hammer doctor` will recreate it from disk artifacts. If the file is corrupt, restore from the most recent `.gsd/backups/` snapshot.

## MCP Issues

### No servers configured

**Fix:** Add server to `.mcp.json` or `.gsd/mcp.json`, verify JSON is valid, run `mcp_servers(refresh=true)`.

### Server discovery times out

**Fix:** Run the configured command outside Hammer to confirm it starts. Check that backend services are reachable.

### Server connection closed immediately

**Fix:** Verify `command` and `args` paths are correct and absolute. Run the command manually to catch errors.

## Recovery Procedures

### Reset auto mode state

```bash
rm .gsd/auto.lock
rm .gsd/completed-units.json
```

Then `/hammer auto` to restart from current state.

### Reset routing history

```bash
rm .gsd/routing-history.json
```

### Full state rebuild

```
/hammer doctor
```

Rebuilds `STATE.md` from plan and roadmap files and fixes inconsistencies.

## Getting Help

- **GitHub Issues:** [github.com/gsd-build/GSD-2/issues](https://github.com/gsd-build/GSD-2/issues) (preserved verbatim — Hammer issues continue to track here for now)
- **Dashboard:** `Ctrl+Alt+G` or `/hammer status`
- **Forensics:** `/hammer forensics` for post-mortem analysis
- **Session logs:** `.gsd/activity/` contains JSONL session dumps

## Platform-Specific Issues

### iTerm2

`Ctrl+Alt` shortcuts trigger wrong actions → Set **Profiles → Keys → General → Left Option Key** to **Esc+**.

### Windows

- LSP ENOENT on MSYS2/Git Bash → Fixed in v2.29+, upgrade
- EBUSY errors during builds → Close browser extension, or change output directory
- Transient EBUSY/EPERM on `.gsd/` files → Retry; close file-locking tools if persistent
