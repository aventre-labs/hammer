import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sourcePath = join(import.meta.dirname, "..", "auto.ts");
const source = readFileSync(sourcePath, "utf-8");

const autoStartSourcePath = join(import.meta.dirname, "..", "auto-start.ts");
const autoStartSource = readFileSync(autoStartSourcePath, "utf-8");

const sessionSourcePath = join(import.meta.dirname, "..", "auto", "session.ts");
const sessionSource = readFileSync(sessionSourcePath, "utf-8");

test("auto-mode captures GSD_PROJECT_ROOT before entering the dispatch loop", () => {
  const captureDeclIdx = source.indexOf("function captureProjectRootEnv(projectRoot: string): void {");
  assert.ok(captureDeclIdx > -1, "auto.ts should define captureProjectRootEnv()");

  const resumeCallIdx = source.indexOf("captureProjectRootEnv(s.originalBasePath || s.basePath);");
  assert.ok(resumeCallIdx > -1, "auto.ts should capture GSD_PROJECT_ROOT before resume autoLoop");

  const firstLoopIdxCandidates = [
    source.indexOf("await runAutoLoopWithUok({"),
    source.indexOf("await autoLoop(ctx, pi, s, buildLoopDeps());"),
  ].filter((idx) => idx > -1);
  const firstAutoLoopIdx = firstLoopIdxCandidates.length > 0 ? Math.min(...firstLoopIdxCandidates) : -1;
  assert.ok(firstAutoLoopIdx > -1, "auto.ts should invoke the auto dispatch loop");
  assert.ok(
    resumeCallIdx < firstAutoLoopIdx,
    "auto.ts must set GSD_PROJECT_ROOT before the first loop call",
  );
});

test("auto-mode restores GSD_PROJECT_ROOT when execution stops or pauses", () => {
  assert.match(source, /function restoreProjectRootEnv\(\): void \{/);
  assert.match(source, /cleanupAfterLoopExit\(ctx: ExtensionContext\): void \{[\s\S]*restoreProjectRootEnv\(\);/);
  assert.match(source, /export async function pauseAuto\([\s\S]*restoreProjectRootEnv\(\);/);
  assert.match(source, /\} finally \{[\s\S]*restoreProjectRootEnv\(\);[\s\S]*s\.reset\(\);/);
});

test("auto-mode no longer references the deleted MCP_AUTO_APPROVE_TRUST machinery", () => {
  for (const src of [source, autoStartSource, sessionSource]) {
    assert.doesNotMatch(src, /captureMcpTrustAutoApproveEnv/);
    assert.doesNotMatch(src, /restoreMcpTrustAutoApproveEnv/);
    assert.doesNotMatch(src, /enableMcpTrustAutoApproveForAutoMode/);
    assert.doesNotMatch(src, /captureMcpTrustAutoApprove\b/);
    assert.doesNotMatch(src, /GSD_MCP_AUTO_APPROVE_TRUST/);
    assert.doesNotMatch(src, /mcpTrustAutoApproveEnvCaptured/);
  }
});
