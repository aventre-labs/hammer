import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sourcePath = join(import.meta.dirname, "..", "auto.ts");
const source = readFileSync(sourcePath, "utf-8");

const autoStartSourcePath = join(import.meta.dirname, "..", "auto-start.ts");
const autoStartSource = readFileSync(autoStartSourcePath, "utf-8");

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

test("full auto-mode auto-approves MCP stdio trust for unattended runs", () => {
  assert.match(source, /function captureMcpTrustAutoApproveEnv\(\): void \{/);
  assert.match(source, /export function enableMcpTrustAutoApproveForAutoMode\(\): void \{[\s\S]*captureMcpTrustAutoApproveEnv\(\);[\s\S]*\}/);
  assert.match(autoStartSource, /deps\.captureMcpTrustAutoApprove\(\);/);

  const captureIdx = autoStartSource.indexOf("deps.captureMcpTrustAutoApprove();");
  const activeIdx = autoStartSource.indexOf("s.active = true;", captureIdx);
  assert.ok(captureIdx > -1, "auto-start.ts should enable MCP trust auto-approval for full auto-mode");
  assert.ok(activeIdx > -1, "auto-start.ts should activate auto-mode after the trust flag is set");
  assert.ok(captureIdx < activeIdx, "MCP trust auto-approval must be set before the fresh auto session starts dispatching");

  assert.match(source, /cleanupAfterLoopExit\(ctx: ExtensionContext\): void \{[\s\S]*restoreMcpTrustAutoApproveEnv\(\);/);
  assert.match(source, /export async function pauseAuto\([\s\S]*restoreMcpTrustAutoApproveEnv\(\);/);
  assert.match(source, /\} finally \{[\s\S]*restoreMcpTrustAutoApproveEnv\(\);[\s\S]*s\.reset\(\);/);
});
