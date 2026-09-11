import assert from "node:assert/strict";
import { afterAll, afterEach, test, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { sessionId } from "@nyte-ai/protocol";
import type { UsageSnapshot, UsageWindow } from "../../shared/ipc.ts";
import { queryClient, usageReportOptions } from "./queries.ts";
import { USAGE_RANGES, USAGE_STALE_AFTER_MS, usageWindow } from "./chrome/usage-view.ts";

// Supply the preload boundary before imports. Browser timers keep the no-polling check meaningful.
const readUsage = vi.hoisted(() => {
  const usage = vi.fn<() => Promise<UsageSnapshot>>();
  vi.stubGlobal("window", { nyte: { host: { usage } } });
  return usage;
});

const TODAY = "2026-09-02";
/** The read is unbounded; only the day it was taken on is part of the key. */
const WINDOW: UsageWindow = { sinceDay: null, untilDay: TODAY };

function report(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    nyteError: null,
    claudeCode: { kind: "missing" },
    codex: { kind: "missing" },
    readAt: 1,
    sinceDay: TODAY,
    untilDay: TODAY,
    entries: [],
    sessions: [],
    sources: [{ workspacePath: null, status: "ok", sessions: 0, message: null }],
    previous: undefined,
    earliestDay: undefined,
    ...overrides,
  };
}

const empty = report();
const recorded = report({
  claudeCode: { kind: "failed", message: "History unavailable" },
  readAt: 2,
  entries: [
    {
      day: "2026-09-02",
      workspacePath: null,
      sessionId: sessionId("session-1"),
      subject: { kind: "model", provider: "openai", model: "gpt-5" },
      totals: {
        input: 100,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        tokens: 120,
        cost: 1,
        turns: 1,
      },
    },
  ],
  sessions: [
    {
      sessionId: sessionId("session-1"),
      name: "Chat",
      workspacePath: null,
      lastActivityAt: 2,
    },
  ],
  earliestDay: "2026-09-02",
});

const cleanups: (() => void)[] = [];

function openUsage(untilDay: string = TODAY) {
  const observer = new QueryObserver(queryClient, usageReportOptions(untilDay));
  cleanups.push(observer.subscribe(() => {}));
  return observer;
}

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
  queryClient.clear();
  readUsage.mockReset();
  vi.useRealTimers();
});
afterAll(() => vi.unstubAllGlobals());

/** A report old enough that the page would already be offering to re-read it. */
const stale = { updatedAt: Date.now() - USAGE_STALE_AFTER_MS * 10 };

test.each([empty, recorded])(
  "reopening shows a fresh cached report with $entries.length entries without re-reading",
  (cached) => {
    queryClient.setQueryData(usageReportOptions(TODAY).queryKey, cached);

    const observer = openUsage();
    assert.equal(observer.getCurrentResult().isFetching, false);
    assert.equal(observer.getCurrentResult().isSuccess, true);
    assert.deepEqual(observer.getCurrentResult().data, cached);
    // A read walks every stored commit, so a report this young is not worth one.
    assert.equal(readUsage.mock.calls.length, 0);
  },
);

test.each([empty, recorded])(
  "reopening re-reads a stale cached report with $entries.length entries",
  async (cached) => {
    queryClient.setQueryData(usageReportOptions(TODAY).queryKey, cached, stale);
    const load = Promise.withResolvers<UsageSnapshot>();
    readUsage.mockReturnValueOnce(load.promise);

    const observer = openUsage();
    assert.equal(observer.getCurrentResult().isFetching, true);
    assert.deepEqual(observer.getCurrentResult().data, cached);
    load.resolve(recorded);
    await vi.waitFor(() => assert.equal(observer.getCurrentResult().isFetching, false));
    assert.deepEqual(observer.getCurrentResult().data, recorded);
    assert.equal(observer.getCurrentResult().isSuccess, true);
    assert.equal(readUsage.mock.calls.length, 1);
  },
);

test("the read is unbounded, so one read answers every range", async () => {
  readUsage.mockResolvedValueOnce(recorded);
  const observer = openUsage();
  await vi.waitFor(() => assert.equal(observer.getCurrentResult().isSuccess, true));
  // No range reaches the host: the page narrows the report it already holds.
  assert.deepEqual(readUsage.mock.calls[0], [WINDOW]);
  assert.equal(readUsage.mock.calls.length, 1);
});

test("every range shares one key, so pressing between them reads nothing", () => {
  const at = Date.parse("2026-09-02T15:00:00");
  const keys = USAGE_RANGES.map(
    (range) => usageReportOptions(usageWindow(range, at).untilDay).queryKey,
  );
  assert.equal(new Set(keys.map((key) => JSON.stringify(key))).size, 1);
});

test("crossing midnight is a different read", async () => {
  readUsage.mockResolvedValueOnce(recorded);
  const observer = openUsage();
  await vi.waitFor(() => assert.equal(observer.getCurrentResult().isSuccess, true));

  readUsage.mockResolvedValueOnce(report({ readAt: 3 }));
  observer.setOptions(usageReportOptions("2026-09-03"));
  await vi.waitFor(() => assert.equal(readUsage.mock.calls.length, 2));
  assert.deepEqual(readUsage.mock.calls[1], [{ sinceDay: null, untilDay: "2026-09-03" }]);
});

test("reopening retries an initial read failure", async () => {
  readUsage.mockRejectedValueOnce(new Error("Store unavailable"));
  const failed = openUsage();
  await vi.waitFor(() => assert.equal(failed.getCurrentResult().isError, true));
  failed.destroy();

  readUsage.mockResolvedValueOnce(recorded);
  const reopened = openUsage();
  await vi.waitFor(() => assert.equal(reopened.getCurrentResult().isSuccess, true));
  assert.deepEqual(reopened.getCurrentResult().data, recorded);
});

test("manual refresh recovers from an initial read failure", async () => {
  readUsage.mockRejectedValueOnce(new Error("Store unavailable"));
  const observer = openUsage();
  await vi.waitFor(() => assert.equal(observer.getCurrentResult().isLoadingError, true));

  readUsage.mockResolvedValueOnce(recorded);
  const recovered = await observer.refetch({ cancelRefetch: false });
  assert.equal(recovered.isSuccess, true);
  assert.equal(recovered.error, null);
  assert.deepEqual(recovered.data, recorded);
});

test.each([empty, recorded])(
  "manual refresh reports failure with $entries.length cached entries and can recover",
  async (cached) => {
    readUsage.mockResolvedValueOnce(cached);
    const observer = openUsage();
    await vi.waitFor(() => assert.equal(observer.getCurrentResult().isSuccess, true));

    readUsage.mockRejectedValueOnce(new Error("Store unavailable"));
    const failed = await observer.refetch({ cancelRefetch: false });
    assert.equal(failed.isRefetchError, true);
    assert.equal(failed.isSuccess, false);
    assert.equal(failed.error?.message, "Store unavailable");
    assert.deepEqual(failed.data, cached);

    readUsage.mockResolvedValueOnce(recorded);
    const recovered = await observer.refetch({ cancelRefetch: false });
    assert.equal(recovered.isSuccess, true);
    assert.equal(recovered.error, null);
    assert.deepEqual(recovered.data, recorded);
  },
);

test("reopening after a refresh failure retries despite retained data", async () => {
  queryClient.setQueryData(usageReportOptions(TODAY).queryKey, recorded, stale);
  readUsage.mockRejectedValueOnce(new Error("Store unavailable"));
  const failed = openUsage();
  await vi.waitFor(() => assert.equal(failed.getCurrentResult().isRefetchError, true));
  failed.destroy();

  readUsage.mockResolvedValueOnce(empty);
  const reopened = openUsage();
  await vi.waitFor(() => assert.equal(reopened.getCurrentResult().isSuccess, true));
  assert.deepEqual(reopened.getCurrentResult().data, empty);
});

test("manual refresh joins an in-flight history read instead of starting another", async () => {
  queryClient.setQueryData(usageReportOptions(TODAY).queryKey, empty, stale);
  const load = Promise.withResolvers<UsageSnapshot>();
  readUsage.mockReturnValueOnce(load.promise);
  const observer = openUsage();
  const first = observer.refetch({ cancelRefetch: false });
  const second = observer.refetch({ cancelRefetch: false });
  assert.equal(readUsage.mock.calls.length, 1);

  load.resolve(recorded);
  assert.deepEqual((await first).data, recorded);
  assert.deepEqual((await second).data, recorded);
});

test("leaving Usage open does not repeatedly scan history", async () => {
  vi.useFakeTimers();
  readUsage.mockResolvedValue(recorded);
  const observer = openUsage();
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(observer.getCurrentResult().isSuccess, true);

  await vi.advanceTimersByTimeAsync(10 * 60_000);
  assert.equal(readUsage.mock.calls.length, 1);
});
