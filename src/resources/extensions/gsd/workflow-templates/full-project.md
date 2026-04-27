# Full Project Workflow

Hammer Awareness: this bundled workflow is Hammer-native and inherits IAM/Omega/Trinity/VOLVOX/no-degradation semantics; preserve provenance, declared artifacts, and verification evidence.

<template_meta>
name: full-project
version: 1
mode: auto-milestone
requires_project: true
artifact_dir: .hammer/
</template_meta>

<purpose>
The complete Hammer workflow with full ceremony: roadmap, milestones, slices, tasks,
research, planning, execution, and verification. Use for greenfield projects or
major features that need the full planning apparatus.

This template wraps the existing Hammer workflow for registry completeness.
When selected, it routes to the standard /hammer init → /hammer auto pipeline.
</purpose>

<phases>
1. init    — Initialize project, detect stack, create .hammer/
2. discuss — Define requirements, decisions, and architecture
3. plan    — Create roadmap with milestones and slices
4. execute — Execute slices: research → plan → implement → verify per slice
5. verify  — Milestone-level verification and completion
</phases>

<process>

## Routing to Standard Hammer

This template is a convenience entry point. When selected via `/hammer start full-project`,
it should route to the standard Hammer workflow:

1. If `.hammer/` doesn't exist: Run `/hammer init` to bootstrap the project
2. If `.hammer/` exists but no milestones: Start the discuss phase via `/hammer discuss`
3. If milestones exist: Resume via `/hammer auto` or `/hammer next`

The full Hammer workflow protocol is still packaged at the legacy compatibility resource path `GSD-WORKFLOW.md`; it handles all
phases, state tracking, and agent orchestration.

</process>
