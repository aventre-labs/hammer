# Hammer Preferences Reference

Full documentation for Hammer/Pi skill and workflow preferences. Project preferences live in `.hammer/PREFERENCES.md`; global defaults live in `~/.hammer/PREFERENCES.md`.

Hammer runs on Pi and keeps preferences IAM-aware: settings may guide routing, skills, models, and hooks, but they cannot weaken required verification, provenance, quality gates, or no-degradation behavior.

---

## Notes

- Keep preferences skill-first and specific.
- Prefer explicit skill names or absolute paths when you want zero ambiguity.
- Use global preferences for personal defaults and project preferences for repository-specific policy.
- These preferences guide which skills Hammer should load and follow; they do not override higher-priority instructions in the active conversation.
- IAM_SUBAGENT_CONTRACT: subagent model routing remains governed by Hammer role/envelope policy; a preference can select a model but cannot bypass IAM awareness or no-degradation checks.
- For Claude marketplace/plugin import behavior, see `~/.hammer/agent/extensions/gsd/docs/claude-marketplace-import.md` (legacy extension path segment; Hammer state remains under `.hammer`).

---

## Canonical locations and legacy bridges

Hammer/Pi uses these current locations:

1. **Global:** `~/.hammer/PREFERENCES.md` — applies to all projects.
2. **Project:** `.hammer/PREFERENCES.md` — applies to the current project only.

Legacy state bridge: Hammer may still read `.gsd/PREFERENCES.md` during migration or compatibility bootstrap, but new preferences should be created and edited in `.hammer/PREFERENCES.md` or `~/.hammer/PREFERENCES.md`.

Legacy environment bridge: old `GSD_*` environment names may still be honored by specific compatibility layers, but new automation should prefer Hammer-prefixed configuration when a Hammer name exists.

Quick setup commands:

```text
/hammer mode
/hammer mode project
/hammer prefs global
/hammer prefs project
/hammer prefs status
```

---

## Semantics

### Empty arrays vs omitted fields

**Empty arrays (`[]`) are equivalent to omitting the field entirely.** During validation, Hammer removes empty arrays from the preferences object for list fields such as:

```yaml
prefer_skills: []
avoid_skills: []
skill_rules: []
custom_instructions: []
```

These are functionally identical to leaving those keys out.

**Recommendation:** omit fields you do not need. Empty arrays add noise with no behavior change.

### Global vs project preferences

Preferences are loaded from global and project locations, then merged:

- **Scalar fields** (`skill_discovery`, `budget_ceiling`, `token_profile`, and similar): project wins if defined; otherwise global applies.
- **Array fields** (`always_use_skills`, `prefer_skills`, `avoid_skills`, `custom_instructions`, and similar): global entries come first, then project entries are appended.
- **Object fields** (`models`, `git`, `auto_supervisor`, and similar): project values override matching global keys while preserving unspecified global values.

For `models`, project settings override global settings at the phase level. If global has `planning: claude-opus-4-6` and project has `planning: claude-sonnet-4-6`, the project wins for planning. If project omits `research`, the global research setting is preserved.

### Skill discovery vs skill preferences

These are separate concerns:

| Field | What it controls |
| --- | --- |
| `skill_discovery` | Whether Hammer looks for relevant skills during research/planning. |
| `always_use_skills`, `prefer_skills`, `avoid_skills` | Which skills Hammer should use, prefer, or avoid when they are relevant. |

Setting `prefer_skills: []` does **not** disable skill discovery; it only means you have no preference overrides. Use `skill_discovery: off` to disable discovery.

---

## Field guide

### Core workflow

- `version`: schema version. Start at `1`.

- `mode`: workflow mode — `"solo"` or `"team"`. Mode sets defaults for git and milestone behavior. Explicit settings always override mode defaults.

  | Setting | `solo` | `team` |
  | --- | --- | --- |
  | `git.auto_push` | `true` | `false` |
  | `git.push_branches` | `false` | `true` |
  | `git.pre_merge_check` | `false` | `true` |
  | `git.merge_strategy` | `"squash"` | `"squash"` |
  | `git.isolation` | `"worktree"` | `"worktree"` |
  | `unique_milestone_ids` | `false` | `true` |

- `unique_milestone_ids`: boolean. When `true`, generated milestone IDs include a short random suffix such as `M001-eh88as`, reducing collisions in team workflows. Existing plain IDs remain valid.

- `token_profile`: `"budget"`, `"balanced"`, `"quality"`, or `"burn-max"`. Coordinates model selection, phase skipping, and context compression.

- `phases`: controls which orchestration phases run. Keys include:
  - `skip_research`
  - `skip_reassess`
  - `reassess_after_slice`
  - `skip_slice_research`

### Skills and instructions

- `always_use_skills`: skills Hammer should use whenever relevant.
- `prefer_skills`: soft defaults Hammer should prefer when relevant.
- `avoid_skills`: skills Hammer should avoid unless clearly needed.
- `skill_rules`: situational rules with a human-readable `when` trigger and one or more of `use`, `prefer`, or `avoid`.
- `custom_instructions`: durable instructions related to skill use. Use concise operational guidance here; keep project facts and recurring gotchas in the project knowledge system rather than overloading preferences.
- `skill_staleness_days`: number of unused days after which skills are deprioritized during discovery. Set `0` to disable staleness tracking. Default: `60`.
- `skill_discovery`: controls automatic skill discovery:
  - `auto` — relevant skills are found and applied automatically.
  - `suggest` — relevant skills are identified but not installed automatically.
  - `off` — skill discovery is disabled.

### Language

- `language`: preferred response language for Hammer interactions. Accepts language names or codes such as `"Chinese"`, `"zh"`, `"German"`, `"de"`, or `"日本語"`.

Examples:

```text
/hammer language German
/hammer language off
```

### Models

- `models`: per-stage model selection for auto-mode and guided-flow dispatch. Keys include `research`, `planning`, `discuss`, `execution`, `execution_simple`, `completion`, `validation`, and `subagent`.

Values may be:

```yaml
models:
  execution: claude-sonnet-4-6
  planning: anthropic/claude-opus-4-6
  research:
    model: openrouter/deepseek/deepseek-r1
    fallbacks:
      - openrouter/minimax/minimax-m2.5
  validation:
    model: claude-sonnet-4-6
    provider: bedrock
```

Notes:

- Provider-qualified strings such as `bedrock/claude-sonnet-4-6` target a specific provider.
- Object values support `model`, `provider`, and `fallbacks`.
- Omit a key to use the current active model, except `discuss` and `validation`, which fall back to `planning` when unset.
- Fallbacks are tried when switching fails because a provider is unavailable, rate-limited, or out of credits.

### Auto supervisor

- `auto_supervisor`: configures the process that monitors auto-mode progress. Keys:
  - `model`
  - `soft_timeout_minutes`
  - `idle_timeout_minutes`
  - `hard_timeout_minutes`

### Git

- `git`: configures Hammer git behavior. All fields are optional:
  - `auto_push`: automatically push commits after committing.
  - `push_branches`: push milestone branches after commits.
  - `remote`: remote name. Default: `origin`.
  - `snapshots`: create WIP snapshot commits for safety events.
  - `pre_merge_check`: `true`, `false`, or `"auto"`.
  - `commit_type`: override the conventional commit prefix.
  - `main_branch`: primary branch name for new repositories and ambiguous branch detection.
  - `merge_strategy`: `"squash"` or `"merge"`.
  - `isolation`: `"worktree"`, `"branch"`, or `"none"`.
  - `manage_gitignore`: when `false`, Hammer will not modify `.gitignore`.
  - `worktree_post_create`: script to run after a worktree is created; receives `SOURCE_DIR` and `WORKTREE_DIR`.
  - `auto_pr`: automatically create a GitHub pull request after milestone merge when supported.
  - `pr_target_branch`: branch to target when `auto_pr` is enabled.

Deprecated settings:

- `commit_docs`: no longer valid. Hammer state is private and ignored by git.
- `merge_to_main`: no longer valid. Milestone-level merge is always used.

### Budget and cost control

- `budget_ceiling`: maximum dollar amount to spend on auto-mode.
- `budget_enforcement`: `"warn"`, `"pause"`, or `"halt"`.
- `context_pause_threshold`: context usage percentage at which auto-mode should pause to suggest checkpointing.

### Routing

- `dynamic_routing`: configures model tier routing. Keys:
  - `enabled`
  - `tier_models`
  - `escalate_on_failure`
  - `budget_pressure`
  - `cross_provider`
  - `hooks`
  - `capability_routing`

- `disabled_model_providers`: provider IDs to hide from model selection and routing.

### IAM and orchestration kernel

- `uok`: Unified Orchestration Kernel controls. Defaults keep Hammer IAM and no-degradation behavior enabled. Keys include:
  - `enabled`
  - `legacy_fallback.enabled`
  - `gates.enabled`
  - `model_policy.enabled`
  - `execution_graph.enabled`
  - `gitops.enabled`
  - `gitops.turn_action`
  - `gitops.turn_push`
  - `audit_unified.enabled`
  - `plan_v2.enabled`

Legacy bridge note: `GSD_UOK_FORCE_LEGACY=1` and `GSD_UOK_LEGACY_FALLBACK=1` may still force legacy behavior for compatibility when the kernel fallback layer explicitly supports them. Prefer Hammer-native configuration for new automation.

### Context management

- `context_management`: configures context hygiene for auto-mode sessions. Keys:
  - `observation_masking`
  - `observation_mask_turns`
  - `compaction_threshold_percent`
  - `tool_result_max_chars`

### Reporting and visualization

- `auto_visualize`: show a visualizer hint after milestone completion.
- `auto_report`: generate an HTML report snapshot after milestone completion.

### Search and context selection

- `search_provider`: `"brave"`, `"tavily"`, `"ollama"`, `"native"`, or `"auto"`.
- `context_selection`: `"full"` or `"smart"`.

### Parallel execution

- `parallel`: configures multi-slice execution. Keys:
  - `enabled`
  - `max_workers`
  - `budget_ceiling`
  - `merge_strategy`: `"per-slice"` or `"per-milestone"`.
  - `auto_merge`: `"auto"`, `"confirm"`, or `"manual"`.
  - `worker_model`

### Verification and UAT

- `verification_commands`: shell commands to run after task execution.
- `verification_auto_fix`: automatically attempt to fix verification failures.
- `verification_max_retries`: maximum fix-and-retry cycles.
- `uat_dispatch`: enable user-acceptance-test dispatch mode.

Verification preferences are additive safety rails. They cannot reduce task-level or slice-level verification required by Hammer plans, IAM gates, or no-degradation policy.

### Notifications and remote questions

- `notifications`: desktop notification behavior. Keys:
  - `enabled`
  - `on_complete`
  - `on_error`
  - `on_budget`
  - `on_milestone`
  - `on_attention`

- `remote_questions`: route interactive questions to Slack or Discord for headless auto-mode. Keys:
  - `channel`
  - `channel_id`
  - `timeout_minutes`
  - `poll_interval_seconds`

### cmux integration

- `cmux`: terminal integration when Hammer is running inside a cmux workspace. Keys:
  - `enabled`
  - `notifications`
  - `sidebar`
  - `splits`
  - `browser`

### Hooks

- `post_unit_hooks`: hooks that fire after a unit completes. Each entry may include:
  - `name`
  - `after`
  - `prompt`
  - `max_cycles`
  - `model`
  - `artifact`
  - `retry_on`
  - `agent`
  - `enabled`

- `pre_dispatch_hooks`: hooks that fire before a unit is dispatched. Each entry may include:
  - `name`
  - `before`
  - `action`: `"modify"`, `"skip"`, or `"replace"`.
  - `prepend`
  - `append`
  - `prompt`
  - `unit_type`
  - `skip_if`
  - `model`
  - `enabled`

Known unit types include `research-milestone`, `plan-milestone`, `research-slice`, `plan-slice`, `execute-task`, `complete-slice`, `replan-slice`, `reassess-roadmap`, and `run-uat`.

### Experimental features

- `experimental`: opt-in features that are off by default and may change without a deprecation cycle.
- `experimental.rtk`: enable RTK shell-command compression. Set `GSD_RTK_DISABLED=1` only as a legacy environment compatibility bridge when the runtime documents that fallback.

---

## Best practices

- Keep `always_use_skills` short.
- Use `skill_rules` for situational routing, not broad personality preferences.
- Prefer stable skill names for shared skills.
- Prefer absolute paths for local personal skills.
- Omit fields you do not need.
- Keep verification commands concrete and repeatable.
- Treat preferences as guidance, not as a way to downgrade Hammer IAM, provenance, or no-degradation guarantees.

---

## Examples

### Minimal preferences

```yaml
---
version: 1
always_use_skills:
  - debug-like-expert
skill_discovery: suggest
models:
  planning: claude-opus-4-6
  execution: claude-sonnet-4-6
---
```

Everything else uses defaults.

### Solo developer

```yaml
---
version: 1
mode: solo
---
```

Equivalent to auto-push, simple milestone IDs, worktree isolation, and squash merge defaults.

### Team workflow

```yaml
---
version: 1
mode: team
---
```

Equivalent to branch pushes, pre-merge checks, unique milestone IDs, worktree isolation, and squash merge defaults.

### Team workflow with one override

```yaml
---
version: 1
mode: team
git:
  auto_push: true
---
```

Team defaults apply except `git.auto_push`, which is explicitly overridden.

### Model fallbacks

```yaml
---
version: 1
models:
  research:
    model: openrouter/deepseek/deepseek-r1
    fallbacks:
      - openrouter/minimax/minimax-m2.5
  planning:
    model: claude-opus-4-6
    fallbacks:
      - openrouter/z-ai/glm-5
      - openrouter/moonshotai/kimi-k2.5
  execution: openrouter/minimax/minimax-m2.5
  completion: openrouter/minimax/minimax-m2.5
---
```

### Provider targeting

```yaml
---
version: 1
models:
  research: bedrock/claude-sonnet-4-6
  planning: anthropic/claude-opus-4-6
  execution:
    model: claude-sonnet-4-6
    provider: bedrock
    fallbacks:
      - anthropic/claude-sonnet-4-6
---
```

### Skill routing

```yaml
---
version: 1
prefer_skills:
  - commit-ignore
skill_rules:
  - when: task involves Clerk authentication
    use:
      - clerk
      - clerk-setup
  - when: finishing implementation and human judgment matters
    use:
      - /Users/you/.claude/skills/verify-uat
---
```

### Git preferences

```yaml
---
version: 1
git:
  auto_push: true
  push_branches: true
  remote: origin
  snapshots: true
  pre_merge_check: auto
  commit_type: feat
---
```

### Budget and context control

```yaml
---
version: 1
budget_ceiling: 10.00
budget_enforcement: pause
context_pause_threshold: 80
---
```

### Notifications

```yaml
---
version: 1
notifications:
  enabled: true
  on_complete: false
  on_error: true
  on_budget: true
  on_milestone: true
  on_attention: true
---
```

### cmux

```yaml
---
version: 1
cmux:
  enabled: true
  notifications: true
  sidebar: true
  splits: true
  browser: false
---
```

### Post-unit hook

```yaml
---
version: 1
post_unit_hooks:
  - name: code-review
    after:
      - execute-task
    prompt: "Review the code changes in {sliceId}/{taskId} for quality, security, and test coverage."
    max_cycles: 1
    artifact: REVIEW.md
---
```

### Pre-dispatch hook

```yaml
---
version: 1
pre_dispatch_hooks:
  - name: enforce-standards
    before:
      - execute-task
    action: modify
    prepend: "Follow our TypeScript coding standards and always run linting."
---
```

### Verification commands

```yaml
---
version: 1
verification_commands:
  - npm test
  - npm run lint
  - npm run typecheck
verification_auto_fix: true
verification_max_retries: 2
---
```

### Experimental RTK

```yaml
---
version: 1
experimental:
  rtk: true
---
```

RTK downloads automatically on first use when enabled. Use the legacy `GSD_RTK_DISABLED=1` environment bridge only when you must force-disable RTK in a compatibility environment; prefer Hammer-native controls where available.
