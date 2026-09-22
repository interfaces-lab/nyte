import assert from "node:assert/strict";
import { test } from "vitest";
import { runRelaunchCleanup } from "./update-relaunch.ts";

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
