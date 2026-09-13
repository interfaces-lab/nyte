import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import { emptyUsageSummary, mergeUsageSummaries } from "@nyte-ai/core/views";
import type { SessionId } from "@nyte-ai/core";
import type { UsageSnapshot } from "../../../shared/ipc.ts";
import type { UsageEntry, UsageReport, UsageSession, UsageTotals, UsageWindow } from "../nyte.ts";
import {
  costChange,
  dayLabel,
  deriveAccount,
  deriveLocalHistory,
  deriveTools,
  deriveUsage,
  describeEmptyRange,
  describeTotals,
  formatPercent,
  formatTokens,
  formatUsd,
  localDay,
  shiftDay,
  usageWindow,
  type UsageDerived,
  type UsageRow,
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

/** What a row shows, in the order the page shows it. */
function shown(rows: readonly UsageRow[]): readonly (readonly [string, string, number])[] {
  return rows.map((row) => [row.label, row.value.text, row.share] as const);
}

function history(
  models: readonly { model: string; tokens: number; cost: number; turns?: number }[],
  overrides?: Partial<Extract<UsageSnapshot["claudeCode"], { kind: "ready" }>>,
): UsageSnapshot["claudeCode"] {
  return {
    kind: "ready",
    summary: mergeUsageSummaries(emptyUsageSummary(), {
      ...emptyUsageSummary(),
      models: models.map((row) => ({
        provider: "anthropic",
        model: row.model,
        turns: row.turns ?? 1,
        usage: {
          ...emptyUsageSummary().total,
          input: row.tokens,
          totalTokens: row.tokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: row.cost },
        },
      })),
    }),
    unpricedRecords: 0,
    malformedRecords: 0,
    unreadableFiles: 0,
    ...overrides,
  };
}

function snapshot(overrides?: Partial<UsageSnapshot>): UsageSnapshot {
  return {
    ...report([entry(TODAY)]),
    nyteError: null,
    claudeCode: { kind: "missing" },
    codex: { kind: "missing" },
    ...overrides,
  };
}

describe("usage window", () => {
  test("asks the host for the days a range covers, and lets all time name itself", () => {
    assert.deepEqual(usageWindow("7d", NOW), { sinceDay: shiftDay(TODAY, -6), untilDay: TODAY });
    assert.deepEqual(usageWindow("30d", NOW), { sinceDay: shiftDay(TODAY, -29), untilDay: TODAY });
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
    assert.deepEqual(
      usage.points.map((point) => point.cost),
      [0, 0, 0, 1, 0, 0, 1],
    );
    assert.equal(usage.totals.cost, 2);
    assert.equal(usage.totals.tokens, 240);
  });

  test("buckets a long window by week so the trend stays readable", () => {
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
  });

  test("ranks models by cost, names the spend with no model, and reports shares", () => {
    const usage = derive([
      entry(TODAY, {
        subject: { kind: "model", provider: "openai", model: "gpt-5" },
        totals: totals({ cost: 1, tokens: 10 }),
        workspacePath: "/repos/nyte",
      }),
      entry(TODAY, { totals: totals({ cost: 3, tokens: 30 }) }),
      entry(TODAY, { subject: { kind: "compaction" }, totals: totals({ cost: 0.5, tokens: 5 }) }),
    ]);

    assert.deepEqual(shown(usage.models), [
      ["claude-opus-5", "$3.00", 3 / 4.5],
      ["gpt-5", "$1.00", 1 / 4.5],
      ["Compaction and tools", "$0.50", 0.5 / 4.5],
    ]);
    assert.match(usage.models[0]?.meta ?? "", /^anthropic · 30 tokens · 1 request$/);
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
      usage.folders.map((folder) => folder.label),
      ["api in acme", "api in beta", "nyte"],
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
    assert.deepEqual(shown(usage.models), [
      ["c", "$5.00", 5 / 6],
      ["b/c", "$1.00", 1 / 6],
    ]);
    assert.equal(usage.models[0]?.meta, "a/b · 50 tokens · 2 requests");
  });

  test("compares a bounded window against the window of equal length before it", () => {
    const history = report(
      [entry(TODAY), entry(shiftDay(TODAY, -8), { totals: totals({ cost: 4 }) })],
      { sinceDay: shiftDay(TODAY, -30) },
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

  test("every list is summed from the same cells, so they reconcile with the total", () => {
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

    assert.deepEqual(shown(usage.chats), [
      ["Busy chat", "$5.00", 5 / 6],
      ["Quiet chat", "$1.00", 1 / 6],
    ]);
    assert.deepEqual(shown(usage.folders), [["Home", "$6.00", 1]]);
    assert.equal(
      usage.models.reduce((sum, model) => sum + model.share, 0),
      1,
    );
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

  test("an empty window says why, and offers all time only when that would help", () => {
    const read = snapshot({ entries: [], earliestDay: "2026-01-04" });

    assert.deepEqual(describeEmptyRange(read, [], "30d"), {
      title: "Nothing in the last 30 days",
      body: "Earliest recorded usage: Jan 4.",
      offerAllTime: true,
    });
    assert.equal(describeEmptyRange(read, [], "all").offerAllTime, false);
    assert.equal(
      describeEmptyRange(snapshot({ entries: [], earliestDay: undefined }), [], "30d").title,
      "No recorded Nyte usage",
    );
    assert.equal(
      describeEmptyRange(snapshot({ entries: [] }), ["broken"], "30d").body,
      "Couldn't read broken.",
    );
    assert.equal(
      describeEmptyRange(snapshot({ entries: [], nyteError: "Registry unavailable" }), [], "30d")
        .body,
      "Registry unavailable",
    );
  });
});

describe("other tools", () => {
  test("compares every tool on the same denominator, all time", () => {
    const tools = deriveTools(
      snapshot({
        entries: [entry(TODAY, { totals: totals({ cost: 1, tokens: 100 }) })],
        claudeCode: history([{ model: "sonnet", tokens: 300, cost: 3 }]),
      }),
    );

    assert.equal(tools.amount, "$4.00");
    assert.equal(tools.meta, "API estimate · 400 tokens · 2 of 3 histories read");
    assert.deepEqual(shown(tools.rows), [
      ["Nyte", "$1.00", 0.25],
      ["Claude Code", "$3.00", 0.75],
      ["Codex", "Not found", 0],
    ]);
    assert.equal(tools.rows[2]?.meta, "No local history in CODEX_HOME or ~/.codex");
  });

  test("a history that could not be read is absent, never zero spend", () => {
    const tools = deriveTools(
      snapshot({
        entries: [],
        nyteError: "Registry unavailable",
        codex: { kind: "failed", message: "History path is not a directory." },
      }),
    );

    assert.equal(tools.amount, "No history read");
    assert.deepEqual(
      tools.rows.map((row) => [row.label, row.value.kind, row.value.text]),
      [
        ["Nyte", "absent", "Couldn't read"],
        ["Claude Code", "absent", "Not found"],
        ["Codex", "absent", "Couldn't read"],
      ],
    );
    assert.equal(tools.rows[2]?.meta, "History path is not a directory.");
  });

  test("a local history ranks its own models and counts its records", () => {
    const view = deriveLocalHistory(
      "claudeCode",
      history([
        { model: "sonnet", tokens: 300, cost: 3, turns: 2 },
        { model: "haiku", tokens: 100, cost: 1 },
      ]),
    );

    assert.equal(view.kind, "rows");
    if (view.kind !== "rows") return;
    assert.equal(view.note, undefined);
    assert.deepEqual(shown(view.rows), [
      ["sonnet", "$3.00", 0.75],
      ["haiku", "$1.00", 0.25],
    ]);
    assert.equal(view.rows[0]?.meta, "300 tokens · 2 records");
  });

  test("unpriced records are named as unpriced and the gaps are stated once", () => {
    const view = deriveLocalHistory(
      "claudeCode",
      history([
        { model: "sonnet", tokens: 300, cost: 3 },
        { model: "unknown", tokens: 100, cost: 0 },
      ]),
    );
    const partial = deriveLocalHistory(
      "claudeCode",
      history([{ model: "unknown", tokens: 100, cost: 0 }], {
        unpricedRecords: 1,
        malformedRecords: 3,
      }),
    );

    // Nothing was flagged unpriced here, so a free model is still a price.
    assert.equal(view.kind === "rows" && view.rows[1]?.value.text, "$0.00");
    assert.equal(partial.kind === "rows" && partial.rows[0]?.value.text, "Unpriced");
    assert.equal(
      partial.kind === "rows" && partial.note,
      "Skipped 3 malformed records, 1 unpriced record",
    );
  });

  test("a missing or failed history explains itself instead of showing rows", () => {
    assert.deepEqual(deriveLocalHistory("codex", { kind: "missing" }), {
      kind: "message",
      message: "No local history in CODEX_HOME or ~/.codex.",
      failed: false,
    });
    assert.deepEqual(
      deriveLocalHistory("claudeCode", { kind: "failed", message: "Permission denied." }),
      {
        kind: "message",
        message: "Couldn't read Claude Code history. Permission denied.",
        failed: true,
      },
    );
  });
});

describe("plan limits", () => {
  test("names each window the way its provider does and says when it refills", () => {
    const resetsAt = new Date(2026, 8, 5, 20).getTime();
    const view = deriveAccount({
      provider: "anthropic",
      kind: "ready",
      limits: {
        providerId: "anthropic",
        plan: "Max",
        observedAt: NOW,
        windows: [
          { id: "five_hour", usedPercent: 12.4, resetsAt },
          { id: "seven_day", usedPercent: 88 },
          { id: "seven_day_Opus", usedPercent: 4 },
        ],
      },
    });

    assert.equal(view.title, "Claude · Max");
    assert.equal(view.message, undefined);
    assert.deepEqual(
      view.meters.map((meter) => [meter.label, meter.used]),
      [
        ["5 hours", 12],
        ["Weekly", 88],
        ["Weekly · Opus", 4],
      ],
    );
    assert.match(view.meters[0]?.reset ?? "", /^Resets /);
    assert.equal(view.meters[1]?.reset, "Reset time unknown");
  });

  test("an account that cannot answer says what to do about it", () => {
    const signedOut = deriveAccount({ provider: "openai-codex", kind: "unavailable" });
    const failed = deriveAccount({
      provider: "openai-codex",
      kind: "failed",
      message: "Could not read account limits. Try again.",
    });

    assert.deepEqual(signedOut.meters, []);
    assert.match(signedOut.message ?? "", /Sign in to Codex/);
    assert.equal(signedOut.failed, false);
    assert.equal(failed.message, "Could not read account limits. Try again.");
    assert.equal(failed.failed, true);
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

  test("the sentence under the total reads cache hits as a share of context", () => {
    assert.equal(
      describeTotals(totals({ input: 100, cacheRead: 300, tokens: 400, turns: 2 })),
      "API estimate · 400 tokens · 2 requests · 75% of context from cache",
    );
    assert.equal(formatPercent(0.004), "<1%");
  });
});
