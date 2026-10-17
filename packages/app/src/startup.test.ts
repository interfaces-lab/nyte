import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { startRendererStartup, startupConnection } from "./startup.ts";

const fonts = { load: vi.fn(async () => []) };

vi.stubGlobal("document", { fonts });

function settled(kind: "failed" | "connected"): Promise<void> {
  return new Promise((resolve) => {
    const leave = startupConnection.subscribe(() => {
      if (startupConnection.read().kind !== kind) return;
      leave();
      resolve();
    });
  });
}

test("the interface mounts while the host connection never settles, and connects once it has committed", async () => {
  const mounted = Promise.withResolvers<() => void>();
  const order: string[] = [];

  startRendererStartup({
    fonts: ['13px "Inter Variable"'],
    router: { load: async () => void order.push("route") },
    mountShell: (committed) => {
      order.push("mount");
      mounted.resolve(committed);
    },
    connect: () => {
      order.push("connect");

      return new Promise<void>(() => undefined);
    },
    showError: () => assert.fail("startup should succeed"),
  });

  const committed = await mounted.promise;
  assert.deepEqual(order, ["route", "mount"]);
  committed();
  assert.deepEqual(order, ["route", "mount", "connect"]);
  assert.equal(startupConnection.read().kind, "connecting");
});

test("a failed connection leaves the shell mounted and retries on request", async () => {
  let attempts = 0;
  const failed = settled("failed");

  startRendererStartup({
    fonts: [],
    router: { load: async () => undefined },
    mountShell: (committed) => committed(),
    connect: async () => {
      attempts += 1;

      if (attempts === 1) throw new Error("host unavailable");
    },
    showError: () => assert.fail("local startup should succeed"),
  });

  await failed;
  const state = startupConnection.read();

  if (state.kind !== "failed") assert.fail("the connection should have failed");
  const connected = settled("connected");
  state.retry();
  await connected;
  assert.equal(attempts, 2);
});

test("a route failure shows a retry that can finish startup", async () => {
  let available = false;
  const failed = Promise.withResolvers<() => void>();
  const mounted = Promise.withResolvers<void>();

  startRendererStartup({
    fonts: [],
    router: {
      load: async () => {
        if (!available) throw new Error("route unavailable");
      },
    },
    mountShell: () => mounted.resolve(),
    connect: async () => undefined,
    showError: (retry) => failed.resolve(retry),
  });

  const retry = await failed.promise;
  available = true;
  retry();
  await mounted.promise;
});
