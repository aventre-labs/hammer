# Issue #120 — GSD Auto Secret Collection Improvements

## Problem Statement

Users report three failures in auto-mode secret handling:

1. **Late discovery** — Secrets aren't gathered until well into execution (e.g., first slice), blocking progress for hours while the user is away
2. **Re-asking across slices** — The same secrets are requested again at the start of later slices
3. **Re-asking within slices** — The same secrets are requested again mid-slice

All three stem from the same architectural gap: GSD has no proactive secret identification, and no reliable persistence of project-specific secrets across fresh sessions.

---

## Current Architecture

### Secret Collection Tool

`src/resources/extensions/get-secrets-from-user.ts`

- `secure_env_collect` — paged, masked-input TUI for collecting env vars
- Writes to three destinations: `.env` (local), Vercel (`vercel env add`), Convex (`npx convex env set`)
- Values are masked in UI and never echoed in tool output
- Well-built tool — the problem isn't collection UX, it's when and how often collection happens

### Secret Persistence (GSD-owned keys only)

`src/wizard.ts` — `loadStoredEnvKeys()`

Runs at CLI startup. Loads a hardcoded list of GSD's own keys from `~/.gsd/agent/auth.json` into `process.env`:

- `BRAVE_API_KEY`, `BRAVE_ANSWERS_KEY`
- `CONTEXT7_API_KEY`, `JINA_API_KEY`, `TAVILY_API_KEY`
- `SLACK_BOT_TOKEN`, `DISCORD_BOT_TOKEN`

**Project-specific secrets** (GitHub tokens, database URLs, OpenAI keys, etc.) collected via `secure_env_collect` to `.env` are NOT loaded by this mechanism.

### Fresh Session Model

`src/resources/extensions/gsd/auto.ts`

Each unit of work (plan slice, execute task, complete slice) gets a fresh session via `ctx.newSession()`. This means:

- Clean context window
- State rebuilt from `.gsd/` artifacts on disk
- No memory of what happened in the previous session
- `process.env` does not include project `.env` contents unless something explicitly loads them

### Prompt Guidance

| File | What it says about secrets |
|------|--------------------------|
| `system.md:26-27` | Never log secrets; use `secure_env_collect` instead of manual `.env` editing |
| `system.md:131` | Routes "Secrets" to `secure_env_collect` |
| `system.md:197` | After applying secrets, rerun the blocked workflow |
| `execute-task.md:30` | Never log secrets/tokens unnecessarily |
| `secure_env_collect` promptGuidelines | Proactively call before first command needing secrets; call when commands fail due to missing env vars |

All guidance is **reactive** — "when you hit an error, collect the secret." Nothing says "identify all secrets upfront before execution begins."

### What's Missing

| Gap | Impact |
|-----|--------|
| No secret identification during research/planning | Secrets discovered reactively during execution, often hours in |
| No `.env` loading across fresh sessions | Previously-collected project secrets invisible to new sessions |
| No "secrets already collected" carry-forward | Agent in fresh session doesn't know what was already gathered |
| No `Required Credentials` section in requirements | No structured place to track what the project needs |
| No deduplication or "already have this" check | Agent re-asks for secrets it already wrote to `.env` |

---

## Root Cause Analysis

### Problem 1: Late Discovery

The research phase (`research-milestone.md`) focuses on codebase exploration, technology assessment, and strategic questions. The planning phase (`plan-milestone.md`, `plan-slice.md`) focuses on task decomposition and verification. Neither phase includes a step to identify required credentials.

The `secure_env_collect` promptGuidelines say "when starting a new project or running setup steps that require secrets, proactively call secure_env_collect before the first command that needs them" — but this fires during task execution, not during planning. By then, the user may be asleep.

### Problem 2: Re-asking Across Slices

When `secure_env_collect` writes a secret to `.env`, that file persists on disk. But when auto-mode spawns a fresh session for the next slice, the new session's `process.env` doesn't include the `.env` contents. The agent in the new session encounters the same "missing env var" error and calls `secure_env_collect` again.

The `loadStoredEnvKeys()` function only loads GSD's own keys from AuthStorage, not project-specific keys from `.env`.

### Problem 3: Re-asking Within Slices

Within a single session, if `secure_env_collect` writes to `.env` but the calling code reads from `process.env` (not the file), the secret appears missing. Additionally, if a task uses a tool that checks `process.env` independently, it won't see the `.env` file contents unless something loads them.

---

## Proposed Solutions

### Solution 1: Proactive Secret Identification During Planning

**Where**: `src/resources/extensions/gsd/prompts/plan-milestone.md`

Add a step after research is consumed and before slice decomposition:

> Identify all secrets, API keys, tokens, credentials, and external service configurations this milestone will require. Consider:
> - APIs being integrated (keys, tokens, OAuth credentials)
> - Databases (connection strings, passwords)
> - Third-party services (webhook secrets, API keys)
> - Deployment targets (platform tokens)
>
> If any secrets are needed, call `secure_env_collect` now to gather them before execution begins. This prevents blocking during unattended execution.

**Also update**: `src/resources/extensions/gsd/templates/requirements.md` — add a `## Required Credentials` section:

```markdown
## Required Credentials

| Key | Purpose | Source | Status |
|-----|---------|--------|--------|
| GITHUB_TOKEN | GitHub API access | User | collected |
| DATABASE_URL | PostgreSQL connection | User | pending |
```

### Solution 2: Load Project `.env` on Fresh Session Start

**Where**: `src/resources/extensions/gsd/auto.ts` — before spawning each fresh session

Before `ctx.newSession()`, read the project's `.env` file and inject its contents into the session's environment. This ensures previously-collected secrets carry forward without re-asking.

Implementation approach:

```typescript
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function loadProjectEnv(cwd: string): Promise<void> {
  try {
    const envPath = resolve(cwd, ".env");
    const content = await readFile(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      // Don't override explicitly-set env vars
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // No .env file — that's fine
  }
}
```

Call this before each fresh session spawn in auto-mode.

**Alternative**: Persist project secrets to AuthStorage alongside GSD's own keys, so `loadStoredEnvKeys()` picks them up. This is cleaner but requires changes to `secure_env_collect` to write to both `.env` and AuthStorage.

### Solution 3: Carry-Forward Context for Collected Secrets

**Where**: `src/resources/extensions/gsd/auto.ts` — in the context/prompt assembly for fresh sessions

Add a section to the injected prompt that lists secrets already collected:

> ## Previously Collected Secrets
> The following env vars have already been collected and are available in `.env`:
> - `GITHUB_TOKEN` ✓
> - `DATABASE_URL` ✓
>
> Do NOT re-ask the user for these. If a command fails due to a missing env var not on this list, use `secure_env_collect`.

This requires scanning `.env` for key names (not values) and including them in the carry-forward context.

### Solution 4: Update Execute-Task Prompt

**Where**: `src/resources/extensions/gsd/prompts/execute-task.md`

Add an early step:

> Before starting work, check if the task requires env vars or secrets. If so, verify they exist in `.env` or `process.env`. If missing, call `secure_env_collect` immediately rather than discovering the need mid-task.

---

## Implementation Priority

| Priority | Solution | Effort | Impact |
|----------|----------|--------|--------|
| 1 | Solution 2: Load `.env` on fresh session start | Small | Eliminates re-asking (Problems 2 & 3) |
| 2 | Solution 3: Carry-forward collected secret names | Small | Prevents agent confusion about what's available |
| 3 | Solution 1: Proactive identification during planning | Medium | Eliminates late discovery (Problem 1) |
| 4 | Solution 4: Execute-task prompt update | Small | Defense-in-depth for Problem 1 |

Solutions 1-3 together fully address the issue. Solution 4 is defense-in-depth.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/resources/extensions/gsd/auto.ts` | Load `.env` before fresh sessions; include collected secret names in carry-forward context |
| `src/resources/extensions/gsd/prompts/plan-milestone.md` | Add proactive secret identification step |
| `src/resources/extensions/gsd/prompts/execute-task.md` | Add early secret verification step |
| `src/resources/extensions/gsd/templates/requirements.md` | Add Required Credentials section |
| `src/resources/extensions/get-secrets-from-user.ts` | (Optional) Dual-write to AuthStorage for cross-project persistence |

---

## Edge Cases to Consider

- **Non-dotenv destinations**: If secrets were sent to Vercel or Convex, the `.env` loading approach won't help. May need to track "collected secrets" in a `.gsd/secrets-manifest.json` (key names only, no values).
- **Multiple `.env` files**: Some projects use `.env.local`, `.env.development`, etc. The loader should check common variants.
- **Secrets that change**: If a user needs to rotate a key, the "don't re-ask" logic should have an escape hatch.
- **Workspace vs global secrets**: Some secrets (like `GITHUB_TOKEN`) are user-global; others (like `DATABASE_URL`) are project-specific. Consider whether global secrets should go to AuthStorage while project secrets stay in `.env`.
