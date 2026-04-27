# HeadlessJsonResult Reference

> Hammer/IAM awareness: JSON result fields are diagnostics for provenance, blockers, and no-degradation remediation. Treat malformed JSON, missing fields, and blocker statuses as signals to inspect state rather than as reasons to assume success.

When using `--output-format json`, Hammer collects events silently and emits a single `HeadlessJsonResult` JSON object to stdout at process exit. This object is the structured result for orchestrator decision-making.

## Obtaining the Result

```bash
# Capture the JSON result. Progress goes to stderr; JSON goes to stdout.
RESULT=$(hammer headless --output-format json next 2>/dev/null)
EXIT=$?

# Parse fields with jq.
echo "$RESULT" | jq '.status'
echo "$RESULT" | jq '.cost.total'
echo "$RESULT" | jq '.nextAction'
```

If `jq` cannot parse the result, treat the run as malformed output: preserve the exit code, inspect stderr and `.hammer/STATE.md`, and retry only after a concrete remediation. Do not continue as if the run succeeded.

## Field Reference

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"success" \| "error" \| "blocked" \| "cancelled" \| "timeout"` | Final session status. Maps directly to exit codes. |
| `exitCode` | `number` | Process exit code: `0` success, `1` error/timeout, `10` blocked, `11` cancelled. |
| `sessionId` | `string \| undefined` | Session identifier. Pass to `--resume <id>` to continue this session. |
| `duration` | `number` | Session wall-clock duration in milliseconds. |
| `cost` | `CostObject` | Token usage and cost breakdown. |
| `toolCalls` | `number` | Total tool calls made during the session. |
| `events` | `number` | Total events processed during the session. |
| `milestone` | `string \| undefined` | Active milestone ID, for example `"M001"`. |
| `phase` | `string \| undefined` | Current Hammer phase at session end, for example `"executing"`, `"blocked"`, or `"complete"`. |
| `nextAction` | `string \| undefined` | Recommended next action from the state machine. |
| `artifacts` | `string[] \| undefined` | Paths to artifacts created or modified during the session. |
| `commits` | `string[] \| undefined` | Git commit SHAs created during the session. |

### Status to Exit Code Mapping

| Status | Exit Code | Constant | Meaning |
|--------|-----------|----------|---------|
| `success` | `0` | `EXIT_SUCCESS` | Unit, command, or milestone completed successfully. |
| `error` | `1` | `EXIT_ERROR` | Runtime error or LLM failure. |
| `timeout` | `1` | `EXIT_ERROR` | `--timeout` deadline exceeded. |
| `blocked` | `10` | `EXIT_BLOCKED` | Execution blocked and needs intervention. |
| `cancelled` | `11` | `EXIT_CANCELLED` | Cancelled by user or orchestrator. |

IAM/no-degradation failures should surface as blocked or error outcomes with state artifacts to inspect. If a result says `success` but required awareness/provenance artifacts are missing, treat that as a verification failure outside the JSON contract.

### Cost Object

| Field | Type | Description |
|-------|------|-------------|
| `cost.total` | `number` | Total cost in USD for the session. |
| `cost.input_tokens` | `number` | Input tokens consumed. |
| `cost.output_tokens` | `number` | Output tokens generated. |
| `cost.cache_read_tokens` | `number` | Tokens served from prompt cache. |
| `cost.cache_write_tokens` | `number` | Tokens written to prompt cache. |

## Parsing Patterns

### Decision-Making After Each Step

```bash
RESULT=$(hammer headless --output-format json next 2>/dev/null)
EXIT=$?

case $EXIT in
  0)
    PHASE=$(echo "$RESULT" | jq -r '.phase')
    NEXT=$(echo "$RESULT" | jq -r '.nextAction')
    echo "Success — phase: $PHASE, next: $NEXT"
    ;;
  1)
    STATUS=$(echo "$RESULT" | jq -r '.status // "malformed"' 2>/dev/null || echo malformed)
    echo "Failed — status: $STATUS"
    hammer headless query | jq '.state'
    ;;
  10)
    echo "Blocked — needs intervention"
    hammer headless query | jq '{phase: .state.phase, blockers: .state.blockers, next: .next}'
    ;;
  11)
    echo "Cancelled"
    ;;
esac
```

### Cost Tracking

```bash
RESULT=$(hammer headless --output-format json next 2>/dev/null)

COST=$(echo "$RESULT" | jq -r '.cost.total')
INPUT=$(echo "$RESULT" | jq -r '.cost.input_tokens')
OUTPUT=$(echo "$RESULT" | jq -r '.cost.output_tokens')

echo "Cost: \$$COST (${INPUT} in / ${OUTPUT} out)"
```

### Session Resumption

```bash
# First run — capture session ID.
RESULT=$(hammer headless --output-format json next 2>/dev/null)
SESSION_ID=$(echo "$RESULT" | jq -r '.sessionId')

# Resume the same session later.
hammer headless --resume "$SESSION_ID" --output-format json next 2>/dev/null
```

### Artifact Collection

```bash
RESULT=$(hammer headless --output-format json auto 2>/dev/null)

# List files created or modified.
echo "$RESULT" | jq -r '.artifacts[]?'

# List commits made.
echo "$RESULT" | jq -r '.commits[]?'
```

## Example Result

```json
{
  "status": "success",
  "exitCode": 0,
  "sessionId": "abc123def456",
  "duration": 45200,
  "cost": {
    "total": 0.42,
    "input_tokens": 15000,
    "output_tokens": 3500,
    "cache_read_tokens": 8000,
    "cache_write_tokens": 2000
  },
  "toolCalls": 12,
  "events": 87,
  "milestone": "M001",
  "phase": "executing",
  "nextAction": "dispatch",
  "artifacts": [
    ".hammer/milestones/M001/slices/S01/tasks/T01-SUMMARY.md"
  ],
  "commits": [
    "a1b2c3d"
  ]
}
```

## Combined with `query` for Full Picture

`HeadlessJsonResult` captures what happened during one session. Use `query` for current project state and remediation context.

```bash
# What happened in this step?
RESULT=$(hammer headless --output-format json next 2>/dev/null)
echo "$RESULT" | jq '{status, cost: .cost.total, phase}'

# What is the overall project state now?
hammer headless query | jq '{phase: .state.phase, progress: .state.progress, totalCost: .cost.total}'
```

## Malformed or Missing Result Handling

If stdout is empty, invalid JSON, or missing required fields:

1. Keep the original exit code.
2. Inspect stderr from the subprocess if captured.
3. Run `hammer headless query` to inspect `.hammer` state.
4. If state shows `blocked`, follow blocker remediation rather than retrying blindly.
5. If state is unavailable, run `hammer headless doctor` and escalate with the malformed output evidence.
