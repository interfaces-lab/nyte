import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { readWorkspaceFile, WorkspaceStore, WorkspaceTrustRequired } from "@nyte-ai/host";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, test } from "vitest";
import {
  blameWorkspaceFile,
  createWorkspaceEditor,
  formatWorkspaceFile,
} from "./workspace-files.ts";
import { ipcDiagnostics, ipcResult } from "./errors.ts";

async function fixture(): Promise<{ readonly root: string; readonly file: string }> {
  const root = await mkdtemp(join(tmpdir(), "nyte-files-"));
  const file = join(root, "index.ts");
  await writeFile(file, "export const value = 1;\n");
  return { root, file };
}

describe("workspace search", () => {
  test("returns shared search results and maps core failures across IPC", async () => {
    const { root, file } = await fixture();
    const outside = await fixture();
    const editor = createWorkspaceEditor({
      workspace: async () => root,
      requireTrust: async () => undefined,
    });
    try {
      const result = await ipcResult(() =>
        editor.call({
          operation: "search",
          input: {
            requestId: "shared",
            query: "value",
            drafts: [{ path: file, contents: "😀 value" }],
          },
        }),
      );
      assert.equal(result.ok, true);
      assert.ok(result.value && "files" in result.value);
      assert.equal(result.value.matchCount, 1);
      assert.deepEqual(result.value.files[0], {
        path: await realpath(file),
        displayPath: "index.ts",
        source: "draft",
        matches: [{ line: 1, column: 4, length: 5, snippet: "😀 value", snippetColumn: 1 }],
      });
      const invalid = await ipcResult(() =>
        editor.call({
          operation: "search",
          input: { requestId: "shared", query: "(?=value)", regex: true },
        }),
      );
      assert.equal(invalid.ok, false);
      assert.equal(invalid.error.code, "invalid_input");
      const forbidden = await ipcResult(() =>
        editor.call({
          operation: "search",
          input: {
            requestId: "shared",
            query: "value",
            drafts: [{ path: outside.file, contents: "value" }],
          },
        }),
      );
      assert.equal(forbidden.ok, false);
      assert.equal(forbidden.error.code, "forbidden");
      const oversized = await ipcResult(() =>
        editor.call({
          operation: "search",
          input: {
            requestId: "shared",
            query: "value",
            drafts: Array.from({ length: 10 }, () => ({
              path: file,
              contents: "λ".repeat(200_000),
            })),
          },
        }),
      );
      assert.equal(oversized.ok, false);
      assert.equal(oversized.error.code, "payload_too_large");
      assert.equal(await readFile(file, "utf8"), "export const value = 1;\n");
    } finally {
      editor.dispose();
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside.root, { recursive: true, force: true }),
      ]);
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
        editor.call({
          operation: "search",
          input: {
            requestId: "draft",
            query: "value",
            drafts: [{ path: outside.file, contents: "value" }],
          },
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
      const trust = new WorkspaceStore(join(root, "workspaces.json"));
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
