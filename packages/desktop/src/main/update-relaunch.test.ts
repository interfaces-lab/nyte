import assert from "node:assert/strict";
import { test } from "vitest";
import {
  preflightUpdateCheck,
  runRelaunchCleanup,
  updateActivityDetail,
} from "./update-relaunch.ts";

test("bounds relaunch cleanup and reports failures", async () => {
  assert.deepEqual(await runRelaunchCleanup({ cleanup: () => Promise.resolve() }), {
    kind: "completed",
  });
  assert.deepEqual(
    await runRelaunchCleanup({ cleanup: () => Promise.reject(new Error("close failed")) }),
    { kind: "failed", message: "close failed" },
  );
  assert.deepEqual(
    await runRelaunchCleanup({ cleanup: () => new Promise(() => undefined), timeoutMs: 5 }),
    { kind: "timed-out" },
  );
});

test("active work defers background checks and asks before manual checks", async () => {
  const current = { kind: "busy", taskCount: 1, terminalCommandCount: 1 } as const;
  let confirmations = 0;
  const confirm = () => {
    confirmations++;
    return Promise.resolve(true);
  };

  assert.deepEqual(
    await preflightUpdateCheck({
      activity: () => Promise.resolve(current),
      confirm,
      manual: false,
    }),
    { kind: "defer", activity: current },
  );
  assert.equal(confirmations, 0);
  assert.deepEqual(
    await preflightUpdateCheck({ activity: () => Promise.resolve(current), confirm, manual: true }),
    { kind: "check" },
  );
  assert.equal(confirmations, 1);
  assert.deepEqual(
    await preflightUpdateCheck({
      activity: () => Promise.resolve(current),
      confirm: () => Promise.resolve(false),
      manual: true,
    }),
    { kind: "defer", activity: current },
  );
});

test("idle work starts a check without a confirmation", async () => {
  let confirmations = 0;
  assert.deepEqual(
    await preflightUpdateCheck({
      activity: () => Promise.resolve({ kind: "idle" }),
      confirm: () => {
        confirmations++;
        return Promise.resolve(false);
      },
      manual: true,
    }),
    { kind: "check" },
  );
  assert.equal(confirmations, 0);
});

test("the active-work warning names what an update will stop", () => {
  assert.equal(
    updateActivityDetail({ kind: "busy", taskCount: 1, terminalCommandCount: 0 }),
    "1 task is still running. Installing an update will stop it.",
  );
  assert.equal(
    updateActivityDetail({ kind: "busy", taskCount: 2, terminalCommandCount: 1 }),
    "2 tasks and 1 terminal command are still running. Installing an update will stop them.",
  );
});
