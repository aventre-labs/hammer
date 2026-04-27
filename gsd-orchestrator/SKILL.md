---
name: gsd-orchestrator
description: >
  Build software products autonomously by orchestrating Hammer headless mode.
  Handles the full lifecycle: write a spec, launch a build, poll for completion,
  handle blockers, track costs, and verify the result. Use when asked to
  "build something", "create a project", "run hammer", "check build status",
  or any task that requires autonomous software development via subprocess.
metadata:
  openclaw:
    requires:
      bins: [hammer]
    install:
      kind: node
      package: hammer-pi
      bins: [hammer, hammer-pi]
---

<objective>
You are an autonomous agent that builds software by orchestrating Hammer as a subprocess.
Hammer is a headless CLI that plans, codes, tests, and ships software from a spec.
You control it with shell commands, exit codes, JSON output, and state files — no SDK, no RPC.
</objective>

<reader_contract>
This skill is for future agents running unattended builds. After reading it, an agent should be able to create a Hammer spec, launch `hammer headless`, monitor progress, handle blockers, and verify deliverables without writing application code itself.
</reader_contract>

<awareness_contract>
Hammer/IAM awareness is required. Preserve provenance for specs, commands, JSON results, answer files, and remediation decisions. Missing IAM/Omega/Trinity/VOLVOX evidence, absent provenance, or failed no-degradation proof is a blocker signal. Do not silently fallback to lower-quality work or hide the missing awareness artifact.
</awareness_contract>

<mental_model>
Hammer headless is a subprocess you launch and monitor. Think of it like a junior developer you hand a spec to:

1. You write the spec with user outcomes, constraints, provenance, and verification expectations.
2. You launch the build (`hammer headless --output-format json --context spec.md new-milestone --auto`).
3. You wait for it to finish; the process exit code tells you the outcome.
4. You query state, inspect files, and verify deliverables.
5. If blocked, you intervene with steering, answer injection, replanning, or human escalation.

The subprocess handles planning, coding, testing, artifact summaries, and commits internally. You do not write application code yourself unless explicitly asked to stop orchestrating and become the implementer.
</mental_model>

<critical_rules>
- **Current command surface is Hammer.** Use `hammer`, `hammer-pi`, `hammer headless`, and `/hammer` for current behavior.
- **Flags before command.** `hammer headless [--flags] [command] [args]`. Flags after the command are ignored.
- **Redirect stderr when parsing JSON.** JSON output goes to stdout. Progress and diagnostics go to stderr. Use `2>/dev/null` only when you need machine-readable stdout.
- **Check exit codes.** `0` = success, `1` = error or timeout, `10` = blocked, `11` = cancelled.
- **Use `query` to poll.** It is instant, free of LLM cost, and safe for tight polling loops.
- **Budget awareness.** Track `cost.total` from query or result JSON. Set limits before long runs.
- **One project directory per build.** Each Hammer project has one canonical `.hammer/` state tree.
- **Legacy state bridge only.** `.gsd` may exist as a legacy state bridge in older projects; never create it as the canonical state root for new work.
- **No-degradation remediation.** When a blocker names missing awareness, verification, or provenance, inspect the evidence and remediate deliberately instead of accepting a weaker result.
</critical_rules>

<routing>
Route based on what you need to do:

**Build something from scratch:**
Read `workflows/build-from-spec.md` — write spec, init directory, launch, monitor, verify.

**Check on a running or completed build:**
Read `workflows/monitor-and-poll.md` — query state, interpret phases, handle blockers.

**Execute with fine-grained control:**
Read `workflows/step-by-step.md` — run one unit at a time with decision points.

**Understand the JSON output:**
Read `references/json-result.md` — field reference for `HeadlessJsonResult`.

**Pre-supply answers or secrets:**
Read `references/answer-injection.md` — answer file schema, secret handling, and injection mechanics.

**Look up a specific command:**
Read `references/commands.md` — command reference with flags and examples.
</routing>

<quick_reference>

**Launch a full build from spec to working code:**
```bash
mkdir -p /tmp/my-project && cd /tmp/my-project && git init
cat > spec.md << 'EOF'
# Product Spec

Build a user-visible capability with explicit outcomes, constraints, verification,
and IAM/Omega/Trinity/VOLVOX provenance expectations.
EOF
RESULT=$(hammer headless --output-format json --context spec.md new-milestone --auto 2>/dev/null)
EXIT=$?
```

**Check project state without spending LLM budget:**
```bash
cd /path/to/project
hammer headless query | jq '{phase: .state.phase, progress: .state.progress, cost: .cost.total}'
```

**Resume work on an existing project:**
```bash
cd /path/to/project
hammer headless --output-format json auto 2>/dev/null
```

**Run one step at a time:**
```bash
RESULT=$(hammer headless --output-format json next 2>/dev/null)
EXIT=$?
echo "$RESULT" | jq '{status: .status, phase: .phase, cost: .cost.total}'
```

</quick_reference>

<exit_codes>
| Code | Meaning | Your action |
|------|---------|-------------|
| `0`  | Success | Check deliverables, verify output, and report completion with evidence. |
| `1`  | Error or timeout | Inspect stderr and `.hammer/STATE.md`; retry only after a specific hypothesis or escalate. |
| `10` | Blocked | Query state for blocker details; steer, inject answers, replan, or escalate. Missing IAM/no-degradation artifacts belong here. |
| `11` | Cancelled | Process was interrupted; resume with `--resume <sessionId>` when available or restart from state. |
</exit_codes>

<project_structure>
Hammer creates and manages canonical state in `.hammer/`:
```
.hammer/
  PROJECT.md          # What this project is
  REQUIREMENTS.md     # Capability contract
  DECISIONS.md        # Architectural decisions
  KNOWLEDGE.md        # Persistent project knowledge
  STATE.md            # Current phase, next action, and blocker context
  milestones/
    M001-xxxxx/
      M001-xxxxx-CONTEXT.md    # Scope, constraints, assumptions
      M001-xxxxx-ROADMAP.md    # Slices with checkboxes
      M001-xxxxx-SUMMARY.md    # Completion summary
      slices/S01/
        S01-PLAN.md            # Tasks
        S01-SUMMARY.md         # Slice summary
        tasks/
          T01-PLAN.md          # Individual task spec
          T01-SUMMARY.md       # Task completion summary
```

State is derived from files on disk. Checkboxes in roadmap and plan artifacts are completion evidence, but Hammer manages them. Read these files to understand progress; do not edit them behind Hammer's back.

Some existing projects may still contain `.gsd/` as a legacy state bridge while `.hammer/` is canonical. Treat that spelling as compatibility/migration evidence only, never as current product language.
</project_structure>

<flags>
| Flag | Description |
|------|-------------|
| `--output-format <fmt>` | `text` (default), `json` (single structured result at exit), or `stream-json` (JSONL events). |
| `--json` | Alias for `--output-format stream-json`; writes JSONL events to stdout. |
| `--bare` | Skip CLAUDE.md, AGENTS.md, user settings, and user skills. Use for CI/ecosystem runs. |
| `--resume <id>` | Resume a prior headless session by session ID or unique prefix. |
| `--timeout N` | Overall timeout in ms. Default is command-dependent; `0` disables the outer timeout. |
| `--model ID` | Override the LLM model. |
| `--supervised` | Forward interactive UI requests to the orchestrator through stdout/stdin. |
| `--response-timeout N` | Timeout in ms for supervised responses; default is 30000. |
| `--answers <path>` | Pre-supply answers and secrets from a JSON file. |
| `--events <types>` | Filter JSONL to specific event types, comma-separated; implies `--json`. |
| `--verbose` | Show tool calls in progress output. |
| `--context <path>` | Spec file path for `new-milestone`; use `-` for stdin. |
| `--context-text <text>` | Inline spec text for `new-milestone`. |
| `--auto` | Chain into auto-mode after `new-milestone`. |
</flags>

<answer_injection>
Pre-supply answers and secrets for fully autonomous runs:

```bash
hammer headless --answers answers.json --output-format json auto 2>/dev/null
```

```json
{
  "questions": { "question_id": "selected_option" },
  "secrets": { "API_KEY": "<redacted>" },
  "defaults": { "strategy": "first_option" }
}
```

- `questions` maps question IDs to answers. Use a string for single-select and a string array for multi-select.
- `secrets` maps env var names to values injected into the Hammer child process. Never print the values in logs, examples, or reports.
- `defaults.strategy` is `"first_option"` or `"cancel"` for unmatched questions.

See `references/answer-injection.md` for the full mechanism.
</answer_injection>

<event_streaming>
For real-time monitoring, use JSONL event streaming:

```bash
hammer headless --json auto 2>/dev/null | while read -r line; do
  TYPE=$(echo "$line" | jq -r '.type')
  case "$TYPE" in
    tool_execution_start) echo "Tool: $(echo "$line" | jq -r '.toolName')" ;;
    extension_ui_request) echo "Hammer: $(echo "$line" | jq -r '.message // .title // empty')" ;;
    agent_end) echo "Session ended" ;;
  esac
done
```

Filter to specific events: `--events agent_end,execution_complete,extension_ui_request`.

Common event types: `agent_start`, `agent_end`, `tool_execution_start`, `tool_execution_end`, `tool_execution_update`, `extension_ui_request`, `message_start`, `message_end`, `message_update`, `turn_start`, `turn_end`, `cost_update`, and `execution_complete`.
</event_streaming>

<all_commands>
| Command | Purpose |
|---------|---------|
| `auto` | Run queued units until milestone completion or blocker. |
| `next` | Run exactly one unit, then exit. |
| `query` | Instant JSON snapshot: state, next dispatch, and costs. |
| `new-milestone` | Create a milestone from a spec file or inline spec. |
| `dispatch <phase>` | Force a specific phase such as research, plan, execute, complete, reassess, uat, or replan. |
| `stop` / `pause` | Stop or pause auto-mode. |
| `steer <desc>` | Hard-steer plan documents mid-execution. |
| `skip` / `undo` | Control the active unit. |
| `queue` | Queue or reorder milestones. |
| `history` | View execution history. |
| `doctor` | Run health checks and surface auto-fix guidance. |
| `knowledge <rule>` | Add persistent project knowledge. |

See `references/commands.md` for the complete command reference.
</all_commands>
