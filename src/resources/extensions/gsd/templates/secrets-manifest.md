# Hammer Secrets Manifest

<!-- This file lists predicted API keys and secrets for the Hammer milestone.
     Each H3 section defines one secret with setup guidance.
     The parser extracts entries by H3 heading (the env var name).
     Bold fields: Service, Dashboard, Format hint, Status, Destination.
     Guidance is a numbered list under each entry.
     IAM provenance belongs in guidance source notes, never in secret values. -->

**Milestone:** {{milestone}}
**Generated:** {{generatedAt}}

## Hammer Secret Handling Contract

- Keep secret names, destinations, and setup provenance visible; never write secret values into this manifest, logs, diagnostics, or generated summaries.
- Use Hammer's secure collection path for real values and preserve no-degradation behavior: missing required secrets should block the dependent runtime check with remediation, not trigger hardcoded fallbacks.
- `.hammer` is the canonical state/config root; read `.gsd` only as a legacy state bridge when compatibility code explicitly requires it.
- Verification may mention env var names and redacted status only.

### {{ENV_VAR_NAME}}

**Service:** {{serviceName}}
**Dashboard:** {{dashboardUrl}}
**Format hint:** {{formatHint}}
**Status:** pending
**Destination:** dotenv

1. {{Step 1 guidance}}
2. {{Step 2 guidance}}
3. {{Step 3 guidance}}
