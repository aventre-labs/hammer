# Step-by-Step Execution

> Hammer/IAM awareness: step-by-step execution preserves provenance and gives the orchestrator a chance to stop on no-degradation failures before they compound.

Run Hammer one unit at a time with decision points between steps. Use this when you need budget enforcement, progress reporting, conditional logic, or the ability to steer mid-build.

## When to use this vs `auto`

| Approach | Use when |
|----------|----------|
| `auto` | You trust the spec and want Hammer to run until complete or blocked. |
| `next` loop | You need budget checks, progress updates, verification gates, or intervention points. |

## Core Loop

```bash
cd /path/to/project
MAX_BUDGET=20.00
TOTAL_COST=0

while true; do
  # Run one unit.
  RESULT=$(hammer headless --output-format json next 2>/dev/null)
  EXIT=$?

  # Parse result. If parsing fails, treat it as a malformed-response error.
  STATUS=$(echo "$RESULT" | jq -r '.status // "malformed"' 2>/dev/null || echo malformed)
  STEP_COST=$(echo "$RESULT" | jq -r '.cost.total // 0' 2>/dev/null || echo 0)
  PHASE=$(echo "$RESULT" | jq -r '.phase // empty' 2>/dev/null || true)
  SESSION_ID=$(echo "$RESULT" | jq -r '.sessionId // empty' 2>/dev/null || true)

  # Handle exit codes.
  case $EXIT in
    0) ;; # success — continue
    1)
      echo "Step failed or timed out: $STATUS"
      hammer headless query | jq '.state' 2>/dev/null || true
      break
      ;;
    10)
      echo "Blocked — needs remediation"
      hammer headless query | jq '{phase: .state.phase, blockers: .state.blockers, next: .next}'
      break
      ;;
    11)
      echo "Cancelled"
      break
      ;;
    *)
      echo "Unexpected exit code: $EXIT"
      break
      ;;
  esac

  # Check if milestone is complete.
  CURRENT_PHASE=$(hammer headless query | jq -r '.state.phase')
  if [ "$CURRENT_PHASE" = "complete" ]; then
    TOTAL_COST=$(hammer headless query | jq -r '.cost.total')
    echo "Milestone complete. Total cost: \$$TOTAL_COST"
    break
  fi

  # Budget check.
  TOTAL_COST=$(hammer headless query | jq -r '.cost.total')
  OVER=$(echo "$TOTAL_COST > $MAX_BUDGET" | bc -l)
  if [ "$OVER" = "1" ]; then
    echo "Budget limit (\$$MAX_BUDGET) exceeded at \$$TOTAL_COST"
    hammer headless stop
    break
  fi

  # Progress report.
  PROGRESS=$(hammer headless query | jq -r '"\(.state.progress.tasks.done)/\(.state.progress.tasks.total) tasks"')
  echo "Step done ($STATUS). Phase: $CURRENT_PHASE, Progress: $PROGRESS, Cost: \$$TOTAL_COST"
done
```

## Step-by-Step with Spec Creation

Complete flow from idea to working code with full control:

```bash
# 1. Setup.
PROJECT_DIR="/tmp/my-project"
mkdir -p "$PROJECT_DIR" && cd "$PROJECT_DIR" && git init 2>/dev/null

# 2. Write spec.
cat > spec.md << 'SPEC'
# Product Spec

Describe user outcomes, technical constraints, verification expectations,
IAM/Omega/Trinity/VOLVOX provenance requirements, and no-degradation blockers.
SPEC

# 3. Create the milestone without auto-executing it.
RESULT=$(hammer headless --output-format json --context spec.md new-milestone 2>/dev/null)
EXIT=$?

if [ $EXIT -ne 0 ]; then
  echo "Milestone creation failed"
  echo "$RESULT" | jq . 2>/dev/null || true
  hammer headless query | jq '.state' 2>/dev/null || true
  exit 1
fi

echo "Milestone created. Starting execution..."

# 4. Execute one unit at a time.
STEP=0
while true; do
  STEP=$((STEP + 1))
  RESULT=$(hammer headless --output-format json next 2>/dev/null)
  EXIT=$?

  if [ $EXIT -ne 0 ]; then
    echo "Stopped at step $STEP with exit $EXIT"
    echo "$RESULT" | jq . 2>/dev/null || true
    hammer headless query | jq '.state' 2>/dev/null || true
    break
  fi

  PHASE=$(hammer headless query | jq -r '.state.phase')
  COST=$(hammer headless query | jq -r '.cost.total')

  echo "Step $STEP complete. Phase: $PHASE, Cost: \$$COST"

  [ "$PHASE" = "complete" ] && break
done

echo "Build finished in $STEP steps"
```

## Intervention Patterns

### Steer mid-execution

If you detect the build going in the wrong direction:

```bash
# Check what is happening.
hammer headless query | jq '{phase: .state.phase, task: .state.activeTask, blockers: .state.blockers}'

# Redirect with explicit quality constraints.
hammer headless steer "Use SQLite instead of PostgreSQL for storage, but keep tests, IAM provenance, and no-degradation verification intact."

# Continue one unit.
hammer headless --output-format json next 2>/dev/null
```

### Skip a stuck unit

```bash
hammer headless skip
hammer headless --output-format json next 2>/dev/null
```

Only skip when the unit is obsolete or safely descoped. Do not skip a unit merely because it is missing awareness or verification evidence; replan or remediate instead.

### Undo last completed unit

```bash
hammer headless undo --force
hammer headless --output-format json next 2>/dev/null
```

Use undo when verification after completion reveals a regression, stale evidence, or a no-degradation violation.

### Force a specific phase

```bash
hammer headless dispatch replan   # Re-plan the current slice.
hammer headless dispatch execute  # Return to execution.
hammer headless dispatch uat      # Jump to user acceptance testing.
```

Force dispatch only after `query` confirms the current state and you can explain why normal routing is insufficient.

## Failure Handling Checklist

When a step fails, times out, or returns malformed JSON:

1. Preserve the exit code and raw result for evidence.
2. Run `hammer headless query` and inspect `.hammer/STATE.md`.
3. Identify whether the issue is dependency failure, spec ambiguity, missing IAM/provenance, stale verification, or runtime crash.
4. Apply one remediation: answer injection, steering, replan dispatch, resume, or escalation.
5. Re-run only the next bounded step; avoid launching an unbounded parallel `auto` while the failure is unexplained.
