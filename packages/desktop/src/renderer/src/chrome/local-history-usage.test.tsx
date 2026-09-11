import assert from "node:assert/strict";
import { afterAll, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { emptyUsageSummary, mergeUsageSummaries } from "@nyte-ai/core/views";
import type { UsageSnapshot } from "../../../shared/ipc.ts";
import { usageReportOptions } from "../queries.ts";
import { LocalHistorySection } from "./local-history-usage.tsx";
import { UsageSettings } from "./usage-settings.tsx";
import { usageWindow } from "./usage-view.ts";

vi.hoisted(() => {
  vi.stubGlobal("window", {
    nyte: {
      host: {
        setThemePreference: () => undefined,
        // A read that never settles, so a render can be caught mid-load.
        usage: () => new Promise(() => undefined),
      },
    },
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
  });
  vi.stubGlobal("self", window);
  vi.stubGlobal("document", {
    head: { appendChild: () => undefined },
    createElement: () => ({ styleSheet: {} }),
    documentElement: { dataset: {}, style: { setProperty: () => undefined } },
  });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#888888" }));
});
afterAll(() => vi.unstubAllGlobals());

const ready = {
  kind: "ready",
  summary: mergeUsageSummaries(emptyUsageSummary(), {
    ...emptyUsageSummary(),
    models: [
      {
        provider: "anthropic",
        model: "fixture-claude",
        turns: 2,
        usage: {
          ...emptyUsageSummary().total,
          input: 100,
          output: 20,
          totalTokens: 120,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1.25 },
        },
      },
    ],
  }),
  unpricedRecords: 0,
  malformedRecords: 0,
  unreadableFiles: 0,
} satisfies UsageSnapshot["claudeCode"];

test("Claude Code shows separate all-time model totals without chat navigation", () => {
  const html = renderToStaticMarkup(<LocalHistorySection tool="claudeCode" usage={ready} />);
  assert.match(html, /Claude Code · by model/);
  assert.match(html, /All-time, ignoring the range above/);
  assert.match(html, /API estimates, not charges/);
  // The amount leads; what qualifies it steps down beneath it.
  assert.match(html, /\$2,604\.01|\$1\.25/);
  assert.match(html, /120 tokens · API estimate/);
  assert.match(html, /fixture-claude/);
  assert.match(html, /2 records/);
  assert.doesNotMatch(html, /<button|<a\s/);
});

test("missing and failed history are not presented as zero spend", () => {
  const missing = renderToStaticMarkup(
    <LocalHistorySection tool="claudeCode" usage={{ kind: "missing" }} />,
  );
  assert.match(missing, /No local history in CLAUDE_CONFIG_DIR or ~\/\.claude/);
  assert.doesNotMatch(missing, /\$0\.00/);
  const failed = renderToStaticMarkup(
    <LocalHistorySection
      tool="claudeCode"
      usage={{ kind: "failed", message: "History path is not a directory." }}
    />,
  );
  assert.match(failed, /role="alert"/);
  assert.match(failed, /History path is not a directory/);
  assert.doesNotMatch(failed, /\$0\.00/);
});

test("a clean read says nothing about coverage", () => {
  const html = renderToStaticMarkup(<LocalHistorySection tool="claudeCode" usage={ready} />);
  assert.doesNotMatch(html, /Skipped|partial|malformed|unpriced/i);
});

test("partial and unpriced coverage explain what is absent while retaining totals", () => {
  const html = renderToStaticMarkup(
    <LocalHistorySection
      tool="claudeCode"
      usage={{ ...ready, malformedRecords: 3, unreadableFiles: 2, unpricedRecords: 1 }}
    />,
  );
  assert.match(html, /Skipped 3 malformed records, 2 unreadable files, 1 unpriced record[^s]/);
  assert.match(html, /Unpriced tokens count as tokens, not cost/);
  assert.match(html, /120 tokens · partial API estimate/);
  assert.match(html, /\$1\.25/);
});

test("empty readable history is distinguished from missing history", () => {
  const html = renderToStaticMarkup(
    <LocalHistorySection tool="claudeCode" usage={{ ...ready, summary: emptyUsageSummary() }} />,
  );
  assert.match(html, /No usage records in the readable history/);
  assert.match(html, /\$0\.00/);
  assert.match(html, /0 tokens · API estimate/);
  assert.doesNotMatch(html, /No local history in/);
});

test.each(["empty", "outside-window", "failed-store", "failed-registry", "failed-refresh"])(
  "Usage settings retain Claude Code history with %s Nyte history",
  async (state) => {
    const earliestDay = state === "outside-window" ? "2020-01-01" : undefined;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory(),
    });
    const days = usageWindow("30d", Date.now());
    client.setQueryData(usageReportOptions(days.untilDay).queryKey, {
      readAt: Date.now(),
      sinceDay: days.sinceDay ?? days.untilDay,
      untilDay: days.untilDay,
      entries: [],
      sessions: [],
      sources:
        state === "failed-store"
          ? [{ workspacePath: null, status: "failed", sessions: 0, message: "Broken database" }]
          : [],
      earliestDay,
      previous: undefined,
      nyteError: state === "failed-registry" ? "Registry unavailable" : null,
      claudeCode: ready,
      codex: { kind: "missing" },
    } satisfies UsageSnapshot);
    try {
      if (state === "failed-refresh") {
        await assert.rejects(
          client.fetchQuery({
            ...usageReportOptions(days.untilDay),
            // The options now hold a cached report fresh; a refresh is explicit.
            staleTime: 0,
            queryFn: () => Promise.reject(new Error("Refresh unavailable")),
          }),
          /Refresh unavailable/,
        );
      }
      const html = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <RouterContextProvider router={router}>
            <UsageSettings />
          </RouterContextProvider>
        </QueryClientProvider>,
      );
      if (state === "failed-store" || state === "failed-registry") {
        assert.match(html, /Couldn&#x27;t read all Nyte usage/);
        assert.doesNotMatch(html, /No recorded Nyte usage/);
      } else {
        assert.match(
          html,
          earliestDay === undefined ? /No recorded Nyte usage/ : /Earliest recorded usage/,
        );
      }
      if (state === "failed-refresh") {
        assert.match(html, /Last good read/);
        assert.match(html, /Refresh unavailable/);
      }
      if (state === "failed-registry") assert.match(html, /Registry unavailable/);
      assert.match(html, /Claude Code · by model/);
      assert.match(html, /fixture-claude/);
      assert.match(html, /120 tokens · API estimate/);
      assert.match(html, /\$1\.25/);
      assert.match(html, /Refresh/);
    } finally {
      client.clear();
    }
  },
);

test.each([false, true])("unpriced model estimates never look free, mixed prices %s", (mixed) => {
  const unknown = {
    provider: "anthropic",
    model: "unknown-claude",
    turns: 1,
    usage: { ...emptyUsageSummary().total, input: 50, totalTokens: 50 },
  };
  const html = renderToStaticMarkup(
    <LocalHistorySection
      tool="claudeCode"
      usage={{
        ...ready,
        summary: mergeUsageSummaries(mixed ? ready.summary : emptyUsageSummary(), {
          ...emptyUsageSummary(),
          models: [unknown],
        }),
        unpricedRecords: 1,
      }}
    />,
  );
  assert.match(html, /unknown-claude/);
  assert.match(html, /50 tokens · 1 record[^s]/);
  // A row with no price reads as absent, never as zero spend.
  assert.match(html, /Unpriced/);
  assert.match(html, /Unpriced tokens count as tokens, not cost/);
  assert.doesNotMatch(html, /\$0\.00/);
  assert.match(html, mixed ? /170 tokens · partial API estimate/ : /No priced history/);
  if (mixed) assert.match(html, /\$1\.25/);
});

test.each(["malformedRecords", "unreadableFiles"] as const)(
  "%s with no usable records does not claim zero spend",
  (field) => {
    const html = renderToStaticMarkup(
      <LocalHistorySection
        tool="claudeCode"
        usage={{ ...ready, summary: emptyUsageSummary(), [field]: 1 }}
      />,
    );
    assert.match(html, /Skipped 1 (malformed record|unreadable file)[^s]/);
    assert.match(html, /No priced history/);
    assert.doesNotMatch(html, /\$0\.00/);
  },
);

test("a pending read draws each card's own skeleton, not one page-wide spinner", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <RouterContextProvider router={router}>
          <UsageSettings />
        </RouterContextProvider>
      </QueryClientProvider>,
    );
    // Every card keeps its own frame and title while it waits.
    for (const title of [
      "API estimate",
      "Tokens",
      "By model",
      "Activity",
      "By folder",
      "By chat",
    ]) {
      assert.match(html, new RegExp(`aria-label="${title}"`));
    }
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Reading local history/);
    // The range control and the Claude Code section stay on the page.
    assert.match(html, /aria-label="Usage range"/);
    assert.match(html, /Claude Code · by model/);
    // Nothing claims a number it does not have yet.
    assert.doesNotMatch(html, /\$0\.00|Nothing in this window|No recorded Nyte usage/);
  } finally {
    client.clear();
  }
});
