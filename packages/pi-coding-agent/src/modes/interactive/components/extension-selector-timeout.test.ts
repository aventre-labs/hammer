import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const selectorSource = readFileSync(join(import.meta.dirname, "extension-selector.ts"), "utf-8");
const interactiveModeSource = readFileSync(join(import.meta.dirname, "..", "interactive-mode.ts"), "utf-8");
const rpcModeSource = readFileSync(join(import.meta.dirname, "..", "..", "rpc", "rpc-mode.ts"), "utf-8");

test("ExtensionSelector supports confirmOnTimeout to select the highlighted option", () => {
	assert.match(selectorSource, /confirmOnTimeout\?: boolean/);
	assert.match(selectorSource, /opts\.confirmOnTimeout[\s\S]*this\.onSelectCallback\(selected\)/);
});

test("interactive confirm passes confirmOnTimeout into the selector", () => {
	assert.match(interactiveModeSource, /confirmOnTimeout:\s*opts\?\.confirmOnTimeout/);
});

test("RPC confirm timeout default honors confirmOnTimeout", () => {
	assert.match(rpcModeSource, /confirm: \(title, message, opts\) =>[\s\S]*opts\?\.confirmOnTimeout \? true : false/);
});
