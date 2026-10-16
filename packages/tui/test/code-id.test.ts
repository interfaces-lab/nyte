import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { hashSourceTree } from "../src/code-id.ts";

let root = "";

const git = (...args: readonly string[]): string =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "nyte-code-id-")));
  git("init", "--quiet");
  writeFileSync(join(root, "host.ts"), "export const answer = 1;\n");
  git("add", "host.ts");
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

test("an edit with the same commit gives another code id, the same on every run", async () => {
  const clean = await hashSourceTree(root);
  writeFileSync(join(root, "host.ts"), "export const answer = 2;\n");
  const edited = await hashSourceTree(root);

  expect(edited).toMatch(/^[0-9a-f]{12}\.[0-9a-f]{8}$/u);
  expect(edited?.startsWith(`${clean ?? ""}.`)).toBe(true);
  expect(await hashSourceTree(root)).toBe(edited);

  writeFileSync(join(root, "worker.ts"), "export const added = true;\n");
  const added = await hashSourceTree(root);

  expect(added).not.toBe(edited);
  writeFileSync(join(root, "worker.ts"), "export const added = false;\n");
  expect(await hashSourceTree(root)).not.toBe(added);
});

test("a tree outside git has no code id", async () => {
  rmSync(join(root, ".git"), { recursive: true, force: true });

  expect(await hashSourceTree(root)).toBeUndefined();
});
