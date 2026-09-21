import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  changeSelectionSummary,
  filterChangePaths,
  matchesChangePathQuery,
} from "./change-tree.ts";

const entries = [
  { path: "packages/desktop/src/renderer/theme/styles.ts", status: "modified" },
  { path: "packages/desktop/src/renderer/theme/vars.ts", status: "deleted" },
  { path: "packages/core/src/kernel/step.ts", status: "added" },
  { path: "notes.md", status: "untracked" },
] as const;

describe("change path filter", () => {
  test("matches a case-insensitive subsequence of the path", () => {
    assert.equal(matchesChangePathQuery("packages/desktop/src/theme.ts", "DSKTHEME"), true);
    assert.equal(matchesChangePathQuery("packages/desktop/src/theme.ts", "themedesk"), false);
  });

  test("filters by change status", () => {
    assert.deepEqual(filterChangePaths(entries, { statuses: ["added", "untracked"] }), [
      "packages/core/src/kernel/step.ts",
      "notes.md",
    ]);
  });

  test("drops entries without a status when a status filter is set", () => {
    assert.deepEqual(filterChangePaths([{ path: "a.ts" }], { statuses: ["modified"] }), []);
  });

  test("filters by a caller-supplied viewed predicate", () => {
    const isViewed = (path: string) => path.endsWith("vars.ts");
    assert.deepEqual(filterChangePaths(entries, { viewed: { mode: "viewed", isViewed } }), [
      "packages/desktop/src/renderer/theme/vars.ts",
    ]);
    assert.deepEqual(filterChangePaths(entries, { viewed: { mode: "not-viewed", isViewed } }), [
      "packages/desktop/src/renderer/theme/styles.ts",
      "packages/core/src/kernel/step.ts",
      "notes.md",
    ]);
  });

  test("combines query, status, and viewed axes", () => {
    assert.deepEqual(
      filterChangePaths(entries, {
        query: "theme",
        statuses: ["modified", "deleted"],
        viewed: { mode: "not-viewed", isViewed: (path) => path.endsWith("vars.ts") },
      }),
      ["packages/desktop/src/renderer/theme/styles.ts"],
    );
  });
});

test("selection is mixed when only some shown paths are viewed", () => {
  assert.equal(
    changeSelectionSummary(["a.ts", "b.ts"], (path) => path === "a.ts"),
    "some",
  );
});
