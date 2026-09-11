import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  changeFileGroups,
  changeFileTone,
  filesChangedLabel,
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
