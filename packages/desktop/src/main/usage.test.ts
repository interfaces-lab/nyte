import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { projectUsage } from "@nyte-ai/core/views";
import { sessionId } from "@nyte-ai/protocol";
import type { Commit } from "@nyte-ai/protocol";
import type { Usage } from "@nyte-ai/schema";
import {
  localDay,
  projectUsageReport,
  shiftDay,
  usageCommit,
  type SessionCommits,
} from "./usage.ts";
import { ipcDiagnostics, ipcFailure } from "./errors.ts";
import type { StoreRead } from "./usage.ts";
import type { UsageWindow } from "../shared/ipc.ts";

const AT = new Date(2026, 8, 2, 13, 30).getTime();
const DAY_MS = 24 * 60 * 60 * 1_000;

function usage(input: number, output: number, cost: number, cacheRead = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    totalTokens: input + output + cacheRead,
    cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

function assistant(at: number, model: string, spend: Usage, provider = "anthropic"): Commit {
  return {
    kind: "commit",
    parent: null,
    at,
    body: {
      kind: "message",
      message: {
        role: "assistant",
        content: [],
        api: "anthropic-messages",
        provider,
        model,
        usage: spend,
        stopReason: "stop",
        timestamp: at,
      },
    },
  };
}

function session(commits: readonly Commit[], overrides?: Partial<SessionCommits>): SessionCommits {
  return {
    sessionId: sessionId("session-1"),
    name: "Ship the thing",
    commits: commits.flatMap((commit) => usageCommit(commit) ?? []),
    ...overrides,
  };
}

function store(
  sessions: readonly SessionCommits[],
  workspacePath: string | null = null,
  failure: StoreRead["failure"] = null,
) {
  return { workspacePath, sessions, failure };
}

/** A window wide enough that the fixtures land inside it unless a test says otherwise. */
const WINDOW: UsageWindow = {
  sinceDay: shiftDay(localDay(AT), -6),
  untilDay: shiftDay(localDay(AT), 1),
};

/** The chat totals the page ranks, summed from the cells the way the page does. */
function chatCost(report: { entries: readonly { sessionId: string; totals: { cost: number } }[] }) {
  const perChat = new Map<string, number>();
  for (const entry of report.entries) {
    perChat.set(entry.sessionId, (perChat.get(entry.sessionId) ?? 0) + entry.totals.cost);
  }
  return perChat;
}

describe("usage fold", () => {
  test("groups a folder's spend by local day, model, and provider", () => {
    const report = projectUsageReport(
      [
        store([
          session([
            assistant(AT, "claude-opus-5", usage(100, 20, 0.5)),
            assistant(AT + 60_000, "claude-opus-5", usage(200, 40, 1)),
            assistant(AT + DAY_MS, "gpt-5", usage(10, 5, 0.25), "openai"),
          ]),
        ]),
      ],
      WINDOW,
      AT,
    );

    assert.equal(report.entries.length, 2);
    const [first, second] = report.entries;
    assert.deepEqual(first?.subject, {
      kind: "model",
      provider: "anthropic",
      model: "claude-opus-5",
    });
    assert.equal(first?.day, localDay(AT));
    assert.equal(first?.totals.turns, 2);
    assert.equal(first?.totals.input, 300);
    assert.equal(first?.totals.cost, 1.5);
    assert.equal(second?.day, localDay(AT + DAY_MS));
    assert.deepEqual(second?.subject, { kind: "model", provider: "openai", model: "gpt-5" });
  });

  test("keeps provider and model identities separate", () => {
    const report = projectUsageReport(
      [
        store([
          session([
            assistant(AT, "c", usage(10, 0, 1), "a/b"),
            assistant(AT, "b/c", usage(20, 0, 2), "a"),
          ]),
        ]),
      ],
      WINDOW,
      AT,
    );
    assert.equal(report.entries.length, 2);
    assert.deepEqual(
      report.entries.map((entry) => entry.totals.tokens),
      [10, 20],
    );
    assert.equal(chatCost(report).get(sessionId("session-1")), 3);
  });

  test("keeps folders and chats apart on their own cells", () => {
    const report = projectUsageReport(
      [
        store([
          session([assistant(AT, "claude-opus-5", usage(10, 2, 0.1))], {
            sessionId: sessionId("home"),
          }),
        ]),
        store(
          [
            session([assistant(AT, "claude-opus-5", usage(90, 20, 9))], {
              sessionId: sessionId("project"),
              name: "Bigger chat",
            }),
          ],
          "/repos/nyte",
        ),
      ],
      WINDOW,
      AT,
    );

    assert.equal(report.entries.length, 2);
    assert.deepEqual(
      new Set(report.entries.map((entry) => entry.workspacePath)),
      new Set([null, "/repos/nyte"]),
    );
    assert.equal(chatCost(report).get(sessionId("project")), 9);
    assert.equal(chatCost(report).get(sessionId("home")), 0.1);
    assert.deepEqual(report.sessions.map((entry) => entry.sessionId).toSorted(), [
      sessionId("home"),
      sessionId("project"),
    ]);
    assert.equal(
      report.sessions.find((entry) => entry.sessionId === sessionId("project"))?.lastActivityAt,
      AT,
    );
  });

  test("keeps only the requested window, and reports what came before it", () => {
    const today = localDay(AT);
    const report = projectUsageReport(
      [
        store([
          session([
            assistant(AT, "claude-opus-5", usage(10, 0, 1)),
            // Two days back: inside the prior window, outside this one.
            assistant(AT - 2 * DAY_MS, "claude-opus-5", usage(20, 0, 4)),
            // Long before either window; only the earliest-day marker sees it.
            assistant(AT - 40 * DAY_MS, "claude-opus-5", usage(30, 0, 8)),
          ]),
        ]),
      ],
      { sinceDay: today, untilDay: today },
      AT,
    );

    assert.deepEqual(
      report.entries.map((entry) => entry.day),
      [today],
    );
    assert.equal(report.entries[0]?.totals.cost, 1);
    // The prior window is one day long, so only the day before today counts.
    assert.equal(report.previous, undefined);
    assert.equal(report.earliestDay, localDay(AT - 40 * DAY_MS));

    const wider = projectUsageReport(
      [
        store([
          session([
            assistant(AT, "claude-opus-5", usage(10, 0, 1)),
            assistant(AT - 2 * DAY_MS, "claude-opus-5", usage(20, 0, 4)),
          ]),
        ]),
      ],
      { sinceDay: shiftDay(today, -1), untilDay: today },
      AT,
    );
    assert.equal(wider.previous?.cost, 4);
  });

  test("an all-time read resolves its own start and has nothing to compare with", () => {
    const report = projectUsageReport(
      [
        store([
          session([
            assistant(AT - 30 * DAY_MS, "claude-opus-5", usage(10, 0, 1)),
            assistant(AT, "claude-opus-5", usage(10, 0, 1)),
          ]),
        ]),
      ],
      { sinceDay: null, untilDay: localDay(AT) },
      AT,
    );

    assert.equal(report.sinceDay, localDay(AT - 30 * DAY_MS));
    assert.equal(report.entries.length, 2);
    assert.equal(report.previous, undefined);
  });

  test("a store that failed is a source row, not a lost report", () => {
    const cause = new Error("synthetic-secret-store-body");
    const failure = ipcFailure(cause);
    const report = projectUsageReport(
      [
        store([session([assistant(AT, "claude-opus-5", usage(10, 0, 1))])]),
        store([], "/repos/broken", failure),
      ],
      WINDOW,
      AT,
    );

    assert.equal(report.entries.length, 1);
    assert.deepEqual(
      report.sources.map((source) => source.status),
      ["ok", "failed"],
    );
    assert.equal(report.sources[1]?.message, failure.message);
    assert.ok(failure.correlationId);
    assert.equal(ipcDiagnostics.get(failure.correlationId), cause);
    assert.doesNotMatch(JSON.stringify(report), /synthetic-secret-store-body/);
    ipcDiagnostics.delete(failure.correlationId);
  });

  test("prices compaction and tool results under their own subjects", () => {
    const checkpoint: Commit = {
      kind: "commit",
      parent: null,
      at: AT,
      body: {
        kind: "checkpoint",
        summary: "so far",
        retainedTail: [],
        tokensBefore: 5_000,
        usage: usage(4_000, 300, 2),
      },
    };
    const toolResult: Commit = {
      kind: "commit",
      parent: null,
      at: AT,
      body: {
        kind: "message",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "task",
          content: [],
          isError: false,
          timestamp: AT,
          usage: usage(50, 10, 0.75),
        },
      },
    };

    const report = projectUsageReport([store([session([checkpoint, toolResult])])], WINDOW, AT);

    assert.deepEqual(report.entries.map((entry) => entry.subject.kind).toSorted(), [
      "compaction",
      "tool",
    ]);
    assert.equal(chatCost(report).get(sessionId("session-1")), 2.75);
  });

  test("skips commits and chats that reported nothing", () => {
    const free = assistant(AT, "local-model", usage(0, 0, 0));
    const user: Commit = {
      kind: "commit",
      parent: null,
      at: AT,
      body: {
        kind: "message",
        message: { role: "user", content: "hello", timestamp: AT },
      },
    };

    const report = projectUsageReport([store([session([free, user])])], WINDOW, AT);

    assert.deepEqual(report.entries, []);
    assert.deepEqual(report.sessions, []);
    assert.equal(report.earliestDay, undefined);
  });

  test("counts a provider's parts when it reports no total", () => {
    const partial: Usage = {
      input: 120,
      output: 30,
      cacheRead: 10,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.4 },
    };

    const commits = [assistant(AT, "gpt-5", partial, "openai")];
    const report = projectUsageReport([store([session(commits)])], WINDOW, AT);

    assert.equal(report.entries[0]?.totals.tokens, 160);
    assert.equal(projectUsage(commits).total.totalTokens, 160);
  });
});
