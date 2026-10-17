import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { WorkspaceTarget } from "@nyte-ai/schema";
import { composeHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import type { ExecutionEnv } from "@nyte-ai/core";
import { afterEach, assert, describe, expect, it } from "vitest";
import {
  listWorktrees,
  localExec,
  localFiles,
  localProvider,
  localWorktrees,
} from "../src/index.ts";
import { findExecutable } from "../src/local/command.ts";
import { fakeModels } from "../src/bench/fake-models.ts";
import type { Reply, Request } from "../src/bench/fake-models.ts";

const hasGit = (await findExecutable("git")) !== null;

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-worktrees-")));
  folders.push(made);

  return made;
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
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

function readPath(target: WorkspaceTarget): string {
  assert("path" in target);

  return target.path;
}

async function repository(): Promise<string> {
  const root = join(await folder(), "project");
  await mkdir(root);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.name", "Ada");
  sh(root, "config", "user.email", "ada@example.com");
  await writeFile(join(root, ".gitignore"), "dist/\n.env\n");
  await writeFile(join(root, "a.txt"), "one\n");
  await writeFile(join(root, "gone.txt"), "bye\n");
  await mkdir(join(root, "app"));
  await writeFile(join(root, "app", "main.ts"), "export {};\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "first");

  return root;
}

describe.skipIf(!hasGit)("localWorktrees", () => {
  it("branches a worktree from HEAD with the uncommitted changes copied in, leaving the source untouched, and answers it again for the same name", async () => {
    const root = await repository();
    const home = await folder();
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    await rm(join(root, "gone.txt"));
    await writeFile(join(root, "fresh.txt"), "fresh\n");
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "out.js"), "built\n");
    sh(root, "add", "fresh.txt");
    const status = sh(root, "status", "--porcelain");
    const head = sh(root, "rev-parse", "HEAD").trim();
    const worktrees = localWorktrees({ home });

    const made = await worktrees.create(localEnv(root), { name: "session-1", title: "Fix login!" });
    const path = readPath(made.target);

    expect(made.branch).toMatch(/^nyte\/fix-login-[0-9a-f]{8}$/);
    expect(made.base).toBe(head);
    expect(path).toBe(
      join(await realpath(home), ".nyte", "worktrees", "project", made.branch.slice(5)),
    );
    expect(sh(path, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(made.branch);
    expect(await readFile(join(path, "a.txt"), "utf8")).toBe("one\ntwo\n");
    expect(await readFile(join(path, "fresh.txt"), "utf8")).toBe("fresh\n");
    expect(await stat(join(path, "gone.txt")).catch(() => null)).toBeNull();
    expect(await stat(join(path, "dist")).catch(() => null)).toBeNull();
    expect(sh(path, "status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual([
      " D gone.txt",
      " M a.txt",
      "?? fresh.txt",
    ]);
    expect(sh(root, "status", "--porcelain")).toBe(status);

    expect(
      await worktrees.create(localEnv(root), { name: "session-1", title: "Fix login!" }),
    ).toEqual(made);
    expect(await listWorktrees(root)).toEqual([
      { path: root, branch: "main" },
      { path, branch: made.branch },
    ]);
  });

  it("puts a workspace below the repository root at the same folder below the worktree's", async () => {
    const root = await repository();
    const made = await localWorktrees({ home: await folder() }).create(
      localEnv(join(root, "app")),
      {
        name: "session-2",
        title: null,
      },
    );

    expect(made.branch).toMatch(/^nyte\/[0-9a-f]{8}$/);
    expect(readPath(made.target)).toMatch(/\/project\/[0-9a-f]{8}\/app$/);
    expect(await readFile(join(readPath(made.target), "main.ts"), "utf8")).toBe("export {};\n");
  });

  it("refuses a folder outside git and a repository with no commit", async () => {
    const worktrees = localWorktrees({ home: await folder() });
    const plain = await folder();

    await expect(worktrees.create(localEnv(plain), { name: "s", title: null })).rejects.toThrow(
      `${plain} is not in a git repository, so it cannot have a worktree.`,
    );

    sh(plain, "init", "-q", "-b", "main");

    await expect(worktrees.create(localEnv(plain), { name: "s", title: null })).rejects.toThrow(
      `${plain} has no commits yet, so a worktree has nothing to branch from.`,
    );
  });

  it("removes a clean worktree and its branch, keeps a branch with commits, and keeps a worktree with uncommitted changes", async () => {
    const root = await repository();
    const worktrees = localWorktrees({ home: await folder() });
    const env = localEnv(root);
    const clean = await worktrees.create(env, { name: "clean", title: null });
    const committed = await worktrees.create(env, { name: "committed", title: null });
    const dirty = await worktrees.create(env, { name: "dirty", title: null });
    const built = await worktrees.create(env, { name: "built", title: null });
    const secret = await worktrees.create(env, { name: "secret", title: null });

    await writeFile(join(readPath(committed.target), "a.txt"), "changed\n");
    sh(readPath(committed.target), "commit", "-q", "-am", "work");
    await writeFile(join(readPath(dirty.target), "a.txt"), "unsaved\n");
    await mkdir(join(readPath(built.target), "dist"), { recursive: true });
    await writeFile(join(readPath(built.target), "dist", "a.js"), "built\n");
    await writeFile(join(readPath(secret.target), ".env"), "TOKEN=1\n");

    expect(await worktrees.remove(clean)).toEqual({ folder: "removed", branch: "deleted" });
    expect(await worktrees.remove(committed)).toEqual({ folder: "removed", branch: "kept" });
    expect(await worktrees.remove(dirty)).toEqual({ folder: "kept", branch: "kept" });
    expect(await worktrees.remove(built)).toEqual({ folder: "removed", branch: "deleted" });
    expect(await worktrees.remove(secret)).toEqual({ folder: "kept", branch: "kept" });
    expect(await readFile(join(readPath(secret.target), ".env"), "utf8")).toBe("TOKEN=1\n");
    expect(await worktrees.remove(clean)).toEqual({ folder: "removed", branch: "kept" });

    expect(await stat(readPath(clean.target)).catch(() => null)).toBeNull();
    expect(await stat(readPath(committed.target)).catch(() => null)).toBeNull();
    expect(await readFile(join(readPath(dirty.target), "a.txt"), "utf8")).toBe("unsaved\n");
    expect(
      sh(root, "branch", "--format=%(refname:short)").split("\n").filter(Boolean).sort(),
    ).toEqual(["main", committed.branch, dirty.branch, secret.branch].sort());
  });
});

describe.skipIf(!hasGit)("worktree isolation on a local host", () => {
  it("runs a task's subagent in a worktree with the parent's uncommitted changes, keeps its edits out of the parent, and keeps the worktree with its changes listed after the subagent", async () => {
    const root = await repository();
    const home = await folder();
    await writeFile(join(root, "a.txt"), "one\nuncommitted\n");

    const fake = fakeModels();
    let parent = "";
    let parentTurn = 0;
    let childTurn = 0;

    const parentScript: readonly Reply[] = [
      {
        content: [
          {
            type: "toolCall",
            id: "call-task",
            name: "task",
            arguments: { prompt: "Write the note.", title: "Note writer", isolation: "worktree" },
          },
        ],
      },
      { content: [{ type: "text", text: "The subagent wrote it." }] },
    ];

    const childScript: readonly Reply[] = [
      {
        content: [
          {
            type: "toolCall",
            id: "call-write",
            name: "write",
            arguments: { path: "note.txt", content: "from the subagent\n" },
          },
        ],
      },
      { content: [{ type: "text", text: "Wrote note.txt." }] },
    ];

    const dispatch = (request: Request): Reply => {
      const own = request.options?.sessionId === parent;
      const reply = own ? parentScript[parentTurn++] : childScript[childTurn++];

      return reply ?? { content: [{ type: "text", text: "Title" }] };
    };

    fake.reply(...Array.from({ length: 8 }, () => dispatch));

    await using host = await composeHost({
      store: memoryStore(),
      models: fake.models,
      plugins: [{ id: "local", environment: localProvider({ home }) }],
      workspace: { kind: "local", path: root },
      home,
      description: { name: "test", platform: "darwin", version: "0.1.0" },
    });

    parent = "parent";
    const { receipt } = await host.sessions.start({
      id: asId("parent"),
      name: "Parent",
      content: "Delegate the note.",
    });

    expect(await receipt.settled()).toMatchObject({ kind: "completed" });

    const [child] = (
      await host.sessions.list({ parents: { kind: "children", session: asId("parent") } })
    ).items;
    assert(child !== undefined);
    const workspace = await host.workspace(child.workspace).info();
    assert(workspace.isolation !== null);
    const path = readPath(workspace.target);

    expect(workspace.isolation).toMatchObject({ kind: "worktree", session: child.id });
    expect(workspace.isolation.branch).toMatch(/^nyte\/note-writer-[0-9a-f]{8}$/);
    expect(await readFile(join(path, "note.txt"), "utf8")).toBe("from the subagent\n");
    expect(await readFile(join(path, "a.txt"), "utf8")).toBe("one\nuncommitted\n");
    expect(await stat(join(root, "note.txt")).catch(() => null)).toBeNull();

    const reply = fake.requests
      .flatMap((request) => request.context.messages)
      .findLast((message) => message.role === "toolResult");
    assert(reply?.role === "toolResult");

    expect(reply.content).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining(
          `It works in the worktree ${path} on branch ${workspace.isolation.branch}.`,
        ),
      },
    ]);

    const provider = localProvider({ home });

    expect(provider.snapshots?.(await provider.attach(workspace.target))).toBeDefined();
    expect(await host.session(child.id).remove()).toEqual({ kind: "removed" });
    expect(await readFile(join(path, "note.txt"), "utf8")).toBe("from the subagent\n");
    expect((await host.workspaces.list()).map((listed) => listed.id)).toContain(child.workspace);
  });
});
