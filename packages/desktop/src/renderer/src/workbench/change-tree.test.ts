import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  changeFileGroups,
  changeFileTone,
  changeSelectionSummary,
  filesChangedLabel,
  filterChangePaths,
  matchesChangePathQuery,
  visibleChangeTreeRows,
} from "./change-tree.ts";

function labels(paths: readonly string[], collapsed: readonly string[] = []) {
  return visibleChangeTreeRows({
    groups: changeFileGroups(paths),
    collapsed,
  }).map((row) => ({
    kind: row.kind,
    label: row.label,
    depth: row.depth,
    path: row.path,
  }));
}

describe("change file groups", () => {
  test("groups files under a short unique folder label", () => {
    assert.deepEqual(
      labels([
        "packages/desktop/src/renderer/src/theme/styles.stylex.ts",
        "packages/desktop/src/renderer/src/conversation/composer.tsx",
      ]),
      [
        {
          kind: "directory",
          label: "conversation",
          depth: 0,
          path: "packages/desktop/src/renderer/src/conversation/",
        },
        {
          kind: "file",
          label: "composer.tsx",
          depth: 1,
          path: "packages/desktop/src/renderer/src/conversation/composer.tsx",
        },
        {
          kind: "directory",
          label: "theme",
          depth: 0,
          path: "packages/desktop/src/renderer/src/theme/",
        },
        {
          kind: "file",
          label: "styles.stylex.ts",
          depth: 1,
          path: "packages/desktop/src/renderer/src/theme/styles.stylex.ts",
        },
      ],
    );
  });

  test("disambiguates sibling folders that share a leaf name", () => {
    assert.deepEqual(
      changeFileGroups([
        "packages/core/src/kernel/step.ts",
        "packages/core/test/kernel/step.test.ts",
      ]).map((group) => group.label),
      ["src / kernel", "test / kernel"],
    );
  });

  test("lists root files without a folder header", () => {
    assert.deepEqual(labels(["a.ts", "b.ts"]), [
      { kind: "file", label: "a.ts", depth: 0, path: "a.ts" },
      { kind: "file", label: "b.ts", depth: 0, path: "b.ts" },
    ]);
  });

  test("colors added, deleted, and modified files", () => {
    assert.equal(changeFileTone({ status: "deleted" }), "deleted");
    assert.equal(changeFileTone({ status: "untracked" }), "added");
    assert.equal(changeFileTone({ status: "added" }), "added");
    assert.equal(changeFileTone({ status: "modified" }), "modified");
    assert.equal(changeFileTone({ added: 0, removed: 12 }), "deleted");
    assert.equal(changeFileTone({ added: 4, removed: 0 }), "added");
    assert.equal(changeFileTone({ added: 2, removed: 1 }), "modified");
  });

  test("names the overview by file count", () => {
    assert.equal(filesChangedLabel(1), "1 File Changed");
    assert.equal(filesChangedLabel(108), "108 Files Changed");
  });

  test("stacks files in rail order, including collapsed groups", () => {
    assert.deepEqual(
      changeFileGroups(["a/b.ts", "z.ts"]).flatMap((group) => group.files),
      ["z.ts", "a/b.ts"],
    );
  });

  test("hides files in a collapsed group", () => {
    assert.deepEqual(
      labels(
        ["packages/desktop/src/a.ts", "packages/desktop/src/b.ts"],
        ["packages/desktop/src/"],
      ).map((row) => row.label),
      ["src"],
    );
  });
});

const entries = [
  { path: "packages/desktop/src/renderer/theme/styles.ts", status: "modified" },
  { path: "packages/desktop/src/renderer/theme/vars.ts", status: "deleted" },
  { path: "packages/core/src/kernel/step.ts", status: "added" },
  { path: "notes.md", status: "untracked" },
] as const;

describe("change path filter", () => {
  test("keeps every path for a blank query", () => {
    assert.equal(matchesChangePathQuery("a/b.ts", "   "), true);
    assert.deepEqual(
      filterChangePaths(entries, { query: "" }),
      entries.map((entry) => entry.path),
    );
  });

  test("matches a case-insensitive subsequence of the path", () => {
    assert.equal(matchesChangePathQuery("packages/desktop/src/theme.ts", "DSKTHEME"), true);
    assert.equal(matchesChangePathQuery("packages/desktop/src/theme.ts", "themedesk"), false);
  });

  test("matching a directory keeps its files", () => {
    assert.deepEqual(filterChangePaths(entries, { query: "theme/" }), [
      "packages/desktop/src/renderer/theme/styles.ts",
      "packages/desktop/src/renderer/theme/vars.ts",
    ]);
  });

  test("matching a file keeps its ancestors as group headers", () => {
    assert.deepEqual(labels(filterChangePaths(entries, { query: "step.ts" })), [
      {
        kind: "directory",
        label: "kernel",
        depth: 0,
        path: "packages/core/src/kernel/",
      },
      {
        kind: "file",
        label: "step.ts",
        depth: 1,
        path: "packages/core/src/kernel/step.ts",
      },
    ]);
  });

  test("filters by change status", () => {
    assert.deepEqual(filterChangePaths(entries, { statuses: ["added", "untracked"] }), [
      "packages/core/src/kernel/step.ts",
      "notes.md",
    ]);
    assert.deepEqual(
      filterChangePaths(entries, { statuses: [] }),
      entries.map((entry) => entry.path),
    );
  });

  test("drops entries without a status when a status filter is set", () => {
    assert.deepEqual(filterChangePaths([{ path: "a.ts" }], { statuses: ["modified"] }), []);
    assert.deepEqual(filterChangePaths([{ path: "a.ts" }], {}), ["a.ts"]);
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
    assert.deepEqual(
      filterChangePaths(entries, { viewed: { mode: "all" } }),
      entries.map((entry) => entry.path),
    );
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

describe("filtered tree rows", () => {
  test("regroups a narrowed path set with short labels", () => {
    assert.deepEqual(
      labels(filterChangePaths(entries, { query: "src" })).map((row) => row.label),
      ["kernel", "step.ts", "theme", "styles.ts", "vars.ts"],
    );
  });

  test("keeps collapsed directories collapsed after narrowing", () => {
    assert.deepEqual(
      labels(filterChangePaths(entries, { query: "theme" }), [
        "packages/desktop/src/renderer/theme/",
      ]).map((row) => row.label),
      ["theme"],
    );
  });

  test("renders an empty tree when nothing matches", () => {
    assert.deepEqual(labels(filterChangePaths(entries, { query: "zzz" })), []);
  });
});

describe("change selection summary", () => {
  test("reports none, some, and all", () => {
    const paths = ["a.ts", "b.ts"];
    assert.equal(
      changeSelectionSummary(paths, () => false),
      "none",
    );
    assert.equal(
      changeSelectionSummary(paths, (path) => path === "a.ts"),
      "some",
    );
    assert.equal(
      changeSelectionSummary(paths, () => true),
      "all",
    );
  });

  test("reports none for an empty list", () => {
    assert.equal(
      changeSelectionSummary([], () => true),
      "none",
    );
  });
});
