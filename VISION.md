# Vision

Hammer is the orchestration layer between an experienced operator and an AI coding agent. It handles planning, execution, verification, and shipping so you can focus on what to build, not on how to wrangle the tools.

Hammer is forked from GSD-2. The product identity, slash commands, and audience framing are Hammer; the underlying npm package (`gsd-pi`), state-bridge filesystem paths (`.gsd/`), and DB-backed tool names (`gsd_*` aliased alongside `hammer_*`) are preserved as internal-implementation surface during the rebrand window.

## Who it's for

Operators who already code with AI agents every day, find permission prompts and confirm-before-edit dialogs slowing them down, and accept the responsibility that comes with autonomous execution. Hammer adapts to skill level and workflow but its default disposition is **go**, not **ask**.

## No-guardrails posture

This is the central product distinction. Hammer is intentionally **unsafe-mode by default**: there is no confirm-before-edit, no permission prompt on file writes, no human checkpoint between research, plan, execute, verify, and commit phases. Auto-mode advances on its own and trusts the operator to have set the project up correctly.

The only structural guardrail is the recover-and-resume loop's **3-strike cap**: if recovery itself fails three times in a row, auto-mode pauses and surfaces the structured `RECOVERY_VERDICT` trailer for human inspection rather than spinning forever. Everything else — file writes, shell commands, git operations, dependency installs — runs without prompting.

This posture is deliberate, not an oversight. It exists because:

- The audience is operators who already know how to evaluate AI-generated changes and want throughput, not training wheels.
- Permission gates create cadence drag that compounds over a long milestone; removing them is the largest single-axis throughput win available.
- The structural guardrails Hammer **does** keep — IAM fail-closed envelopes, Omega per-stage artifact persistence, 3-strike recovery cap, structured verification — are durable and machine-readable, not human-in-the-loop dialogs.

If you want guarded edits with confirm-before-write and explicit ask-on-tool-call, run Claude Code directly. Hammer is an opinionated alternative for users who already evaluated that tradeoff and chose throughput.

## Principles

**Extension-first.** If it can be an extension, it should be. Core stays lean. New capabilities belong in extensions, skills, and plugins unless they fundamentally require core integration.

**Simplicity over abstraction.** The codebase was aggressively cleaned up. Every line earns its place. Don't add helpers, utilities, or abstractions unless they eliminate real duplication or solve a real problem. Three similar lines of code is better than a premature abstraction.

**Tests are the contract.** If you change behavior, the tests tell you what you broke. Write tests for new behavior. Trust the test suite.

**Ship fast, fix fast.** Get it out, iterate quickly, don't let perfect be the enemy of good. Every release should work, but we'd rather ship and patch than delay and accumulate.

**Provider-agnostic.** Hammer works with any LLM provider. No architectural decisions should privilege one provider over another.

**Fail closed at the chokepoint.** Where IAM, Omega, or recovery semantics would otherwise drift silently, Hammer fails closed and surfaces a structured marker for inspection. Soft-failing or "best effort continue" is not acceptable in those paths — recovery and policy decisions must be auditable.

## What we won't accept

These save everyone time. Don't open PRs for:

- **Enterprise patterns.** Dependency injection containers, abstract factories, strategy-pattern-for-the-sake-of-it, over-engineered config systems. This is a CLI tool, not a Spring application.

- **Framework swaps.** Rewriting working code in a different library or framework without a clear, measurable improvement in performance or maintainability. "I prefer X" is not sufficient motivation.

- **Cosmetic refactors.** Renaming variables to your preferred style, reordering imports, reformatting code that works. This is pure churn that creates merge conflicts and review burden for zero user value.

- **Complexity without user value.** If a change adds abstraction, indirection, or configuration but doesn't improve something a user can see or feel, it doesn't belong here.

- **Heavy orchestration layers.** Don't duplicate what the agent infrastructure already provides. Build on top of it, don't wrap it.

- **Re-introducing permission prompts.** Hammer's no-guardrails posture is the product, not a missing feature. PRs that add confirm-before-edit, ask-on-tool-call, or other interactive guardrails to the default path will be closed. Optional opt-in flags are fine if they default off; structural enforcement (IAM markers, Omega artifacts, recovery cap) is the right place to invest defensive work.

## Relationship to GSD-1 and GSD-2

GSD-1 is the original prompt-framework version. GSD-2 was the standalone-CLI rewrite on the Pi SDK. Hammer is forked from GSD-2 and is where active development, new features, and architectural investment now happen. GSD-2 itself continues to serve its community; Hammer's audience is the subset of GSD-2 users who want IAM integration, recover-and-resume guarantees, Omega-driven phase artifacts, and the no-guardrails posture as defaults rather than opt-ins.
