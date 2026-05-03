# M002 Integration Fixture Corpus

This directory is a frozen, tracked seed corpus consumed by the M002 / S09
final-integration tests. It is **read-only at test time** — no test in
this repository writes back into this directory. Each test that needs a
mutable working tree creates its own `mkdtempSync` tmpbase and projects
this corpus into that tmpbase via `cpSync({recursive:true})` before
exercising the production helpers.

## Why this corpus exists

The S09 integration suite drives the real Hammer auto-mode recovery and
phase-spiral helpers (`dispatchRecovery`, `evaluateRecoveryTrigger`,
`runPhaseSpiral`, `persistPhaseOmegaRun`, `validatePhaseOmegaArtifacts`)
end-to-end against a synthetic milestone. Those helpers expect a
realistic on-disk shape — a milestone-context document and per-slice
research stubs — but the integration test does not need (and must not
mutate) the user's real milestone state. Pinning a tracked synthetic
milestone here gives the test deterministic seed content while keeping
production state untouched.

## Slice shapes covered

The synthetic milestone `MILESTONE-INTEGRATION-DEMO` contains two
slices, each pinning one shape the integration tests must prove:

- `slices/S01-recoverable/` — the **recoverable** cycle. The test
  injects a stubbed `runUnit` that emits a `fix-applied` recovery
  verdict, then a follow-up non-recovery `execute-task` success, and
  asserts the recovery counter resets to zero per the
  `shouldResetRecoveryCounter` contract. This slice's research stub is
  the synthetic seed the recovery prompt substitution reads.
- `slices/S02-fatal/` — the **non-recoverable** cycle. The test injects
  three consecutive `give-up` recovery verdicts and asserts the
  dispatcher hits `RECOVERY_FAILURE_CAP === 3`, persisting a
  `cap-reached` decision and a structured remediation handoff. This
  slice's research stub is the synthetic seed the cap-3 path reads.

## Tmpdir-projection contract

Every integration test in the S09 suite must follow this shape:

1. `const tmpbase = mkdtempSync(join(tmpdir(), "m002-integ-"));`
2. `cpSync(<this fixture root>, join(tmpbase, ".gsd", "milestones", "M002"), { recursive: true });`
3. Run the production helper against `tmpbase` — never against the
   fixture directory.
4. Read back `<tmpbase>/.gsd/auto.lock`, journal files, and Omega phase
   artifacts from the tmpbase to verify behavior.
5. The fixture directory remains byte-identical before and after the
   test. Any mutation of fixture content is a test bug.

`validatePhaseOmegaArtifacts` does not read this fixture at all — it
reads the per-stage manifests the test writes into the tmpbase. The
fixture supplies only the seed milestone-context and research bodies.

## Identity-scanner contract

Every markdown file in this corpus carries the canonical Hammer body
marker so the S08-graduated identity-scanner rule classifies the
documents correctly. Future edits must preserve a `Hammer` mention in
each markdown file's body, and must avoid introducing legacy
unclassified visible product spellings.
