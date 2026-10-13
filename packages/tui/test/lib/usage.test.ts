import { expect, test } from "bun:test";
import { usageLines } from "../../src/lib/usage.ts";

test("usage lines show each window's share with a bar, then this chat's spend", () => {
  const lines = usageLines({
    accounts: [
      {
        provider: "test",
        name: "Test",
        limits: [{ label: "5h", used: 45, limit: 100, resetsAt: null }],
      },
    ],
    chat: { kind: "usage", total: "1.2k tokens · $0.01", breakdown: ["input 1k · output 200"] },
  });

  expect(lines).toEqual([
    "Recorded usage · API cost estimates, not subscription charges",
    "",
    "Test · account limits",
    "5h · 45% used · 55% left · reset unknown",
    `${"━".repeat(9)}${"─".repeat(11)}`,
    "",
    "this chat · 1.2k tokens · $0.01",
    "input 1k · output 200",
  ]);
  expect(
    usageLines({ accounts: [], chat: { kind: "message", message: "No usage recorded" } }),
  ).toEqual([
    "Recorded usage · API cost estimates, not subscription charges",
    "",
    "this chat · No usage recorded",
  ]);
});
