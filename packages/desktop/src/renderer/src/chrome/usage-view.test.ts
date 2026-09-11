import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionId } from "@nyte-ai/core";
import type { UsageEntry, UsageReport, UsageSession, UsageTotals, UsageWindow } from "../nyte.ts";
import {
  cacheHitRate,
  costChange,
  dayLabel,
  deriveUsage,
  formatPercent,
  formatTokens,
  formatUsd,
  formatUsdCompact,
  localDay,
  shiftDay,
  usageWindow,
  type UsageDerived,
} from "./usage-view.ts";

const NOW = new Date(2026, 8, 2, 15).getTime();
const TODAY = localDay(NOW);
const SESSION = sessionId("session-1");

function totals(overrides?: Partial<UsageTotals>): UsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    tokens: 0,
    cost: 0,
    turns: 1,
    ...overrides,
  };
}

function entry(day: string, overrides?: Partial<UsageEntry>): UsageEntry {
  return {
    day,
    workspacePath: null,
    sessionId: SESSION,
    subject: { kind: "model", provider: "anthropic", model: "claude-opus-5" },
    totals: totals({ input: 100, output: 20, tokens: 120, cost: 1 }),
    ...overrides,
  };
}

function chatSession(id: SessionId, name = "Chat", lastActivityAt = NOW): UsageSession {
  return { sessionId: id, name, workspacePath: null, lastActivityAt };
}

/**
 * One unbounded read. `sinceDay` is the earliest day it holds, not a filter;
 * the window handed to `deriveUsage` is what narrows it.
 */
function report(entries: readonly UsageEntry[], overrides?: Partial<UsageReport>): UsageReport {
  const sessions = [...new Set(entries.map((item) => item.sessionId))].map((id) => chatSession(id));
  return {
    readAt: NOW,
    sinceDay: shiftDay(TODAY, -6),
    untilDay: TODAY,
    entries,
    sessions,
    sources: [{ workspacePath: null, status: "ok", sessions: sessions.length, message: null }],
    previous: undefined,
    earliestDay: entries.map((item) => item.day).toSorted()[0],
    ...overrides,
  };
}

/** Reads a fixture through the window it names, which is the page's default case. */
function derive(entries: readonly UsageEntry[], overrides?: Partial<UsageReport>): UsageDerived {
  const read = report(entries, overrides);
  return deriveUsage(read, { sinceDay: read.sinceDay, untilDay: read.untilDay });
}

describe("usage window", () => {
  test("asks the host for the days a range covers, and lets all time name itself", () => {
    assert.deepEqual(usageWindow("7d", NOW), {
      sinceDay: shiftDay(TODAY, -6),
      untilDay: TODAY,
    });
    assert.deepEqual(usageWindow("30d", NOW), {
      sinceDay: shiftDay(TODAY, -29),
      untilDay: TODAY,
    });
    assert.deepEqual(usageWindow("all", NOW), { sinceDay: null, untilDay: TODAY });
  });
});

describe("usage derivation", () => {
  test("fills every day in the window, including days with no spend", () => {
    const usage = derive([entry(TODAY), entry(shiftDay(TODAY, -3))]);

    assert.equal(usage.grain, "day");
    assert.equal(usage.points.length, 7);
    assert.equal(usage.from, shiftDay(TODAY, -6));
    assert.equal(usage.to, TODAY);
    assert.equal(usage.points.at(-1)?.key, TODAY);
    assert.deepEqual(
      usage.points.map((point) => point.cost),
      [0, 0, 0, 1, 0, 0, 1],
    );
    assert.equal(usage.totals.cost, 2);
    assert.equal(usage.totals.tokens, 240);
  });

  test("buckets a long window by week so the series stays readable", () => {
    const usage = derive([entry(shiftDay(TODAY, -400)), entry(TODAY)], {
      sinceDay: shiftDay(TODAY, -400),
    });

    assert.equal(usage.grain, "week");
    assert.equal(usage.from, shiftDay(TODAY, -400));
    assert.ok(usage.points.length < 60);
    assert.equal(
      usage.points.reduce((sum, point) => sum + point.cost, 0),
      2,
    );
    // A heatmap still reads as a calendar, so it keeps its own shorter window.
    assert.ok(usage.calendar.from > usage.from);
  });

  test("ranks models and folders by cost and reports their share", () => {
    const usage = derive([
      entry(TODAY, {
        subject: { kind: "model", provider: "openai", model: "gpt-5" },
        totals: totals({ cost: 1, tokens: 10 }),
        workspacePath: "/repos/nyte",
      }),
      entry(TODAY, { totals: totals({ cost: 3, tokens: 30 }) }),
      entry(TODAY, { subject: { kind: "compaction" }, totals: totals({ cost: 0.5, tokens: 5 }) }),
    ]);

    assert.deepEqual(
      usage.models.map((model) => model.model),
      ["claude-opus-5", "gpt-5"],
    );
    assert.equal(usage.models[0]?.share, 3 / 4.5);
    assert.equal(usage.overheadCost, 0.5);
    assert.equal(usage.totals.turns, 3);
    assert.deepEqual(
      usage.folders.map((folder) => folder.label),
      ["Home", "nyte"],
    );
  });

  test("names the parent folder only when two folders share a leaf", () => {
    const usage = derive([
      entry(TODAY, { workspacePath: "/repos/acme/api", totals: totals({ cost: 3 }) }),
      entry(TODAY, { workspacePath: "/work/beta/api", totals: totals({ cost: 2 }) }),
      entry(TODAY, { workspacePath: "/repos/nyte", totals: totals({ cost: 1 }) }),
    ]);

    assert.deepEqual(
      usage.folders.map((folder) => [folder.label, folder.qualifier]),
      [
        ["api", "acme"],
        ["api", "beta"],
        ["nyte", undefined],
      ],
    );
  });

  test("keeps provider/model tuples distinct even when identifiers contain slashes", () => {
    const usage = derive([
      entry(TODAY, {
        subject: { kind: "model", provider: "a/b", model: "c" },
        totals: totals({ cost: 2, tokens: 20 }),
      }),
      entry(TODAY, {
        subject: { kind: "model", provider: "a", model: "b/c" },
        totals: totals({ cost: 1, tokens: 10 }),
      }),
      entry(shiftDay(TODAY, -1), {
        subject: { kind: "model", provider: "a/b", model: "c" },
        totals: totals({ cost: 3, tokens: 30 }),
      }),
    ]);

    assert.equal(new Set(usage.models.map((model) => model.key)).size, 2);
    assert.deepEqual(
      usage.models.map(({ provider, model, cost, tokens, turns, share }) => ({
        provider,
        model,
        cost,
        tokens,
        turns,
        share,
      })),
      [
        { provider: "a/b", model: "c", cost: 5, tokens: 50, turns: 2, share: 5 / 6 },
        { provider: "a", model: "b/c", cost: 1, tokens: 10, turns: 1, share: 1 / 6 },
      ],
    );
  });

  test("compares a bounded window against the window of equal length before it", () => {
    const history = report(
      [entry(TODAY), entry(shiftDay(TODAY, -8), { totals: totals({ cost: 4 }) })],
      {
        sinceDay: shiftDay(TODAY, -30),
      },
    );
    const week: UsageWindow = { sinceDay: shiftDay(TODAY, -6), untilDay: TODAY };

    // The prior week holds the day-8 entry; the current week holds today's.
    assert.equal(deriveUsage(history, week).totals.cost, 1);
    assert.equal(deriveUsage(history, week).previousCost, 4);
    // All time has no length of its own, so it has nothing to compare against.
    assert.equal(deriveUsage(history, { sinceDay: null, untilDay: TODAY }).previousCost, undefined);
  });

  test("a window narrower than the read holds only its own days", () => {
    const history = report([entry(TODAY), entry(shiftDay(TODAY, -20))], {
      sinceDay: shiftDay(TODAY, -30),
    });

    assert.equal(
      deriveUsage(history, { sinceDay: shiftDay(TODAY, -6), untilDay: TODAY }).totals.cost,
      1,
    );
    assert.equal(deriveUsage(history, { sinceDay: null, untilDay: TODAY }).totals.cost, 2);
  });

  test("all time starts at the earliest recorded day, and a range keeps its own length", () => {
    const history = report([entry(TODAY)], { sinceDay: shiftDay(TODAY, -2) });

    assert.equal(deriveUsage(history, { sinceDay: null, untilDay: TODAY }).from, TODAY);
    // A range is a question about a period: an idle stretch inside it is an answer.
    const week = deriveUsage(history, { sinceDay: shiftDay(TODAY, -6), untilDay: TODAY });
    assert.equal(week.from, shiftDay(TODAY, -6));
    assert.equal(week.points.length, 7);
  });

  test("chats are summed from the same cells as every other card", () => {
    const busy = sessionId("busy");
    const quiet = sessionId("quiet");
    const usage = derive(
      [
        entry(TODAY, { sessionId: busy, totals: totals({ cost: 3, tokens: 30 }) }),
        entry(shiftDay(TODAY, -2), { sessionId: busy, totals: totals({ cost: 2, tokens: 20 }) }),
        entry(TODAY, { sessionId: quiet, totals: totals({ cost: 1, tokens: 10 }) }),
      ],
      { sessions: [chatSession(busy, "Busy chat"), chatSession(quiet, "Quiet chat")] },
    );

    assert.deepEqual(
      usage.chats.map((chat) => [chat.label, chat.cost]),
      [
        ["Busy chat", 5],
        ["Quiet chat", 1],
      ],
    );
    // The whole point of the flat report: the cards reconcile with the header.
    assert.equal(
      usage.chats.reduce((sum, chat) => sum + chat.cost, 0),
      usage.totals.cost,
    );
    assert.equal(
      usage.folders.reduce((sum, folder) => sum + folder.cost, 0),
      usage.totals.cost,
    );
    // And every share is a share of the same denominator.
    assert.equal(usage.chats[0]?.share, 5 / 6);
    assert.equal(usage.folders[0]?.share, 1);
  });

  test("names a chat with no name of its own, and skips one that did not spend", () => {
    const silent = sessionId("silent");
    const usage = derive([entry(TODAY, { sessionId: SESSION })], {
      sessions: [chatSession(SESSION, "   "), chatSession(silent, "Never spent")],
    });

    assert.deepEqual(
      usage.chats.map((chat) => chat.label),
      ["Untitled chat"],
    );
  });

  test("surfaces folders whose read failed, since their spend is missing", () => {
    const usage = derive([entry(TODAY)], {
      sources: [
        { workspacePath: null, status: "ok", sessions: 1, message: null },
        {
          workspacePath: "/repos/broken",
          status: "failed",
          sessions: 0,
          message: "Permission denied",
        },
      ],
    });

    assert.deepEqual(usage.unreadFolders, ["broken"]);
  });
});

describe("usage formatting", () => {
  test("prints a short month-day label instead of the ISO day", () => {
    const label = dayLabel("2026-09-06");
    assert.notEqual(label, "2026-09-06");
    assert.match(label, /6/);
  });

  test("prints dollars with grouped thousands and a floor for dust", () => {
    assert.equal(formatUsd(0), "$0.00");
    assert.equal(formatUsd(0.004), "<$0.01");
    assert.equal(formatUsd(12.5), "$12.50");
    assert.equal(formatUsd(1_284.3), "$1,284.30");
  });

  test("keeps sub-dollar axis ticks distinct instead of labelling them all $0.00", () => {
    assert.equal(formatUsdCompact(0), "$0");
    assert.equal(formatUsdCompact(0.002), "$0.002");
    assert.equal(formatUsdCompact(0.004), "$0.004");
    assert.equal(formatUsdCompact(0.42), "$0.42");
    assert.equal(formatUsdCompact(12), "$12");
    assert.equal(formatUsdCompact(1_200), "$1.2k");
  });

  test("shortens token counts by magnitude", () => {
    assert.equal(formatTokens(842), "842");
    assert.equal(formatTokens(1_500), "1.5K");
    assert.equal(formatTokens(120_000), "120K");
    assert.equal(formatTokens(1_240_000), "1.24M");
    assert.equal(formatTokens(2_400_000_000), "2.40B");
  });

  test("reports change against the previous window", () => {
    assert.equal(costChange(3, 1)?.label, "+200%");
    assert.equal(costChange(1, 2)?.direction, "down");
    assert.equal(costChange(1, 1)?.label, "No change");
    assert.equal(costChange(1, 0)?.label, "New");
    assert.equal(costChange(0, 0), undefined);
    assert.equal(costChange(1, undefined), undefined);
  });

  test("reads cache hits as a share of everything sent as context", () => {
    assert.equal(cacheHitRate(totals({ input: 100, cacheRead: 300 })), 0.75);
    assert.equal(cacheHitRate(totals({ input: 100, cacheRead: 300, cacheWrite: 600 })), 0.3);
    assert.equal(cacheHitRate(totals({ cacheWrite: 600 })), 0);
    assert.equal(cacheHitRate(totals()), 0);
    assert.equal(formatPercent(0.004), "<1%");
  });
});
