import { expect, test } from "bun:test";
import { usageLines } from "../../src/lib/usage.ts";
import type { ProviderUsage } from "@nyte-ai/sdk";

function account(...used: readonly number[]): ProviderUsage {
  return {
    provider: "test",
    name: "Test",
    account: null,
    state: {
      kind: "ready",
      observedAt: 1_000,
      stale: false,
      error: null,
      limits: used.map((share, index) => ({
        label: `w${String(index)}`,
        used: share,
        limit: 100,
        resetsAt: null,
      })),
    },
  };
}

test("usage lines show each window's share with a bar, then this chat's spend", () => {
  const lines = usageLines({
    accounts: [account(45)],
    chat: { kind: "usage", total: "1.2k tokens · $0.01", breakdown: ["input 1k · output 200"] },
  });

  expect(lines).toEqual([
    [{ text: "Test · account limits", bold: true }],
    "w0 · 45% used · 55% left · reset unknown",
    [
      { text: "━".repeat(9), tone: "accent" },
      { text: "─".repeat(11), tone: "muted" },
    ],
    "",
    [{ text: "this chat · 1.2k tokens · $0.01", bold: true }],
    "input 1k · output 200",
  ]);
  expect(
    usageLines({ accounts: [], chat: { kind: "message", message: "No usage recorded" } }),
  ).toEqual([[{ text: "this chat · No usage recorded", bold: true }]]);
});

test("a window's bar turns warning at 85% and error at 95%", () => {
  const tones = usageLines({
    accounts: [account(84, 85, 94, 95)],
    chat: { kind: "message", message: "No usage recorded" },
  }).flatMap((line) => (typeof line === "string" || line.length !== 2 ? [] : [line[0]?.tone]));

  expect(tones).toEqual(["accent", "warning", "warning", "error"]);
});
