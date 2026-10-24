import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Plugin, Resources } from "@nyte-ai/core";
import { memoryStore } from "@nyte-ai/core/store";
import { assert, afterEach, describe, expect, it } from "vitest";
import { localProvider, openHost } from "../src/index.ts";
import { findExecutable } from "../src/local/command.ts";
import { fakeModels } from "./fixtures/fake-models.ts";

const hasGit = (await findExecutable("git")) !== null;

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true, maxRetries: 10 });
});

/** A temporary folder as the OS names it, not its real path: on macOS `/var/folders/…`, really `/private/var/folders/…`. */
async function folder(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), "nyte-context-"));
  folders.push(made);

  return made;
}

async function put(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "ignore" });
}

async function repository(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  await mkdir(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Ada");
  git(root, "config", "user.email", "ada@example.com");

  for (const [path, body] of Object.entries(files)) await put(join(root, path), body);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "first");
}

/** The context files a session started in `path` reads, as `[scope, path, content]`, seen by a plugin through `api.inputs`. */
async function contextFiles(
  home: string,
  path: string,
  start?: { readonly isolation?: "worktree"; readonly contextFiles?: false },
): Promise<{ readonly files: readonly string[][]; readonly worktree: string | null }> {
  let seen: (files: Resources["contextFiles"]) => void = () => undefined;

  const read = new Promise<Resources["contextFiles"]>((resolve) => {
    seen = resolve;
  });

  const probe: Plugin<"core"> = { id: "probe", activate: (api) => seen(api.inputs.contextFiles) };

  await using host = await openHost({
    store: memoryStore(),
    models: fakeModels().models,
    plugins: [{ id: "local", environment: localProvider({ home }) }, probe],
    workspace: { kind: "local", path },
    home,
  });

  const [info] = await host.workspaces.list();
  assert(info !== undefined);
  await host.sessions.start({ workspace: info.id, content: "Hi.", ...start });
  const files = (await read).map((file) => [file.scope, file.path, file.content]);
  const isolated = (await host.workspaces.list()).find((entry) => entry.isolation !== null);

  return {
    files,
    worktree: isolated !== undefined && "path" in isolated.target ? isolated.target.path : null,
  };
}

describe("context files on a local host", () => {
  it("reads a folder's lone AGENTS.MD at the path the disk spells", async () => {
    const workspace = await folder();
    await put(join(workspace, "AGENTS.MD"), "Shouted rules.\n");

    expect((await contextFiles(await folder(), workspace)).files).toEqual([
      ["project", join(await realpath(workspace), "AGENTS.MD"), "Shouted rules.\n"],
    ]);
  });

  it("reads none with contextFiles false", async () => {
    const home = await folder();
    const workspace = await folder();
    await put(join(home, ".nyte", "AGENTS.md"), "User rules.\n");
    await put(join(workspace, "AGENTS.md"), "Project rules.\n");

    expect((await contextFiles(home, workspace, { contextFiles: false })).files).toEqual([]);
  });
});

describe.skipIf(!hasGit)("context files in git worktrees on a local host", () => {
  it("reads <home>/.nyte/AGENTS.md once, as the user's, in a worktree under <home>/.nyte/worktrees", async () => {
    const home = await folder();
    const repo = join(await folder(), "repo");
    await put(join(home, ".nyte", "AGENTS.md"), "User rules.\n");
    await repository(repo, { "AGENTS.md": "Repo rules.\n" });

    const { files, worktree } = await contextFiles(home, repo, { isolation: "worktree" });

    assert(worktree !== null);
    expect(worktree.startsWith(join(await realpath(home), ".nyte", "worktrees", "repo"))).toBe(
      true,
    );
    expect(files).toEqual([
      ["user", join(home, ".nyte", "AGENTS.md"), "User rules.\n"],
      ["project", join(worktree, "AGENTS.md"), "Repo rules.\n"],
    ]);
  });

  it("reads a nested worktree's own AGENTS.md instead of its repository's, keeping the folders above", async () => {
    const outer = await folder();
    const repo = join(outer, "repo");
    const worktree = join(repo, "trees", "feat");
    await put(join(outer, "AGENTS.md"), "Outer rules.\n");
    await repository(repo, { "AGENTS.md": "Repo rules.\n" });
    git(repo, "worktree", "add", "-q", "-b", "feat", worktree);
    await put(join(worktree, "AGENTS.md"), "Worktree rules.\n");
    await mkdir(join(worktree, "src"));
    const real = await realpath(outer);

    expect((await contextFiles(await folder(), join(worktree, "src"))).files).toEqual([
      ["ancestor", join(real, "AGENTS.md"), "Outer rules.\n"],
      ["ancestor", join(real, "repo", "trees", "feat", "AGENTS.md"), "Worktree rules.\n"],
    ]);
  });

  it("reads a nested worktree's AGENTS.md once when it links to its repository's", async () => {
    const outer = await folder();
    const repo = join(outer, "repo");
    const worktree = join(repo, "trees", "feat");
    await repository(repo, { "AGENTS.md": "Repo rules.\n" });
    git(repo, "worktree", "add", "-q", "-b", "feat", worktree);
    await rm(join(worktree, "AGENTS.md"));
    await symlink(join(repo, "AGENTS.md"), join(worktree, "AGENTS.md"));

    expect((await contextFiles(await folder(), worktree)).files).toEqual([
      ["project", join(await realpath(worktree), "AGENTS.md"), "Repo rules.\n"],
    ]);
  });

  it("leaves a sibling worktree, a bare layout and a submodule their ancestors", async () => {
    const outer = await folder();
    const repo = join(outer, "repo");
    const sibling = join(outer, "sibling");
    await put(join(outer, "AGENTS.md"), "Outer rules.\n");
    await repository(repo, { "AGENTS.md": "Repo rules.\n" });
    git(repo, "worktree", "add", "-q", "-b", "sibling", sibling);
    const real = await realpath(outer);

    expect((await contextFiles(await folder(), sibling)).files).toEqual([
      ["ancestor", join(real, "AGENTS.md"), "Outer rules.\n"],
      ["project", join(real, "sibling", "AGENTS.md"), "Repo rules.\n"],
    ]);

    const project = join(outer, "proj");
    git(outer, "clone", "-q", "--bare", repo, join(project, ".bare"));
    git(join(project, ".bare"), "worktree", "add", "-q", join(project, "main"), "main");
    await put(join(project, "AGENTS.md"), "Container rules.\n");

    expect((await contextFiles(await folder(), join(project, "main"))).files).toEqual([
      ["ancestor", join(real, "AGENTS.md"), "Outer rules.\n"],
      ["ancestor", join(real, "proj", "AGENTS.md"), "Container rules.\n"],
      ["project", join(real, "proj", "main", "AGENTS.md"), "Repo rules.\n"],
    ]);

    const library = join(outer, "library");
    const superproject = join(outer, "super");
    await repository(library, { "AGENTS.md": "Library rules.\n" });
    await repository(superproject, { "AGENTS.md": "Super rules.\n" });
    git(
      superproject,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      library,
      "vendor/lib",
    );

    expect((await contextFiles(await folder(), join(superproject, "vendor", "lib"))).files).toEqual(
      [
        ["ancestor", join(real, "AGENTS.md"), "Outer rules.\n"],
        ["ancestor", join(real, "super", "AGENTS.md"), "Super rules.\n"],
        ["project", join(real, "super", "vendor", "lib", "AGENTS.md"), "Library rules.\n"],
      ],
    );
  });
});
