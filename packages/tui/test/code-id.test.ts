import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { hashSourceTree } from "../src/code-id.ts";

let root = "";

const git = (...args: readonly string[]): string =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

const write = (file: string, text: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};

const manifest = (name: string, dependencies: readonly string[] = []): string =>
  JSON.stringify({
    name,
    dependencies: Object.fromEntries(dependencies.map((dependency) => [dependency, "*"])),
  });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "nyte-code-id-")));
  git("init", "--quiet");
  write("packages/host/package.json", manifest("@nyte-ai/host", ["@nyte-ai/core"]));
  write("packages/host/src/index.ts", "export const host = 1;\n");
  write("packages/core/package.json", manifest("@nyte-ai/core"));
  write("packages/core/src/index.ts", "export const core = 1;\n");
  write("packages/service/package.json", manifest("@nyte-ai/service"));
  write("packages/service/src/index.ts", "export const service = 1;\n");
  write("packages/desktop/package.json", manifest("@nyte-ai/desktop", ["@nyte-ai/host"]));
  write("packages/desktop/src/main.ts", "export const desktop = 1;\n");
  write("packages/tui/package.json", manifest("@nyte-ai/tui", ["@nyte-ai/host"]));
  write("packages/tui/src/host-worker.ts", 'import { open } from "./host.ts";\nopen();\n');
  write("packages/tui/src/host.ts", "export const open = (): void => undefined;\n");
  write("packages/tui/src/composer.ts", "export const composer = 1;\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Nyte",
    "-c",
    "user.email=nyte@example.com",
    "commit",
    "--quiet",
    "-m",
    "one",
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a clean tree's code id is its commit, the same on every run", async () => {
  const commit = git("rev-parse", "HEAD").slice(0, 12);

  expect(await hashSourceTree(root)).toBe(commit);
  expect(await hashSourceTree(root)).toBe(commit);
});

test("editing code the service runs gives another code id, the same on every run", async () => {
  const clean = await hashSourceTree(root);

  write("packages/core/src/index.ts", "export const core = 2;\n");
  const edited = await hashSourceTree(root);

  expect(edited).toMatch(/^[0-9a-f]{12}\.[0-9a-f]{8}$/u);
  expect(edited?.startsWith(`${clean ?? ""}.`)).toBe(true);
  expect(await hashSourceTree(root)).toBe(edited);

  write("packages/core/src/added.ts", "export const added = true;\n");
  const added = await hashSourceTree(root);

  expect(added).not.toBe(edited);

  write("packages/tui/src/host.ts", "export const open = (): number => 1;\n");
  expect(await hashSourceTree(root)).not.toBe(added);
});

test("editing a client, a test or a doc keeps the code id", async () => {
  const clean = await hashSourceTree(root);

  write("packages/desktop/src/main.ts", "export const desktop = 2;\n");
  write("packages/tui/src/composer.ts", "export const composer = 2;\n");
  write("packages/core/test/index.test.ts", "export const covered = true;\n");
  write("README.md", "# Nyte\n");

  expect(await hashSourceTree(root)).toBe(clean);
});

test("a tree outside git has no code id", async () => {
  rmSync(join(root, ".git"), { recursive: true, force: true });

  expect(await hashSourceTree(root)).toBeUndefined();
});
