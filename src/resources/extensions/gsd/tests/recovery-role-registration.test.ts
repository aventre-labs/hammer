/**
 * recovery-role-registration.test.ts — M002/S03/T01
 *
 * Proves the "recovery" subagent role is wired into the IAM contract catalog
 * and that prompts emitted via formatIAMSubagentContractMarker pass the
 * iam-subagent-policy MARKER_RE recogniser.
 *
 * Tests:
 *   1. getIAMSubagentRoleContract("recovery") returns ok:true with the
 *      bounded fix-or-give-up contract shape (mutation boundaries, expected
 *      artifact kinds, provenance permissions, remediation language).
 *   2. formatIAMSubagentContractMarker("recovery", envelopeId) produces a
 *      marker line that parseIAMSubagentContractMarker (which uses MARKER_RE)
 *      accepts without flagging it as malformed.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  IAM_SUBAGENT_ROLE_NAMES,
  getIAMSubagentRoleContract,
} from "../../../../iam/context-envelope.ts";
import {
  formatIAMSubagentContractMarker,
  parseIAMSubagentContractMarker,
} from "../iam-subagent-policy.ts";

test("recovery role is present in IAM_SUBAGENT_ROLE_NAMES", () => {
  assert.ok(
    (IAM_SUBAGENT_ROLE_NAMES as readonly string[]).includes("recovery"),
    "expected 'recovery' to be registered in IAM_SUBAGENT_ROLE_NAMES",
  );
});

test("getIAMSubagentRoleContract('recovery') returns ok:true with the bounded recovery contract", () => {
  const result = getIAMSubagentRoleContract("recovery");
  assert.ok(result.ok, "recovery role contract must resolve");

  const contract = result.value;
  assert.equal(contract.role, "recovery");
  assert.equal(contract.contractId, "iam-subagent-role/recovery/v1");
  assert.equal(contract.requiredContext, false, "recovery is bounded — context optional");

  // Mirrors workflow-worker bounded surface: tool-call + artifact-only.
  assert.deepEqual(
    [...contract.mutationBoundaries].sort(),
    ["artifact-only", "tool-call"].sort(),
    "recovery mutation boundaries must be tool-call + artifact-only",
  );

  assert.equal(contract.allowGraphMutation, false, "recovery cannot mutate the graph");
  assert.equal(contract.allowMemoryMutation, false, "recovery cannot mutate memory store");

  assert.deepEqual(
    [...contract.expectedArtifactKinds].sort(),
    ["audit-event", "diagnostic", "tool-call"].sort(),
    "recovery expected artifact kinds must be diagnostic + audit-event + tool-call",
  );

  assert.deepEqual(
    [...contract.provenancePermissions].sort(),
    ["read-uok-audit", "write-provenance"].sort(),
    "recovery provenance permissions: read-uok-audit + write-provenance",
  );

  assert.match(
    contract.remediation,
    /fix it applied|blocker filed/i,
    "recovery remediation must instruct the actor to declare fix-applied or blocker-filed",
  );
});

test("formatIAMSubagentContractMarker('recovery', envelopeId) is recognised by parseIAMSubagentContractMarker", () => {
  const envelopeId = "M002/S03:recover-1";
  const marker = formatIAMSubagentContractMarker("recovery", envelopeId);

  // The marker line itself should be the canonical form.
  assert.equal(marker, "IAM_SUBAGENT_CONTRACT: role=recovery; envelopeId=M002/S03:recover-1");

  // parseIAMSubagentContractMarker consumes MARKER_RE — if it accepts the
  // marker without the malformed flag, the policy chokepoint will accept it
  // too (the policy uses the same parser at iam-subagent-policy.ts:186).
  const parsedBare = parseIAMSubagentContractMarker(marker);
  assert.equal(parsedBare.malformed, false, "bare marker must not be flagged as malformed");
  assert.equal(parsedBare.role, "recovery");
  assert.equal(parsedBare.envelopeId, envelopeId);

  // And when embedded inside a multi-line prompt body — the regex anchors on
  // either line start or string start, so the marker must work in context too.
  const prompt = `${marker}\n\n## IAM Context Envelope\n- Role: recovery\n`;
  const parsedEmbedded = parseIAMSubagentContractMarker(prompt);
  assert.equal(parsedEmbedded.malformed, false, "embedded marker must not be flagged as malformed");
  assert.equal(parsedEmbedded.role, "recovery");
  assert.equal(parsedEmbedded.envelopeId, envelopeId);
});
