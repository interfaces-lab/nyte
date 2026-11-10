import { expect, test } from "vitest";
import type { FileDiffMetadata } from "@nyte-ai/ui/diffs";
import { createDiffFilesLoader } from "./diff-expansion.ts";
import type { DiffContents } from "./diff-expansion.ts";

const BOTH_SIDES: DiffContents = {
  path: "app.ts",
  old: { kind: "text", text: "one\ntwo\n" },
  new: { kind: "text", text: "one\nTWO\n" },
};

function fileDiff(name = "app.ts"): FileDiffMetadata {
  return {
    name,
    type: "change",
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    deletionCharacterCount: 0,
    additionCharacterCount: 0,
  };
}

const source = {
  root: "/repo",
  scope: { kind: "worktree" },
} as const;

test.each<{ readonly name: string; readonly contents: DiffContents; readonly error: string }>([
  {
    name: "binary contents before Pierre can hydrate text",
    contents: { path: "logo.png", old: { kind: "binary" }, new: { kind: "binary" } },
    error: "Cannot expand logo.png: the file is binary",
  },
  {
    name: "truncated contents before Pierre can invent deletions",
    contents: { ...BOTH_SIDES, new: { kind: "truncated", head: "one\nTWO\n" } },
    error: "Cannot expand app.ts: the file was read only in part",
  },
  {
    name: "absent previous contents instead of treating them as empty",
    contents: { ...BOTH_SIDES, old: { kind: "absent" } },
    error: "Cannot expand app.ts: it has no previous contents",
  },
])("rejects $name", async (row) => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () => Promise.resolve(row.contents),
  });

  await expect(loader(fileDiff(row.contents.path))).rejects.toThrow(row.error);
});

test("a renamed edit reads its original path without losing either side", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: async ({ path }): Promise<DiffContents> =>
      path === "before.ts"
        ? { ...BOTH_SIDES, path, new: { kind: "absent" } }
        : { ...BOTH_SIDES, old: { kind: "absent" } },
  });

  const files = await loader({ ...fileDiff(), type: "rename-changed", prevName: "before.ts" });
  expect(files.oldFile?.contents).toBe("one\ntwo\n");
  expect(files.newFile.contents).toBe("one\nTWO\n");
  expect(files.oldFile?.cacheKey).not.toBe(files.newFile.cacheKey);
});
