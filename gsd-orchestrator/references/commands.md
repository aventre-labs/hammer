# Hammer Commands Reference

> Hammer/IAM awareness: use these commands with provenance checks and no-degradation remediation when blockers appear. The current command surface is `hammer headless` and `/hammer`; legacy spellings are compatibility bridges only.

All commands run as subprocesses via `hammer headless [flags] [command] [args...]`.

## Global Flags

These flags apply to any `hammer headless` invocation. Put flags before the command.

| Flag | Description |
|------|-------------|
| `--output-format <fmt>` | `text` (default), `json` (single structured result at exit), or `stream-json` (JSONL events). |
| `--json` | Alias for `--output-format stream-json`. |
| `--bare` | Minimal context: skip CLAUDE.md, AGENTS.md, user settings, and user skills. |
| `--resume <id>` | Resume a prior headless session by ID or unique prefix. |
| `--timeout N` | Overall timeout in ms; use `0` to disable the outer timeout. |
| `--model ID` | Override model. |
| `--supervised` | Forward interactive UI requests to the orchestrator over stdout/stdin. |
| `--response-timeout N` | Timeout for orchestrator response in supervised mode; default is 30000ms. |
| `--answers <path>` | Pre-supply answers and secrets from JSON file. |
| `--events <types>` | Filter JSONL output to specific event types, comma-separated; implies `--json`. |
| `--verbose` | Show tool calls in progress output. |

## Exit Codes

| Code | Meaning | When | Orchestrator response |
|------|---------|------|-----------------------|
| `0` | Success | Unit, command, or milestone completed normally. | Verify deliverables and report evidence. |
| `1` | Error or timeout | Runtime error, LLM failure, malformed input, or `--timeout` exceeded. | Inspect stderr and `.hammer/STATE.md`; retry only with a specific remediation or escalate. |
| `10` | Blocked | Execution hit a blocker requiring intervention. | Query state, inspect blocker payload, and resolve with steering, answers, replanning, or human escalation. |
| `11` | Cancelled | User or orchestrator cancelled the operation. | Resume with `--resume <id>` when available, or restart from `.hammer` state. |

Missing IAM/Omega/Trinity/VOLVOX evidence, absent provenance, and failed no-degradation checks should be treated as structured blockers. Do not convert them into success by accepting weaker behavior.

## Workflow Commands

### `auto` (default)

Autonomous mode loops through queued units until the milestone is complete or blocked.

```bash
hammer headless --output-format json auto
```

Use `auto` when the spec is good, the budget is acceptable, and you do not need decision points between units.

### `next`

Step mode executes exactly one unit, then exits. Use this when you need budget checks, progress reporting, or remediation decisions between units.

```bash
hammer headless --output-format json next
```

### `new-milestone`

Create a milestone from a specification document. The spec should include user outcomes, technical constraints, out-of-scope boundaries, verification expectations, and IAM/provenance requirements.

```bash
hammer headless new-milestone --context spec.md
hammer headless new-milestone --context spec.md --auto
hammer headless new-milestone --context-text "Build a REST API" --auto
cat spec.md | hammer headless new-milestone --context - --auto
```

Extra flags:
- `--context <path>` — path to spec/PRD file; use `-` for stdin.
- `--context-text <text>` — inline specification text.
- `--auto` — start auto-mode after milestone creation.

### `dispatch <phase>`

Force-route to a specific phase, bypassing normal state-machine routing. Use only when the queried state and remediation plan justify it.

```bash
hammer headless dispatch research
hammer headless dispatch plan
hammer headless dispatch execute
hammer headless dispatch complete
hammer headless dispatch reassess
hammer headless dispatch uat
hammer headless dispatch replan
```

### `discuss`

Start guided milestone or slice discussion.

```bash
hammer headless discuss
```

### `stop`

Stop auto-mode gracefully.

```bash
hammer headless stop
```

### `pause`

Pause auto-mode while preserving state for later resumption.

```bash
hammer headless pause
```

## State Inspection

### `query`

`query` returns an instant JSON snapshot: state, next dispatch, progress, and costs. It does not spend LLM budget and is the recommended polling command.

```bash
hammer headless query
hammer headless query | jq '.state.phase'
hammer headless query | jq '.next'
hammer headless query | jq '.cost.total'
```

### `status`

Progress dashboard. Useful interactively; prefer `query` for parsing.

```bash
hammer headless status
```

### `history`

Execution history. Supports cost, phase, model, and limit arguments.

```bash
hammer headless history
```

## Unit Control

### `skip`

Prevent the active unit from auto-mode dispatch.

```bash
hammer headless skip
```

Use only with an explicit rationale. Skipping missing IAM/no-degradation work without remediation is a product-quality regression.

### `undo`

Revert the last completed unit. Use `--force` to bypass confirmation in non-interactive orchestrator contexts.

```bash
hammer headless undo
hammer headless undo --force
```

### `steer <description>`

Hard-steer plan documents during execution. Use for mid-course corrections after inspecting state.

```bash
hammer headless steer "Replan around the unavailable database dependency and preserve the no-degradation requirement."
```

### `queue`

Queue and reorder future milestones.

```bash
hammer headless queue
```

## Configuration & Health

### `doctor`

Runtime health checks with auto-fix guidance.

```bash
hammer headless doctor
```

### `prefs`

Manage preferences: global, project, status, wizard, and setup.

```bash
hammer headless prefs
```

### `knowledge <rule|pattern|lesson>`

Add persistent project knowledge.

```bash
hammer headless knowledge "Always use UTC timestamps in API responses"
```

## Phases

Hammer workflows progress through these phases:

```
pre-planning → needs-discussion → discussing → researching → planning →
executing → verifying → summarizing → advancing → validating-milestone →
completing-milestone → complete
```

Special phases: `paused`, `blocked`, `replanning-slice`.

## Hierarchy

- **Milestone**: Shippable version, usually several slices.
- **Slice**: One demoable vertical capability.
- **Task**: One context-window-sized unit of work.

## Compatibility Bridge Notes

- `/hammer` is the current slash-command surface. `/gsd` is accepted only as a legacy alias for compatibility, not as canonical documentation prose.
- `.hammer` is the canonical state namespace. `.gsd` may be read only as a legacy state bridge in older projects.
- DB-backed `gsd_*` tool names may still appear in internal execution-substrate docs only when a line explicitly marks them as legacy/tool-name compatibility bridges.
