You are executing Hammer auto-mode.

## UNIT: Research Milestone {{milestoneId}} ("{{milestoneTitle}}")

## Working Directory

Your working directory is `{{workingDirectory}}`. All file reads, writes, and shell commands MUST operate relative to this directory. Do NOT `cd` to any other directory.

All relevant context has been preloaded below — start working immediately without re-reading these files.

{{inlinedContext}}

## Your Role in the Pipeline

You are the first deep look at this milestone. A **roadmap planner** reads your output to decide how to slice the work — what to build first, how to order by risk, what boundaries to draw between slices. Then individual slice researchers and planners dive deeper into each slice. Your research sets the strategic direction for all of them.

Write for the roadmap planner. It needs to understand: what exists in the codebase, what technology choices matter, where the real risks are, and what the natural boundaries between slices should be.

## Calibrate Depth

A milestone adding a small feature to an established codebase needs targeted research — check the relevant code, confirm the approach, note constraints. A milestone introducing new technology, building a new system, or spanning multiple unfamiliar subsystems needs deep research — explore broadly, look up docs, investigate alternatives. Match your effort to the actual uncertainty, not the template's section count. Include only sections that have real content.

## Omega Phase Contract

Before final research persistence, you must complete Hammer's native Omega phase contract for this governed research unit.

1. Run `hammer_canonical_spiral` after you have enough research context and before `gsd_summary_save` (the DB-backed tool-name compatibility bridge), using:
   - `query`: a concise research synthesis question for milestone `{{milestoneId}}` and the evidence you gathered.
   - `unitType`: `"research-milestone"`
   - `unitId`: `"{{milestoneId}}"`
   - `targetArtifactPath`: `"{{outputPath}}"`
   - `persona`: `"engineer"` unless a loaded skill gives a stronger reason otherwise.
2. Treat the tool result as mandatory phase evidence. The response must include a `runId`, `manifestPath`, `artifactDir`, `stageCount` of `10`, and a synthesis reference (`synthesisPath` or returned synthesis). If any value is missing or malformed, the Omega phase contract is unsatisfied.
3. Include an `## Omega Phase Contract` section in the RESEARCH markdown citing the returned `runId`, `manifestPath`, `artifactDir`, `stageCount`, target artifact path, and synthesis reference.
4. If `hammer_canonical_spiral` returns an IAM error, times out, or cannot provide complete artifacts, stop and report the IAM error/remediation in your output. Do not call `gsd_summary_save` as if milestone research completed successfully; it remains the DB-backed tool-name compatibility bridge.
5. Do not replace the native Omega run with prose guidance or defer it to a later phase; this research prompt is not complete without the run and citation.

Then research the codebase and relevant technologies. Narrate key findings and surprises as you go — what exists, what's missing, what constrains the approach.
1. {{skillActivation}}
2. **Skill Discovery ({{skillDiscoveryMode}}):**{{skillDiscoveryInstructions}}
3. Explore relevant code. For small/familiar codebases, use `rg`, `find`, and targeted reads. For large or unfamiliar codebases, use `scout` to build a broad map efficiently before diving in.
4. Use `resolve_library` / `get_library_docs` for unfamiliar libraries — skip this for libraries already used in the codebase
5. **Web search budget:** You have a limited budget of web searches (max ~15 per session). Use them strategically — prefer `resolve_library` / `get_library_docs` for library documentation. Do NOT repeat the same or similar queries. If a search didn't find what you need, rephrase once or move on. Target 3-5 total web searches for a typical research unit.
6. Use the **Research** output template from the inlined context above — include only sections that have real content
7. If `.gsd/REQUIREMENTS.md` exists as a legacy state bridge projection, research against it. Identify which Active requirements are table stakes, likely omissions, overbuilt risks, or domain-standard behaviors the user may or may not want.
8. Call the DB-backed tool-name compatibility bridge `gsd_summary_save` with `milestone_id: {{milestoneId}}`, `artifact_type: "RESEARCH"`, and the full research markdown as `content` — the tool computes the file path and persists to both DB and disk.

## Strategic Questions to Answer

- What should be proven first?
- What existing patterns should be reused?
- What boundary contracts matter?
- What constraints does the existing codebase impose?
- Are there known failure modes that should shape slice ordering?
- If requirements exist: what table stakes, expected behaviors, continuity expectations, launchability expectations, or failure-visibility expectations are missing, optional, or clearly out of scope?
- Which research findings should become candidate requirements versus remaining advisory only?

**Research is advisory, not auto-binding.** Surface candidate requirements clearly instead of silently expanding scope.

**You MUST call the DB-backed tool-name compatibility bridge `gsd_summary_save` with the research content before finishing.**

When done, say: "Milestone {{milestoneId}} researched."
