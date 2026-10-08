import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { sessionId } from "@nyte-ai/protocol";
import type { HostBridge, UsageSnapshot, UsageWindow } from "./bridge.ts";
import { installBridge } from "./nyte.ts";
import { queryClient, usageReportOptions } from "./queries.ts";
import { USAGE_RANGES, USAGE_STALE_AFTER_MS, usageWindow } from "./chrome/usage-view.ts";
import { createWebBridge } from "./web/bridge.ts";

const readUsage = vi.fn<HostBridge["usage"]>();

const web = createWebBridge().bridge;

installBridge({ ...web, host: { ...web.host, usage: readUsage } });

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
});

/** A report old enough that the page would already be offering to re-read it. */
const stale = { updatedAt: Date.now() - USAGE_STALE_AFTER_MS * 10 };

test("reopening shows a fresh cached report without re-reading", () => {
  queryClient.setQueryData(usageReportOptions(TODAY).queryKey, recorded);

  const observer = openUsage();
  assert.equal(observer.getCurrentResult().isFetching, false);
  assert.equal(observer.getCurrentResult().isSuccess, true);
  assert.deepEqual(observer.getCurrentResult().data, recorded);
  // A read walks every stored commit, so a report this young is not worth one.
  assert.equal(readUsage.mock.calls.length, 0);
});

test("reopening re-reads a stale cached report", async () => {
  queryClient.setQueryData(usageReportOptions(TODAY).queryKey, empty, stale);
  const load = Promise.withResolvers<UsageSnapshot>();
  readUsage.mockReturnValueOnce(load.promise);

  const observer = openUsage();
  assert.equal(observer.getCurrentResult().isFetching, true);
  assert.deepEqual(observer.getCurrentResult().data, empty);
  load.resolve(recorded);
  await vi.waitFor(() => assert.equal(observer.getCurrentResult().isFetching, false));
  assert.deepEqual(observer.getCurrentResult().data, recorded);
  assert.equal(observer.getCurrentResult().isSuccess, true);
  assert.equal(readUsage.mock.calls.length, 1);
});

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
