import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test(
  "a window tab shows its focused chat's mark and unread as the chat's sidebar row does",
  { timeout: 120_000 },
  async () => {
    const seen: unknown = JSON.parse(
      await testRenderer(
        new URL("./tab-status.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {}, state: async () => ({ workspace: undefined }), server: { state: async () => ({ kind: "none" }) } } };`,
      ),
    );

    expect(seen).toEqual({
      solo: [
        { state: "working", row: "Working", tab: "Working" },
        { state: "waiting", row: "Needs attention", tab: "Needs attention" },
        { state: "failed", row: "Failed", tab: "Failed" },
        { state: "unread", row: "Unread", tab: "Unread, unread" },
        { state: "read", row: "none", tab: "none" },
      ],
      split: {
        rightUnread: { left: "none", right: "Unread", tab: "none" },
        leftWorking: { left: "Working", right: "Unread", tab: "Working" },
      },
      unlisted: {
        row: "no row",
        tabs: ["Solo", "Left | Right", "Quiet", "New chat"],
        tab: "Needs attention",
      },
    });
  },
);
