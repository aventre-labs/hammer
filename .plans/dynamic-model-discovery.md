# Dynamic Model Discovery
<!-- HAMMER FORK BRIDGE: This file is part of Hammer's documentation surface. Hammer is a fork of GSD-2 that adds explicit IAM-gated subagent dispatch, a no-guardrails posture, recover-and-resume on session crash, and Omega-driven discuss/research/plan/execute/refine phases. Legacy `/gsd` commands, `gsd_*` tool names, `.gsd/` state paths, and `GSD_*` env vars remain accepted as internal-implementation/state-bridge surface so existing installations keep working — see CHANGELOG.md and VISION.md for the full fork-relationship note. -->


## Overview
Runtime model discovery from provider APIs with caching, TUI management, and CLI flags.

## Components
1. **model-discovery.ts** — Provider adapters (OpenAI, Ollama, OpenRouter, Google) + static adapters
2. **discovery-cache.ts** — Disk cache at `{agentDir}/discovery-cache.json` with per-provider TTLs
3. **models-json-writer.ts** — Safe read-modify-write for `models.json` with file locking
4. **provider-manager.ts** — TUI component for provider management (`/provider` command)
5. **model-registry.ts** — Extended with `discoverModels()`, `getAllWithDiscovered()`, cache integration
6. **settings-manager.ts** — `modelDiscovery` settings (enabled, providers, ttlMinutes, autoRefreshOnModelSelect)
7. **args.ts** — `--discover`, `--add-provider`, `--base-url`, `--discover-models` CLI flags
8. **list-models.ts** — Rewritten with `[discovered]` badge support
9. **main.ts** — CLI handlers for new flags
10. **interactive-mode.ts** — `/provider` command handler
11. **preferences.ts** — `updatePreferencesModels()` and `validateModelId()` helpers

## TTL Strategy
- Ollama: 5 min (local, models change often)
- OpenAI / Google / OpenRouter: 1 hour
- Default: 24 hours

## Merge Rules
- Discovered models never override existing built-in or custom models
- Discovered models are appended to the registry with `[discovered]` badge
- Background discovery is opt-in via `modelDiscovery.enabled` setting
