import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, test } from "vitest";
import type { ExecutionEnv } from "../src/kernel/loop/env.ts";
import {
  formatContextFilesForPrompt,
  loadProjectContextFiles,
} from "../src/plugins/builtin/context-files.ts";
import type { ContextFile } from "../src/plugins/builtin/context-files.ts";
import { localEnv } from "./kernel/helpers.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "nyte-context-")));
  temporaryDirectories.push(directory);
  return directory;
}

/** The walk continues above the temp root; keep assertions to files inside it. */
function underRoot(files: ContextFile[], root: string): ContextFile[] {
  return files.filter((file) => file.path.startsWith(`${root}${sep}`));
}

function remote(cwd: string, files: ReadonlyMap<string, string>): ExecutionEnv {
  const unsupported = () => Promise.reject(new Error("unsupported"));

  return {
    id: "remote",
    cwd,
    resolve: (...paths) => resolve(cwd, ...paths),
    readFile: async (path) => {
      const content = files.get(path);

      if (content === undefined) throw new Error(`ENOENT: ${path}`);

      return Buffer.from(content);
    },
    writeFile: unsupported,
    mkdir: unsupported,
    stat: async (path) => (files.has(path) ? { kind: "file" } : undefined),
    readdir: unsupported,
    realpath: async (path) => (files.has(path) ? path : undefined),
    exec: unsupported,
  };
}

describe("context files", () => {
  test("prefers AGENTS.override.md over AGENTS.md over CLAUDE.md per directory", async () => {
    const root = tempDir();
    writeFileSync(join(root, "CLAUDE.md"), "claude");
    writeFileSync(join(root, "AGENTS.md"), "agents");
    writeFileSync(join(root, "AGENTS.override.md"), "override");

    const files = underRoot(await loadProjectContextFiles({ env: localEnv(root) }), root);

    assert.deepEqual(files, [{ path: join(root, "AGENTS.override.md"), content: "override" }]);
  });

  test("collects global dir first, then ancestors outermost-first, cwd last", async () => {
    const root = tempDir();
    const globalDir = join(root, "global");
    const project = join(root, "project");
    const nested = join(project, "packages", "app");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(globalDir, "AGENTS.md"), "global");
    writeFileSync(join(project, "AGENTS.md"), "project");
    writeFileSync(join(nested, "CLAUDE.md"), "nested");

    const files = underRoot(
      await loadProjectContextFiles({ env: localEnv(nested), globalDir }),
      root,
    );

    assert.deepEqual(files, [
      { path: join(globalDir, "AGENTS.md"), content: "global" },
      { path: join(project, "AGENTS.md"), content: "project" },
      { path: join(nested, "CLAUDE.md"), content: "nested" },
    ]);
  });

  test("strips a BOM and skips directories named like candidates", async () => {
    const root = tempDir();
    mkdirSync(join(root, "AGENTS.override.md"));
    writeFileSync(join(root, "AGENTS.md"), "\uFEFFagents");

    const files = underRoot(await loadProjectContextFiles({ env: localEnv(root) }), root);

    assert.deepEqual(files, [{ path: join(root, "AGENTS.md"), content: "agents" }]);
  });

  test("a linked worktree's own context file shadows the main repo's; without one it inherits", async () => {
    const root = tempDir();
    const mainRepo = join(root, "repo");
    const worktree = join(mainRepo, "wt");
    const worktreeGitDir = join(mainRepo, ".git", "worktrees", "wt");
    mkdirSync(worktreeGitDir, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(mainRepo, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(worktreeGitDir, "HEAD"), "ref: refs/heads/feat\n");
    writeFileSync(join(worktreeGitDir, "commondir"), "../..\n");
    writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`);
    writeFileSync(join(mainRepo, "AGENTS.md"), "main");

    assert.deepEqual(underRoot(await loadProjectContextFiles({ env: localEnv(worktree) }), root), [
      { path: join(mainRepo, "AGENTS.md"), content: "main" },
    ]);

    writeFileSync(join(worktree, "AGENTS.md"), "worktree");

    assert.deepEqual(underRoot(await loadProjectContextFiles({ env: localEnv(worktree) }), root), [
      { path: join(worktree, "AGENTS.md"), content: "worktree" },
    ]);
  });

  test("a workspace's files come from its environment, not the host's disk under the same path", async () => {
    const root = tempDir();
    const globalDir = join(root, "global");
    const project = join(root, "project");
    mkdirSync(globalDir);
    mkdirSync(project);
    writeFileSync(join(globalDir, "AGENTS.md"), "global");
    writeFileSync(join(root, "AGENTS.md"), "host ancestor");
    writeFileSync(join(project, "AGENTS.override.md"), "host");
    const env = remote(project, new Map([[join(project, "AGENTS.md"), "remote"]]));

    assert.deepEqual(await loadProjectContextFiles({ env, globalDir }), [
      { path: join(globalDir, "AGENTS.md"), content: "global" },
      { path: join(project, "AGENTS.md"), content: "remote" },
    ]);
  });

  test("formats files as a project_context block and returns empty for none", () => {
    assert.equal(formatContextFilesForPrompt([]), "");
    const text = formatContextFilesForPrompt([{ path: "/p/AGENTS.md", content: "rules" }]);
    assert.equal(
      text,
      "<project_context>\n\n" +
        "Project-specific instructions and guidelines:\n\n" +
        '<project_instructions path="/p/AGENTS.md">\nrules\n</project_instructions>\n\n' +
        "</project_context>",
    );
  });
});
