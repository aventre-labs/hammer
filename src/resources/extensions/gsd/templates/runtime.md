# Hammer Runtime Context

## Hammer Awareness Contract

Runtime setup must keep Hammer executable and IAM-aware. Record provenance for commands, environment assumptions, and diagnostics; if required awareness or no-degradation checks cannot run, block with remediation instead of silently using a non-aware fallback.

## Stack
- **Language:** (e.g., TypeScript, Python, Go)
- **Framework:** (e.g., Next.js, FastAPI, Gin)
- **Build:** (e.g., npm run build, cargo build)
- **Test:** (e.g., npm run test, pytest)
- **Lint:** (e.g., npm run lint, ruff check)

## Environment
- **Node version:** (e.g., 20.x)
- **Package manager:** (e.g., npm, pnpm, yarn)
- **Required env vars:** (list names needed for local dev; never include values)
- **State root:** `.hammer` is canonical; `.gsd` may be read only as a legacy state bridge when compatibility code says so.

## Dev Server
- **Start command:** (e.g., npm run dev)
- **Default port:** (e.g., 3000)
- **Health check:** (e.g., curl http://localhost:3000/health)

## Diagnostics
- **Hammer/IAM checks:** (commands or scripts that verify identity, awareness, provenance, and no-degradation behavior)
- **Failure artifacts:** (logs, persisted error files, state snapshots, or none)
- **Redaction boundary:** (secrets and PII that diagnostics must not print)

## Notes
(Any runtime-specific context the executor needs to know, including Trinity/VOLVOX continuity or known gaps)
