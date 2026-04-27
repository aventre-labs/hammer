Research slice {{sliceId}} ("{{sliceTitle}}") of milestone {{milestoneId}}. Read `.gsd/DECISIONS.md` as a legacy state bridge projection if it exists — respect existing decisions, don't contradict them. Read `.gsd/REQUIREMENTS.md` as a legacy state bridge projection if it exists — identify which Active requirements this slice owns or supports and target research toward risks, unknowns, and constraints that could affect delivery of those requirements. {{skillActivation}} Explore the relevant code — use `rg`/`find` for targeted reads, or `scout` if the area is broad or unfamiliar. Check libraries with `resolve_library`/`get_library_docs` — skip this for libraries already used in the codebase. Use the **Research** output template below.

## Omega Phase Contract

Before final research persistence, complete Hammer's native Omega phase contract for this governed research unit.

1. Run `hammer_canonical_spiral` after you have enough research context and before `gsd_summary_save` (the DB-backed tool-name compatibility bridge), using `query` with your slice research synthesis question, `unitType: "research-slice"`, `unitId: "{{milestoneId}}/{{sliceId}}"`, `targetArtifactPath` for the final `{{sliceId}}-RESEARCH.md` artifact, and `persona: "engineer"` unless a loaded skill gives a stronger reason otherwise.
2. The tool result must include `runId`, `manifestPath`, `artifactDir`, `stageCount` of `10`, and a synthesis reference (`synthesisPath` or returned synthesis). Missing run id, manifest path, artifact directory, stage count, or synthesis reference means the phase contract is unsatisfied.
3. Include an `## Omega Phase Contract` section in the RESEARCH markdown citing the returned `runId`, `manifestPath`, `artifactDir`, `stageCount`, target artifact path, and synthesis reference.
4. If `hammer_canonical_spiral` returns an IAM error, times out, or cannot provide complete artifacts, stop and report the IAM error/remediation. Do not call `gsd_summary_save` as if slice research completed successfully; it remains the DB-backed tool-name compatibility bridge.
5. Do not replace the native Omega run with prose-only or deferred Omega guidance.

Call the DB-backed tool-name compatibility bridge `gsd_summary_save` with `milestone_id: {{milestoneId}}`, `slice_id: {{sliceId}}`, `artifact_type: "RESEARCH"`, and the research content — the tool writes the file to disk and persists to DB.

**You are the scout.** A planner agent reads your output in a fresh context to decompose this slice into tasks. Write for the planner — surface key files, where the work divides naturally, what to build first, and how to verify. If the research doc is vague, the planner re-explores code you already read. If it's precise, the planner decomposes immediately.

## Strategic Questions to Answer

Research should drive planning decisions, not just collect facts. Explicitly address:

- **What should be proven first?** What's the riskiest assumption — the thing that, if wrong, invalidates downstream work?
- **What existing patterns should be reused?** What modules, conventions, or infrastructure already exist that the plan should build on rather than reinvent?
- **What boundary contracts matter?** What interfaces, data shapes, event formats, or invariants will slices need to agree on?
- **What constraints does the existing codebase impose?** What can't be changed, what's expensive to change, what patterns must be respected?
- **Are there known failure modes that should shape slice ordering?** Pitfalls that mean certain work should come before or after other work?

{{inlinedTemplates}}
