# Answer Injection

> Hammer/IAM awareness: injected answers preserve provenance and no-degradation blocking without exposing secret values. Use answer files to remove interactive pauses, not to bypass required remediation.

Pre-supply answers and secrets to eliminate interactive prompts during headless execution.

## Usage

```bash
hammer headless --answers answers.json auto
hammer headless --answers answers.json new-milestone --context spec.md --auto
```

The `--answers` flag takes a path to a JSON file containing pre-supplied answers and secrets. Keep the file outside committed source or delete it after the run.

## Answer File Schema

```json
{
  "questions": {
    "question_id": "selected_option_label",
    "multi_select_question": ["option_a", "option_b"]
  },
  "secrets": {
    "API_KEY": "<redacted>",
    "DATABASE_URL": "<redacted>"
  },
  "defaults": {
    "strategy": "first_option"
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `questions` | `Record<string, string \| string[]>` | Map question ID to answer. Use a string for single-select and a string array for multi-select. |
| `secrets` | `Record<string, string>` | Map env var name to value. Values are injected into the Hammer child process environment. |
| `defaults.strategy` | `"first_option" \| "cancel"` | Fallback for unmatched questions. Default is `"first_option"`. Use `"cancel"` when guessing could degrade the result. |

## How Secrets Work

Secrets are injected as environment variables into the Hammer child process:

1. The orchestrator passes the answer file via `--answers`.
2. Hammer reads the file and sets secret values as env vars in the child process.
3. When a secret-collection tool runs inside the agent, it finds the keys already in `process.env`.
4. The tool skips the interactive prompt and reports the keys as already configured.

Secrets must never be logged, copied into docs, included in JSON event streams, or echoed back to a user. Examples should show env var names and redacted placeholders only.

## How Question Matching Works

Two-phase correlation:

1. **Observe** — Hammer monitors `tool_execution_start` events for `ask_user_questions` to extract question metadata: ID, options, and multi-select support.
2. **Match** — Subsequent `extension_ui_request` events are correlated to that metadata and answered with the pre-supplied value.

The injector handles out-of-order events. If `extension_ui_request` arrives before metadata, it defers processing briefly, then applies the configured default strategy.

## Coexistence with `--supervised`

`--answers` and `--supervised` can be active simultaneously. Priority order:

1. Answer injector tries first.
2. If no answer matches, supervised mode forwards to the orchestrator.
3. If no orchestrator response arrives within `--response-timeout`, the auto-responder applies the default behavior.

Use this mode when most questions are predictable but blockers still need external judgment.

## Without Answer Injection

Headless mode has built-in auto-responders for prompt types:

| Prompt Type | Default Behavior |
|-------------|------------------|
| Select | Picks first option. |
| Confirm | Auto-confirms. |
| Input | Empty string. |
| Editor | Returns prefill or empty. |

Answer injection overrides these defaults when precision matters. If the question affects IAM/provenance, production data, irreversible operations, or no-degradation scope, prefer an explicit answer or `"cancel"` over first-option guessing.

## Diagnostics

The injector tracks statistics printed in the session summary:

| Stat | Description |
|------|-------------|
| `questionsAnswered` | Questions resolved from the answer file. |
| `questionsDefaulted` | Questions handled by the default strategy. |
| `secretsProvided` | Number of secret entries made available to the child process. |

Unused question IDs and secret keys are warned about at exit. Treat unused IDs as evidence that the prompt shape changed; inspect before assuming the run followed the intended path.

## Invalid Answers and Blockers

If a supplied question ID is wrong, a selected option is absent, or a required answer is not matched, the injector falls back according to `defaults.strategy`:

- `"first_option"` continues with the first available option and records a defaulted question.
- `"cancel"` sends a cancelled response, which should surface as a subprocess blocker or error.

For no-degradation workflows, `"cancel"` is safer when an unknown prompt could change scope, drop verification, or hide missing awareness artifacts. Inspect `.hammer/STATE.md` and `hammer headless query` after any cancellation.

## Example: Orchestrator with Answers

```bash
# Create answer file. Values shown here are placeholders; do not print real secrets.
cat > answers.json << 'EOF'
{
  "questions": {
    "test_framework": "vitest",
    "package_manager": "pnpm"
  },
  "secrets": {
    "OPENAI_API_KEY": "<redacted>",
    "DATABASE_URL": "<redacted>"
  },
  "defaults": {
    "strategy": "first_option"
  }
}
EOF

# Run with pre-supplied answers.
hammer headless --answers answers.json --output-format json auto 2>/dev/null

# Parse result.
RESULT=$(hammer headless --answers answers.json --output-format json next 2>/dev/null)
echo "$RESULT" | jq '{status: .status, cost: .cost.total}'
```
