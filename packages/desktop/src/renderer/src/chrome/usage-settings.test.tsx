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
import { sessionId } from "@nyte-ai/protocol";
import type { AccountUsage, UsageSnapshot } from "../../../shared/ipc.ts";
import { keys } from "../query-keys.ts";
import { usageReportOptions } from "../queries.ts";
import { UsageSettings } from "./usage-settings.tsx";
import { usageWindow } from "./usage-view.ts";

vi.hoisted(() => {
  vi.stubGlobal("window", {
    nyte: {
      host: {
        setThemePreference: () => undefined,
        // Reads that never settle, so a render can be caught mid-load.
        usage: () => new Promise(() => undefined),
        accountLimits: () => new Promise(() => undefined),
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
});
afterAll(() => vi.unstubAllGlobals());

const DAYS = usageWindow("30d", Date.now());

const claudeCode = {
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

function snapshot(overrides?: Partial<UsageSnapshot>): UsageSnapshot {
  return {
    readAt: Date.now(),
    sinceDay: DAYS.sinceDay ?? DAYS.untilDay,
    untilDay: DAYS.untilDay,
    entries: [],
    sessions: [],
    sources: [],
    previous: undefined,
    earliestDay: undefined,
    nyteError: null,
    claudeCode,
    codex: { kind: "missing" },
    ...overrides,
  };
}

const spent = snapshot({
  entries: [
    {
      day: DAYS.untilDay,
      workspacePath: "/repos/nyte",
      sessionId: sessionId("chat-1"),
      subject: { kind: "model", provider: "anthropic", model: "claude-opus-5" },
      totals: {
        input: 400,
        output: 100,
        cacheRead: 600,
        cacheWrite: 0,
        reasoning: 0,
        tokens: 1_100,
        cost: 4.5,
        turns: 3,
      },
    },
  ],
  sessions: [
    {
      sessionId: sessionId("chat-1"),
      name: "A chat with a name long enough that a card would have cut it off",
      workspacePath: "/repos/nyte",
      lastActivityAt: Date.now(),
    },
  ],
  sources: [{ workspacePath: "/repos/nyte", status: "ok", sessions: 1, message: null }],
  earliestDay: DAYS.untilDay,
});

const limits: readonly AccountUsage[] = [
  {
    provider: "anthropic",
    kind: "ready",
    limits: {
      providerId: "anthropic",
      plan: "Max",
      observedAt: Date.now(),
      windows: [{ id: "five_hour", usedPercent: 91.2, resetsAt: Date.now() + 3_600_000 }],
    },
  },
  { provider: "openai-codex", kind: "unavailable" },
];

/** Render the page over a seeded cache; an unseeded query stays pending. */
function render(seed?: {
  report?: UsageSnapshot;
  limits?: readonly AccountUsage[];
  reportError?: Error;
}): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  if (seed?.report !== undefined) {
    client.setQueryData(usageReportOptions(DAYS.untilDay).queryKey, seed.report);
  }
  if (seed?.limits !== undefined) client.setQueryData(keys.accountLimits, seed.limits);
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <RouterContextProvider router={router}>
          <UsageSettings />
        </RouterContextProvider>
      </QueryClientProvider>,
    );
  } finally {
    client.clear();
  }
}

test("the page leads with Nyte spend by model, then plan limits", () => {
  const html = render({ report: spent, limits });

  assert.match(html, /\$4\.50/);
  assert.match(html, /API estimate · 1.1K tokens · 3 requests · 60% of context from cache/);
  assert.match(html, /claude-opus-5/);
  assert.match(html, /anthropic · 1.1K tokens · 3 requests/);
  // The lists in order: models first, then the plan limits, then where it went.
  assert.ok(html.indexOf("Nyte spend by model") < html.indexOf("Plan limits"));
  assert.ok(html.indexOf("Plan limits") < html.indexOf("Nyte spend by folder"));
  assert.match(html, /Claude · Max/);
  assert.match(html, /aria-valuenow="91"/);
  assert.match(html, /91% used/);
  assert.match(html, /Sign in to Codex/);
});

test("a ranked list past five models names the remainder instead of growing", () => {
  const models = ["a", "b", "c", "d", "e", "f"] as const;
  const html = render({
    limits,
    report: snapshot({
      earliestDay: DAYS.untilDay,
      sessions: [
        {
          sessionId: sessionId("chat-1"),
          name: "Chat",
          workspacePath: "/repos/nyte",
          lastActivityAt: Date.now(),
        },
      ],
      sources: [{ workspacePath: "/repos/nyte", status: "ok", sessions: 1, message: null }],
      entries: models.map((model, index) => ({
        day: DAYS.untilDay,
        workspacePath: "/repos/nyte",
        sessionId: sessionId("chat-1"),
        subject: { kind: "model", provider: "anthropic", model: `model-${model}` },
        totals: {
          input: 10,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          tokens: 20,
          cost: 6 - index,
          turns: 1,
        },
      })),
    }),
  });

  assert.match(html, /\+1 more/);
  assert.match(html, /model-a/);
  assert.doesNotMatch(html, /model-f/);
});

test("a long chat name wraps instead of hiding behind a tooltip", () => {
  const html = render({ report: spent, limits });

  assert.match(html, /A chat with a name long enough that a card would have cut it off/);
  assert.doesNotMatch(html, /title="/);
});

test("all-time tool totals stay separate from the selected range", () => {
  const html = render({ report: spent, limits });

  assert.match(html, /All tools/);
  assert.match(html, /All time/);
  assert.match(html, /fixture-claude/);
  assert.match(html, /120 tokens · 2 records/);
  assert.match(html, /No local history in CODEX_HOME or ~\/\.codex/);
});

test("a pending read shows the frame it is waiting for and no numbers", () => {
  const html = render();

  assert.match(html, /Reading local history…/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /\$/);
});

test.each(["empty", "outside-window", "failed-store", "failed-registry"])(
  "%s Nyte history keeps the other tools readable",
  (state) => {
    const html = render({
      limits,
      report: snapshot({
        earliestDay: state === "outside-window" ? "2020-01-01" : undefined,
        sources:
          state === "failed-store"
            ? [{ workspacePath: null, status: "failed", sessions: 0, message: "Broken database" }]
            : [],
        nyteError: state === "failed-registry" ? "Registry unavailable" : null,
      }),
    });

    if (state === "failed-store" || state === "failed-registry") {
      assert.match(html, /Couldn&#x27;t read all Nyte usage/);
    } else if (state === "outside-window") {
      assert.match(html, /Earliest recorded usage/);
    } else {
      assert.match(html, /No recorded Nyte usage/);
    }
    assert.match(html, /fixture-claude/);
    assert.match(html, /\$1\.25/);
    assert.match(html, /Refresh/);
  },
);

test("a failed refresh keeps the last good read and says which it is", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  client.setQueryData(usageReportOptions(DAYS.untilDay).queryKey, spent);
  await assert.rejects(
    client.fetchQuery({
      ...usageReportOptions(DAYS.untilDay),
      staleTime: 0,
      queryFn: () => Promise.reject(new Error("Refresh unavailable")),
    }),
    /Refresh unavailable/,
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <UsageSettings />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  client.clear();

  assert.match(html, /Showing the last good read/);
  assert.match(html, /Refresh unavailable/);
  assert.match(html, /\$4\.50/);
});
