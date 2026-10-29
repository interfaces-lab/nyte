import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

const STORED = JSON.stringify({
  view: {
    grouping: "repository",
    sort: "created",
    show: ["updated"],
    statuses: [],
    environments: [],
    archived: false,
  },
  folded: ["beta"],
});

test(
  "the sidebar keeps its stored view, pins, folds, keys, renames, read marks and archive confirmation",
  { timeout: 120_000 },
  async () => {
    const output = await testRenderer(
      new URL("./sidebar.browser-test.tsx", import.meta.url),
      `localStorage.setItem("nyte.desktop.sidebar.v3", ${JSON.stringify(STORED)});
window.nyte = { clientSurface: "desktop", platform: "linux", host: { setThemePreference() {}, state: async () => ({ workspace: undefined }), server: { state: async () => ({ kind: "none" }) } } };`,
    );

    expect(output).toBe("passed");
  },
);
