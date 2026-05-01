/**
 * Regression test for M002/S06 — MCP stdio trust-prompt machinery removal.
 *
 * Two layers:
 *   (1) Source-grep gate that fails if any of the deleted symbols are
 *       reintroduced into mcp-client/index.ts.
 *   (2) Behavioral gate that exercises the post-deletion connect path with
 *       a spawn-fail stdio config and asserts the rejection is a structured
 *       Error from the real SDK transport — NOT the old branded
 *       trust-prompt error.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _buildMcpChildEnvForTest, _connectServerForTest } from "../index.ts";

test("mcp-client/index.ts has no trust-prompt machinery", () => {
	const source = readFileSync(
		join(import.meta.dirname, "..", "index.ts"),
		"utf-8",
	);
	assert.doesNotMatch(source, /assertTrustedStdioServer/);
	assert.doesNotMatch(source, /trustedStdioServers/);
	assert.doesNotMatch(source, /stdioTrustKey/);
	assert.doesNotMatch(source, /_buildMcpTrustConfirmOptionsForTest/);
	assert.doesNotMatch(source, /_shouldAutoApproveMcpTrustForTest/);
	assert.doesNotMatch(source, /GSD_MCP_AUTO_APPROVE_TRUST/);
	assert.doesNotMatch(source, /confirmOnTimeout/);
});

test("module still loads cleanly post-deletion (kept helper export resolves)", () => {
	// If any of the deleted symbols left a dangling reference, importing the
	// module would have already crashed by the time we got here. This is a
	// belt-and-braces check that the kept helper still works as expected.
	const env = _buildMcpChildEnvForTest({ EXAMPLE: "value" });
	assert.equal(env.EXAMPLE, "value");
});

test("connectServer fails with a structured Error when stdio command does not exist", async () => {
	// Sandbox dir + writable .mcp.json fixture (matches plan's connect-path
	// surface even though connectServer takes the config directly — the
	// sourcePath field still reflects a real path on disk).
	const sandboxDir = mkdtempSync(join(tmpdir(), "mcp-no-trust-prompt-"));
	const mcpJsonPath = join(sandboxDir, ".mcp.json");
	writeFileSync(
		mcpJsonPath,
		JSON.stringify({
			mcpServers: {
				"fake-broken": {
					command: "/nonexistent/binary-for-trust-prompt-removal-regression",
					args: [],
					env: {},
				},
			},
		}),
		"utf-8",
	);

	type ConnectConfig = Parameters<typeof _connectServerForTest>[0];
	const config: ConnectConfig = {
		name: "fake-broken",
		transport: "stdio",
		sourcePath: mcpJsonPath,
		command: "/nonexistent/binary-for-trust-prompt-removal-regression",
		args: [],
		env: {},
	};

	// Backup AbortController so the test never hangs if the SDK swallows the
	// spawn error — ENOENT should fire fast, but be defensive.
	const ac = new AbortController();
	const guard = setTimeout(() => ac.abort(), 10_000);

	try {
		await assert.rejects(
			() => _connectServerForTest(config, ac.signal),
			(err: unknown) => {
				assert.ok(err instanceof Error, "rejection must be an Error instance");
				const msg = err.message;
				// Old trust-prompt branding must be gone — these substrings came from
				// the deleted assertTrustedStdioServer body.
				assert.doesNotMatch(
					msg,
					/project-local stdio command/,
					`error message still references trust-prompt copy: ${msg}`,
				);
				assert.doesNotMatch(
					msg,
					/was not approved by the user/,
					`error message still references trust-prompt copy: ${msg}`,
				);
				// Real SDK / spawn failure should surface — confirms we hit the
				// actual connect path, not a synthetic gate.
				assert.match(
					msg,
					/ENOENT|spawn|not found/i,
					`expected real spawn-failure error, got: ${msg}`,
				);
				return true;
			},
		);
	} finally {
		clearTimeout(guard);
		try {
			rmSync(sandboxDir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup
		}
	}
});
