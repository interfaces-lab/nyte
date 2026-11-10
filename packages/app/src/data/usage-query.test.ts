import assert from "node:assert/strict";
import { afterEach, onTestFinished, test, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { asId } from "@nyte-ai/schema";
import type { HostBridge, UsageSnapshot, UsageWindow } from "../contract/bridge.ts";
import { installBridge } from "../contract/nyte.ts";
import { queryClient } from "./query-client.ts";
import { usageReportOptions } from "./usage.ts";
import { USAGE_RANGES, usageWindow } from "../settings/usage-view.ts";
import { createWebBridge } from "../web/bridge.ts";

const readUsage = vi.fn<NonNullable<HostBridge["usage"]>>();

const web = createWebBridge().bridge;

installBridge({ ...web, host: { ...web.host, usage: readUsage } });

const TODAY = "2026-09-02";

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
      sessionId: asId<"session">("session-1"),
      subject: { kind: "model", provider: "openai", model: "gpt-5" },
      totals: {
        input: 100,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        tokens: 120,
        cost: 1,
        cacheSavings: 0,
      },
    },
  ],
  sessions: [
    {
      sessionId: asId<"session">("session-1"),
      name: "Chat",
      workspacePath: null,
      lastActivityAt: 2,
    },
  ],
  earliestDay: "2026-09-02",
});

const cleanups: (() => void)[] = [];

const THIRTY_DAYS: UsageWindow = { sinceDay: "2026-08-04", untilDay: TODAY };

function openUsage(window: UsageWindow = WINDOW) {
  const observer = new QueryObserver(queryClient, usageReportOptions(window));
  cleanups.push(observer.subscribe(() => {}));

  return observer;
}

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
  queryClient.clear();
  readUsage.mockReset();
});

test("reopening shows a fresh cached read without re-reading, and re-reads it an hour later", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.setSystemTime(Date.parse("2026-09-02T15:00:00"));
  queryClient.setQueryData(usageReportOptions(WINDOW).queryKey, { window: WINDOW, report: empty });

  const fresh = openUsage();
  assert.equal(fresh.getCurrentResult().isFetching, false);
  assert.equal(fresh.getCurrentResult().isSuccess, true);
  assert.deepEqual(fresh.getCurrentResult().data, { window: WINDOW, report: empty });
  assert.equal(readUsage.mock.calls.length, 0);

  vi.setSystemTime(Date.parse("2026-09-02T16:00:00"));
  const load = Promise.withResolvers<UsageSnapshot>();
  readUsage.mockReturnValueOnce(load.promise);

  const stale = openUsage();
  assert.equal(stale.getCurrentResult().isFetching, true);
  assert.deepEqual(stale.getCurrentResult().data?.report, empty);
  load.resolve(recorded);
  await vi.waitFor(() => assert.equal(stale.getCurrentResult().isFetching, false));
  assert.deepEqual(stale.getCurrentResult().data?.report, recorded);
  assert.equal(readUsage.mock.calls.length, 1);
});

test("a range reads only its own window", async () => {
  readUsage.mockResolvedValueOnce(recorded);
  const observer = openUsage(usageWindow("30d", Date.parse("2026-09-02T15:00:00")));
  await vi.waitFor(() => assert.equal(observer.getCurrentResult().isSuccess, true));
  assert.deepEqual(readUsage.mock.calls, [[THIRTY_DAYS]]);
  assert.deepEqual(observer.getCurrentResult().data?.window, THIRTY_DAYS);
});

test("every range has its own key", () => {
  const at = Date.parse("2026-09-02T15:00:00");
  const keys = USAGE_RANGES.map((range) => usageReportOptions(usageWindow(range, at)).queryKey);

  assert.equal(new Set(keys.map((key) => JSON.stringify(key))).size, USAGE_RANGES.length);
});

test("a new range keeps the last read, with its own window, until its read answers", async () => {
  readUsage.mockResolvedValueOnce(recorded);
  const observer = openUsage(THIRTY_DAYS);
  await vi.waitFor(() => assert.equal(observer.getCurrentResult().isSuccess, true));

  const load = Promise.withResolvers<UsageSnapshot>();
  readUsage.mockReturnValueOnce(load.promise);
  observer.setOptions(usageReportOptions(WINDOW));
  assert.equal(observer.getCurrentResult().isPlaceholderData, true);
  assert.deepEqual(observer.getCurrentResult().data, { window: THIRTY_DAYS, report: recorded });

  load.resolve(empty);
  await vi.waitFor(() => assert.equal(observer.getCurrentResult().isPlaceholderData, false));
  assert.deepEqual(observer.getCurrentResult().data, { window: WINDOW, report: empty });
});

test("crossing midnight is a different read", async () => {
  readUsage.mockResolvedValueOnce(recorded);
  const observer = openUsage();
  await vi.waitFor(() => assert.equal(observer.getCurrentResult().isSuccess, true));

  readUsage.mockResolvedValueOnce(report({ readAt: 3 }));
  observer.setOptions(usageReportOptions({ sinceDay: null, untilDay: "2026-09-03" }));
  await vi.waitFor(() => assert.equal(readUsage.mock.calls.length, 2));
  assert.deepEqual(readUsage.mock.calls[1], [{ sinceDay: null, untilDay: "2026-09-03" }]);
});
