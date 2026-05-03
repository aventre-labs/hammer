# Auto Mode

Auto mode is Hammer's autonomous execution engine. Run `/hammer auto`, walk away, come back to built software with clean git history. Auto-mode is intentionally **unsafe-by-default** — there are no per-phase human checkpoints unless `require_slice_discussion: true` is set explicitly. The recover-and-resume loop's 3-strike cap (see [below](#recover-and-resume)) is the only structural guardrail between the agent and a long sequence of file/shell/git operations.

## How It Works

Auto mode is a **state machine driven by files on disk**. It reads `.gsd/STATE.md`, determines the next unit of work, creates a fresh agent session, injects a focused prompt with all relevant context pre-inlined, and lets the LLM execute. When the LLM finishes, auto mode reads disk state again and dispatches the next unit.

### The Loop

Each slice flows through phases automatically:

```
Plan (with integrated research) → Execute (per task) → Complete → Reassess Roadmap → Next Slice
                                                                                      ↓ (all slices done)
                                                                              Validate Milestone → Complete Milestone
```

- **Plan** — scouts the codebase, researches relevant docs, and decomposes the slice into tasks with must-haves
- **Execute** — runs each task in a fresh context window
- **Complete** — writes summary, UAT script, marks roadmap, commits
- **Reassess** — checks if the roadmap still makes sense
- **Validate Milestone** — reconciliation gate after all slices complete; compares roadmap success criteria against actual results, catches gaps before sealing the milestone

## Key Properties

### Fresh Session Per Unit

Every task, research phase, and planning step gets a clean context window. No accumulated garbage. No degraded quality from context bloat. The dispatch prompt includes everything needed — task plans, prior summaries, dependency context, decisions register — so the LLM starts oriented instead of spending tool calls reading files.

### Runtime Tool Policy

Each auto-mode unit has a `UnitContextManifest` with a `ToolsPolicy`, and Hammer enforces that policy before tool calls execute. Execution units use `all` mode and may edit project files, run shell commands, and dispatch subagents. Planning and discussion units use `planning` mode: they can read broadly, write planning artifacts under `.gsd/`, run only read-only shell commands, and cannot dispatch subagents. Documentation units use `docs` mode, which keeps the same restrictions but also allows writes to the manifest's explicit documentation globs such as `docs/**`, top-level `README*.md`, `CHANGELOG.md`, and top-level `*.md`.

Writes outside those allowed paths, unsafe bash commands, and subagent dispatch from non-execution units are blocked with a hard policy error instead of relying on prompt compliance.

### Context Pre-Loading

The dispatch prompt is carefully constructed with:

| Inlined Artifact | Purpose |
|------------------|---------|
| Task plan | What to build |
| Slice plan | Where this task fits |
| Prior task summaries | What's already done |
| Dependency summaries | Cross-slice context |
| Roadmap excerpt | Overall direction |
| Decisions register | Architectural context |

The amount of context inlined is controlled by your [token profile](./token-optimization.md). Budget mode inlines minimal context; quality mode inlines everything.

### Git Isolation

Hammer isolates milestone work using one of three modes (configured via `git.isolation` in preferences):

- **`worktree`** (default): Each milestone runs in its own git worktree at `.gsd/worktrees/<MID>/` on a `milestone/<MID>` branch. All slice work commits sequentially — no branch switching, no merge conflicts mid-milestone. When the milestone completes, it's squash-merged to main as one clean commit.
- **`branch`**: Work happens in the project root on a `milestone/<MID>` branch. Useful for submodule-heavy repos where worktrees don't work well.
- **`none`**: Work happens directly on your current branch. No worktree, no milestone branch. Ideal for hot-reload workflows where file isolation breaks dev tooling.

See [Git Strategy](./git-strategy.md) for details.

### Parallel Execution

When your project has independent milestones, you can run them simultaneously. Each milestone gets its own worker process and worktree. See [Parallel Orchestration](./parallel-orchestration.md) for setup and usage.

### Crash Recovery

A lock file tracks the current unit. If the session dies, the next `/hammer auto` reads the surviving session file, synthesizes a recovery briefing from every tool call that made it to disk, and resumes with full context.

**Headless auto-restart (v2.26):** When running `gsd headless auto`, crashes trigger automatic restart with exponential backoff (5s → 10s → 30s cap, default 3 attempts). Configure with `--max-restarts N`. SIGINT/SIGTERM bypasses restart. Combined with crash recovery, this enables true overnight "run until done" execution.

### Recover-and-Resume

Hammer's recover-and-resume loop is the **only structural guardrail** in the no-guardrails posture, and it is load-bearing for any unattended run longer than a few minutes. It is intentionally distinct from generic "crash recovery" — it is a bounded loop with a verdict trailer and a strike counter, designed to fail closed rather than spin forever.

**The dispatch-recovery briefing.** When `/hammer auto` resumes after a crash, kill, terminal close, or pause, Hammer reconstructs the prior unit's state from durable artifacts only — it never trusts in-memory state from the dead session:

- `.hammer/auto-MID.lock` (or `.gsd/auto.lock` on legacy state) — current unit pointer, owner PID, and the `consecutiveRecoveryFailures` counter.
- `.hammer/exec/<sessionId>.stdout` — every tool call's persisted stdout, replayed into the briefing so the agent sees what it already did.
- `.gsd/milestones/<MID>/slices/<SID>/tasks/T##-PLAN.md` — the authoritative contract.
- The completed-units list, prior summaries, and the slice plan excerpt — all inlined into the dispatch prompt verbatim.

The briefing format itself is novel: completed tool calls, pre-loaded context, and the slice scope are stitched together so the resumed agent starts oriented at the exact unit boundary instead of paying tool calls to re-read state.

**The 3-strike cap.** Recovery is bounded. Each unit returns a `RECOVERY_VERDICT` trailer that the loop parses fail-closed:

| Verdict | Cap behavior | What it means |
|---------|--------------|---------------|
| `fix-applied` | Counter resets to 0 | Recovery succeeded; resume normally on the next unit. |
| `blocker-filed` | Clean exit, **no cap consumption** | Recovery surfaced an unresolvable blocker as a structured artifact; auto-mode pauses but does not count this against the cap. |
| `give-up` | Counter increments by 1 | Recovery cannot proceed; if the counter reaches 3, auto-mode pauses with the structured verdict for human inspection. |
| Malformed / missing trailer | Treated as failure (no clarification re-dispatch) | A unit that does not return a parseable trailer fails closed. The loop refuses to re-dispatch with "did you mean X?" — silent advance is structurally impossible. |

**Counter inspection idiom.** When auto-mode pauses on the cap, read the lock file directly:

```bash
cat .hammer/auto-MID.lock | jq '.consecutiveRecoveryFailures, .lastVerdict, .lastUnit'
```

(Substitute the active milestone ID; on legacy state, the file is at `.gsd/auto.lock`.) The counter, the most recent verdict, and the unit that produced it are sufficient context to decide whether to resume (`/hammer auto` after manual intervention), reset (`rm .hammer/auto-MID.lock` and re-dispatch), or escalate. See [Troubleshooting → Recover-and-resume](./troubleshooting.md#recover-and-resume) for the structured remediation procedure.

**Why this exists.** Without the cap, a malformed agent return could put auto-mode into an unbounded recovery spin that burns budget and produces no progress. The cap is the recovery loop's own kill switch — it makes "fire and forget" actually safe, because the worst case after walking away is a paused session, not a runaway one.

If your project still has a legacy `.gsd/` or `.planning/` layout, run `/hammer migrate` first to lift state into `.hammer/` so resume can find it.

### Omega-Driven Phases

Auto-mode is structured as a 10-stage canonical Omega spiral. Every phase that produces a durable artifact is one stage of this spiral, and each stage emits a per-stage artifact persisted to disk before the loop advances. Per R031 and R037, **per-stage artifact persistence is non-skippable** — a phase that cannot persist its stage artifact fails closed, and auto-mode refuses to advance.

**The 10 canonical stages** (per `OMEGA_STAGES` in `src/runtime/omega/*`):

1. **URUZ** — primal-strength scoping. Bound the unit and surface the contract.
2. **BERKANO** — growth-from-roots. Read existing artifacts, summaries, and decisions.
3. **MANNAZ** — humanity / self-awareness. Establish the agent's role and constraints.
4. **THURISAZ** — disruption / friction. Stress-test the plan, find what would break.
5. **EHWAZ** — partnership / movement. Assemble the dispatch context coherently.
6. **KENAZ** — illumination / craft. Execute the unit's real work.
7. **SOWILO / NAUTHIZ** — sun (success) or need (constraint). Check verification, surface what failed.
8. **DAGAZ / GEBO** — breakthrough / gift. Synthesize the result and the trade-offs.
9. **ALGIZ** — protection / fail-closed gate. Validate that all stage artifacts are present and parseable.
10. **JERA** — harvest / completion. Persist the aggregate artifact and advance the unit.

**Per-stage artifact layout.** Stages persist under `.gsd/omega/phases/<unitType>/<unitId>/<runId>/`:

```
.gsd/omega/phases/execute-task/M002.S08.T02/<runId>/
  01-uruz.md         — primal-strength scoping artifact
  02-berkano.md      — growth-from-roots artifact
  03-mannaz.md       — humanity / self-awareness artifact
  04-thurisaz.md     — disruption / friction artifact
  05-ehwaz.md        — partnership artifact
  06-kenaz.md        — execution artifact
  07-sowilo.md       — verification artifact (or 07-nauthiz.md if constrained)
  08-dagaz.md        — synthesis artifact (or 08-gebo.md)
  09-algiz.md        — fail-closed gate artifact
  10-jera.md         — harvest / completion artifact
  synthesis.md       — aggregate synthesis across stages
  phase-manifest.json — per-stage manifest (validated on advance)
  run-manifest.json   — top-level run manifest
```

**Fail-closed semantics.** The ALGIZ gate refuses to advance unless `phase-manifest.json`, `run-manifest.json`, all 10 stage files, and `synthesis.md` validate. Per R031, abbreviation or skip-on-trivial is not allowed — even a one-line task emits all 10 stage artifacts, because the recovery loop reads stage artifacts on resume and cannot reconstruct intent from gaps.

**Operator implication.** This is the structural surface that makes recover-and-resume load-bearing. Resume reads stage artifacts to rebuild the briefing, and the loop will refuse to advance if a stage cannot be persisted (disk full, permission denied, write-after-rename race). If you see auto-mode pause with `phase-artifact-missing` or `omega-gate-failed`, the gate is doing its job — fix the underlying disk condition and resume rather than overriding the gate.

### Provider Error Recovery

Hammer classifies provider errors and auto-resumes when safe:

| Error type | Examples | Action |
|-----------|----------|--------|
| **Rate limit** | 429, "too many requests" | Auto-resume after retry-after header or 60s |
| **Server error** | 500, 502, 503, "overloaded", "api_error" | Auto-resume after 30s |
| **Permanent** | "unauthorized", "invalid key", "billing" | Pause indefinitely (requires manual resume) |

No manual intervention needed for transient errors — the session pauses briefly and continues automatically.

### Incremental Memory (v2.26)

Hammer maintains a `KNOWLEDGE.md` file — an append-only register of project-specific rules, patterns, and lessons learned. The agent reads it at the start of every unit and appends to it when discovering recurring issues, non-obvious patterns, or rules that future sessions should follow. This gives auto-mode cross-session memory that survives context window boundaries.

### Context Pressure Monitor (v2.26)

When context usage reaches 70%, Hammer sends a wrap-up signal to the agent, nudging it to finish durable output (commit, write summaries) before the context window fills. This prevents sessions from hitting the hard context limit mid-task with no artifacts written.

### Meaningful Commit Messages (v2.26)

Commits are generated from task summaries — not generic "complete task" messages. Each commit message reflects what was actually built, giving clean `git log` output that reads like a changelog.

### Stuck Detection (v2.39)

Hammer uses a sliding-window analysis to detect stuck loops. Instead of a simple "same unit dispatched twice" counter, the detector examines recent dispatch history for repeated patterns — catching cycles like A→B→A→B as well as single-unit repeats. On detection, Hammer retries once with a deep diagnostic prompt. If it fails again, auto mode stops so you can intervene.

The sliding-window approach reduces false positives on legitimate retries (e.g., verification failures that self-correct) while catching genuine stuck loops faster.

### Artifact Verification Retries

After each unit, Hammer verifies that the expected artifact exists on disk. If the artifact is missing, auto mode re-dispatches the unit with explicit failure context and records an `artifact-verification-retry` journal event.

Artifact verification retries are capped at 3 attempts. If the expected artifact is still missing after those retries, Hammer pauses auto mode with an "Artifact still missing..." error instead of relying on loop detection or an unbounded dispatch counter.

### Post-Mortem Investigation (v2.40)

`/hammer forensics` is a full-access Hammer debugger for post-mortem analysis of auto-mode failures. It provides:

- **Anomaly detection** — structured identification of stuck loops, cost spikes, timeouts, missing artifacts, and crashes with severity levels
- **Unit traces** — last 10 unit executions with error details and execution times
- **Metrics analysis** — cost, token counts, and execution time breakdowns
- **Doctor integration** — includes structural health issues from `/hammer doctor`
- **LLM-guided investigation** — an agent session with full tool access to investigate root causes

```
/hammer forensics [optional problem description]
```

See [Troubleshooting](./troubleshooting.md) for more on diagnosing issues.

### Timeout Supervision

Three timeout tiers prevent runaway sessions:

| Timeout | Default | Behavior |
|---------|---------|----------|
| Soft | 20 min | Warns the LLM to wrap up |
| Idle | 10 min | Detects stalls, intervenes |
| Hard | 30 min | Pauses auto mode |

Recovery steering nudges the LLM to finish durable output before timing out. Configure in preferences:

```yaml
auto_supervisor:
  soft_timeout_minutes: 20
  idle_timeout_minutes: 10
  hard_timeout_minutes: 30
```

### Cost Tracking

Every unit's token usage and cost is captured, broken down by phase, slice, and model. The dashboard shows running totals and projections. Budget ceilings can pause auto mode before overspending.

See [Cost Management](./cost-management.md).

### Adaptive Replanning

After each slice completes, the roadmap is reassessed. If the work revealed new information that changes the plan, slices are reordered, added, or removed before continuing. This can be skipped with the `balanced` or `budget` token profiles.

### Verification Enforcement (v2.26)

Configure shell commands that run automatically after every task execution:

```yaml
verification_commands:
  - npm run lint
  - npm run test
verification_auto_fix: true    # auto-retry on failure (default)
verification_max_retries: 2    # max retry attempts (default: 2)
```

Failures trigger auto-fix retries — the agent sees the verification output and attempts to fix the issues before advancing. This ensures code quality gates are enforced mechanically, not by LLM compliance.

### Slice Discussion Gate (v2.26)

For projects where you want human review before each slice begins:

```yaml
require_slice_discussion: true
```

Auto-mode pauses before each slice, presenting the slice context for discussion. After you confirm, execution continues. Useful for high-stakes projects where you want to review the plan before the agent builds.

### HTML Reports (v2.26)

After a milestone completes, Hammer auto-generates a self-contained HTML report in `.gsd/reports/`. Reports include project summary, progress tree, slice dependency graph (SVG DAG), cost/token metrics with bar charts, execution timeline, changelog, and knowledge base. No external dependencies — all CSS and JS are inlined.

```yaml
auto_report: true    # enabled by default
```

Generate manually anytime with `/hammer export --html`, or generate reports for all milestones at once with `/hammer export --html --all` (v2.28).

### Failure Recovery (v2.28)

v2.28 hardens auto-mode reliability with multiple safeguards: atomic file writes prevent corruption on crash, OAuth fetch timeouts (30s) prevent indefinite hangs, RPC subprocess exit is detected and reported, and blob garbage collection prevents unbounded disk growth. Combined with the existing crash recovery and headless auto-restart, auto-mode is designed for true "fire and forget" overnight execution.

### Pipeline Architecture (v2.40)

The auto-loop is structured as a linear phase pipeline rather than recursive dispatch. Each iteration flows through explicit stages:

1. **Pre-Dispatch** — validate state, check guards, resolve model preferences
2. **Dispatch** — execute the unit with a focused prompt
3. **Post-Unit** — close out the unit, update caches, run cleanup
4. **Verification** — optional validation gate (lint, test, etc.)
5. **Stuck Detection** — sliding-window pattern analysis

This linear flow is easier to debug, uses less memory (no recursive call stack), and provides cleaner error recovery since each phase has well-defined entry and exit conditions.

### Real-Time Health Visibility (v2.40)

Doctor issues (from `/hammer doctor`) now surface in real time across three places:

- **Dashboard widget** — health indicator with issue count and severity
- **Workflow visualizer** — issues shown in the status panel
- **HTML reports** — health section with all issues at report generation time

Issues are classified by severity: `error` (blocks auto-mode), `warning` (non-blocking), and `info` (advisory). Auto-mode checks health at dispatch time and can pause on critical issues.

### Skill Activation in Prompts (v2.39)

Configured skills are automatically resolved and injected into dispatch prompts. The agent receives an "Available Skills" block listing skills that match the current context, based on:

- `always_use_skills` — always included
- `prefer_skills` — included with preference indicator
- `skill_rules` — conditional activation based on `when` clauses

See [Configuration](./configuration.md) for skill routing preferences.

## Controlling Auto Mode

### Start

```
/hammer auto
```

### Pause

Press **Escape**. The conversation is preserved. You can interact with the agent, inspect state, or resume.

### Resume

```
/hammer auto
```

Auto mode reads disk state and picks up where it left off.

### Stop

```
/hammer stop
```

Stops auto mode gracefully. Can be run from a different terminal.

### Steer

```
/hammer steer
```

Hard-steer plan documents during execution without stopping the pipeline. Changes are picked up at the next phase boundary.

### Capture

```
/hammer capture "add rate limiting to API endpoints"
```

Fire-and-forget thought capture. Captures are triaged automatically between tasks. See [Captures & Triage](./captures-triage.md).

### Visualize

```
/hammer visualize
```

Open the workflow visualizer — interactive tabs for progress, dependencies, metrics, and timeline. See [Workflow Visualizer](./visualizer.md).

### Remote Control via Telegram

When Telegram is configured as your remote channel, you can control auto-mode and query project status directly from the Telegram chat — without touching the terminal.

| Command | What it does |
|---------|-------------|
| `/pause` | Pause auto-mode after the current unit finishes |
| `/resume` | Clear a pause directive and continue auto-mode |
| `/status` | Show current milestone, active unit, and session cost |
| `/progress` | Roadmap overview (done / open milestones) |
| `/budget` | Token usage and cost for the current session |
| `/log [n]` | Last `n` activity log entries (default: 5) |

Hammer polls for incoming Telegram commands every ~5 seconds while auto-mode is active. Commands are only available during active auto-mode sessions.

See [Remote Questions — Telegram Commands](./remote-questions.md#telegram-commands) for the full command reference and setup instructions.

## Dashboard

`Ctrl+Alt+G` or `/hammer status` shows real-time progress:

- Current milestone, slice, and task
- Auto mode elapsed time and phase
- Per-unit cost and token breakdown
- Cost projections
- Completed and in-progress units
- Pending capture count (when captures are awaiting triage)
- Parallel worker status (when running parallel milestones — includes 80% budget alert)

## Phase Skipping

Token profiles can skip certain phases to reduce cost:

| Phase | `budget` | `balanced` | `quality` |
|-------|----------|------------|-----------|
| Milestone Research | Skipped | Runs | Runs |
| Slice Research | Skipped | Skipped | Runs |
| Reassess Roadmap | Skipped | Runs | Runs |

See [Token Optimization](./token-optimization.md) for details.

## Dynamic Model Routing

When enabled, auto-mode automatically selects cheaper models for simple units (slice completion, UAT) and reserves expensive models for complex work (replanning, architectural tasks). See [Dynamic Model Routing](./dynamic-model-routing.md).

## Reactive Task Execution (v2.38)

When `reactive_execution: true` is set in preferences, Hammer derives a dependency graph from IO annotations in task plans. Tasks that don't conflict (no shared file reads/writes) are dispatched in parallel via subagents, while dependent tasks wait for their predecessors to complete.

```yaml
reactive_execution: true    # disabled by default
```

The graph derivation is pure and deterministic — it resolves a ready-set of tasks, detects conflicts, and guards against deadlocks. Verification results carry forward across parallel batches, so tasks that pass verification don't need to be re-verified when subsequent tasks in the same slice complete.

The implementation lives in `reactive-graph.ts` (graph derivation, ready-set resolution, conflict/deadlock detection) with integration into `auto-dispatch.ts` and `auto-prompts.ts`.
