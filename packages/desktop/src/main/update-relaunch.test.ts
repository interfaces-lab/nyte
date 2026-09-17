import assert from "node:assert/strict";
import { test } from "vitest";
import { installBlockedDialog, runRelaunchCleanup } from "./update-relaunch.ts";

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

test("a blocked install names the work to finish first", () => {
  assert.equal(
    installBlockedDialog({ kind: "busy", taskCount: 1, terminalCommandCount: 0 }).detail,
    "1 task is still running. Choose Restart to Update once it finishes.",
  );
  assert.equal(
    installBlockedDialog({ kind: "busy", taskCount: 2, terminalCommandCount: 1 }).detail,
    "2 tasks and 1 terminal command are still running. Choose Restart to Update once they finish.",
  );
});
