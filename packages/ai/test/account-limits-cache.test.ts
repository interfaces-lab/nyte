import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { AccountLimitsCache } from "../src/account-limits-cache.ts";
import type { AccountLimits } from "../src/types.ts";

afterEach(() => vi.useRealTimers());

function limits(usedPercent: number, observedAt = Date.now()): AccountLimits {
  return {
    providerId: "anthropic",
    windows: [{ id: "five_hour", label: "5-hour", usedPercent }],
    observedAt,
  };
}

test("concurrent readers and repeated opens share account quota until its TTL expires", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  const cache = new AccountLimitsCache();
  const scope = cache.scope("anthropic");
  let requests = 0;
  const pending = Promise.withResolvers<AccountLimits>();
  const load = async () => {
    requests += 1;

    return pending.promise;
  };

  const first = scope.fetch("work", load);
  const second = scope.fetch("work", load);
  pending.resolve(limits(28));
  assert.deepEqual(await first, { kind: "ready", limits: limits(28), stale: false, error: null });
  assert.deepEqual(await second, { kind: "ready", limits: limits(28), stale: false, error: null });
  assert.deepEqual(await scope.fetch("work", async () => limits(99)), {
    kind: "ready",
    limits: limits(28),
    stale: false,
    error: null,
  });
  assert.equal(requests, 1);

  vi.setSystemTime(1_060_001);
  assert.deepEqual(await scope.fetch("work", async () => limits(35)), {
    kind: "ready",
    limits: limits(35),
    stale: false,
    error: null,
  });
});

test("cancelling one reader keeps the shared request available to another", async () => {
  const cache = new AccountLimitsCache();
  const scope = cache.scope("anthropic");
  const pending = Promise.withResolvers<AccountLimits>();
  const controller = new AbortController();
  const first = scope.fetch("work", async () => pending.promise, { signal: controller.signal });
  const second = scope.fetch("work", async () => limits(99));
  controller.abort(new Error("Dialog closed"));
  await assert.rejects(first, /Dialog closed/u);
  pending.resolve(limits(28));
  const result = await second;
  assert.equal(result.kind, "ready");

  if (result.kind === "ready") assert.equal(result.limits.windows[0]?.usedPercent, 28);
});

test("failed refreshes preserve stale data and back off before retrying", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  const scope = new AccountLimitsCache().scope("anthropic");
  await scope.fetch("work", async () => limits(28));
  vi.setSystemTime(1_060_001);
  const expected = {
    kind: "ready",
    limits: limits(28, 1_000_000),
    stale: true,
    error: "Provider unavailable",
  };
  assert.deepEqual(
    await scope.fetch("work", async () => {
      throw new Error("Provider unavailable");
    }),
    expected,
  );
  assert.deepEqual(await scope.fetch("work", async () => limits(99)), expected);
  vi.setSystemTime(1_075_002);
  assert.deepEqual(await scope.fetch("work", async () => limits(35)), {
    kind: "ready",
    limits: limits(35),
    stale: false,
    error: null,
  });
});

test("partial telemetry retains scoped windows and newer observations win", async () => {
  const cache = new AccountLimitsCache();
  const scope = cache.scope("anthropic");
  scope.observe("work", {
    ...limits(28, 200),
    windows: [
      { id: "five_hour", label: "5-hour", usedPercent: 28 },
      { id: "seven_day_opus", label: "Opus weekly", usedPercent: 91 },
    ],
  });
  const pending = Promise.withResolvers<AccountLimits>();
  const refresh = scope.fetch("work", async () => pending.promise);
  scope.observe("work", limits(35, 300));
  scope.observe("work", limits(2, 100));
  pending.resolve(limits(30, 400));
  await refresh;
  assert.deepEqual(cache.get("anthropic", "work")?.windows, [
    { id: "five_hour", label: "5-hour", usedPercent: 35 },
    { id: "seven_day_opus", label: "Opus weekly", usedPercent: 91 },
  ]);
});

test("switching accounts prevents late quota and telemetry from restoring the prior account", async () => {
  const cache = new AccountLimitsCache();
  const old = cache.scope("anthropic");
  const pending = Promise.withResolvers<AccountLimits>();
  const first = old.fetch("work", async () => pending.promise);
  cache.invalidate("anthropic");
  const result = await cache.scope("anthropic").fetch("personal", async () => limits(72));
  old.observe("work", limits(99));
  pending.resolve(limits(99));
  assert.deepEqual(await first, {
    kind: "unavailable",
    reason: "failed",
    message: "The active account changed.",
  });
  assert.equal(cache.get("anthropic", "work"), undefined);
  assert.equal(result.kind, "ready");
  assert.deepEqual(cache.get("anthropic", "personal")?.windows, [
    { id: "five_hour", label: "5-hour", usedPercent: 72 },
  ]);
});

test("accounts without a quota endpoint can still show response telemetry", async () => {
  const cache = new AccountLimitsCache();
  const scope = cache.scope("anthropic");
  const observed = limits(28);
  scope.observe("work", observed);
  assert.deepEqual(await scope.fetch("work", async () => undefined), {
    kind: "ready",
    limits: observed,
    stale: true,
    error: null,
  });
});
