import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { FileEvent, ScanFrame, SearchFrame } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it } from "vitest";
import { localFiles } from "../src/index.ts";
import { sha256 } from "../src/hash.ts";
import { WALK_LIMIT, walkTree } from "../src/local/tree.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-files-")));
  folders.push(made);

  return made;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];

  for await (const item of source) all.push(item);

  return all;
}

function paths(frames: readonly ScanFrame[]): string[] {
  return frames.flatMap((frame) =>
    frame.kind === "entries" ? frame.entries.map((entry) => entry.path) : [],
  );
}

describe("localFiles", () => {
  it("reads text, binary, large and missing files with content versions", async () => {
    const root = await folder();
    await writeFile(join(root, "a.txt"), "hello\n");
    await writeFile(join(root, "b.bin"), new Uint8Array([0, 1, 2]));
    await writeFile(join(root, "big.txt"), "x".repeat(1024 * 1024 + 1));
    const files = localFiles(root);

    expect(await files.read("a.txt")).toEqual({
      kind: "text",
      path: "a.txt",
      contents: "hello\n",
      version: sha256("hello\n"),
    });
    expect(await files.read("b.bin")).toMatchObject({ kind: "binary", size: 3 });
    expect(await files.read("big.txt")).toMatchObject({
      kind: "large",
      size: 1024 * 1024 + 1,
      version: sha256("x".repeat(1024 * 1024 + 1)),
    });
    expect(await files.read("nope.txt")).toEqual({ kind: "missing", path: "nope.txt" });
    expect(await files.read(join(root, "a.txt"))).toMatchObject({
      kind: "text",
      contents: "hello\n",
    });
    await expect(files.read(".")).rejects.toMatchObject({ code: "invalid" });
  });

  it("streams bytes with the version it read", async () => {
    const root = await folder();
    const bytes = new Uint8Array(200_000).map((_, index) => index % 251);
    await writeFile(join(root, "data.bin"), bytes);
    const reader = await localFiles(root).bytes("data.bin");
    const chunks = await collect(reader.chunks());

    expect(reader.size).toBe(200_000);
    expect(reader.mime).toBeNull();
    expect(reader.version).toBe(sha256(bytes));
    expect(Buffer.concat(chunks).equals(Buffer.from(bytes))).toBe(true);
    await expect(localFiles(root).bytes("gone")).rejects.toMatchObject({ code: "unknown" });
  });

  it("stats files, directories and symlinks", async () => {
    const root = await folder();
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "dir", "f.txt"), "f");
    await symlink("dir/f.txt", join(root, "link"));
    const files = localFiles(root);

    expect(await files.stat("dir/f.txt")).toEqual({ kind: "file", size: 1, version: sha256("f") });
    expect(await files.stat("dir")).toMatchObject({ kind: "directory", version: sha256("f.txt") });
    expect(await files.stat("link")).toMatchObject({
      kind: "symlink",
      target: "dir/f.txt",
      version: sha256("dir/f.txt"),
    });
    expect(await files.stat("none")).toBeNull();
  });

  it("writes under expect, absent and parents, keeping the mode and writing through symlinks", async () => {
    const root = await folder();
    const files = localFiles(root);
    const created = await files.write("new.txt", "one", { expect: "absent" });

    assert(created.kind === "saved");
    expect(created.version).toBe(sha256("one"));
    expect(await files.write("new.txt", "again", { expect: "absent" })).toEqual({
      kind: "stale",
      current: sha256("one"),
    });
    expect(await files.write("new.txt", "two", { expect: created.version })).toEqual({
      kind: "saved",
      version: sha256("two"),
    });
    expect(await files.write("new.txt", "three", { expect: created.version })).toEqual({
      kind: "stale",
      current: sha256("two"),
    });
    expect(await files.write("new.txt", "four")).toMatchObject({ kind: "saved" });
    expect(await files.write("deep/er/file.txt", "x")).toEqual({ kind: "missing-parent" });
    expect(await files.write("deep/er/file.txt", "x", { parents: true })).toMatchObject({
      kind: "saved",
    });
    expect(await readFile(join(root, "deep/er/file.txt"), "utf8")).toBe("x");

    await writeFile(join(root, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
    await files.write("run.sh", "#!/bin/sh\necho\n");
    expect((await stat(join(root, "run.sh"))).mode & 0o777).toBe(0o755);

    await symlink("new.txt", join(root, "alias"));
    const read = await files.read("alias");
    assert(read.kind === "text");
    expect(await files.write("alias", "through", { expect: read.version })).toMatchObject({
      kind: "saved",
    });
    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("through");
    expect((await files.stat("alias"))?.kind).toBe("symlink");
  });

  it("removes under expect", async () => {
    const root = await folder();
    await writeFile(join(root, "r.txt"), "r");
    const files = localFiles(root);

    expect(await files.remove("r.txt", { expect: asId(sha256("other")) })).toEqual({
      kind: "stale",
      current: sha256("r"),
    });
    expect(await files.remove("r.txt", { expect: asId(sha256("r")) })).toEqual({
      kind: "saved",
      version: sha256("r"),
    });
    expect(await files.remove("r.txt")).toEqual({ kind: "stale", current: null });
  });

  it("leaves batch and upload to core", async () => {
    const files = localFiles(await folder());

    await expect(files.batch().put({ path: "a", contents: "a" }).apply()).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(files.upload((async function* () {})())).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("scans in pages, honouring .gitignore unless asked, and stops at the limit", async () => {
    const root = await folder();
    await writeFile(join(root, ".gitignore"), "ignored/\n*.log\n");
    await mkdir(join(root, "ignored"));
    await writeFile(join(root, "ignored", "x.txt"), "x");
    await mkdir(join(root, "src", "nested"), { recursive: true });
    await writeFile(join(root, "src", ".gitignore"), "secret.txt\n");
    await writeFile(join(root, "src", "secret.txt"), "s");
    await writeFile(join(root, "src", "nested", "kept.ts"), "k");
    await writeFile(join(root, "app.log"), "l");
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "HEAD"), "ref");
    const files = localFiles(root);

    const kept = await collect(files.scan());
    expect(paths(kept)).toEqual([
      ".gitignore",
      "src",
      "src/.gitignore",
      "src/nested",
      "src/nested/kept.ts",
    ]);
    expect(kept.at(-1)).toEqual({ kind: "complete" });
    const [first] = kept;
    assert(first?.kind === "entries");
    expect(first.entries[0]).toEqual({ path: ".gitignore", kind: "file", size: 15, version: null });

    const everything = paths(await collect(files.scan({ ignored: "include" })));
    expect(everything).toContain("ignored/x.txt");
    expect(everything).toContain("app.log");
    expect(everything).not.toContain(".git");

    expect(paths(await collect(files.scan({ directory: "src" })))).toEqual([
      "src/.gitignore",
      "src/nested",
      "src/nested/kept.ts",
    ]);
    expect(paths(await collect(files.scan({ directory: "ignored" })))).toEqual(["ignored/x.txt"]);
    expect(paths(await collect(files.scan({ directory: join(root, "src", "nested") })))).toEqual([
      join(root, "src", "nested", "kept.ts"),
    ]);
  });

  it("pages a tree by 500 entries, and a walk answers incomplete at its limit", async () => {
    const root = await folder();
    await Promise.all(
      Array.from({ length: 1_200 }, (_, index) =>
        writeFile(join(root, `f${String(index).padStart(4, "0")}`), ""),
      ),
    );
    const frames = await collect(localFiles(root).scan());

    expect(
      frames.map((frame) => (frame.kind === "entries" ? frame.entries.length : frame.kind)),
    ).toEqual([500, 500, 200, "complete"]);
    expect(WALK_LIMIT).toBe(50_000);

    const limited = await collect(walkTree(root, { ignored: "exclude", limit: 10, page: 4 }));
    expect(
      limited.map((frame) => (frame.kind === "entries" ? frame.entries.length : frame)),
    ).toEqual([4, 4, 2, { kind: "incomplete", reason: "limit" }]);
  }, 30_000);

  it("finds names fuzzily, best match first, capped", async () => {
    const root = await folder();
    await mkdir(join(root, "src", "parser"), { recursive: true });
    await writeFile(join(root, "src", "parser", "index.ts"), "");
    await writeFile(join(root, "src", "parser.ts"), "");
    await writeFile(join(root, "src", "my-parser.test.ts"), "");
    await writeFile(join(root, "README.md"), "");
    const files = localFiles(root);
    const found = await files.find({ query: "parser" });

    expect(found.map((entry) => entry.path)).toEqual([
      "src/parser.ts",
      "src/my-parser.test.ts",
      "src/parser/index.ts",
    ]);
    expect((await files.find({ query: "rdm" })).map((entry) => entry.path)).toEqual(["README.md"]);
    expect(await files.find({ query: "parser", limit: 1 })).toHaveLength(1);
    expect((await files.find({ query: "", limit: 500 })).length).toBeLessThanOrEqual(50);
  });

  for (const engine of ["ripgrep", "scan"] as const)
    it(`searches content with smart case through ${engine}`, async () => {
      const root = await folder();
      await writeFile(join(root, "a.ts"), "const Alpha = 1;\nconst beta = alpha;\n");
      await writeFile(join(root, "b.txt"), "nothing here\nALPHA again\n");
      await writeFile(join(root, ".gitignore"), "skip.txt\n");
      await writeFile(join(root, "skip.txt"), "alpha hidden\n");

      const files = localFiles(
        root,
        engine === "scan" ? { ripgrep: join(root, "no-rg") } : undefined,
      );

      const all = await collect(files.search({ query: "alpha" }));

      const matches = all.filter(
        (frame): frame is Extract<SearchFrame, { kind: "match" }> => frame.kind === "match",
      );

      expect(all.at(-1)).toEqual({ kind: "complete" });
      expect(
        matches
          .map((match) => [match.path, match.line, match.column])
          .sort((left, right) => String(left).localeCompare(String(right))),
      ).toEqual([
        ["a.ts", 1, 7],
        ["a.ts", 2, 14],
        ["b.txt", 2, 1],
      ]);
      expect(matches.find((match) => match.path === "b.txt")?.text).toBe("ALPHA again");

      const exact = await collect(files.search({ query: "Alpha" }));
      expect(exact.filter((frame) => frame.kind === "match")).toHaveLength(1);

      expect((await collect(files.search({ query: "alpha", limit: 1 }))).at(-1)).toEqual({
        kind: "truncated",
        limit: 1,
      });
    });

  it("formats with a detected formatter and answers unavailable without one", async () => {
    const root = await folder();

    const files = localFiles(root, {
      formatter: join(import.meta.dirname, "../../../node_modules/.bin/oxfmt"),
    });

    const formatted = await files.format("a.ts", "const   a=1\n");

    expect(formatted).toEqual({ kind: "formatted", contents: "const a = 1;\n" });
    expect(await files.format("a.ts", "const a = 1;\n")).toEqual({ kind: "unchanged" });
    expect(
      (await localFiles(root, { formatter: join(root, "none") }).format("a.ts", "x")).kind,
    ).toBe("unavailable");
  });

  it("watches created, modified and removed files, coalesced, without ignored paths", async () => {
    const root = await folder();
    await writeFile(join(root, ".gitignore"), "out/\n");
    await mkdir(join(root, "out"));
    await writeFile(join(root, "kept.txt"), "one");
    const controller = new AbortController();
    const files = localFiles(root, { signal: controller.signal });
    const iterator = files.watch()[Symbol.asyncIterator]();
    const seen: FileEvent[] = [];

    const until = async (done: () => boolean): Promise<void> => {
      while (!done()) {
        const next = await iterator.next();

        if (next.done === true) return;
        seen.push(...next.value);
      }
    };

    const pending = until(() =>
      seen.some((event) => event.path === "fresh.txt" && event.kind === "created"),
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    await writeFile(join(root, "out", "built.js"), "x");
    await writeFile(join(root, "fresh.txt"), "new");
    await pending;

    await writeFile(join(root, "fresh.txt"), "changed");
    await until(() =>
      seen.some((event) => event.path === "fresh.txt" && event.kind === "modified"),
    );
    await rm(join(root, "fresh.txt"));
    await until(() => seen.some((event) => event.path === "fresh.txt" && event.kind === "removed"));

    expect(
      seen.find((event) => event.kind === "modified" && event.path === "fresh.txt")?.version,
    ).toBe(sha256("changed"));
    expect(seen.find((event) => event.kind === "removed")?.version).toBeNull();
    expect(seen.some((event) => event.path.startsWith("out/"))).toBe(false);

    controller.abort();
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  }, 20_000);
});
