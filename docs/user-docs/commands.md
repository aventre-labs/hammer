# Commands Reference

> **Slash-command rebrand.** All slash commands in this catalog use the `/hammer …` form. The legacy `/gsd …` slash-command form is **not** an alias and is no longer recognized — it has been retired. The CLI binary, npm package, filesystem layout, environment variables, and MCP tool names are preserved verbatim per the rebrand-window scoping rule:
>
> - **CLI binary:** `gsd` (e.g. `gsd auto`, `gsd --version`, `gsd config`) — unchanged.
> - **npm package:** `gsd-pi` — unchanged.
> - **Filesystem paths:** `.gsd/`, `~/.gsd/`, `~/.gsd/agent/auth.json`, `.gsd/PREFERENCES.md` — unchanged. Runtime artifacts now also land under `.hammer/` (auto lock, exec stdouts).
> - **Environment variables:** `GSD_HOME`, `GSD_PROJECT_ID`, `GSD_STATE_DIR`, `GSD_CODING_AGENT_DIR`, `GSD_ALLOWED_COMMAND_PREFIXES`, `GSD_FETCH_ALLOWED_URLS` — unchanged.
> - **VS Code chat handle / setting prefix:** `@hammer` (chat handle, rebranded) but the VS Code setting key prefix is still `gsd.*` — unchanged.
> - **MCP tool names:** every legacy `gsd_*` tool now also responds to a `hammer_*` alias. Both names dispatch to the same handler. New code should prefer `hammer_*`; existing scripts that call `gsd_*` continue to work. See [MCP Tool Aliases](#mcp-tool-aliases) below for the canonical list.

## Session Commands

| Command | Description |
|---------|-------------|
| `/hammer` | Step mode — execute one unit at a time, pause between each |
| `/hammer next` | Explicit step mode (same as `/hammer`) |
| `/hammer auto` | Autonomous mode — research, plan, execute, commit, repeat |
| `/hammer quick` | Execute a quick task with Hammer guarantees (atomic commits, state tracking) without full planning overhead |
| `/hammer stop` | Stop auto mode gracefully |
| `/hammer pause` | Pause auto-mode (preserves state, `/hammer auto` to resume) |
| `/hammer steer` | Hard-steer plan documents during execution |
| `/hammer discuss` | Discuss architecture and decisions (works alongside auto mode) |
| `/hammer status` | Progress dashboard |
| `/hammer widget` | Cycle dashboard widget: full / small / min / off |
| `/hammer queue` | Queue and reorder future milestones (safe during auto mode) |
| `/hammer capture` | Fire-and-forget thought capture (works during auto mode) |
| `/hammer triage` | Manually trigger triage of pending captures |
| `/hammer debug` | Create and inspect persistent /hammer debug sessions |
| `/hammer debug list` | List persisted debug sessions |
| `/hammer debug status <slug>` | Show status for one debug session slug |
| `/hammer debug continue <slug>` | Resume an existing debug session slug |
| `/hammer debug --diagnose` | Inspect malformed artifacts and session health (`--diagnose [<slug> | <issue text>]`) |
| `/hammer dispatch` | Dispatch a specific phase directly (research, plan, execute, complete, reassess, uat, replan) |
| `/hammer history` | View execution history (supports `--cost`, `--phase`, `--model` filters) |
| `/hammer forensics` | Full-access Hammer debugger — structured anomaly detection, unit traces, and LLM-guided root-cause analysis for auto-mode failures |
| `/hammer cleanup` | Clean up Hammer state files and stale worktrees |
| `/hammer visualize` | Open workflow visualizer (progress, deps, metrics, timeline) |
| `/hammer export --html` | Generate self-contained HTML report for current or completed milestone |
| `/hammer export --html --all` | Generate retrospective reports for all milestones at once |
| `/hammer update` | Update Hammer to the latest version in-session |
| `/hammer knowledge` | Add persistent project knowledge (rule, pattern, or lesson) |
| `/hammer extract-learnings <MID>` | Extract structured Decisions, Lessons, Patterns, and Surprises from a completed milestone — writes `<MID>-LEARNINGS.md` audit trail, appends Patterns and Lessons to `.gsd/KNOWLEDGE.md`, and persists Decisions via the DECISIONS database. Runs automatically at milestone completion. |
| `/hammer fast` | Toggle service tier for supported models (prioritized API routing) |
| `/hammer rate` | Rate last unit's model tier (over/ok/under) — improves adaptive routing |
| `/hammer changelog` | Show categorized release notes |
| `/hammer logs` | Browse activity logs, debug logs, and metrics |
| `/hammer remote` | Control remote auto-mode |
| `/hammer help` | Categorized command reference with descriptions for all Hammer subcommands |

## Configuration & Diagnostics

| Command | Description |
|---------|-------------|
| `/hammer prefs` | Model selection, timeouts, budget ceiling |
| `/hammer mode` | Switch workflow mode (solo/team) with coordinated defaults for milestone IDs, git commit behavior, and documentation |
| `/hammer config` | Re-run the provider setup wizard (LLM provider + tool keys) |
| `/hammer keys` | API key manager — list, add, remove, test, rotate, doctor |
| `/hammer doctor` | Runtime health checks with auto-fix — issues surface in real time across widget, visualizer, and HTML reports (v2.40) |
| `/hammer inspect` | Show SQLite DB diagnostics |
| `/hammer init` | Project init wizard — detect, configure, bootstrap `.gsd/` |
| `/hammer setup` | Global setup status and configuration |
| `/hammer skill-health` | Skill lifecycle dashboard — usage stats, success rates, token trends, staleness warnings |
| `/hammer skill-health <name>` | Detailed view for a single skill |
| `/hammer skill-health --declining` | Show only skills flagged for declining performance |
| `/hammer skill-health --stale N` | Show skills unused for N+ days |
| `/hammer hooks` | Show configured post-unit and pre-dispatch hooks |
| `/hammer run-hook` | Manually trigger a specific hook |
| `/hammer migrate` | Migrate a v1 `.planning` directory to `.gsd` format |

## Milestone Management

| Command | Description |
|---------|-------------|
| `/hammer new-milestone` | Create a new milestone |
| `/hammer skip` | Prevent a unit from auto-mode dispatch |
| `/hammer undo` | Revert last completed unit |
| `/hammer undo-task` | Reset a specific task's completion state (DB + markdown) |
| `/hammer reset-slice` | Reset a slice and all its tasks (DB + markdown) |
| `/hammer park` | Park a milestone — skip without deleting |
| `/hammer unpark` | Reactivate a parked milestone |
| Discard milestone | Available via `/hammer` wizard → "Milestone actions" → "Discard" |

## Parallel Orchestration

| Command | Description |
|---------|-------------|
| `/hammer parallel start` | Analyze eligibility, confirm, and start workers |
| `/hammer parallel status` | Show all workers with state, progress, and cost |
| `/hammer parallel stop [MID]` | Stop all workers or a specific milestone's worker |
| `/hammer parallel pause [MID]` | Pause all workers or a specific one |
| `/hammer parallel resume [MID]` | Resume paused workers |
| `/hammer parallel merge [MID]` | Merge completed milestones back to main |

See [Parallel Orchestration](./parallel-orchestration.md) for full documentation.

## Workflow Templates (v2.42)

| Command | Description |
|---------|-------------|
| `/hammer start` | Start a workflow template (bugfix, spike, feature, hotfix, refactor, security-audit, dep-upgrade, full-project) |
| `/hammer start resume` | Resume an in-progress workflow |
| `/hammer templates` | List available workflow templates |
| `/hammer templates info <name>` | Show detailed template info |

## Custom Workflows

The unified plugin system. Every workflow — bundled, user-authored, or
remotely installed — is discoverable via `/hammer workflow <name>` and declares
one of four execution modes:

| Mode              | What it does                                                                              |
|-------------------|-------------------------------------------------------------------------------------------|
| `oneshot`         | Prompt-only, no state, no branch. For reviews, triage, changelog generation.              |
| `yaml-step`       | Full engine with GRAPH.yaml, iterate, and shell-verify. For fan-out batch work.           |
| `markdown-phase`  | Multi-phase with STATE.json + phase-approval gates. For release, performance audit.       |
| `auto-milestone`  | Hooks into the full `/hammer auto` pipeline. Reserved for `full-project`.                    |

### Discovery order (project > global > bundled)

1. `.gsd/workflows/<name>.{yaml,md}` — project-local, checked into the repo.
2. `~/.gsd/workflows/<name>.{yaml,md}` — global, private to the machine.
3. Bundled — ships with Hammer (see the full list with `/hammer workflow`).

Legacy `.gsd/workflow-defs/` YAML definitions are still picked up for
backwards compatibility.

### Commands

| Command | Description |
|---------|-------------|
| `/hammer workflow` | List all discoverable plugins, grouped by mode |
| `/hammer workflow <name> [args]` | Run a plugin directly (resolved via precedence chain) |
| `/hammer workflow info <name>` | Show plugin metadata — source, mode, phases, path |
| `/hammer workflow new` | Create a new workflow definition (via the `create-workflow` skill) |
| `/hammer workflow install <source>` | Install a plugin from `https://...`, `gist:<id>`, or `gh:owner/repo/path[@ref]` |
| `/hammer workflow uninstall <name>` | Remove an installed plugin and its provenance record |
| `/hammer workflow run <name> [k=v]` | Explicit YAML run form (same as `/hammer workflow <name>` for yaml-step plugins) |
| `/hammer workflow list` | List YAML workflow runs (history) |
| `/hammer workflow validate <name>` | Validate a YAML definition |
| `/hammer workflow pause` | Pause custom workflow auto-mode |
| `/hammer workflow resume` | Resume paused custom workflow auto-mode |

### Bundled plugins

- **Phased (`markdown-phase`)**: `bugfix`, `small-feature`, `spike`, `hotfix`,
  `refactor`, `security-audit`, `dep-upgrade`, `release`, `api-breaking-change`,
  `performance-audit`, `observability-setup`, `ci-bootstrap`.
- **Oneshot**: `pr-review`, `changelog-gen`, `issue-triage`, `pr-triage`,
  `onboarding-check`, `dead-code`, `accessibility-audit`.
- **YAML engine (`yaml-step`)**: `test-backfill`, `docs-sync`, `rename-symbol`,
  `env-audit`.
- **Auto-milestone**: `full-project` (reached via `/hammer start full-project` or
  `/hammer auto`).

### Authoring a custom plugin

Run `/hammer workflow new <name>` to scaffold via the `create-workflow` skill.
Plugins are plain YAML (`.yaml`) or markdown (`.md`) files. See
`src/resources/extensions/gsd/workflow-templates/` for bundled examples.

## Extensions

| Command | Description |
|---------|-------------|
| `/hammer extensions list` | List all extensions and their status. User-installed entries show `[user]` plus the install source |
| `/hammer extensions enable <id>` | Enable a disabled extension |
| `/hammer extensions disable <id>` | Disable an extension |
| `/hammer extensions info <id>` | Show extension details |
| `/hammer extensions install <spec>` | Install a user extension. `<spec>` is an npm package, a git URL, or a local path. Restart Hammer to activate. (v2.78) |
| `/hammer extensions uninstall <id>` | Remove a user-installed extension. Warns if other extensions depend on it. (v2.78) |
| `/hammer extensions update [id]` | Update a single user-installed npm extension to its latest version, or all of them when `id` is omitted. Git/local installs are skipped — reinstall to update. (v2.78) |
| `/hammer extensions validate <path>` | Validate an extension package directory against the manifest schema before publishing or installing. (v2.78) |

Install sources are auto-detected: starts with `http(s)://` or ends with `.git` → git clone; contains `/` or `.` and exists on disk → local copy; otherwise → `npm pack`. Installed extensions land in `~/.gsd/extensions/<id>/` and the registry records the source so `update` can re-fetch.

## cmux Integration

| Command | Description |
|---------|-------------|
| `/hammer cmux status` | Show cmux detection, prefs, and capabilities |
| `/hammer cmux on` | Enable cmux integration |
| `/hammer cmux off` | Disable cmux integration |
| `/hammer cmux notifications on/off` | Toggle cmux desktop notifications |
| `/hammer cmux sidebar on/off` | Toggle cmux sidebar metadata |
| `/hammer cmux splits on/off` | Toggle cmux visual subagent splits |

## GitHub Sync (v2.39)

| Command | Description |
|---------|-------------|
| `/github-sync bootstrap` | Initial setup — creates GitHub Milestones, Issues, and draft PRs from current `.gsd/` state |
| `/github-sync status` | Show sync mapping counts (milestones, slices, tasks) |

Enable with `github.enabled: true` in preferences. Requires `gh` CLI installed and authenticated. Sync mapping is persisted in `.gsd/.github-sync.json`.

## Git Commands

| Command | Description |
|---------|-------------|
| `/worktree` (`/wt`) | Git worktree lifecycle — create, switch, merge, remove |

## Telegram Commands

The following commands are sent directly in your **Telegram chat** to a configured Hammer bot — they are not Hammer CLI commands. Telegram command polling runs every ~5 seconds while auto-mode is active. Each response is prefixed with the project name (e.g., `📁 MyProject`).

| Command | Description |
|---------|-------------|
| `/status` | Current milestone, active unit, and session cost |
| `/progress` | Roadmap overview — completed and open milestones |
| `/budget` | Token usage and cost for the current session |
| `/pause` | Pause auto-mode after the current unit finishes |
| `/resume` | Clear a pause directive and continue auto-mode |
| `/log [n]` | Last `n` activity log entries (default: 5) |
| `/help` | List all available Telegram commands |

**Requirements:** Telegram must be configured as your remote channel (`remote_questions.channel: telegram`). Commands are only processed while auto-mode is running. See [Remote Questions — Telegram Commands](./remote-questions.md#telegram-commands) for setup and details.

## Session Management

| Command | Description |
|---------|-------------|
| `/clear` | Start a new session (alias for `/new`) |
| `/exit` | Graceful shutdown — saves session state before exiting |
| `/kill` | Kill Hammer process immediately |
| `/model` | Switch the active model |
| `/login` | Log in to an LLM provider |
| `/thinking` | Toggle thinking level during sessions |
| `/voice` | Toggle real-time speech-to-text (macOS, Linux) |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+G` | Toggle dashboard overlay |
| `Ctrl+Alt+V` | Toggle voice transcription |
| `Ctrl+Alt+B` | Show background shell processes |
| `Ctrl+V` / `Alt+V` | Paste image from clipboard (screenshot → vision input) |
| `Escape` | Pause auto mode (preserves conversation) |

> **Note:** In terminals without Kitty keyboard protocol support (macOS Terminal.app, JetBrains IDEs), slash-command fallbacks are shown instead of `Ctrl+Alt` shortcuts.
>
> **Tip:** If `Ctrl+V` is intercepted by your terminal (e.g. Warp), use `Alt+V` instead for clipboard image paste.

## CLI Flags

| Flag | Description |
|------|-------------|
| `gsd` | Start a new interactive session |
| `gsd --continue` (`-c`) | Resume the most recent session for the current directory |
| `gsd --model <id>` | Override the default model for this session |
| `gsd --print "msg"` (`-p`) | Single-shot prompt mode (no TUI) |
| `gsd --mode <text\|json\|rpc\|mcp>` | Output mode for non-interactive use |
| `gsd --list-models [search]` | List available models and exit |
| `gsd --web [path]` | Start browser-based web interface (optional project path) |
| `gsd --worktree` (`-w`) [name] | Start session in a git worktree (auto-generates name if omitted) |
| `gsd --no-session` | Disable session persistence |
| `gsd --extension <path>` | Load an additional extension (can be repeated) |
| `gsd --append-system-prompt <text>` | Append text to the system prompt |
| `gsd --tools <list>` | Comma-separated list of tools to enable |
| `gsd --version` (`-v`) | Print version and exit |
| `gsd --help` (`-h`) | Print help and exit |
| `gsd sessions` | Interactive session picker — list all saved sessions for the current directory and choose one to resume |
| `gsd --debug` | Enable structured JSONL diagnostic logging for troubleshooting dispatch and state issues |
| `gsd config` | Set up global API keys for search and docs tools (saved to `~/.gsd/agent/auth.json`, applies to all projects). See [Global API Keys](./configuration.md#global-api-keys-gsd-config). |
| `gsd update` | Update Hammer to the latest version (binary name preserved verbatim) |
| `gsd headless new-milestone` | Create a new milestone from a context file (headless — no TUI required) |

## Headless Mode

`gsd headless` runs `/hammer` commands without a TUI — designed for CI, cron jobs, and scripted automation. It spawns a child process in RPC mode, auto-responds to interactive prompts, detects completion, and exits with meaningful exit codes.

```bash
# Run auto mode (default)
gsd headless

# Run a single unit
gsd headless next

# Instant JSON snapshot — no LLM, ~50ms
gsd headless query

# With timeout for CI
gsd headless --timeout 600000 auto

# Force a specific phase
gsd headless dispatch plan

# Create a new milestone from a context file and start auto mode
gsd headless new-milestone --context brief.md --auto

# Create a milestone from inline text
gsd headless new-milestone --context-text "Build a REST API with auth"

# Pipe context from stdin
echo "Build a CLI tool" | gsd headless new-milestone --context -
```

| Flag | Description |
|------|-------------|
| `--timeout N` | Overall timeout in milliseconds (default: 300000 / 5 min) |
| `--max-restarts N` | Auto-restart on crash with exponential backoff (default: 3). Set 0 to disable |
| `--json` | Stream all events as JSONL to stdout |
| `--model ID` | Override the model for the headless session |
| `--context <file>` | Context file for `new-milestone` (use `-` for stdin) |
| `--context-text <text>` | Inline context text for `new-milestone` |
| `--auto` | Chain into auto-mode after milestone creation |

**Exit codes:** `0` = complete, `1` = error or timeout, `2` = blocked.

Any `/hammer` subcommand works as a positional argument — `gsd headless status`, `gsd headless doctor`, `gsd headless dispatch execute`, etc.

### `gsd headless query`

Returns a single JSON object with the full project snapshot — no LLM session, no RPC child, instant response (~50ms). This is the recommended way for orchestrators and scripts to inspect Hammer state.

```bash
gsd headless query | jq '.state.phase'
# "executing"

gsd headless query | jq '.next'
# {"action":"dispatch","unitType":"execute-task","unitId":"M001/S01/T03"}

gsd headless query | jq '.cost.total'
# 4.25
```

**Output schema:**

```json
{
  "state": {
    "phase": "executing",
    "activeMilestone": { "id": "M001", "title": "..." },
    "activeSlice": { "id": "S01", "title": "..." },
    "activeTask": { "id": "T01", "title": "..." },
    "registry": [{ "id": "M001", "status": "active" }, ...],
    "progress": { "milestones": { "done": 0, "total": 2 }, "slices": { "done": 1, "total": 3 } },
    "blockers": []
  },
  "next": {
    "action": "dispatch",
    "unitType": "execute-task",
    "unitId": "M001/S01/T01"
  },
  "cost": {
    "workers": [{ "milestoneId": "M001", "cost": 1.50, "state": "running", ... }],
    "total": 1.50
  }
}
```

## MCP Server Mode

`gsd --mode mcp` runs Hammer as a [Model Context Protocol](https://modelcontextprotocol.io) server over stdin/stdout. This exposes all Hammer tools (read, write, edit, bash, etc.) to external AI clients — Claude Desktop, VS Code Copilot, and any MCP-compatible host. The CLI binary name `gsd` is preserved verbatim.

```bash
# Start Hammer as an MCP server
gsd --mode mcp
```

The server registers all tools from the agent session and maps MCP `tools/list` and `tools/call` requests to Hammer tool definitions. It runs until the transport closes.

## In-Session Update

`/hammer update` checks npm for a newer version of Hammer and installs it without leaving the session.

```bash
/hammer update
# Current version: v2.36.0
# Checking npm registry...
# Updated to v2.37.0. Restart Hammer to use the new version.
```

If already up to date, it reports so and takes no action.

## Export

`/hammer export` generates reports of milestone work.

```bash
# Generate HTML report for the active milestone
/hammer export --html

# Generate retrospective reports for ALL milestones at once
/hammer export --html --all
```

Reports are saved to `.gsd/reports/` with a browseable `index.html` that links to all generated snapshots.

## MCP Tool Aliases

Hammer exposes its MCP tool surface under two names: the historical `gsd_*` prefix (preserved verbatim from the GSD-2 fork point) and the new `hammer_*` prefix. Both dispatch to the same handler — calling `gsd_complete_task` and calling `hammer_complete_task` are equivalent. New automation should prefer `hammer_*`; existing scripts and prompts that call `gsd_*` continue to work without modification.

The dual-alias surface exists so the rebrand can ship without breaking external orchestrators, in-tree prompts, and the embedded skill catalog. Removing the `gsd_*` prefix is a separate, deliberately deferred breaking change.

| Canonical (preferred) | Legacy alias (still works) | What it does |
|-----------------------|----------------------------|--------------|
| `hammer_decision_save` | `gsd_decision_save`, `gsd_save_decision` | Record a project decision; auto-assigns ID; regenerates `.gsd/DECISIONS.md`. |
| `hammer_requirement_save` | `gsd_requirement_save`, `gsd_save_requirement` | Record a new requirement; auto-assigns ID; regenerates `.gsd/REQUIREMENTS.md`. |
| `hammer_requirement_update` | `gsd_requirement_update`, `gsd_update_requirement` | Update fields on an existing requirement by ID. |
| `hammer_summary_save` | `gsd_summary_save`, `gsd_save_summary` | Persist a `SUMMARY` / `RESEARCH` / `CONTEXT` / `ASSESSMENT` artifact to disk and DB. |
| `hammer_milestone_generate_id` | `gsd_milestone_generate_id`, `gsd_generate_milestone_id` | Generate a valid milestone ID respecting `unique_milestone_ids`. |
| `hammer_plan_milestone` | `gsd_plan_milestone`, `gsd_milestone_plan` | Plan a milestone (DB write + roadmap render + cache invalidation). |
| `hammer_plan_slice` | `gsd_plan_slice`, `gsd_slice_plan` | Plan a slice (DB write + `PLAN.md` render). |
| `hammer_plan_task` | `gsd_plan_task`, `gsd_task_plan` | Plan a task (DB write + task `PLAN.md` render). |
| `hammer_complete_task` | `gsd_complete_task`, `gsd_task_complete` | Complete a task (DB + summary render + checkbox toggle). |
| `hammer_complete_slice` | `gsd_complete_slice`, `gsd_slice_complete` | Complete a slice (DB + summary/UAT + roadmap toggle). |
| `hammer_skip_slice` | `gsd_skip_slice` | Mark a slice as skipped; satisfies downstream dependencies like a complete. |
| `hammer_complete_milestone` | `gsd_complete_milestone`, `gsd_milestone_complete` | Complete a milestone (DB + summary). |
| `hammer_validate_milestone` | `gsd_validate_milestone`, `gsd_milestone_validate` | Validate a milestone (DB + `VALIDATION.md` render). |
| `hammer_replan_slice` | `gsd_replan_slice`, `gsd_slice_replan` | Replan a slice with structural enforcement of completed tasks. |
| `hammer_reassess_roadmap` | `gsd_reassess_roadmap`, `gsd_roadmap_reassess` | Reassess a roadmap with structural enforcement of completed slices. |
| `hammer_save_gate_result` | `gsd_save_gate_result` | Save a quality-gate evaluation result. |
| `hammer_journal_query` | `gsd_journal_query` | Query the event journal with filters. |
| `hammer_milestone_status` | `gsd_milestone_status` | Read milestone / slice / task status from DB. |
| `hammer_checkpoint_db` | `gsd_checkpoint_db` | Flush WAL into `gsd.db` so `git add` stages the current state. |
| `hammer_capture_thought` | `gsd_capture_thought` | Capture a durable insight to the memory store. |
| `hammer_memory_query` | `gsd_memory_query` | Search the memory store by keyword. |
| `hammer_graph` | `gsd_graph` | Query / rebuild the memory relationship graph. |
| `hammer_exec` | `gsd_exec` | Run a sandboxed bash/node/python script; full output saved to disk. |
| `hammer_exec_search` | `gsd_exec_search` | Search prior `hammer_exec` runs. |
| `hammer_resume` | `gsd_resume` | Read the pre-compaction snapshot for re-orientation after context loss. |

The IAM awareness surface (`hammer_recall`, `hammer_quick`, `hammer_refract`, `hammer_spiral`, `hammer_canonical_spiral`, `hammer_explore`, `hammer_bridge`, `hammer_compare`, `hammer_cluster`, `hammer_landscape`, `hammer_tension`, `hammer_rune`, `hammer_validate`, `hammer_assess`, `hammer_compile`, `hammer_harvest`, `hammer_remember`, `hammer_provenance`, `hammer_check`, `hammer_volvox_epoch`, `hammer_volvox_status`, `hammer_volvox_diagnose`) follows the same dual-alias rule — every `hammer_*` IAM tool also responds to its historical `gsd_*` name. Prefer the canonical `hammer_*` form in new prompts.
