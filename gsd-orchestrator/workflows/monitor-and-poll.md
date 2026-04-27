# Monitor and Poll

> Hammer/IAM awareness: blockers, missing provenance, absent awareness artifacts, and failed no-degradation proof are remediation signals. Polling should make those signals visible instead of smoothing them over.

Use this workflow to check a Hammer project, handle blockers, track costs, and decide the next action.

## Checking Project State

The `query` command is your primary monitoring tool. It is instant, has no LLM cost, and returns the current project snapshot.

```bash
cd /path/to/project
hammer headless query
```

### Key fields to inspect

```bash
# Overall status.
hammer headless query | jq '{
  phase: .state.phase,
  milestone: .state.activeMilestone.id,
  slice: .state.activeSlice.id,
  task: .state.activeTask.id,
  progress: .state.progress,
  cost: .cost.total
}'

# What should happen next.
hammer headless query | jq '.next'
# Example: { "action": "dispatch", "unitType": "execute-task", "unitId": "M001/S01/T01" }

# Is it done?
hammer headless query | jq '.state.phase'
# "complete" = done, "blocked" = needs remediation, anything else = in progress.
```

### Phase meanings

| Phase | Meaning | Your action |
|-------|---------|-------------|
| `pre-planning` | Milestone exists, no slices planned yet. | Run `auto` or `next`. |
| `needs-discussion` | Ambiguities need resolution. | Supply answers or supervised input. |
| `discussing` | Discussion in progress. | Wait or monitor events. |
| `researching` | Codebase or library research. | Wait; verify research provenance if it later becomes a blocker. |
| `planning` | Creating task plans. | Wait. |
| `executing` | Writing code. | Wait or run step mode for budget control. |
| `verifying` | Checking must-haves. | Wait; failures should remain visible. |
| `summarizing` | Recording what happened. | Wait. |
| `advancing` | Moving to next task or slice. | Wait. |
| `evaluating-gates` | Quality checks before execution. | Wait or run `next`. |
| `validating-milestone` | Final milestone checks. | Wait and inspect validation evidence. |
| `completing-milestone` | Archiving and cleanup. | Wait. |
| `complete` | Done. | Verify deliverables independently. |
| `blocked` | Needs remediation. | Handle blocker. |
| `paused` | Explicitly paused. | Resume with `auto` when ready. |

## Handling Blockers

When exit code is `10` or phase is `blocked`, do not treat the build as failed silently. Query the structured state and choose a remediation.

```bash
# 1. Understand the blocker.
hammer headless query | jq '{phase: .state.phase, blockers: .state.blockers, next: .next}'

# 2. Option A: steer around it with explicit no-degradation constraints.
hammer headless steer "Replan around the unavailable database dependency without dropping validation, IAM provenance, or no-degradation requirements."

# 3. Option B: supply pre-built answers.
cat > fix.json << 'EOF'
{
  "questions": { "blocked_question_id": "workaround_option" },
  "defaults": { "strategy": "first_option" }
}
EOF
hammer headless --answers fix.json auto

# 4. Option C: force a specific remediation phase.
hammer headless dispatch replan

# 5. Option D: escalate with evidence.
echo "Hammer build blocked. Phase: $(hammer headless query | jq -r '.state.phase')"
echo "Manual intervention required; attach blocker JSON and relevant .hammer summaries."
```

Blocker examples that require structured remediation:

- Missing IAM/Omega/Trinity/VOLVOX awareness artifacts.
- Verification evidence absent or stale.
- A dependency cannot be reached.
- A spec ambiguity would change scope or quality.
- The result would require degrading security, reliability, or user-visible behavior.

## Cost Tracking

```bash
# Current cumulative cost.
hammer headless query | jq '.cost.total'

# Per-worker breakdown when available.
hammer headless query | jq '.cost.workers'

# After a step, from HeadlessJsonResult.
RESULT=$(hammer headless --output-format json next 2>/dev/null)
echo "$RESULT" | jq '.cost'
```

### Budget enforcement pattern

```bash
MAX_BUDGET=15.00

check_budget() {
  TOTAL=$(hammer headless query | jq -r '.cost.total')
  OVER=$(echo "$TOTAL > $MAX_BUDGET" | bc -l)
  if [ "$OVER" = "1" ]; then
    echo "Budget exceeded: \$$TOTAL > \$$MAX_BUDGET"
    hammer headless stop
    return 1
  fi
  return 0
}
```

## Poll-and-React Loop

For agents that need to periodically check on a build, keep polling bounded. `query` is cheap, but a subprocess can still run for a long time.

```bash
cd /path/to/project

poll_project() {
  STATE=$(hammer headless query 2>/dev/null)
  if [ -z "$STATE" ]; then
    echo "NO_PROJECT"
    return
  fi

  PHASE=$(echo "$STATE" | jq -r '.state.phase')
  COST=$(echo "$STATE" | jq -r '.cost.total')
  PROGRESS=$(echo "$STATE" | jq -r '"\(.state.progress.milestones.done)/\(.state.progress.milestones.total) milestones, \(.state.progress.tasks.done)/\(.state.progress.tasks.total) tasks"')

  case "$PHASE" in
    complete)
      echo "COMPLETE cost=\$$COST progress=$PROGRESS"
      ;;
    blocked)
      BLOCKER=$(echo "$STATE" | jq -r '.state.blockers // .state.nextAction // "unknown"')
      echo "BLOCKED reason=$BLOCKER cost=\$$COST"
      ;;
    *)
      NEXT=$(echo "$STATE" | jq -r '.next.action // "none"')
      echo "IN_PROGRESS phase=$PHASE next=$NEXT cost=\$$COST progress=$PROGRESS"
      ;;
  esac
}
```

### Bounded polling wrapper

```bash
MAX_POLLS=120
SLEEP_SECONDS=10

for i in $(seq 1 "$MAX_POLLS"); do
  poll_project
  PHASE=$(hammer headless query | jq -r '.state.phase')
  [ "$PHASE" = "complete" ] && break
  [ "$PHASE" = "blocked" ] && break
  sleep "$SLEEP_SECONDS"
done
```

If the poll loop times out, stop and inspect `.hammer/STATE.md`, recent summaries, and any captured stderr. Do not start a second long-running `auto` loop until you know whether the first subprocess is still active.

## Resuming Work

If a build was interrupted or you need to continue:

```bash
cd /path/to/project

# Check current state.
hammer headless query | jq '.state.phase'

# Resume from where it left off.
hammer headless --output-format json auto 2>/dev/null

# Or resume a specific session.
hammer headless --resume "$SESSION_ID" --output-format json auto 2>/dev/null
```

## Reading Build Artifacts

After completion or blockage, inspect what Hammer produced:

```bash
cd /path/to/project

# Project summary.
cat .hammer/PROJECT.md

# Architectural decisions.
cat .hammer/DECISIONS.md

# Requirements and validation status.
cat .hammer/REQUIREMENTS.md

# Current phase, blocker, and next action.
cat .hammer/STATE.md

# Milestone summaries.
cat .hammer/milestones/M001-*/M001-*-SUMMARY.md 2>/dev/null

# Git history, because Hammer commits per completed unit.
git log --oneline
```

Do not read or print secret values from answer files, environment files, or logs. It is safe to mention env var names and whether they were configured.
