import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { RunId } from "@nyte-ai/schema";
import type { ExecutionEnv } from "@nyte-ai/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localExec, localFiles, localSnapshots } from "../src/index.ts";
import { findExecutable } from "../src/local/command.ts";

const hasGit = (await findExecutable("git")) !== null;

const run: RunId = asId("run-1");

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-snapshots-")));
  folders.push(made);

  return made;
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
}

function envOf(cwd: string): ExecutionEnv {
  return {
    identity: asId("test"),
    cwd,
    files: localFiles(cwd),
    exec: localExec(cwd),
    close: async () => undefined,
  };
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
    const snapshots = localSnapshots(envOf(root), { store });
    const before = await snapshots.before(run);

    expect(before).toMatch(/^git:[0-9a-f]{40}$/);
    expect(await snapshots.before(run)).toBe(before);
    expect(await snapshots.after(run)).toBe(before);

    await writeFile(join(root, "a.txt"), "one\nTWO\n");
    await rm(join(root, "gone.txt"));
    await rm(join(root, "moved.txt"));
    await writeFile(join(root, "renamed.txt"), "a stable body\nthat moves\nacross names\n");
    await writeFile(join(root, "fresh.txt"), "fresh\n");
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "out.js"), "ignored");
    const statusBefore = sh(root, "status", "--porcelain");
    const after = await snapshots.after(run);

    expect(after).not.toBe(before);
    expect(await snapshots.before(run)).toBe(before);
    expect(sh(root, "status", "--porcelain")).toBe(statusBefore);
    await vi.waitFor(() =>
      expect(sh(root, "ls-tree", "refs/nyte/kept")).toContain(`tree ${after.slice(4)}\t`),
    );
    expect(sh(root, "ls-tree", "refs/nyte/kept")).toContain(`tree ${committed}\t`);
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
      hunks: [
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
      ],
    });
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
    const snapshots = localSnapshots(envOf(join(root, "pkg")), { store: await folder() });
    const before = await snapshots.before(run);
    await writeFile(join(root, "pkg", "inside.txt"), "changed\n");
    await writeFile(join(root, "outside.txt"), "changed\n");
    const after = await snapshots.after(run);

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
    const snapshots = localSnapshots(envOf(root), { store: await folder() });
    const before = await snapshots.before(run);
    await writeFile(join(root, "big.txt"), lines("b"));
    await writeFile(join(root, "small.txt"), "two\n");
    const after = await snapshots.after(run);
    const patches = await snapshots.patches(before, after, ["big.txt", "small.txt"]);

    expect(patches.map((entry) => [entry.path, entry.kind])).toEqual([
      ["big.txt", "too-large"],
      ["small.txt", "text"],
    ]);
    expect(patches[0]).toMatchObject({ limit: 1024 * 1024 });
  });
});

describe("localSnapshots outside a repository", () => {
  it("walks the tree into a content-addressed store and compares manifests", async () => {
    const root = await folder();
    const store = await folder();
    await writeFile(join(root, ".gitignore"), "cache/\n");
    await writeFile(join(root, "a.txt"), "one\ntwo\nthree\n");
    await writeFile(join(root, "gone.txt"), "bye\n");
    await writeFile(join(root, "same.txt"), "kept body\n");
    await writeFile(join(root, "pic.bin"), new Uint8Array([0, 1, 2]));
    await writeFile(join(root, "big.txt"), "b".repeat(1024 * 1024 + 1));
    const snapshots = localSnapshots(envOf(root), { store, git: join(root, "no-git") });
    const before = await snapshots.before(run);

    expect(before).toMatch(/^tree:[0-9a-f]{64}$/);
    expect(await snapshots.after(run)).toBe(before);
    expect((await readdir(join(store, "trees"))).length).toBe(1);
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
    const after = await snapshots.after(run);

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
      hunks: [
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
      ],
    });
    expect(patches[3]).toMatchObject({
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1 }],
    });
    expect((await snapshots.diff(asId(""), before)).files.map((file) => file.path)).toEqual([
      ".gitignore",
      "a.txt",
      "big.txt",
      "gone.txt",
      "pic.bin",
      "same.txt",
    ]);
  });

  it("records a walk stopped at its limit as incomplete, so a path it missed is failed, never deleted or added", async () => {
    const root = await folder();
    const store = await folder();
    const git = join(root, "no-git");
    await writeFile(join(root, "a.txt"), "one\n");
    await writeFile(join(root, "b.txt"), "b\n");
    await writeFile(join(root, "c.txt"), "c\n");
    const full = localSnapshots(envOf(root), { store, git });
    const capped = localSnapshots(envOf(root), { store, git, limit: 2 });
    const before = await full.after(run);
    await writeFile(join(root, "a.txt"), "two\n");
    const after = await capped.after(run);

    const stored: unknown = JSON.parse(
      await readFile(join(store, "trees", `${after.slice("tree:".length)}.json`), "utf8"),
    );

    expect(stored).toMatchObject({ incomplete: true, files: { "a.txt": expect.any(String) } });
    expect((await full.diff(before, after)).files).toEqual([
      { path: "a.txt", status: "modified", stat: { kind: "text", added: 1, removed: 1 } },
      { path: "c.txt", status: "modified", stat: { kind: "unknown" } },
    ]);
    expect(await full.patches(before, after, ["a.txt", "c.txt"])).toMatchObject([
      { path: "a.txt", kind: "text" },
      { path: "c.txt", status: "modified", kind: "failed", reason: "incomplete" },
    ]);
    expect((await full.diff(after, before)).files).toContainEqual({
      path: "c.txt",
      status: "modified",
      stat: { kind: "unknown" },
    });
  });

  it("refuses to compare snapshots of two kinds", async () => {
    const root = await folder();

    const snapshots = localSnapshots(envOf(root), {
      store: await folder(),
      git: join(root, "no-git"),
    });

    const walked = await snapshots.after(run);

    await expect(
      snapshots.diff(asId("git:4b825dc642cb6eb9a060e54bf8d69288fbee4904"), walked),
    ).rejects.toMatchObject({
      code: "invalid",
    });
  });
});
