# {{sliceId}}: {{sliceTitle}} — UAT

**Milestone:** {{milestoneId}}
**Written:** {{date}}

## Hammer Awareness Contract

Run this UAT against the user-visible Hammer outcome and its awareness contract. IAM provenance must identify what evidence was observed; missing awareness, no-degradation, or Trinity/VOLVOX continuity signals are failure signals unless the slice explicitly scoped them out.

## UAT Type

- UAT mode: {{artifact-driven | live-runtime | human-experience | mixed}}
- Why this mode is sufficient: {{reason}}

## Preconditions

{{whatMustBeTrueBeforeTesting — server running, data seeded, Hammer state available, secrets collected without exposing values, etc.}}

## Smoke Test

{{oneQuickCheckThatConfirmsTheSliceBasicallyWorks}}

## Test Cases

### 1. {{testName}}

1. {{step}}
2. {{step}}
3. **Expected:** {{expected}}

### 2. {{testName}}

1. {{step}}
2. **Expected:** {{expected}}

## Edge Cases

### {{edgeCaseName}}

1. {{step}}
2. **Expected:** {{expected}}

## Failure Signals

- {{whatWouldIndicateSomethingIsBroken — errors, missing UI, wrong data, missing Hammer/IAM marker, absent provenance, no-degradation fallback}}

## Awareness / Provenance Evidence

- **IAM provenance observed:** {{source artifact, command output, or runtime trace}}
- **No-degradation checked:** {{what would have blocked instead of silently falling back}}
- **Trinity/VOLVOX continuity:** {{state/memory/lifecycle signal verified, or N/A}}

## Requirements Proved By This UAT

- {{requirementIdOr_none}} — {{what this UAT proves}}

## Not Proven By This UAT

- {{what this UAT intentionally does not prove}}
- {{remaining live/runtime/operational/awareness gaps, if any}}

## Notes for Tester

{{anythingTheHumanShouldKnow — known rough edges, things to ignore, areas needing gut check, redaction boundaries}}
