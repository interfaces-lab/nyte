import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { WorkspaceTrustRequired, WorkspaceTrustStore } from "@nyte-ai/core";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, test } from "vitest";
import {
  blameWorkspaceFile,
  createWorkspaceEditor,
  formatWorkspaceFile,
  readWorkspaceFile,
  saveWorkspaceFile,
  searchWorkspaceFiles,
} from "./workspace-files.ts";
import { ipcDiagnostics } from "./errors.ts";

async function fixture(): Promise<{ readonly root: string; readonly file: string }> {
  const root = await mkdtemp(join(tmpdir(), "nyte-files-"));
  const file = join(root, "index.ts");
  await writeFile(file, "export const value = 1;\n");
  return { root, file };
}

describe("workspace files", () => {
  test("reads and saves one text file without overwriting a newer version", async () => {
    const { root, file } = await fixture();
    try {
      const document = await readWorkspaceFile(root, file);
      assert.equal(document.kind, "text");
      if (document.kind !== "text") return;

      const saved = await saveWorkspaceFile(root, {
        path: file,
        contents: "export const value = 2;\n",
        version: document.version,
      });
      assert.equal(saved.kind, "saved");
      assert.equal(await readFile(file, "utf8"), "export const value = 2;\n");

      const conflict = await saveWorkspaceFile(root, {
        path: file,
        contents: "stale\n",
        version: document.version,
      });
      assert.deepEqual(conflict, { kind: "conflict" });
      assert.equal(await readFile(file, "utf8"), "export const value = 2;\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps binary files and symlinks outside the workspace out of the editor", async () => {
    const { root } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "nyte-files-outside-"));
    try {
      const binary = join(root, "image.bin");
      await writeFile(binary, new Uint8Array([0, 255, 0]));
      assert.deepEqual(await readWorkspaceFile(root, binary), {
        kind: "binary",
        path: binary,
        size: 3,
      });

      const target = join(outside, "secret.txt");
      const link = join(root, "outside.txt");
      await writeFile(target, "secret\n");
      await symlink(target, link);
      await assert.rejects(readWorkspaceFile(root, link), /outside the open workspace/);
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });
});

describe("workspace search", () => {
  test("searches the workspace with gitignore, glob filters, word boundaries and draft overrides", async () => {
    const { root, file } = await fixture();
    try {
      await mkdir(join(root, "nested"));
      await writeFile(join(root, ".gitignore"), "ignored.txt\n");
      await writeFile(join(root, "ignored.txt"), "value");
      await writeFile(join(root, "nested", "other.ts"), "Value values value_ value\nVALUE\n");
      await writeFile(join(root, "notes.txt"), "value");
      const result = await searchWorkspaceFiles(root, {
        requestId: "one",
        query: "value",
        wholeWord: true,
        include: ["**/*.ts"],
        drafts: [{ path: file, contents: "draft VALUE\n" }],
      });
      assert.equal(result.truncated, false);
      assert.equal(result.matchCount, 4);
      assert.deepEqual(
        result.files.map((entry) => [entry.displayPath, entry.source]),
        [
          ["index.ts", "draft"],
          ["nested/other.ts", "disk"],
        ],
      );
      assert.deepEqual(result.files[0]?.matches[0], {
        line: 1,
        column: 7,
        length: 5,
        snippet: "draft VALUE",
        snippetColumn: 1,
      });
      const sensitive = await searchWorkspaceFiles(root, {
        requestId: "two",
        query: "value",
        caseSensitive: true,
        wholeWord: true,
        exclude: ["**/*.txt", "index.ts", ".gitignore"],
      });
      assert.equal(sensitive.matchCount, 1);
      assert.equal(sensitive.files[0]?.matches[0]?.column, 21);
      const ignored = await searchWorkspaceFiles(root, {
        requestId: "three",
        query: "value",
        include: ["ignored.txt"],
        drafts: [{ path: join(root, "ignored.txt"), contents: "value" }],
      });
      assert.equal(ignored.matchCount, 0);
      assert.equal(await readFile(file, "utf8"), "export const value = 1;\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("bounds matches and snippets, skips binary and large files, and accepts safe regexes", async () => {
    const { root, file } = await fixture();
    try {
      await writeFile(file, `${" ".repeat(300)}hit hit\n`);
      await writeFile(join(root, "binary"), "hit\0");
      await writeFile(join(root, "large"), "hit".repeat(700_000));
      const result = await searchWorkspaceFiles(root, {
        requestId: "one",
        query: "h.t",
        regex: true,
        maxMatches: 1,
      });
      assert.equal(result.matchCount, 1);
      assert.equal(result.truncated, true);
      assert.equal(result.files[0]?.matches[0]?.column, 301);
      assert.equal(result.files[0]?.matches[0]?.snippetColumn, 221);
      assert.ok((result.files[0]?.matches[0]?.snippet.length ?? 0) <= 240);
      const all = await searchWorkspaceFiles(root, {
        requestId: "two",
        query: "hit",
        maxMatches: 2,
      });
      assert.equal(all.truncated, false);
      assert.equal(all.matchCount, 2);
      assert.deepEqual(all.skipped, { binary: 1, tooLarge: 1, unreadable: 0 });
      const empty = await searchWorkspaceFiles(root, {
        requestId: "three",
        query: "(?=hit)",
        regex: true,
      });
      assert.equal(empty.matchCount, 2);
      await assert.rejects(
        searchWorkspaceFiles(root, { requestId: "four", query: "[", regex: true }),
        /Invalid search regular expression/,
      );
      await writeFile(file, `${"a".repeat(100_000)}!`);
      await assert.rejects(
        searchWorkspaceFiles(root, { requestId: "five", query: "(a+)+$", regex: true }),
        /execution limit/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("cancels window requests and refuses drafts outside the workspace", async () => {
    const { root } = await fixture();
    const outside = await fixture();
    try {
      const editor = createWorkspaceEditor({
        workspace: async () => root,
        requireTrust: async () => undefined,
      });
      const pending = editor.call({
        operation: "search",
        input: { requestId: "cancel", query: "value" },
      });
      await editor.call({ operation: "cancelSearch", input: { requestId: "cancel" } });
      await assert.rejects(pending, /abort/i);
      await assert.rejects(
        searchWorkspaceFiles(root, {
          requestId: "draft",
          query: "value",
          drafts: [{ path: outside.file, contents: "value" }],
        }),
        /outside the open workspace/,
      );
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside.root, { recursive: true, force: true }),
      ]);
    }
  });
});

describe("workspace blame", () => {
  test("parses real Git porcelain including uncommitted lines and an option-like filename", async () => {
    const { root } = await fixture();
    const file = join(root, "--odd name.txt");
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    try {
      git(["init", "-q"]);
      git(["config", "user.name", "Fixture Author"]);
      git(["config", "user.email", "fixture@example.test"]);
      await writeFile(file, "original\nsecond\n");
      git(["add", "--", "--odd name.txt"]);
      git(["commit", "-qm", "First commit"]);
      const commit = git(["rev-parse", "HEAD"]);
      await writeFile(file, "original\nchanged\n");
      const result = await blameWorkspaceFile(root, file);
      assert.equal(result.kind, "blame", JSON.stringify(result));
      if (result.kind !== "blame") return;
      assert.equal(result.truncated, false);
      assert.equal(result.lines.length, 2);
      assert.deepEqual(result.lines[0], {
        line: 1,
        originalLine: 1,
        commit,
        author: "Fixture Author",
        authorMail: "fixture@example.test",
        authorTime: Number(git(["show", "-s", "--format=%at"])),
        summary: "First commit",
        contents: "original",
        uncommitted: false,
      });
      assert.equal(result.lines[1]?.uncommitted, true);
      assert.equal(result.lines[1]?.contents, "changed");
      assert.equal((await blameWorkspaceFile(root, join(root, "index.ts"))).kind, "error");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports a non-repository explicitly", async () => {
    const { root, file } = await fixture();
    try {
      assert.equal((await blameWorkspaceFile(root, file)).kind, "unsupported");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function installFormatterFixture(directory: string, formatter: string, source: string) {
  const packageDirectory = join(
    directory,
    "node_modules",
    formatter === "biome" ? "@biomejs/biome" : formatter,
  );
  const bin = "bin space & %name%/cli";
  await mkdir(join(packageDirectory, "bin space & %name%"), { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({
      name: formatter,
      bin: formatter === "prettier" ? bin : { [formatter]: bin },
    }),
  );
  await writeFile(join(packageDirectory, bin), source);
  return packageDirectory;
}

describe("workspace formatting", () => {
  test("uses an installed formatter and project config without saving or bypassing conflict checks", async () => {
    const { root, file } = await fixture();
    try {
      await mkdir(join(root, "node_modules"), { recursive: true });
      await symlink(
        await realpath(resolve("../../node_modules/oxfmt")),
        join(root, "node_modules", "oxfmt"),
        "junction",
      );
      await writeFile(join(root, ".oxfmtrc.json"), '{"semi":false}');
      const original = await readWorkspaceFile(root, file);
      assert.equal(original.kind, "text");
      if (original.kind !== "text") return;
      const input = { path: file, contents: "const value={x:1};", version: original.version };
      const result = await formatWorkspaceFile(root, input);
      assert.deepEqual(result, {
        kind: "formatted",
        formatter: "oxfmt",
        contents: "const value = { x: 1 }\n",
        version: original.version,
      });
      assert.equal(await readFile(file, "utf8"), original.contents);
      await writeFile(file, "newer\n");
      assert.deepEqual(await formatWorkspaceFile(root, input), { kind: "conflict" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each(["prettier", "biome", "oxfmt"] as const)(
    "%s runs its package CLI with literal arguments, stdin and Electron Node mode",
    async (formatter) => {
      const { root } = await fixture();
      const workspace = join(root, "project space & %name% ' $(echo nope)");
      const file = join(workspace, "--odd & %name% ' $(echo nope).ts");
      try {
        await mkdir(workspace);
        await writeFile(file, "original\n");
        const original = await readWorkspaceFile(workspace, file);
        assert.equal(original.kind, "text");
        if (original.kind !== "text") return;
        const args =
          formatter === "biome"
            ? ["format", `--stdin-file-path=${await realpath(file)}`]
            : ["--stdin-filepath", await realpath(file)];
        await installFormatterFixture(
          workspace,
          formatter,
          `const assert = require("node:assert/strict");
           assert.deepEqual(process.argv.slice(2), ${JSON.stringify(args)});
           assert.equal(process.cwd(), ${JSON.stringify(await realpath(workspace))});
           assert.equal(process.env.ELECTRON_RUN_AS_NODE, "1");
           process.stdin.setEncoding("utf8");
           let text = "";
           process.stdin.on("data", chunk => { text += chunk; });
           process.stdin.on("end", () => process.stdout.write(text.toUpperCase()));`,
        );
        // Neither Unix launchers nor Windows batch shims should be executed.
        await mkdir(join(workspace, "node_modules", ".bin"));
        for (const suffix of ["", ".cmd", ".ps1"]) {
          await writeFile(join(workspace, "node_modules", ".bin", formatter + suffix), "exit 99");
        }
        assert.deepEqual(
          await formatWorkspaceFile(workspace, {
            path: file,
            contents: "draft λ & %name% $(echo nope)\n",
            version: original.version,
          }),
          {
            kind: "formatted",
            formatter,
            contents: "DRAFT Λ & %NAME% $(ECHO NOPE)\n",
            version: original.version,
          },
        );
        assert.equal(await readFile(file, "utf8"), original.contents);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  test("runs a Biome-style JavaScript wrapper that delegates stdin to a native process", async () => {
    const { root, file } = await fixture();
    try {
      await installFormatterFixture(
        root,
        "biome",
        `const { spawnSync } = require("node:child_process");
         const result = spawnSync(process.execPath, ["-e",
           'process.stdin.pipe(process.stdout)', "--", ...process.argv.slice(2)],
           { stdio: "inherit", shell: false });
         if (result.error) throw result.error;
         process.exitCode = result.status ?? 1;`,
      );
      const original = await readWorkspaceFile(root, file);
      assert.equal(original.kind, "text");
      if (original.kind !== "text") return;
      assert.deepEqual(
        await formatWorkspaceFile(root, {
          path: file,
          contents: "draft\n",
          version: original.version,
        }),
        { kind: "formatted", formatter: "biome", contents: "draft\n", version: original.version },
      );
      assert.equal(await readFile(file, "utf8"), original.contents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("selects the nearest installation, preserves priority and stops at the workspace root", async () => {
    const { root } = await fixture();
    const workspace = join(root, "workspace");
    const nested = join(workspace, "nested");
    const file = join(nested, "index.ts");
    try {
      await mkdir(nested, { recursive: true });
      await writeFile(file, "original");
      await installFormatterFixture(root, "prettier", 'process.stdout.write("outside");');
      const original = await readWorkspaceFile(workspace, file);
      assert.equal(original.kind, "text");
      if (original.kind !== "text") return;
      const input = { path: file, contents: "draft", version: original.version };
      assert.equal((await formatWorkspaceFile(workspace, input)).kind, "unsupported");
      await installFormatterFixture(workspace, "prettier", 'process.stdout.write("root");');
      assert.deepEqual(await formatWorkspaceFile(workspace, input), {
        kind: "formatted",
        formatter: "prettier",
        contents: "root",
        version: original.version,
      });
      await installFormatterFixture(nested, "oxfmt", 'process.stdout.write("nested oxfmt");');
      assert.deepEqual(await formatWorkspaceFile(workspace, input), {
        kind: "formatted",
        formatter: "oxfmt",
        contents: "nested oxfmt",
        version: original.version,
      });
      await installFormatterFixture(nested, "biome", 'process.stdout.write("nested biome");');
      assert.deepEqual(await formatWorkspaceFile(workspace, input), {
        kind: "formatted",
        formatter: "biome",
        contents: "nested biome",
        version: original.version,
      });
      await installFormatterFixture(nested, "prettier", 'process.stdout.write("nested prettier");');
      assert.deepEqual(await formatWorkspaceFile(workspace, input), {
        kind: "formatted",
        formatter: "prettier",
        contents: "nested prettier",
        version: original.version,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    "{",
    "null",
    '{"bin":42}',
    '{"bin":{"prettier":42}}',
    '{"bin":{"other":"cli.js"}}',
    '{"bin":""}',
    '{"bin":"../outside.js"}',
    '{"bin":"missing.js"}',
  ])("reports an invalid or broken local package without falling back: %s", async (manifest) => {
    const { root, file } = await fixture();
    try {
      const directory = await installFormatterFixture(root, "prettier", "process.exitCode = 99;");
      await writeFile(join(directory, "package.json"), manifest);
      await installFormatterFixture(root, "oxfmt", 'process.stdout.write("fallback");');
      const original = await readWorkspaceFile(root, file);
      assert.equal(original.kind, "text");
      if (original.kind !== "text") return;
      const result = await formatWorkspaceFile(root, {
        path: file,
        contents: "draft",
        version: original.version,
      });
      assert.equal(result.kind, "error", JSON.stringify(result));
      assert.equal(await readFile(file, "utf8"), original.contents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects oversized output and detects changes made while a formatter runs", async () => {
    const { root, file } = await fixture();
    try {
      const original = await readWorkspaceFile(root, file);
      assert.equal(original.kind, "text");
      if (original.kind !== "text") return;
      const input = { path: file, contents: "draft", version: original.version };
      await installFormatterFixture(
        root,
        "prettier",
        'process.stdout.write("x".repeat(2_000_001));',
      );
      assert.deepEqual(await formatWorkspaceFile(root, input), {
        kind: "error",
        message: "Formatted contents exceed 2 MB",
      });
      await installFormatterFixture(
        root,
        "prettier",
        `require("node:fs").writeFileSync(process.argv[3], "newer");
         process.stdout.write("formatted");`,
      );
      assert.deepEqual(await formatWorkspaceFile(root, input), { kind: "conflict" });
      assert.equal(await readFile(file, "utf8"), "newer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports missing tools and failures, and uses the persisted trust decision before execution", async () => {
    const { root, file } = await fixture();
    try {
      const original = await readWorkspaceFile(root, file);
      assert.equal(original.kind, "text");
      if (original.kind !== "text") return;
      const input = { path: file, contents: "const x=1", version: original.version };
      assert.equal((await formatWorkspaceFile(root, input)).kind, "unsupported");
      const trust = new WorkspaceTrustStore(join(root, "trust.json"));
      const editor = createWorkspaceEditor({
        workspace: async () => root,
        requireTrust: async (cwd) => {
          await trust.require(cwd);
        },
      });
      await installFormatterFixture(
        root,
        "prettier",
        `require("node:fs").writeFileSync(${JSON.stringify(join(root, "formatter-ran"))}, "ran");
         process.stderr.write("bad syntax"); process.exitCode = 1;`,
      );
      await assert.rejects(editor.call({ operation: "format", input }), WorkspaceTrustRequired);
      await assert.rejects(readFile(join(root, "formatter-ran")), { code: "ENOENT" });
      await trust.trust(root);
      const before = new Set(ipcDiagnostics.keys());
      const result = await editor.call({ operation: "format", input });
      assert.ok(result !== undefined && "kind" in result);
      assert.equal(result.kind, "error");
      assert.doesNotMatch(result.message, /bad syntax/);
      const diagnostics = [...ipcDiagnostics].filter(([id]) => !before.has(id));
      assert.equal(diagnostics.length, 1);
      const diagnostic = diagnostics[0];
      assert.ok(diagnostic);
      assert.ok(result.message.includes(diagnostic[0]));
      assert.deepEqual(diagnostic[1], { code: 1, stdout: "", stderr: "bad syntax" });
      assert.equal(await readFile(join(root, "formatter-ran"), "utf8"), "ran");
      assert.equal(await readFile(file, "utf8"), original.contents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("concurrent drafts sharing a version cannot both acknowledge different saved text", async () => {
  const { root, file } = await fixture();
  try {
    const original = await readWorkspaceFile(root, file);
    assert.equal(original.kind, "text");
    if (original.kind !== "text") return;
    const contents = ["first draft", "second draft"];
    const outcomes = await Promise.all(
      contents.map((text) =>
        saveWorkspaceFile(root, {
          path: file,
          contents: text,
          version: original.version,
        }),
      ),
    );
    assert.equal(outcomes.filter((outcome) => outcome.kind === "saved").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "conflict").length, 1);
    assert.equal(
      await readFile(file, "utf8"),
      contents[outcomes.findIndex((outcome) => outcome.kind === "saved")],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
