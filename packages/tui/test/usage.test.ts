import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { emptyUsageSummary } from "@nyte-ai/core";
import type { AccountLimits } from "@nyte-ai/ai";
import type { Usage } from "@nyte-ai/schema";
import type { WorkspaceUsage } from "../src/host.ts";
import { usageCard, usageLines } from "../src/usage.ts";

const NOW = 2_000_000_000_000;
const MINUTE = 60_000;

describe("usageCard", () => {
  test("shows stale subscription headroom and tones low remaining capacity", () => {
    const limits: AccountLimits = {
      providerId: "openai-codex",
      plan: "plus",
      observedAt: NOW - 20 * MINUTE,
      windows: [
        { id: "five_hour", usedPercent: 96, resetsAt: NOW + 60 * MINUTE },
        { id: "seven_day", usedPercent: 88 },
      ],
    };
    const card = usageCard(emptyWorkspace(), {
      activeProvider: "openai-codex",
      headroom: { kind: "known", limits },
      now: NOW,
    });
    assert.ok(card.headroom.kind === "known");
    assert.equal(card.headroom.stale, true);
    assert.equal(card.headroom.meta, "Plus · fetched 20m ago");
    assert.equal(card.headroom.windows[0].tone, "critical");
    assert.equal(card.headroom.windows[0].remaining.trim(), "4%");
    assert.equal(card.headroom.windows[0].share, 0.04);
    assert.equal(card.headroom.windows[1]?.tone, "warning");
    assert.match(usageLines(card).join("\n"), /Plus · fetched 20m ago \(stale\)/);
  });

  test("renders pending and unavailable headroom for the active provider", () => {
    const checking = usageCard(emptyWorkspace(), {
      activeProvider: "anthropic",
      headroom: { kind: "checking" },
      now: NOW,
    });
    const unavailable = usageCard(emptyWorkspace(), {
      activeProvider: "anthropic",
      headroom: { kind: "unavailable" },
      now: NOW,
    });
    assert.deepEqual(checking.headroom, { kind: "checking", name: "Claude" });
    assert.deepEqual(unavailable.headroom, { kind: "unavailable", name: "Claude" });
    assert.ok(usageLines(checking).includes("Claude · checking…"));
    assert.ok(usageLines(unavailable).includes("Claude · not available"));
  });

  test("an API-key provider has no subscription headroom and an unused workspace is empty", () => {
    const card = usageCard(emptyWorkspace(), {
      activeProvider: "openai",
      headroom: { kind: "none" },
      now: NOW,
    });
    assert.deepEqual(card.headroom, { kind: "none" });
    assert.deepEqual(card.runs, { kind: "none" });
    assert.deepEqual(card.workspace, {
      kind: "empty",
      title: "workspace",
      message: "No usage recorded",
    });
  });

  test("workspace bars follow cost, or tokens when nothing cost anything", () => {
    const paid = usageCard(
      {
        ...emptyWorkspace(),
        chats: 2,
        workspace: {
          models: [
            { model: "big", turns: 3, usage: usageOf(1_000_000, 300_000, 12.35) },
            { model: "mini", turns: 9, usage: usageOf(900_000, 100_000, 0.005) },
          ],
          compaction: usageOf(0, 0, 0),
          tools: usageOf(0, 0, 0),
          total: usageOf(1_900_000, 400_000, 12.355),
        },
        current: {
          models: [{ model: "mini", turns: 1, usage: usageOf(30_000, 2_400, 0.06) }],
          compaction: usageOf(0, 0, 0),
          tools: usageOf(0, 0, 0),
          total: usageOf(30_000, 2_400, 0.06),
        },
      },
      { activeProvider: "openai", headroom: { kind: "none" }, now: NOW },
    );
    assert.ok(paid.workspace.kind === "usage");
    assert.equal(paid.workspace.title, "workspace · 2 chats");
    assert.deepEqual(
      paid.workspace.rows.map((row) => [row.label, row.share, row.cost, row.tokens]),
      [
        ["big", 1, " $12.35", "1.3m"],
        ["mini", 0.005 / 12.35, "$0.0050", "1.0m"],
      ],
    );
    assert.equal(paid.workspace.thisChat, "this chat · 32.4k tokens · $0.06");

    const free = usageCard(
      {
        ...emptyWorkspace(),
        chats: 1,
        workspace: {
          models: [
            { model: "a", turns: 1, usage: usageOf(400, 0, 0) },
            { model: "b", turns: 1, usage: usageOf(100, 0, 0) },
          ],
          compaction: usageOf(0, 0, 0),
          tools: usageOf(0, 0, 0),
          total: usageOf(500, 0, 0),
        },
      },
      { activeProvider: "openai", headroom: { kind: "none" }, now: NOW },
    );
    assert.ok(free.workspace.kind === "usage");
    assert.deepEqual(
      free.workspace.rows.map((row) => row.share),
      [1, 0.25],
    );
  });
});

function emptyWorkspace(): WorkspaceUsage {
  return { runs: [], chats: 0, workspace: emptyUsageSummary(), current: emptyUsageSummary() };
}

function usageOf(input: number, output: number, cost: number): Usage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}
