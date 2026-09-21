import { expect, test } from "vitest";
import type { VcsContents } from "@nyte-ai/protocol";
import type { FileDiffMetadata } from "@pierre/diffs";
import { createDiffFilesLoader } from "./diff-expansion.ts";
import { testRenderer } from "../../../../test/renderer.ts";

const BOTH_SIDES: VcsContents = {
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
  };
}

const source = {
  root: "/repo",
  revision: "abc123",
  scope: { kind: "worktree" },
} as const;

test("rejects binary contents before Pierre can hydrate text", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () =>
      Promise.resolve({ path: "logo.png", old: { kind: "binary" }, new: { kind: "binary" } }),
  });

  await expect(loader(fileDiff("logo.png"))).rejects.toThrow();
});

test("rejects truncated contents before Pierre can invent deletions", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () =>
      Promise.resolve({ ...BOTH_SIDES, new: { kind: "truncated", head: "one\nTWO\n" } }),
  });

  await expect(loader(fileDiff())).rejects.toThrow();
});

test("rejects absent previous contents instead of treating them as empty", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () => Promise.resolve({ ...BOTH_SIDES, old: { kind: "absent" } }),
  });

  await expect(loader(fileDiff())).rejects.toThrow();
});

test("a renamed edit reads its original path without losing either side", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: async ({ path }): Promise<VcsContents> =>
      path === "before.ts"
        ? { ...BOTH_SIDES, path, new: { kind: "absent" } }
        : { ...BOTH_SIDES, old: { kind: "absent" } },
  });
  const files = await loader({ ...fileDiff(), type: "rename-changed", prevName: "before.ts" });
  expect(files.oldFile?.contents).toBe("one\ntwo\n");
  expect(files.newFile.contents).toBe("one\nTWO\n");
  expect(files.oldFile?.cacheKey).not.toBe(files.newFile.cacheKey);
});

test(
  "the visible context control loads and reveals unchanged lines",
  { timeout: 60_000 },
  async () => {
    expect(
      await testRenderer(
        new URL("./diff-separator.browser-test.tsx", import.meta.url),
        `window.nyte = new Proxy({}, { get: () => new Proxy(function () {}, { get: () => () => {}, apply: () => Promise.resolve() }) });`,
      ),
    ).toBe("passed");
  },
);
