# Web Interface

> **Fork bridge.** Hammer is a fork of GSD-2. This page describes a surface preserved verbatim from GSD-2 — references to "GSD" in the prose below describe the same Hammer behavior. Slash commands shown as `/gsd …` are also reachable as `/hammer …` (both dispatch to the same handler). See the **Omega-Driven Phases, IAM, and No-Guardrails Posture** chapter for what Hammer adds on top.


GSD includes a browser-based interface for project management and real-time progress monitoring.

## Quick Start

```bash
gsd --web
```

This starts a local web server and opens the dashboard in your default browser.

## CLI Flags

```bash
gsd --web --host 0.0.0.0 --port 8080 --allowed-origins "https://example.com"
```

| Flag | Default | Description |
|------|---------|-------------|
| `--host` | `localhost` | Bind address |
| `--port` | `3000` | Port |
| `--allowed-origins` | (none) | Comma-separated CORS origins |

## Features

- **Project management** — view milestones, slices, and tasks in a visual dashboard
- **Real-time progress** — live updates as auto mode executes
- **Multi-project support** — manage multiple projects from one browser tab via `?project=` URL parameter
- **Change project root** — switch directories from the web UI without restarting
- **Onboarding flow** — API key setup and provider configuration in the browser
- **Model selection** — switch models and providers from the web UI

## Platform Notes

- **macOS/Linux** — Full support
- **Windows** — Web build is skipped due to Next.js compatibility issues; CLI remains fully functional
