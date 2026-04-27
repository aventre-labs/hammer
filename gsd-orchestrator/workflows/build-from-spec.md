# Build From Spec

> Hammer/IAM awareness: a spec is the provenance root for the build. It must describe user outcomes, technical constraints, verification expectations, and no-degradation requirements before Hammer executes it.

End-to-end workflow: take a product idea or specification, run Hammer headless, and verify working software.

## Prerequisites

- `hammer` CLI installed from `hammer-pi`.
- A project directory, which may be empty.
- Git initialized in the directory.
- A spec that names required awareness/provenance evidence, especially when the build touches IAM, Omega, Trinity, VOLVOX, data access, security, or irreversible operations.

## Process

### Step 1: Prepare the project directory

```bash
PROJECT_DIR="/tmp/my-project-name"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
git init 2>/dev/null  # Hammer needs a git repo.
```

New builds should create canonical Hammer state under `.hammer/`. Do not pre-create `.gsd/`; that path is a legacy state bridge for older projects only.

### Step 2: Write the spec file

Write a spec file that describes what to build. More precise specs produce better results.

```bash
cat > spec.md << 'SPEC'
# Product Name

## Outcome
[Concrete description of what a user can accomplish when this is done.]

## Requirements
- [Specific, testable user action 1]
- [Specific, testable user action 2]
- [Specific system behavior]
- [Required error handling]

## Technical Constraints
- [Language, framework, or platform requirements]
- [External services, APIs, databases, or filesystem constraints]
- [Performance, privacy, and security requirements]

## Verification Expectations
- [Command, test, browser flow, or observable behavior that proves success]
- [Negative case or boundary condition to test]

## Awareness and Provenance
- [What IAM/Omega/Trinity/VOLVOX evidence must be preserved]
- [What no-degradation blocker should stop the build]

## Out of Scope
- [Things explicitly not included]
SPEC
```

**Spec quality matters.** Include:

- What the user can do when the build is done.
- Technical constraints such as language, framework, runtime version, storage, and external services.
- Explicit exclusions to prevent scope creep.
- Verification expectations for success and negative paths.
- Awareness/provenance requirements and no-degradation blockers.

Missing awareness artifacts should become blocker remediation, not silent fallback behavior.

### Step 3: Launch the build

**Fire-and-forget:** Hammer handles planning, execution, verification summaries, and commits.

```bash
cd "$PROJECT_DIR"
RESULT=$(hammer headless --output-format json --timeout 0 --context spec.md new-milestone --auto 2>/dev/null)
EXIT=$?
```

`--timeout 0` disables the outer timeout for long builds. `--auto` chains milestone creation into execution.

**With budget limit:** use step-by-step mode with budget checks instead of `auto`; see `workflows/step-by-step.md`.

**For CI or ecosystem runs without local user context:**

```bash
RESULT=$(hammer headless --bare --output-format json --timeout 0 --context spec.md new-milestone --auto 2>/dev/null)
EXIT=$?
```

### Step 4: Handle the result

```bash
case $EXIT in
  0)
    # Success — verify deliverables.
    STATUS=$(echo "$RESULT" | jq -r '.status')
    COST=$(echo "$RESULT" | jq -r '.cost.total')
    COMMITS=$(echo "$RESULT" | jq -r '.commits | length')
    echo "Build complete: $STATUS, cost: \$$COST, commits: $COMMITS"

    # Inspect what was built.
    hammer headless query | jq '.state.progress'

    # Check the actual files. Exclude Hammer state and git internals.
    find "$PROJECT_DIR" -not -path '*/.hammer/*' -not -path '*/.git/*' -type f
    ;;
  1)
    # Error or timeout — inspect and decide.
    echo "Build failed"
    echo "$RESULT" | jq '{status: .status, phase: .phase}' 2>/dev/null || true

    # Check state for details and remediation hints.
    hammer headless query | jq '.state'
    ;;
  10)
    # Blocked — needs intervention.
    echo "Build blocked — needs remediation"
    hammer headless query | jq '{phase: .state.phase, blockers: .state.blockers, next: .next}'

    # Options: steer, supply answers, dispatch replan, or escalate.
    # See workflows/monitor-and-poll.md for blocker handling.
    ;;
  11)
    echo "Build was cancelled"
    ;;
esac
```

### Step 5: Verify deliverables

After a successful build, verify the output with the project's own contract:

```bash
cd "$PROJECT_DIR"

# Check project state.
hammer headless query | jq '{
  phase: .state.phase,
  progress: .state.progress,
  cost: .cost.total
}'

# Check Hammer-generated summaries and decisions.
find .hammer -name '*SUMMARY.md' -o -name 'DECISIONS.md' -o -name 'REQUIREMENTS.md'

# Check git log for what was built.
git log --oneline

# Run the project's own tests if they exist.
[ -f package.json ] && npm test 2>/dev/null
[ -f Makefile ] && make test 2>/dev/null
```

Success means both the subprocess exited successfully and the deliverables satisfy the spec. If generated artifacts omit required IAM/provenance/no-degradation evidence, treat the build as needing remediation even if exit code was `0`.

## Complete Example

```bash
# 1. Setup.
mkdir -p /tmp/todo-api && cd /tmp/todo-api && git init

# 2. Write spec.
cat > spec.md << 'SPEC'
# Todo API

Build a REST API for managing todo items using Node.js and Express.

## Requirements
- GET /todos lists all todos.
- POST /todos creates a todo with title and completed fields.
- PUT /todos/:id updates a todo.
- DELETE /todos/:id deletes a todo.
- GET /health returns service health.
- Invalid input returns descriptive 4xx errors.

## Technical Constraints
- Node.js with ESM modules.
- Express framework.
- No external database; store todos in memory.
- Port configurable via PORT env var, default 3000.

## Verification Expectations
- Unit or integration tests cover CRUD happy paths.
- Negative tests cover malformed todo payloads and unknown IDs.
- A health-check request proves the server starts.

## Awareness and Provenance
- Summaries must name the requirements verified and the commands run.
- If tests cannot run, Hammer must block or report remediation rather than claiming success.

## Out of Scope
- Authentication.
- Persistent storage.
- Frontend.
SPEC

# 3. Launch.
RESULT=$(hammer headless --output-format json --timeout 0 --context spec.md new-milestone --auto 2>/dev/null)
EXIT=$?

# 4. Report.
if [ $EXIT -eq 0 ]; then
  COST=$(echo "$RESULT" | jq -r '.cost.total')
  echo "Build complete (\$$COST)"
  echo "Files created:"
  find . -not -path './.hammer/*' -not -path './.git/*' -type f
else
  echo "Build did not complete successfully (exit $EXIT)"
  echo "$RESULT" | jq . 2>/dev/null || true
  hammer headless query | jq '.state' 2>/dev/null || true
fi
```
