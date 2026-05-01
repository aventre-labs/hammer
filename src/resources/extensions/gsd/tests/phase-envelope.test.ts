/**
 * phase-envelope.test.ts — IAM context-envelope assertion coverage.
 *
 * Per M002/S02 T02 plan, these cases pin the fail-closed shape of
 * `assertPhaseEnvelopePresent` and prove that the global gsd-phase-state
 * is NOT mutated when the assertion fails (R033 hardening).
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
	assertPhaseEnvelopePresent,
	deriveDispatchPhaseEnvelope,
} from "../auto/phase-envelope.js";
import {
	activateGSD,
	deactivateGSD,
	setCurrentPhase,
	getCurrentPhase,
} from "../../shared/gsd-phase-state.js";

describe("assertPhaseEnvelopePresent", () => {
	beforeEach(() => {
		deactivateGSD();
	});

	it("(a) non-governed unit dispatched without envelope returns envelope-missing failure", () => {
		const result = assertPhaseEnvelopePresent("execute-task", undefined);
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.failingStage, "envelope-missing");
		assert.ok(
			result.missingArtifacts.length > 0,
			"missingArtifacts must be non-empty",
		);
		assert.match(
			result.missingArtifacts.join(","),
			/IAM_SUBAGENT_CONTRACT envelope/,
		);
		assert.ok(
			typeof result.remediation === "string" && result.remediation.length > 0,
			"remediation must be a non-empty string",
		);
		assert.match(result.remediation, /execute-task/);
	});

	it("(b) global gsd-phase-state is NOT mutated when assertion fails", () => {
		// Simulate dispatcher pattern: activate GSD, attempt phase transition
		// with no envelope — the assertion fails, dispatcher MUST short-circuit
		// before calling setCurrentPhase. Verify the global is still null.
		activateGSD();
		assert.equal(getCurrentPhase(), null);

		const result = assertPhaseEnvelopePresent("execute-task", undefined);
		assert.equal(result.ok, false);
		// Caller is responsible for short-circuiting; simulate that pattern:
		if (result.ok) {
			setCurrentPhase("execute-task");
		}
		assert.equal(
			getCurrentPhase(),
			null,
			"global gsd-phase-state must NOT be mutated when assertion fails",
		);
	});

	it("(c) envelope with malformed parentUnit returns awareness-missing", () => {
		const result = assertPhaseEnvelopePresent("plan-slice", {
			envelopeId: "flow-abc-123",
			parentUnit: "", // empty string → awareness lineage broken
			mutationBoundary: { boundary: "orchestration" },
		});
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.failingStage, "awareness-missing");
		assert.deepEqual(result.missingArtifacts, ["parentUnit"]);
		assert.match(result.remediation, /parentUnit/);
	});

	it("(d) valid envelope passes through", () => {
		const result = assertPhaseEnvelopePresent("plan-milestone", {
			envelopeId: "flow-xyz-789",
			parentUnit: "M002/S02/T02",
			mutationBoundary: { boundary: "orchestration" },
		});
		assert.equal(result.ok, true);
	});

	it("missing envelopeId returns envelope-missing", () => {
		const result = assertPhaseEnvelopePresent("plan-slice", {
			parentUnit: "M002/S02/T02",
			mutationBoundary: "orchestration",
		});
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.failingStage, "envelope-missing");
		assert.deepEqual(result.missingArtifacts, ["envelopeId"]);
	});

	it("missing mutationBoundary returns awareness-missing", () => {
		const result = assertPhaseEnvelopePresent("plan-slice", {
			envelopeId: "flow-1",
			parentUnit: "M002/S02/T02",
		});
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.failingStage, "awareness-missing");
		assert.deepEqual(result.missingArtifacts, ["mutationBoundary"]);
	});

	it("accepts string mutationBoundary tag", () => {
		const result = assertPhaseEnvelopePresent("validate-milestone", {
			envelopeId: "flow-1",
			parentUnit: "M002",
			mutationBoundary: "orchestration",
		});
		assert.equal(result.ok, true);
	});
});

describe("deriveDispatchPhaseEnvelope", () => {
	it("synthesizes a valid envelope from iteration context (governed)", () => {
		const env = deriveDispatchPhaseEnvelope({
			flowId: "flow-uuid-1",
			unitType: "plan-milestone",
			unitId: "M002",
			isGovernedPhase: true,
		});
		const result = assertPhaseEnvelopePresent("plan-milestone", env);
		assert.equal(result.ok, true);
		assert.equal(env.envelopeId, "flow-uuid-1");
		assert.equal(env.parentUnit, "M002");
		assert.deepEqual(env.mutationBoundary, { boundary: "orchestration" });
	});

	it("synthesizes a valid envelope from iteration context (non-governed)", () => {
		const env = deriveDispatchPhaseEnvelope({
			flowId: "flow-uuid-2",
			unitType: "execute-task",
			unitId: "M002/S02/T02",
			isGovernedPhase: false,
		});
		const result = assertPhaseEnvelopePresent("execute-task", env);
		assert.equal(result.ok, true);
		assert.deepEqual(env.mutationBoundary, { boundary: "tool-call" });
	});
});
