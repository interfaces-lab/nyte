import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId, readHunks } from "@nyte-ai/schema";
import type { GitStatus, Hunk, PatchEntry, PatchSet } from "@nyte-ai/schema";
import type { ExecutionEnv, GitApi } from "@nyte-ai/core";
import { afterEach, assert, describe, expect, it } from "vitest";
import { localExec, localFiles, localGit } from "../src/index.ts";
import { findExecutable } from "../src/local/command.ts";

const hasGit = (await findExecutable("git")) !== null;

const modesBlockReads = process.platform !== "win32" && process.getuid?.() !== 0;

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-git-")));
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

function localEnv(cwd: string): ExecutionEnv {
  return {
    identity: asId("test"),
    cwd,
    files: localFiles(cwd),
    exec: localExec(cwd),
    close: async () => undefined,
  };
}

async function repository(): Promise<{ readonly root: string; readonly git: GitApi }> {
  const root = await folder();
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.name", "Ada");
  sh(root, "config", "user.email", "ada@example.com");
  sh(root, "config", "commit.gpgsign", "false");
  await writeFile(join(root, "a.txt"), "one\ntwo\nthree\n");
  await writeFile(join(root, "b.txt"), "bee\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "first");

  return { root, git: localGit(localEnv(root)) };
}

async function repo(git: GitApi): Promise<Extract<GitStatus, { kind: "repository" }>> {
  const status = await git.status();
  assert(status.kind === "repository");

  return status;
}

function textHunks(entry: PatchEntry | undefined): readonly Hunk[] {
  assert(entry?.kind === "text");

  return readHunks(entry.patch);
}

async function first<T>(source: AsyncIterable<T>): Promise<T> {
  for await (const value of source) return value;

  throw new Error("The stream ended without a value.");
}

describe.skipIf(!hasGit)("localGit", () => {
  it("answers none outside a repository and an unborn status in a new one", async () => {
    const outside = await folder();
    const git = localGit(localEnv(outside));

    expect(await git.status()).toEqual({ kind: "none" });
    await expect(git.changes({ kind: "worktree" })).rejects.toMatchObject({ code: "unavailable" });

    sh(outside, "init", "-q", "-b", "main");
    await writeFile(join(outside, "new.txt"), "x\n");

    expect(await git.status()).toMatchObject({
      kind: "repository",
      root: outside,
      head: null,
      branch: "main",
      upstream: null,
      staged: [],
      unstaged: [],
      untracked: ["new.txt"],
      conflicts: [],
    });
    expect((await git.changes({ kind: "worktree" })).files).toEqual([
      { path: "new.txt", status: "untracked", stat: { kind: "text", added: 1, removed: 0 } },
    ]);
  });

  it("reads staged, unstaged and untracked files with line counts, its revision moving with every edit", async () => {
    const { root, git } = await repository();
    const clean = await repo(git);

    expect(clean.head).toMatch(/^[0-9a-f]{40}$/);
    expect(clean.staged).toEqual([]);

    await writeFile(join(root, "a.txt"), "one\nTWO\nthree\nfour\n");
    await writeFile(join(root, "c.txt"), "sea\n");
    sh(root, "add", "c.txt");
    await writeFile(join(root, "loose.txt"), "loose\n");
    await rm(join(root, "b.txt"));
    const dirty = await repo(git);

    expect(dirty.staged).toEqual([{ path: "c.txt", status: "added", added: 1, removed: 0 }]);
    expect(dirty.unstaged).toEqual([
      { path: "a.txt", status: "modified", added: 2, removed: 1 },
      { path: "b.txt", status: "deleted", added: 0, removed: 1 },
    ]);
    expect(dirty.untracked).toEqual(["loose.txt"]);
    expect(dirty.revision).not.toBe(clean.revision);
    expect((await repo(git)).revision).toBe(dirty.revision);

    await writeFile(join(root, "a.txt"), "one\nTWO!\nthree\nfour\n");
    expect((await repo(git)).revision).not.toBe(dirty.revision);
  });

  it("compares every scope with statuses and stats", async () => {
    const { root, git } = await repository();
    sh(root, "switch", "-q", "-c", "feature");
    await writeFile(join(root, "a.txt"), "one\n2\nthree\n");
    sh(root, "mv", "b.txt", "bee.txt");
    sh(root, "commit", "-q", "-am", "second");
    const second = sh(root, "rev-parse", "HEAD").trim();
    await writeFile(join(root, "a.txt"), "one\n2\nthree\nmore\n");
    sh(root, "add", "a.txt");
    await writeFile(join(root, "a.txt"), "one\n2\nthree\nmore\nand more\n");
    await writeFile(join(root, "u.txt"), "u\nu\n");

    expect((await git.changes({ kind: "staged" })).files).toEqual([
      { path: "a.txt", status: "modified", stat: { kind: "text", added: 1, removed: 0 } },
    ]);
    expect((await git.changes({ kind: "unstaged" })).files).toEqual([
      { path: "a.txt", status: "modified", stat: { kind: "text", added: 1, removed: 0 } },
      { path: "u.txt", status: "untracked", stat: { kind: "text", added: 2, removed: 0 } },
    ]);
    expect((await git.changes({ kind: "worktree" })).files).toEqual([
      { path: "a.txt", status: "modified", stat: { kind: "text", added: 2, removed: 0 } },
      { path: "u.txt", status: "untracked", stat: { kind: "text", added: 2, removed: 0 } },
    ]);
    expect((await git.changes({ kind: "commit", commit: asId(second) })).files).toEqual([
      { path: "a.txt", status: "modified", stat: { kind: "text", added: 1, removed: 1 } },
      {
        path: "bee.txt",
        status: "renamed",
        from: "b.txt",
        stat: { kind: "text", added: 0, removed: 0 },
      },
    ]);
    expect(
      (await git.changes({ kind: "branch", base: "main" })).files.map((file) => file.path),
    ).toEqual(["a.txt", "bee.txt"]);
    const changes = await git.changes({ kind: "worktree" });
    expect(changes.revision).toBe((await repo(git)).revision);
  });

  it("answers each path's section of the unified diff, batching past 32 paths and leaving out unreported paths", async () => {
    const { root, git } = await repository();
    await mkdir(join(root, "many"));

    for (let index = 0; index < 40; index += 1)
      await writeFile(join(root, "many", `f${index}.txt`), "base\n");
    await writeFile(join(root, "space.txt"), "a b\n");
    await writeFile(join(root, "pic.bin"), new Uint8Array([0, 1, 2, 3]));
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "more");

    for (let index = 0; index < 40; index += 1)
      await writeFile(join(root, "many", `f${index}.txt`), `base\nline ${index}\n`);
    await writeFile(join(root, "a.txt"), "one\nTWO\nthree");
    await writeFile(join(root, "space.txt"), "a  b\n");
    await writeFile(join(root, "pic.bin"), new Uint8Array([0, 1, 2, 4]));
    await writeFile(join(root, "big.txt"), "");
    sh(root, "add", "big.txt");
    sh(root, "commit", "-q", "-m", "big");
    await writeFile(join(root, "big.txt"), `${"z".repeat(100)}\n`.repeat(12_000));
    await writeFile(join(root, "fresh.txt"), "new\nfile\n");

    const many = Array.from({ length: 40 }, (_, index) => `many/f${index}.txt`);

    const set: PatchSet = await first(
      git.patches({ kind: "worktree" }, [
        ...many,
        "a.txt",
        "space.txt",
        "pic.bin",
        "big.txt",
        "fresh.txt",
        "clean.txt",
        "b.txt",
      ]),
    );

    expect(set.revision).toBe((await repo(git)).revision);
    expect(set.entries.size).toBe(45);
    expect(set.entries.has("b.txt")).toBe(false);
    expect(set.entries.get("many/f39.txt")).toMatchObject({
      kind: "text",
      added: 1,
      removed: 0,
      fresh: true,
    });
    expect(set.entries.get("a.txt")).toMatchObject({
      path: "a.txt",
      status: "modified",
      kind: "text",
      added: 2,
      removed: 2,
    });
    expect(textHunks(set.entries.get("a.txt"))).toMatchObject([
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        header: null,
        lines: [
          { kind: "context", text: "one" },
          { kind: "remove", text: "two" },
          { kind: "remove", text: "three" },
          { kind: "add", text: "TWO" },
          { kind: "add", text: "three", noNewline: true },
        ],
      },
    ]);
    expect(set.entries.get("a.txt")).toMatchObject({
      patch: expect.stringMatching(/^diff --git a\/a\.txt b\/a\.txt\n/),
    });
    expect(set.entries.get("pic.bin")).toMatchObject({ kind: "binary" });
    expect(set.entries.get("big.txt")).toMatchObject({ kind: "too-large", limit: 1024 * 1024 });
    expect(set.entries.get("fresh.txt")).toMatchObject({
      status: "untracked",
      kind: "text",
      added: 2,
    });
    expect(textHunks(set.entries.get("fresh.txt"))).toMatchObject([
      { oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 },
    ]);
    expect(set.entries.get("space.txt")).toMatchObject({ kind: "text" });

    const quiet = await first(
      git.patches({ kind: "worktree" }, ["space.txt", "a.txt"], { ignoreWhitespace: true }),
    );

    expect(quiet.entries.get("space.txt")).toMatchObject({ kind: "empty", status: "modified" });
    const again = await first(git.patches({ kind: "worktree" }, ["a.txt"]));
    expect(again.entries.get("a.txt")?.digest).toBe(set.entries.get("a.txt")?.digest);
  }, 20_000);

  it.skipIf(!modesBlockReads)(
    "answers an untracked file whose read fails as one failed entry, the others intact",
    async () => {
      const { root, git } = await repository();
      await writeFile(join(root, "locked.txt"), "secret\n");
      await chmod(join(root, "locked.txt"), 0o000);
      await writeFile(join(root, "a.txt"), "one\nTWO\nthree\n");
      const set = await first(git.patches({ kind: "worktree" }, ["locked.txt", "a.txt"]));

      expect(set.entries.get("locked.txt")).toMatchObject({
        status: "untracked",
        kind: "failed",
        reason: expect.stringContaining("EACCES"),
      });
      expect(set.entries.get("a.txt")).toMatchObject({ kind: "text", added: 1, removed: 1 });
    },
  );

  it("patches a rename against its old path", async () => {
    const { root, git } = await repository();
    sh(root, "mv", "a.txt", "renamed.txt");
    await writeFile(join(root, "renamed.txt"), "one\ntwo\nthree\nfour\n");
    sh(root, "add", "-A");
    const set = await first(git.patches({ kind: "staged" }, ["renamed.txt"]));

    expect(set.entries.get("renamed.txt")).toMatchObject({
      status: "renamed",
      kind: "text",
      added: 1,
      removed: 0,
    });
    expect(textHunks(set.entries.get("renamed.txt"))).toMatchObject([
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          { kind: "context", text: "one" },
          { kind: "context", text: "two" },
          { kind: "context", text: "three" },
          { kind: "add", text: "four" },
        ],
      },
    ]);
    expect(await git.contents("renamed.txt", { kind: "staged" })).toEqual({
      path: "renamed.txt",
      old: { kind: "text", text: "one\ntwo\nthree\n" },
      new: { kind: "text", text: "one\ntwo\nthree\nfour\n" },
    });
  });

  it("reads both sides of a file under a scope", async () => {
    const { root, git } = await repository();
    await writeFile(join(root, "a.txt"), "changed\n");
    await writeFile(join(root, "bin.dat"), new Uint8Array([0, 159, 146, 150]));
    await writeFile(join(root, "huge.txt"), "h".repeat(1024 * 1024 + 10));

    expect(await git.contents("a.txt", { kind: "worktree" })).toEqual({
      path: "a.txt",
      old: { kind: "text", text: "one\ntwo\nthree\n" },
      new: { kind: "text", text: "changed\n" },
    });
    expect(await git.contents("bin.dat", { kind: "worktree" })).toEqual({
      path: "bin.dat",
      old: { kind: "absent" },
      new: { kind: "binary" },
    });
    const huge = await git.contents("huge.txt", { kind: "unstaged" });
    expect(huge.new).toMatchObject({ kind: "truncated" });
    expect(huge.new.kind === "truncated" ? huge.new.head.length : 0).toBe(1024 * 1024);
    const head = (await repo(git)).head;
    assert(head !== null);
    expect(await git.contents("b.txt", { kind: "commit", commit: head })).toEqual({
      path: "b.txt",
      old: { kind: "absent" },
      new: { kind: "text", text: "bee\n" },
    });
  });

  it("pages history, lists refs and blames lines", async () => {
    const { root, git } = await repository();

    for (const name of ["two", "three"]) {
      await writeFile(join(root, `${name}.txt`), name);
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", `add ${name}`);
    }

    sh(root, "branch", "side");
    const page = await git.log({ limit: 2 });

    expect(page.items.map((commit) => commit.subject)).toEqual(["add three", "add two"]);
    expect(page.items[0]).toMatchObject({ author: "Ada", parents: [page.items[1]?.id] });
    expect(page.items[0]?.committedAt).toBeGreaterThan(Date.now() - 60_000);
    assert(page.next !== null);
    const rest = await git.log({ cursor: page.next, limit: 2 });
    expect(rest).toMatchObject({ items: [{ subject: "first", parents: [] }], next: null });

    const refs = await git.refs();
    expect(refs.current).toBe("main");
    expect(refs.branches.map((branch) => branch.name)).toEqual(["main", "side"]);
    expect(refs.branches[0]).toMatchObject({ commit: page.items[0]?.id, upstream: null });
    expect(refs.remotes).toEqual([]);

    await writeFile(join(root, "a.txt"), "one\ntwo\nthree\nuncommitted\n");
    const blame = await git.blame("a.txt");
    expect(blame.path).toBe("a.txt");
    expect(blame.lines.map((line) => [line.line, line.author])).toEqual([
      [1, "Ada"],
      [2, "Ada"],
      [3, "Ada"],
      [4, "Not Committed Yet"],
    ]);
    expect(blame.lines[0]?.at).toBeGreaterThan(0);
  });

  it("stages, unstages, discards and commits under expect, answering stale, unchanged and rejected", async () => {
    const { root, git } = await repository();
    await writeFile(join(root, "a.txt"), "edited\n");
    await writeFile(join(root, "new.txt"), "new\n");
    const before = await repo(git);

    expect(await git.stage(["a.txt"], { expect: asId("old") })).toEqual({
      kind: "stale",
      revision: before.revision,
    });
    const staged = await git.stage(["a.txt", "new.txt"], { expect: before.revision });
    assert(staged.kind === "applied");
    expect((await repo(git)).staged.map((file) => file.path)).toEqual(["a.txt", "new.txt"]);
    expect(await git.stage(["a.txt"])).toEqual({ kind: "unchanged" });

    expect(await git.unstage(["new.txt"], { expect: staged.revision })).toMatchObject({
      kind: "applied",
    });
    expect((await repo(git)).untracked).toEqual(["new.txt"]);

    await writeFile(join(root, "b.txt"), "changed bee\n");
    expect(await git.discard(["b.txt", "new.txt"])).toMatchObject({ kind: "applied" });
    const discarded = await repo(git);
    expect(discarded.untracked).toEqual([]);
    expect(discarded.unstaged).toEqual([]);

    expect(await git.commit({ message: "staged a", files: "staged" })).toMatchObject({
      kind: "applied",
    });
    expect(await git.commit({ message: "nothing", files: "staged" })).toEqual({
      kind: "unchanged",
    });
    await writeFile(join(root, "b.txt"), "bee two\n");
    expect(await git.commit({ message: "all", files: "all" })).toMatchObject({ kind: "applied" });
    await writeFile(join(root, "only.txt"), "only\n");
    await writeFile(join(root, "a.txt"), "left alone\n");
    expect(await git.commit({ message: "listed", files: ["only.txt"] })).toMatchObject({
      kind: "applied",
    });
    const after = await repo(git);
    expect(after.unstaged.map((file) => file.path)).toEqual(["a.txt"]);
    expect((await git.log({ limit: 1 })).items[0]?.subject).toBe("listed");
    expect(await git.stage(["missing.txt"])).toMatchObject({ kind: "rejected" });
  });

  it("branches, pushes to a remote with an upstream, and answers busy while the index is locked", async () => {
    const { root, git } = await repository();
    const remote = await folder();
    sh(remote, "init", "-q", "--bare");
    sh(root, "remote", "add", "origin", remote);

    expect(await git.branch({ name: "topic", checkout: false })).toMatchObject({ kind: "applied" });
    expect((await git.refs()).branches.map((branch) => branch.name)).toEqual(["main", "topic"]);
    expect(await git.branch({ name: "topic", checkout: true })).toMatchObject({ kind: "rejected" });
    expect(await git.branch({ name: "work", checkout: true })).toMatchObject({ kind: "applied" });
    expect((await repo(git)).branch).toBe("work");

    expect(await git.push({ setUpstream: true })).toMatchObject({ kind: "applied" });
    expect((await repo(git)).upstream).toEqual({ name: "origin/work", ahead: 0, behind: 0 });
    expect(await git.push()).toEqual({ kind: "unchanged" });

    await writeFile(join(root, ".git", "index.lock"), "");
    expect(await git.stage(["a.txt"])).toEqual({ kind: "busy", runs: [] });
    expect(await git.commit({ message: "x", files: "all" })).toEqual({ kind: "busy", runs: [] });
    expect(await git.branch({ name: "free", checkout: false })).toMatchObject({ kind: "applied" });
    await rm(join(root, ".git", "index.lock"));
  });

  it("watches the status and the changes as the revision moves", async () => {
    const { root, git } = await repository();
    const statuses = git.watch()[Symbol.asyncIterator]();
    const changes = git.watchChanges({ kind: "worktree" })[Symbol.asyncIterator]();
    const initial = await statuses.next();
    const none = await changes.next();

    assert(initial.done !== true && initial.value.kind === "repository");
    expect(none.value).toMatchObject({ files: [] });
    await writeFile(join(root, "a.txt"), "moved\n");
    const moved = await statuses.next();
    const changed = await changes.next();

    assert(moved.done !== true && moved.value.kind === "repository");
    expect(moved.value.revision).not.toBe(initial.value.revision);
    expect(moved.value.unstaged.map((file) => file.path)).toEqual(["a.txt"]);
    expect(changed.value).toMatchObject({
      revision: moved.value.revision,
      files: [{ path: "a.txt" }],
    });
    await statuses.return?.();
    await changes.return?.();
  }, 15_000);

  it("re-reads the status only for changes git can see, and looks the repository up once", async () => {
    const { root } = await repository();
    await writeFile(join(root, ".gitignore"), "out/\n");
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "ignore");
    await mkdir(join(root, "out"));
    const log = join(await folder(), "git.log");
    const wrapper = join(await folder(), process.platform === "win32" ? "git.cmd" : "git");
    await writeFile(
      wrapper,
      process.platform === "win32"
        ? `@node -e "require('node:fs').appendFileSync(process.argv[1], process.argv.slice(2).join(' ') + '\\n')" "${log}" %*\n@git %*\n`
        : `#!/bin/sh\necho "$*" >> '${log}'\nexec git "$@"\n`,
    );
    await chmod(wrapper, 0o755);
    const git = localGit(localEnv(root), { git: wrapper });
    const runs = async (): Promise<readonly string[]> =>
      (await readFile(log, "utf8").catch(() => "")).split("\n").filter((line) => line !== "");
    const statuses = git.watch()[Symbol.asyncIterator]();
    const initial = await statuses.next();
    assert(initial.done !== true && initial.value.kind === "repository");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const settled = (await runs()).length;

    await writeFile(join(root, "out", "built.js"), "x");
    sh(root, "update-ref", "refs/nyte/kept", "HEAD");
    sh(root, "hash-object", "-w", "--stdin");
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((await runs()).length).toBe(settled);

    await writeFile(join(root, "a.txt"), "moved\n");
    const moved = await statuses.next();
    assert(moved.done !== true && moved.value.kind === "repository");
    expect(moved.value.unstaged.map((file) => file.path)).toEqual(["a.txt"]);
    sh(root, "commit", "-q", "-am", "moved");
    const committed = await statuses.next();
    assert(committed.done !== true && committed.value.kind === "repository");
    expect(committed.value.unstaged).toEqual([]);
    expect(
      (await runs()).filter((line) => line.includes("rev-parse --show-toplevel")),
    ).toHaveLength(1);
    await statuses.return?.();
  }, 15_000);

  it("answers every path relative to a workspace below the repository root, prefixing it on the way in (§41j)", async () => {
    const { root } = await repository();
    await mkdir(join(root, "pkg"));
    await writeFile(join(root, "pkg", "a.ts"), "one\n");
    sh(root, "add", "-A");
    sh(root, "commit", "-q", "-m", "pkg");
    await writeFile(join(root, "pkg", "a.ts"), "two\n");
    await writeFile(join(root, "pkg", "new.ts"), "fresh\n");
    await writeFile(join(root, "a.txt"), "outside the workspace\n");
    const git = localGit(localEnv(join(root, "pkg")));
    const status = await repo(git);

    expect(status.root).toBe(root);
    expect(status.unstaged).toEqual([{ path: "a.ts", status: "modified", added: 1, removed: 1 }]);
    expect(status.untracked).toEqual(["new.ts"]);
    expect((await git.changes({ kind: "worktree" })).files).toEqual([
      { path: "a.ts", status: "modified", stat: { kind: "text", added: 1, removed: 1 } },
      { path: "new.ts", status: "untracked", stat: { kind: "text", added: 1, removed: 0 } },
    ]);

    const set = await first(git.patches({ kind: "worktree" }, ["a.ts", "new.ts", "a.txt"]));

    expect([...set.entries.keys()].sort()).toEqual(["a.ts", "new.ts"]);
    expect(set.entries.get("a.ts")).toMatchObject({
      path: "a.ts",
      kind: "text",
    });
    expect(textHunks(set.entries.get("a.ts"))).toMatchObject([
      {
        lines: [
          { kind: "remove", text: "one" },
          { kind: "add", text: "two" },
        ],
      },
    ]);
    expect(set.entries.get("new.ts")).toMatchObject({ path: "new.ts", kind: "text", added: 1 });
    expect(await git.contents("a.ts", { kind: "worktree" })).toEqual({
      path: "a.ts",
      old: { kind: "text", text: "one\n" },
      new: { kind: "text", text: "two\n" },
    });
    expect((await git.blame("a.ts")).lines).toHaveLength(1);

    expect(await git.stage(["a.ts"])).toMatchObject({ kind: "applied" });
    expect(sh(root, "diff", "--cached", "--name-only")).toBe("pkg/a.ts\n");
    expect((await repo(git)).staged).toEqual([
      { path: "a.ts", status: "modified", added: 1, removed: 1 },
    ]);
  });
});
