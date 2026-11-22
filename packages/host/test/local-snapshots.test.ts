import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId, readHunks } from "@nyte-ai/schema";
import type { Hunk, PatchEntry } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { localSnapshots } from "../src/index.ts";
import { findExecutable } from "../src/local/process/command.ts";

const hasGit = (await findExecutable("git")) !== null;

const WORKSPACE = { kind: "workspace" } as const;

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true, maxRetries: 10 });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-snapshots-")));
  folders.push(made);

  return made;
}

function textHunks(entry: PatchEntry | undefined): readonly Hunk[] {
  assert(entry?.kind === "text");

  return readHunks(entry.patch);
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
}

describe.skipIf(!hasGit)("localSnapshots in a repository", () => {
  it("writes trees through a temporary index under hidden refs, never touching the real index", async () => {
    const root = await folder();
    const store = await folder();
    sh(root, "init", "-q", "-b", "main");
    sh(root, "config", "user.name", "Ada");
    sh(root, "config", "user.email", "ada@example.com");
    await writeFile(join(root, ".gitignore"), "dist/\n");
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    await writeFile(join(root, "gone.txt"), "bye\n");
    await writeFile(join(root, "moved.txt"), "a stable body\nthat moves\nacross names\n");
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "first");
    const committed = sh(root, "rev-parse", "HEAD^{tree}").trim();
    sh(root, "update-ref", `refs/nyte/snapshots/${committed}`, committed);
    const snapshots = localSnapshots(root, { store });
    const before = await snapshots.capture(WORKSPACE);

    expect(before).toMatch(/^git:[0-9a-f]{40}$/);
    expect(await snapshots.capture(WORKSPACE)).toBe(before);

    await writeFile(join(root, "a.txt"), "one\nTWO\n");
    await rm(join(root, "gone.txt"));
    await rm(join(root, "moved.txt"));
    await writeFile(join(root, "renamed.txt"), "a stable body\nthat moves\nacross names\n");
    await writeFile(join(root, "fresh.txt"), "fresh\n");
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "out.js"), "ignored");
    const statusBefore = sh(root, "status", "--porcelain");
    const after = await snapshots.capture(WORKSPACE);

    expect(after).not.toBe(before);
    expect(sh(root, "status", "--porcelain")).toBe(statusBefore);
    await vi.waitFor(
      () =>
        expect(sh(root, "ls-tree", "refs/nyte/kept:g000000")).toContain(`tree ${after.slice(4)}\t`),
      { timeout: 20_000 },
    );
    expect(sh(root, "ls-tree", "refs/nyte/kept:g000000")).toContain(`tree ${committed}\t`);
    expect(sh(root, "show-ref")).not.toContain("refs/nyte/snapshots/");

    const changes = await snapshots.diff(before, after);
    expect(changes).toEqual({
      revision: after,
      files: [
        { path: "a.txt", status: "modified", stat: { kind: "text", added: 1, removed: 1 } },
        { path: "fresh.txt", status: "added", stat: { kind: "text", added: 1, removed: 0 } },
        { path: "gone.txt", status: "deleted", stat: { kind: "text", added: 0, removed: 1 } },
        {
          path: "renamed.txt",
          status: "renamed",
          from: "moved.txt",
          stat: { kind: "text", added: 0, removed: 0 },
        },
      ],
    });

    const patches = await snapshots.patches(before, after, [
      "a.txt",
      "renamed.txt",
      "unrelated.txt",
    ]);

    expect(patches).toHaveLength(2);
    expect(patches[0]).toMatchObject({
      path: "a.txt",
      status: "modified",
      kind: "text",
    });
    expect(textHunks(patches[0])).toMatchObject([
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: "context", text: "one" },
          { kind: "remove", text: "two" },
          { kind: "add", text: "TWO" },
        ],
      },
    ]);
    expect(patches[1]).toMatchObject({ path: "renamed.txt", status: "renamed", kind: "empty" });
    expect((await snapshots.diff(asId(""), before)).files.map((file) => file.status)).toEqual([
      "added",
      "added",
      "added",
      "added",
    ]);
  });

  it("snapshots a workspace below the repository root with paths relative to it", async () => {
    const root = await folder();
    sh(root, "init", "-q", "-b", "main");
    await mkdir(join(root, "pkg"));
    await writeFile(join(root, "outside.txt"), "o\n");
    await writeFile(join(root, "pkg", "inside.txt"), "i\n");
    const snapshots = localSnapshots(join(root, "pkg"), { store: await folder() });
    const before = await snapshots.capture(WORKSPACE);
    await writeFile(join(root, "pkg", "inside.txt"), "changed\n");
    await writeFile(join(root, "outside.txt"), "changed\n");
    const after = await snapshots.capture(WORKSPACE);

    expect((await snapshots.diff(before, after)).files).toEqual([
      { path: "inside.txt", status: "modified", stat: { kind: "text", added: 1, removed: 1 } },
    ]);
  });

  it("answers a change past 1 MiB as too-large next to a small one, never failing the whole call", async () => {
    const root = await folder();
    sh(root, "init", "-q", "-b", "main");
    const lines = (letter: string): string => `${letter.repeat(999)}\n`.repeat(1_200);
    await writeFile(join(root, "big.txt"), lines("a"));
    await writeFile(join(root, "small.txt"), "one\n");
    const snapshots = localSnapshots(root, { store: await folder() });
    const before = await snapshots.capture(WORKSPACE);
    await writeFile(join(root, "big.txt"), lines("b"));
    await writeFile(join(root, "small.txt"), "two\n");
    const after = await snapshots.capture(WORKSPACE);
    const patches = await snapshots.patches(before, after, ["big.txt", "small.txt"]);

    expect(patches.map((entry) => [entry.path, entry.kind])).toEqual([
      ["big.txt", "too-large"],
      ["small.txt", "text"],
    ]);
    expect(patches[0]).toMatchObject({ limit: 1024 * 1024 });
  });
});

describe("localSnapshots outside a repository", () => {
  it("journals what changed between two workspace captures of a small folder", async () => {
    const root = await folder();
    const store = await folder();
    await writeFile(join(root, ".gitignore"), "cache/\n");
    await writeFile(join(root, "a.txt"), "one\ntwo\nthree\n");
    await writeFile(join(root, "gone.txt"), "bye\n");
    await writeFile(join(root, "same.txt"), "kept body\n");
    await writeFile(join(root, "pic.bin"), new Uint8Array([0, 1, 2]));
    await writeFile(join(root, "big.txt"), "b".repeat(1024 * 1024 + 1));
    const snapshots = localSnapshots(root, { store, git: join(root, "no-git") });
    const before = await snapshots.capture(WORKSPACE);

    expect(before).toMatch(/^journal:/);
    expect(await snapshots.capture(WORKSPACE)).toBe(before);
    expect(await readdir(store)).toEqual(["journals", "objects"]);
    expect((await readdir(join(store, "objects"))).length).toBe(5);

    await writeFile(join(root, "a.txt"), "one\n2\nthree\n");
    await rm(join(root, "gone.txt"));
    await rm(join(root, "same.txt"));
    await writeFile(join(root, "moved.txt"), "kept body\n");
    await writeFile(join(root, "pic.bin"), new Uint8Array([0, 1, 3]));
    await writeFile(join(root, "big.txt"), "c".repeat(1024 * 1024 + 1));
    await writeFile(join(root, "new.txt"), "new\n");
    await mkdir(join(root, "cache"));
    await writeFile(join(root, "cache", "x"), "ignored");
    const after = await snapshots.capture(WORKSPACE);

    expect((await snapshots.diff(before, after)).files).toEqual([
      { path: "a.txt", status: "modified", stat: { kind: "text", added: 1, removed: 1 } },
      { path: "big.txt", status: "modified", stat: { kind: "unknown" } },
      { path: "gone.txt", status: "deleted", stat: { kind: "text", added: 0, removed: 1 } },
      {
        path: "moved.txt",
        status: "renamed",
        from: "same.txt",
        stat: { kind: "text", added: 0, removed: 0 },
      },
      { path: "new.txt", status: "added", stat: { kind: "text", added: 1, removed: 0 } },
      { path: "pic.bin", status: "modified", stat: { kind: "binary" } },
    ]);

    const patches = await snapshots.patches(before, after, [
      "a.txt",
      "big.txt",
      "pic.bin",
      "new.txt",
      "gone.txt",
      "none.txt",
    ]);

    expect(patches.map((entry) => [entry.path, entry.kind])).toEqual([
      ["a.txt", "text"],
      ["big.txt", "too-large"],
      ["pic.bin", "binary"],
      ["new.txt", "text"],
      ["gone.txt", "text"],
    ]);
    expect(patches[0]).toMatchObject({
      added: 1,
      removed: 1,
    });
    expect(textHunks(patches[0])).toMatchObject([
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        header: null,
        lines: [
          { kind: "context", text: "one" },
          { kind: "remove", text: "two" },
          { kind: "add", text: "2" },
          { kind: "context", text: "three" },
        ],
      },
    ]);
    expect(patches[3]).toMatchObject({});
    expect(textHunks(patches[3])).toMatchObject([
      { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1 },
    ]);
  });

  it("digests a manifest patch per whitespace mode, so one digest never names two patches", async () => {
    const root = await folder();
    const store = await folder();
    await writeFile(join(root, "a.txt"), "a b\nc\n");
    const snapshots = localSnapshots(root, { store, git: join(root, "no-git") });
    const before = await snapshots.capture(WORKSPACE);
    await writeFile(join(root, "a.txt"), "a  b\nd\n");
    const after = await snapshots.capture(WORKSPACE);
    const [exact] = await snapshots.patches(before, after, ["a.txt"]);
    const [loose] = await snapshots.patches(before, after, ["a.txt"], { ignoreWhitespace: true });

    expect(textHunks(exact)[0]?.lines).toHaveLength(4);
    expect(textHunks(loose)[0]?.lines).toHaveLength(3);
    expect(loose?.digest).not.toBe(exact?.digest);
  });

  it("past its discovery limit, finds nothing on its own but still journals the paths it is named", async () => {
    const root = await folder();
    const store = await folder();
    await writeFile(join(root, "a.txt"), "one\n");
    await writeFile(join(root, "b.txt"), "b\n");
    await writeFile(join(root, "c.txt"), "c\n");
    const snapshots = localSnapshots(root, { store, git: join(root, "no-git"), limit: 2 });
    const quiet = await snapshots.capture(WORKSPACE);
    await writeFile(join(root, "b.txt"), "unseen\n");

    expect((await snapshots.diff(quiet, await snapshots.capture(WORKSPACE))).files).toEqual([]);

    const before = await snapshots.capture({ kind: "paths", paths: ["a.txt", "./made.txt"] });
    await writeFile(join(root, "a.txt"), "two\n");
    await writeFile(join(root, "made.txt"), "made\n");
    const after = await snapshots.capture({ kind: "paths", paths: ["a.txt", "made.txt"] });

    expect((await snapshots.diff(before, after)).files).toEqual([
      { path: "a.txt", status: "modified", stat: { kind: "text", added: 1, removed: 1 } },
      { path: "made.txt", status: "added", stat: { kind: "text", added: 1, removed: 0 } },
    ]);
    expect((await snapshots.diff(after, before)).files).toEqual([
      { path: "a.txt", status: "modified", stat: { kind: "text", added: 1, removed: 1 } },
      { path: "made.txt", status: "deleted", stat: { kind: "text", added: 0, removed: 1 } },
    ]);
    expect(await snapshots.capture({ kind: "paths", paths: ["../outside.txt"] })).toBe(after);
  });

  it("refuses to compare snapshots of two kinds", async () => {
    const root = await folder();

    const snapshots = localSnapshots(root, {
      store: await folder(),
      git: join(root, "no-git"),
    });

    const journaled = await snapshots.capture(WORKSPACE);

    await expect(
      snapshots.diff(journaled, asId("git:4b825dc642cb6eb9a060e54bf8d69288fbee4904")),
    ).rejects.toMatchObject({
      code: "invalid",
    });
  });
});
