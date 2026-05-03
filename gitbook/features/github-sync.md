# GitHub Sync

> **Fork bridge.** Hammer is a fork of GSD-2. This page describes a surface preserved verbatim from GSD-2 — references to "GSD" in the prose below describe the same Hammer behavior. Slash commands shown as `/gsd …` are also reachable as `/hammer …` (both dispatch to the same handler). See the **Omega-Driven Phases, IAM, and No-Guardrails Posture** chapter for what Hammer adds on top.


GSD can auto-sync milestones, slices, and tasks to GitHub Issues, PRs, and Milestones.

## Setup

1. Install and authenticate the `gh` CLI:
   ```bash
   gh auth login
   ```

2. Enable in preferences:
   ```yaml
   github:
     enabled: true
     repo: "owner/repo"              # auto-detected from git remote if omitted
     labels: [gsd, auto-generated]   # labels for created items
   ```

## Commands

| Command | Description |
|---------|-------------|
| `/github-sync bootstrap` | Initial setup — creates GitHub Milestones, Issues, and draft PRs from current `.gsd/` state |
| `/github-sync status` | Show sync mapping counts (milestones, slices, tasks) |

## How It Works

- Milestones → GitHub Milestones
- Slices → GitHub Issues (linked to milestone)
- Tasks → GitHub Issue checklists
- Completed slices → Draft PRs

Sync mapping is persisted in `.gsd/.github-sync.json`. The sync is rate-limit aware — it skips when the GitHub API rate limit is low.

## Configuration

```yaml
github:
  enabled: true
  repo: "owner/repo"
  labels: [gsd, auto-generated]
  project: "Project ID"           # optional: GitHub Project board
```
