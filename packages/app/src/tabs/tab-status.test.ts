import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a window tab shows its focused chat's mark as the chat's sidebar row does, and names it unread once, as the window's unread set has it",
  { timeout: 120_000 },
  async () => {
    const seen: unknown = JSON.parse(
      await testRenderer(
        new URL("./tab-status.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {}, server: { state: async () => ({ kind: "none" }) } } };`,
      ),
    );

    expect(seen).toEqual({
      solo: [
        { state: "working", row: "Working", tab: "Working", name: ", working", unread: false },
        {
          state: "asking",
          row: "Needs attention",
          tab: "Needs attention",
          name: ", needs attention",
          unread: false,
        },
        { state: "failed", row: "Failed", tab: "Failed", name: ", failed", unread: false },
        { state: "failed-unread", row: "Failed", tab: "Failed", name: ", failed, unread", unread: true },
        {
          state: "waiting",
          row: "Needs attention",
          tab: "Needs attention",
          name: ", needs attention",
          unread: false,
        },
        { state: "unread", row: "Unread", tab: "Unread", name: ", unread", unread: true },
        { state: "read", row: "none", tab: "none", name: "", unread: false },
      ],
      split: {
        rightUnread: { left: "none", right: "Unread", tab: "none" },
        leftWorking: { left: "Working", right: "Unread", tab: "Working" },
      },
      unlisted: {
        row: "no row",
        tabs: ["Solo", "Left | Right, working", "Quiet, needs attention", "New chat"],
        tab: "Needs attention",
      },
    });
  },
);
