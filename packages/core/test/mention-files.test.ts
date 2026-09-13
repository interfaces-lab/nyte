import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, test, vi } from "vitest";
import { discoverMentionFiles } from "../src/mention-files.ts";

const roots: string[] = [];

function scratch(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nyte-mentions-")));
  roots.push(root);
  return root;
}

function fixture(files: Record<string, string>): string {
  const root = scratch();
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("discoverMentionFiles", () => {
  test("lists files and folders with workspace-relative display paths and file URLs", async () => {
    const root = scratch();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), "");
    writeFileSync(join(root, "README.md"), "");

    const files = await discoverMentionFiles(root);

    assert.deepEqual(
      files.map((file) => [file.displayPath, file.label]),
      [
        ["README.md", "README.md"],
        ["src/", "src/"],
        ["src/index.ts", "index.ts"],
      ],
    );
    const folder = files.find((file) => file.label === "src/");
    assert.equal(folder?.path, join(root, "src") + sep);
    assert.equal(folder?.url, pathToFileURL(join(root, "src")).href);
    const index = files.find((file) => file.label === "index.ts");
    assert.equal(index?.url, pathToFileURL(join(root, "src", "index.ts")).href);
    await assert.rejects(discoverMentionFiles(join(root, "missing")), { code: "ENOENT" });
  });

  test("never offers the workspace root of a Git repository as a mention", async () => {
    const root = fixture({ "README.md": "", "src/index.ts": "" });
    execFileSync("git", ["init", "--quiet", root]);

    assert.deepEqual(
      (await discoverMentionFiles(root)).map((file) => [file.displayPath, file.label]),
      [
        ["README.md", "README.md"],
        ["src/", "src/"],
        ["src/index.ts", "index.ts"],
      ],
    );
  });

  test("applies Git patterns and directory-only rules case-sensitively, keeping nonignored hidden entries", async () => {
    const root = fixture({
      ".gitignore":
        "# comment\n\\#secret\n\\!secret\n**/generated/*.js\ncache/\n*.LOG\nnode_modules/\n.cache/\n",
      "#secret": "",
      "!secret": "",
      comment: "",
      "cache/data": "",
      "src/cache": "",
      "src/generated/drop.js": "",
      "src/generated/keep.ts": "",
      "drop.LOG": "",
      "debug.log": "",
      "node_modules/dep/index.js": "",
      ".cache/state": "",
      ".env.example": "",
      ".github/workflows/test.yml": "",
    });

    assert.deepEqual(
      (await discoverMentionFiles(root)).map((file) => file.displayPath),
      [
        ".env.example",
        ".github/",
        ".github/workflows/",
        ".github/workflows/test.yml",
        ".gitignore",
        "comment",
        "debug.log",
        "src/",
        "src/cache",
        "src/generated/",
        "src/generated/keep.ts",
      ],
    );
  });

  test("nested rules override ancestors without leaking into siblings", async () => {
    const root = fixture({
      ".gitignore": "*.log\n*.tmp\n/root-only.txt\n",
      "root-only.txt": "",
      "root.log": "",
      "src/.gitignore": "!keep.log\n/local.txt\nprivate/\n",
      "src/keep.log": "",
      "src/drop.log": "",
      "src/drop.tmp": "",
      "src/local.txt": "",
      "src/root-only.txt": "",
      "src/private/secret.txt": "",
      "src/deep/.gitignore": "keep.log\n!drop.tmp\n",
      "src/deep/keep.log": "",
      "src/deep/drop.tmp": "",
      "src/deep/local.txt": "",
      "other/keep.log": "",
      "other/local.txt": "",
    });

    assert.deepEqual(
      (await discoverMentionFiles(root)).map((file) => file.displayPath),
      [
        ".gitignore",
        "other/",
        "other/local.txt",
        "src/",
        "src/.gitignore",
        "src/deep/",
        "src/deep/.gitignore",
        "src/deep/drop.tmp",
        "src/deep/local.txt",
        "src/keep.log",
        "src/root-only.txt",
      ],
    );
  });

  test("negation restores files only when every parent directory is included", async () => {
    const root = fixture({
      ".gitignore": [
        "blocked/",
        "!blocked/keep.txt",
        "opened/",
        "!opened/",
        "opened/*",
        "!opened/keep.txt",
        "!opened/nested/",
        "opened/nested/*",
        "!opened/nested/keep.txt",
        "",
      ].join("\n"),
      "blocked/.gitignore": "!keep.txt\n",
      "blocked/keep.txt": "",
      "opened/keep.txt": "",
      "opened/drop.txt": "",
      "opened/nested/keep.txt": "",
      "opened/nested/drop.txt": "",
    });

    assert.deepEqual(
      (await discoverMentionFiles(root)).map((file) => file.displayPath),
      [".gitignore", "opened/", "opened/keep.txt", "opened/nested/", "opened/nested/keep.txt"],
    );
  });

  test("always excludes .git directories and worktree metadata files", async () => {
    const root = fixture({
      ".gitignore": "!.git/\n!.git\n",
      ".git/config": "",
      "nested/.git": "gitdir: /outside/worktree",
      "nested/app.ts": "",
    });

    assert.deepEqual(
      (await discoverMentionFiles(root)).map((file) => file.displayPath),
      [".gitignore", "nested/", "nested/app.ts"],
    );
  });

  test("does not offer file, directory, dangling, or .gitignore symlinks", async () => {
    const outside = fixture({ "secret.txt": "", "ignore-rules": "*.ts\n" });
    const root = fixture({ "app.ts": "", "src/index.ts": "" });
    symlinkSync(outside, join(root, "outside"), "dir");
    symlinkSync(root, join(root, "src", "cycle"), "dir");
    symlinkSync(join(root, "src"), join(root, "linked-src"), "dir");
    symlinkSync(join(outside, "secret.txt"), join(root, "linked-secret"), "file");
    symlinkSync(join(root, "app.ts"), join(root, "linked-app"), "file");
    symlinkSync(join(root, "missing"), join(root, "dangling"), "file");
    assert.deepEqual(
      (await discoverMentionFiles(root)).map((file) => file.displayPath),
      ["app.ts", "src/", "src/index.ts"],
    );
    // rg reads linked ignore files, but does not offer the links as mention candidates.
    symlinkSync(join(outside, "ignore-rules"), join(root, ".gitignore"), "file");
    assert.deepEqual(await discoverMentionFiles(root), []);
  });
});

describe("home mentions", () => {
  test.skipIf(process.platform !== "darwin" && process.platform !== "win32")(
    "excludes protected home folders and dotfiles before filename matching",
    async () => {
      const root = fixture({
        ".config/secret.ts": "",
        "Documents/private.ts": "",
        "src/public.ts": "",
      });
      vi.stubEnv(process.platform === "win32" ? "USERPROFILE" : "HOME", root);
      assert.deepEqual(
        (await discoverMentionFiles(root)).map((file) => file.displayPath),
        ["src/", "src/public.ts"],
      );
    },
  );

  test("protects a home directory reached through a symlink", async () => {
    const root = fixture({ ".config/secret.ts": "", "src/public.ts": "" });
    const links = fixture({});
    const home = join(links, "home");
    symlinkSync(root, home, process.platform === "win32" ? "junction" : "dir");
    vi.stubEnv(process.platform === "win32" ? "USERPROFILE" : "HOME", home);
    assert.deepEqual(
      (await discoverMentionFiles(root)).map((file) => file.displayPath),
      ["src/", "src/public.ts"],
    );
  });
});
