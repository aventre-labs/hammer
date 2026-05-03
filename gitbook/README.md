# What is Hammer?

> **Fork bridge.** Hammer is a fork of GSD-2. The npm package, binary, MCP tool prefixes, on-disk state directory, and many command surfaces are preserved verbatim so existing GSD-2 workflows keep working. The Hammer-specific commitments — **Omega-driven phases**, **IAM (Integrated Awareness Model) integration**, **a no-guardrails posture**, and **recover-and-resume** — are introduced on this page and detailed throughout this book. The slash command surface is dual: every `/gsd …` command is also available as `/hammer …`, dispatching to the same handler.

Hammer is an AI-powered development agent that turns project ideas into working software. Describe what you want to build, and Hammer researches, plans, codes, tests, and commits — with clean git history, full cost tracking, and structural awareness gates that fail closed when something is missing.

## How It Works

Hammer breaks your project into manageable pieces and works through them systematically:

```
You describe your project
    ↓
Hammer creates a milestone with slices (features)
    ↓
Each slice is decomposed into tasks
    ↓
Tasks are executed one at a time in fresh AI sessions
    ↓
Code is committed, verified, and the next task begins
```

You can stay hands-on with **step mode** (reviewing each step) or let Hammer run autonomously with **auto mode** while you grab coffee.

## Hammer-Specific Commitments

These are the structural commitments that distinguish Hammer from GSD-2 — see [Omega-Driven Phases, IAM, and No-Guardrails Posture](core-concepts/omega-phases.md) for the full treatment.

- **Omega-driven phases** — every auto-mode unit runs inside a phase bound to one or more stages of the canonical 10-stage Omega Protocol. Stage manifests are written to disk and consumed by downstream phases.
- **IAM integration** — `IAM_SUBAGENT_CONTRACT` (enforced by `iam-subagent-policy.ts`) is the structural fail-closed gate around subagent dispatch and key tool boundaries. There is no bypass.
- **No-guardrails posture** — Hammer ships zero soft warnings, "are you sure?" prompts, or coaching nags. IAM is the **only** structural guardrail.
- **Recover-and-resume** — interrupted sessions reconstruct full context from the surviving session file, write a `RECOVERY_VERDICT`, and continue without losing provenance.

## Key Features

- **Autonomous execution** — `/hammer auto` (or `/gsd auto`) runs research, planning, coding, testing, and committing without intervention
- **20+ LLM providers** — Anthropic, OpenAI, Google, OpenRouter, GitHub Copilot, Amazon Bedrock, local models, and more
- **Git isolation** — Each milestone works in its own worktree branch, merged cleanly when done
- **Cost tracking** — Real-time token usage, budget ceilings, and automatic model downgrading
- **Recover-and-resume** — Sessions resume automatically after interruptions with full provenance
- **Skills system** — Domain-specific instruction sets for frameworks, languages, and tools
- **Parallel milestones** — Run multiple milestones simultaneously in isolated worktrees
- **Remote questions** — Get Discord, Slack, or Telegram notifications when Hammer needs input
- **Web interface** — Browser-based dashboard with real-time progress
- **VS Code extension** — Chat participant, sidebar dashboard, and full command palette
- **Headless mode** — Run in CI pipelines, cron jobs, and scripted automation

## Quick Start

```bash
# Install (npm package name preserved from GSD-2)
npm install -g gsd-pi

# Launch (binary name preserved from GSD-2)
gsd

# Start autonomous mode (use either /hammer or /gsd — both dispatch to the same handler)
/hammer auto
```

See [Installation](getting-started/installation.md) for detailed setup instructions.

## Two Ways to Work

| Mode | Command | Best For |
|------|---------|----------|
| **Step** | `/hammer` (or `/gsd`) | Staying in the loop, reviewing each step |
| **Auto** | `/hammer auto` (or `/gsd auto`) | Walking away, overnight builds, batch work |

The recommended workflow: run auto mode in one terminal, steer from another. See [Step Mode](core-concepts/step-mode.md) and [Auto Mode](core-concepts/auto-mode.md).

## Requirements

- **Node.js** 22.0.0 or later (24 LTS recommended)
- **Git** installed and configured
- An API key for at least one LLM provider (or use browser sign-in for Anthropic/GitHub Copilot)
