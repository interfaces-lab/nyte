import assert from "node:assert/strict";
import { test } from "vitest";
import { startRendererStartup } from "./startup.ts";

test("the interface mounts once, after the caches, the initial route, and its screen are ready", async () => {
  const resources = Promise.withResolvers<void>();
  const route = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  const steps: string[] = [];
  let mounts = 0;

  startRendererStartup({
    mountShell: () => {
      mounts += 1;
      steps.push("mount");
    },
    loadResources: async () => {
      steps.push("resources");
      await resources.promise;
    },
    loadRouter: async () => {
      steps.push("route");
      await route.promise;
    },
    showError: () => steps.push("error"),
    onReady: () => ready.resolve(),
  });

  assert.equal(mounts, 0);
  resources.resolve();
  await Promise.resolve();
  assert.equal(mounts, 0);
  route.resolve();
  await ready.promise;
  assert.equal(mounts, 1);
  assert.deepEqual(steps, ["resources", "route", "mount"]);
});

for (const failure of ["resources", "route"] as const) {
  test(`a ${failure} failure keeps the startup shell up with a retry that can finish startup`, async () => {
    let available = false;
    const failed = Promise.withResolvers<() => void>();
    const ready = Promise.withResolvers<void>();
    let mounts = 0;
    startRendererStartup({
      mountShell: () => {
        mounts += 1;
      },
      loadResources: async () => {
        if (!available && failure === "resources") throw new Error("disk unavailable");
      },
      loadRouter: async () => {
        if (!available && failure === "route") throw new Error("route unavailable");
      },
      showError: (retry) => failed.resolve(retry),
      onReady: () => ready.resolve(),
    });
    const retry = await failed.promise;
    assert.equal(mounts, 0);
    available = true;
    retry();
    await ready.promise;
    assert.equal(mounts, 1);
  });
}
