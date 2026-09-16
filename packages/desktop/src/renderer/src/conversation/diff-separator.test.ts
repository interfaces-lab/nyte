import { expect, test } from "vitest";
import { createDiffFilesLoader } from "./diff-expansion.ts";
import type { DesktopVcsContents } from "../../../shared/ipc.ts";
import type { FileDiffMetadata } from "@pierre/diffs";
import { testRenderer } from "../../../../test/renderer.ts";

const BOTH_SIDES: DesktopVcsContents = {
  path: "app.ts",
  old: { contents: "one\ntwo\n" },
  new: { contents: "one\nTWO\n" },
  binary: false,
  truncated: false,
};

/** Only the fields the loader reads; Pierre fills the rest from the patch. */
function fileDiff(overrides: Partial<FileDiffMetadata> = {}): FileDiffMetadata {
  return {
    name: "app.ts",
    type: "change",
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    ...overrides,
  };
}

const source = {
  repositoryId: "repo",
  revision: "abc123",
  base: "head",
} as const;

test("a changed file loads both sides, keyed per side so the two cannot share a cache entry", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () => Promise.resolve(BOTH_SIDES),
  });

  const files = await loader(fileDiff());

  expect(files.oldFile?.contents).toBe("one\ntwo\n");
  expect(files.newFile.contents).toBe("one\nTWO\n");
  expect(files.oldFile?.cacheKey).not.toBe(files.newFile.cacheKey);
  for (const key of [files.oldFile?.cacheKey ?? "", files.newFile.cacheKey ?? ""]) {
    expect(key).toContain("repo");
    expect(key).toContain("abc123");
    expect(key).toContain("app.ts");
  }
});

test("a revision or repository change gives the same path a different cache key", async () => {
  const read = (): Promise<DesktopVcsContents> => Promise.resolve(BOTH_SIDES);
  const first = await createDiffFilesLoader({ ...source, readContents: read })(fileDiff());
  const later = await createDiffFilesLoader({
    ...source,
    revision: "def456",
    readContents: read,
  })(fileDiff());

  expect(first.newFile.cacheKey).not.toBe(later.newFile.cacheKey);
});

test("the loader waits on the read rather than resolving with a half-loaded file", async () => {
  let release = (contents: DesktopVcsContents): void => void contents;
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () =>
      new Promise<DesktopVcsContents>((resolve) => {
        release = resolve;
      }),
  });

  const pending = loader(fileDiff());
  let settled = false;
  void pending.then(() => (settled = true));
  await Promise.resolve();
  expect(settled).toBe(false);

  release(BOTH_SIDES);
  await expect(pending).resolves.toMatchObject({ newFile: { contents: "one\nTWO\n" } });
});

test("a failed read surfaces as a rejection, which leaves the gap collapsed", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () => Promise.reject(new Error("no such repository")),
  });

  await expect(loader(fileDiff())).rejects.toThrow("no such repository");
});

test("a binary file offers no expansion, because neither side carries text", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () =>
      Promise.resolve({ path: "logo.png", old: null, new: null, binary: true, truncated: false }),
  });

  await expect(loader(fileDiff({ name: "logo.png" }))).rejects.toThrow(/binary/);
});

// Hydrating with a cut file would let Pierre recompute the diff against a file
// that stops early and report everything past the cut as deleted.
test("a truncated read expands nothing rather than claiming lines it does not have", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () => Promise.resolve({ ...BOTH_SIDES, truncated: true }),
  });

  await expect(loader(fileDiff())).rejects.toThrow(/part/);
});

test("a missing previous side is refused instead of being sent as an empty old file", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () => Promise.resolve({ ...BOTH_SIDES, old: null }),
  });

  await expect(loader(fileDiff())).rejects.toThrow(/previous contents/);
});

test("a pure rename loads only the new side, the shape Pierre asks for", async () => {
  const loader = createDiffFilesLoader({
    ...source,
    readContents: () => Promise.resolve(BOTH_SIDES),
  });

  const files = await loader(fileDiff({ type: "rename-pure", prevName: "old.ts" }));

  expect(files.oldFile).toBeNull();
  expect(files.newFile.contents).toBe("one\nTWO\n");
});

test("a renamed and changed file reads its previous contents under the previous path", async () => {
  const reads: string[] = [];
  const loader = createDiffFilesLoader({
    ...source,
    readContents: ({ path }) => {
      reads.push(path);
      return Promise.resolve(
        path === "old.ts" ? { ...BOTH_SIDES, path, new: null } : { ...BOTH_SIDES, path, old: null },
      );
    },
  });

  const files = await loader(fileDiff({ type: "rename-changed", prevName: "old.ts" }));

  expect(reads).toEqual(["app.ts", "old.ts"]);
  expect(files.oldFile?.name).toBe("old.ts");
  expect(files.oldFile?.contents).toBe("one\ntwo\n");
});

// The renderer fixture builds and boots Electron.
test(
  "collapsed context pins its count and offers one expand control",
  { timeout: 180_000 },
  async () => {
    const output = await testRenderer(
      new URL("./diff-separator.browser-test.tsx", import.meta.url),
      // DiffView reaches the session bridge through its import chain.
      `window.nyte = new Proxy({}, { get: () => new Proxy(function () {}, { get: () => () => {}, apply: () => Promise.resolve() }) });`,
    );

    expect(output).toBe(
      [
        'label="36 unmodified lines"',
        "labelOnTop=true",
        "bandsMeet=true",
        "bandHeight=28",
        "rowIsWholeRows=true",
        "buttons=2/0",
        "buttonsLeadBand=true",
        "countClearsButtons=true",
        'expanded="16 unmodified lines"',
        "linesGrew=true",
        "plainButtons=0",
        "shortGapButtons=1",
      ].join(" "),
    );
  },
);
