# Commands

> **Fork bridge.** Hammer is a fork of GSD-2. The slash command surface is **dual** — every command listed below as `/hammer …` is also available as `/gsd …` and dispatches to the same handler. The `/gsd` form is preserved verbatim so existing scripts, runbooks, and muscle memory keep working. New material in this book uses `/hammer` as the canonical form. The `gsd_*` MCP tool prefixes are also preserved as canonical (each is also exposed under a `hammer_*` alias for the same handler).

## Session Commands

| Command | Description |
|---------|-------------|
| `/hammer` | Step mode — execute one unit at a time |
| `/hammer auto` | Autonomous mode — research, plan, execute, commit, repeat |
| `/hammer quick` | Quick task with Hammer guarantees but no full planning |
| `/hammer stop` | Stop auto mode gracefully |
| `/hammer pause` | Pause auto mode (preserves state) |
| `/hammer steer` | Modify plan documents during execution |
| `/hammer discuss` | Discuss architecture and decisions |
| `/hammer status` | Progress dashboard |
| `/hammer widget` | Cycle dashboard widget: full / small / min / off |
| `/hammer queue` | Queue and reorder future milestones |
| `/hammer capture` | Fire-and-forget thought capture |
| `/hammer triage` | Manually trigger capture triage |
| `/hammer debug` | Create and inspect persistent `/hammer debug` sessions |
| `/hammer debug list` | List persisted debug sessions |
| `/hammer debug status <slug>` | Show status for one debug session slug |
| `/hammer debug continue <slug>` | Resume an existing debug session slug |
| `/hammer debug --diagnose` | Inspect malformed artifacts and session health (`--diagnose [<slug> | <issue text>]`) |
| `/hammer dispatch` | Dispatch a specific phase directly |
| `/hammer history` | View execution history (supports `--cost`, `--phase`, `--model` filters) |
| `/hammer forensics` | Full debugger for auto-mode failures (includes worktree lifecycle telemetry) |
| `/hammer cleanup` | Clean up state files and stale worktrees |
| `/hammer visualize` | Open workflow visualizer |
| `/hammer export --html` | Generate HTML report for current milestone |
| `/hammer export --html --all` | Generate reports for all milestones |
| `/hammer update` | Update Hammer to the latest version |
| `/hammer knowledge` | Add persistent project knowledge |
| `/hammer fast` | Toggle service tier for supported models |
| `/hammer rate` | Rate last unit's model tier (over/ok/under) |
| `/hammer changelog` | Show release notes |
| `/hammer logs` | Browse activity and debug logs |
| `/hammer remote` | Control remote auto-mode |
| `/hammer help` | Show all available commands |

> Every entry above is also reachable as `/gsd …` (e.g. `/gsd auto`, `/gsd status`).

## Configuration & Diagnostics

| Command | Description |
|---------|-------------|
| `/hammer prefs` | Preferences wizard |
| `/hammer mode` | Switch workflow mode (solo/team) |
| `/hammer config` | Re-run provider setup wizard |
| `/hammer keys` | API key manager |
| `/hammer doctor` | Runtime health checks with auto-fix |
| `/hammer inspect` | Show database diagnostics |
| `/hammer init` | Project init wizard |
| `/hammer setup` | Global setup status |
| `/hammer skill-health` | Skill lifecycle dashboard |
| `/hammer hooks` | Show configured hooks |
| `/hammer migrate` | Migrate v1 `.planning` to `.gsd` format |

## Milestone Management

| Command | Description |
|---------|-------------|
| `/hammer new-milestone` | Create a new milestone |
| `/hammer skip` | Prevent a unit from auto-mode dispatch |
| `/hammer undo` | Revert last completed unit |
| `/hammer undo-task` | Reset a specific task's completion state |
| `/hammer reset-slice` | Reset a slice and all its tasks |
| `/hammer park` | Park a milestone (skip without deleting) |
| `/hammer unpark` | Reactivate a parked milestone |

## Parallel Orchestration

| Command | Description |
|---------|-------------|
| `/hammer parallel start` | Analyze and start parallel workers |
| `/hammer parallel status` | Show worker state and progress |
| `/hammer parallel stop [MID]` | Stop workers |
| `/hammer parallel pause [MID]` | Pause workers |
| `/hammer parallel resume [MID]` | Resume workers |
| `/hammer parallel merge [MID]` | Merge completed milestones |

## Workflow Templates

| Command | Description |
|---------|-------------|
| `/hammer start` | Start a workflow template |
| `/hammer start resume` | Resume an in-progress workflow |
| `/hammer templates` | List available templates |
| `/hammer templates info <name>` | Show template details |

## Custom Workflows

| Command | Description |
|---------|-------------|
| `/hammer workflow new` | Create a workflow definition |
| `/hammer workflow run <name>` | Start a workflow run |
| `/hammer workflow list` | List workflow runs |
| `/hammer workflow validate <name>` | Validate a workflow YAML |
| `/hammer workflow pause` | Pause workflow auto-mode |
| `/hammer workflow resume` | Resume paused workflow |

## Extensions

| Command | Description |
|---------|-------------|
| `/hammer extensions list` | List all extensions |
| `/hammer extensions enable <id>` | Enable an extension |
| `/hammer extensions disable <id>` | Disable an extension |
| `/hammer extensions info <id>` | Show extension details |

## GitHub Sync

| Command | Description |
|---------|-------------|
| `/github-sync bootstrap` | Initial GitHub sync setup |
| `/github-sync status` | Show sync mapping counts |

## Session Management

| Command | Description |
|---------|-------------|
| `/clear` | Start a new session |
| `/exit` | Graceful shutdown |
| `/model` | Switch the active model |
| `/login` | Log in to an LLM provider |
| `/thinking` | Toggle thinking level |
| `/voice` | Toggle speech-to-text |
| `/worktree` (`/wt`) | Git worktree management |

## In-Session Update

```
/hammer update
```

Checks npm for a newer version of the `gsd-pi` package (the npm name is preserved verbatim from GSD-2 — see the fork bridge note above) and installs it without leaving the session.

## MCP Tool Aliases

The MCP server exposes every workflow tool under both prefixes — `gsd_*` (canonical, preserved from GSD-2) and `hammer_*` (alias). Both names dispatch to the same handler. Examples:

| Canonical | Alias | Purpose |
|-----------|-------|---------|
| `gsd_complete_task` | `hammer_complete_task` | Mark a task complete and render its summary |
| `gsd_plan_slice` | `hammer_plan_slice` | Plan a slice |
| `gsd_canonical_spiral` | `hammer_canonical_spiral` | Run the 10-stage Omega Protocol |
| `gsd_journal_query` | `hammer_journal_query` | Query the event journal |
