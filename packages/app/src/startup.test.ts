import assert from "node:assert/strict";
import { test } from "vitest";
import { startRendererStartup, startupConnection } from "./startup.ts";

test("the interface mounts once its local resources and route are ready, then connects once it has committed", async () => {
  const resources = Promise.withResolvers<void>();
  const route = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  let mounts = 0;
  let connects = 0;
  let committed = (): void => assert.fail("the shell has not mounted");

  startRendererStartup({
    mountShell: (mounted) => {
      mounts += 1;
      committed = mounted;
    },
    loadResources: async () => {
      await resources.promise;
    },
    loadRouter: async () => {
      await route.promise;
    },
    connect: () => {
      connects += 1;

      return new Promise<void>(() => undefined);
    },
    showError: () => assert.fail("startup should succeed"),
    onReady: () => ready.resolve(),
  });

  assert.equal(mounts, 0);
  resources.resolve();
  await Promise.resolve();
  assert.equal(mounts, 0);
  route.resolve();
  await ready.promise;
  assert.equal(mounts, 1);
  assert.equal(connects, 0);
  committed();
  assert.equal(connects, 1);
  assert.equal(startupConnection.read().kind, "connecting");
});

test("a failed connection leaves the shell mounted and retries on request", async () => {
  let attempts = 0;
  const ready = Promise.withResolvers<void>();

  const settled = (kind: "failed" | "connected") =>
    new Promise<void>((resolve) => {
      const leave = startupConnection.subscribe(() => {
        if (startupConnection.read().kind !== kind) return;
        leave();
        resolve();
      });
    });

  const failed = settled("failed");

  startRendererStartup({
    mountShell: (mounted) => mounted(),
    loadResources: async () => undefined,
    loadRouter: async () => undefined,
    connect: async () => {
      attempts += 1;

      if (attempts === 1) throw new Error("host unavailable");
    },
    showError: () => assert.fail("local startup should succeed"),
    onReady: () => ready.resolve(),
  });

  await Promise.all([failed, ready.promise]);
  const state = startupConnection.read();

  if (state.kind !== "failed") assert.fail("the connection should have failed");
  const connected = settled("connected");
  state.retry();
  await connected;
  assert.equal(attempts, 2);
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
