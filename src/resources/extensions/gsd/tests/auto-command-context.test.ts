import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dispatchHookUnit,
  getAutoDashboardData,
  startAuto,
} from "../auto.ts";

function makeEventContext() {
  const notifications: Array<{ message: string; level: string }> = [];
  return {
    notifications,
    ctx: {
      ui: {
        notify(message: string, level?: string) {
          notifications.push({ message, level: level ?? "info" });
        },
        setStatus() {},
        setWidget() {},
      },
      modelRegistry: { getAvailable: () => [] },
      sessionManager: { getSessionFile: () => null },
    } as any,
  };
}

function makePi() {
  const sent: unknown[] = [];
  return {
    sent,
    pi: {
      sendMessage(message: unknown) {
        sent.push(message);
      },
      events: { emit() {} },
      setModel: async () => true,
      getThinkingLevel: () => null,
    } as any,
  };
}

test("startAuto rejects stale non-command contexts before activating auto-mode", async () => {
  const { ctx, notifications } = makeEventContext();
  const { pi, sent } = makePi();

  await startAuto(ctx, pi, "/tmp/hammer-auto-command-context-test", false);

  assert.equal(getAutoDashboardData().active, false);
  assert.equal(sent.length, 0, "startAuto must not dispatch without newSession()");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, "warning");
  assert.match(notifications[0].message, /requires a command context with newSession\(\)/);
});

test("dispatchHookUnit rejects stale non-command contexts instead of throwing newSession TypeError", async () => {
  const { ctx, notifications } = makeEventContext();
  const { pi, sent } = makePi();

  const result = await dispatchHookUnit(
    ctx,
    pi,
    "review",
    "execute-task",
    "M001/S01/T01",
    "review prompt",
    undefined,
    "/tmp/hammer-auto-command-context-test",
  );

  assert.equal(result, false);
  assert.equal(getAutoDashboardData().active, false);
  assert.equal(sent.length, 0, "hook dispatch must not send a prompt without newSession()");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, "warning");
  assert.match(notifications[0].message, /no command context with newSession\(\) is available/);
});
