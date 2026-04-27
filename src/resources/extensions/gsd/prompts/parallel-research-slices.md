# Parallel Slice Research

Hammer Awareness: this prompt inherits Hammer identity plus IAM/Omega/no-degradation semantics; preserve provenance and use structured remediation rather than weakening the contract.

You are dispatching parallel research agents for **{{sliceCount}} slices** in milestone **{{mid}} — {{midTitle}}**.

## Slices to Research

{{sliceList}}

## Mission

Dispatch ALL slices simultaneously using the `subagent` tool in **parallel mode**. Each subagent will independently research its slice and write a RESEARCH file.

## Omega Phase Contract

Parallel research is governed per slice. Every dispatched slice subagent prompt already carries the slice-level Omega Phase Contract, and the dispatcher must treat that contract as part of completion.

1. Each slice subagent must run `hammer_canonical_spiral` before its final `gsd_summary_save` DB-backed tool-name compatibility bridge call with `unitType: "research-slice"`, `unitId: "{{mid}}/S##"`, and that slice's `targetArtifactPath` for `S##-RESEARCH.md`.
2. Each successful subagent result must report both the research artifact path and the Omega `manifestPath` for that same slice. Also require the returned `runId`, `artifactDir`, `stageCount` of `10`, and synthesis reference (`synthesisPath` or returned synthesis) in the slice RESEARCH content.
3. Do not accept one milestone-level Omega placeholder for the batch. The sentinel only passes when every ready slice has its own RESEARCH artifact and its own valid per-slice Omega phase manifest.
4. If any subagent reports an IAM error, times out, or omits the per-slice manifest path, that slice is incomplete. Retry once as described below; if it still fails, write a blocker note rather than claiming successful research.
5. Do not write or accept a successful batch completion that bypasses the native Omega run with prose-only or deferred guidance.

## Execution Protocol

1. Call `subagent` with `tasks: [...]` containing one entry per slice below
2. Wait for ALL subagents to complete
3. Verify each slice's RESEARCH file was written (check the `.gsd/{{mid}}/` legacy state bridge directory)
4. If a subagent failed to write its RESEARCH file, retry it **once** individually
5. If it fails a second time, write a partial RESEARCH file for that slice with a `## BLOCKER` section explaining the failure and include the missing or failed Omega `manifestPath`/IAM diagnostics when available — do NOT retry again
6. Report which slices completed research, the research artifact path and Omega manifest path for every completed slice, and which (if any) needed a blocker note

**Important**: Each failed slice gets exactly one retry. After that, write the blocker and move on. Never retry the same slice more than once.

## Subagent Prompts

{{subagentPrompts}}
