import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { TreeId } from "@nyte-ai/protocol";
import { createTreeSnapshot } from "../src/tree-snapshot.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nyte-tree-"));
  vi.stubEnv("NYTE_HOME", join(root, "home"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function workspace(files: Readonly<Record<string, string>>): Promise<string> {
  const cwd = join(root, "workspace");
  await mkdir(cwd, { recursive: true });
  for (const [path, contents] of Object.entries(files)) await writeFile(join(cwd, path), contents);
  return cwd;
}

async function treeOf(snapshot: ReturnType<typeof createTreeSnapshot>): Promise<TreeId> {
  const outcome = await snapshot.tree();
  if (outcome.kind !== "tree") throw new Error(outcome.reason);
  return outcome.id;
}

test("a tree id is stable until the workspace changes, and the user's .git is never touched", async () => {
  const cwd = await workspace({ "a.txt": "one\n" });
  const snapshot = createTreeSnapshot(cwd);
  const first = await treeOf(snapshot);
  assert.equal(await treeOf(snapshot), first);
  await writeFile(join(cwd, "a.txt"), "two\n");
  assert.notEqual(await treeOf(snapshot), first);
  assert.deepEqual(await readdir(cwd), ["a.txt"]);
  assert.deepEqual(await readdir(join(root, "home", "snapshots")).then((names) => names.length), 1);
});

test("diffTrees reports added, modified, and deleted files with counts and patches", async () => {
  const cwd = await workspace({ "kept.txt": "a\nb\n", "gone.txt": "x\n" });
  const snapshot = createTreeSnapshot(cwd);
  const from = await treeOf(snapshot);
  await writeFile(join(cwd, "kept.txt"), "a\nc\nd\n");
  await mkdir(join(cwd, "sub"));
  await writeFile(join(cwd, "sub/new.txt"), "n\n");
  await rm(join(cwd, "gone.txt"));
  const to = await treeOf(snapshot);
  const files = await snapshot.diffTrees({ from, to });
  assert.deepEqual(
    files.map(({ path, kind, added, removed }) => ({ path, kind, added, removed })),
    [
      { path: "gone.txt", kind: "deleted", added: 0, removed: 1 },
      { path: "kept.txt", kind: "modified", added: 2, removed: 1 },
      { path: "sub/new.txt", kind: "added", added: 1, removed: 0 },
    ],
  );
  assert.match(files[1]?.patch ?? "", /^diff --git a\/kept\.txt b\/kept\.txt\n/u);
  assert.match(files[1]?.patch ?? "", /-b\n\+c\n\+d\n$/u);
  assert.match(files[2]?.patch ?? "", /--- \/dev\/null\n\+\+\+ b\/sub\/new\.txt/u);
  assert.deepEqual(
    (await snapshot.diffTrees({ from, to, paths: ["kept.txt"] })).map((file) => file.path),
    ["kept.txt"],
  );
});

test("restoreTree puts a modified file back and removes a created one", async () => {
  const cwd = await workspace({ "a.txt": "before\n" });
  const trashed: string[] = [];
  const snapshot = createTreeSnapshot(cwd, {
    discard: async (absolute) => {
      trashed.push(absolute);
      await rm(absolute);
    },
  });
  const from = await treeOf(snapshot);
  await writeFile(join(cwd, "a.txt"), "after\n");
  await writeFile(join(cwd, "made.txt"), "new\n");
  const to = await treeOf(snapshot);
  const paths = (await snapshot.diffTrees({ from, to })).map((file) => file.path);
  assert.deepEqual(await snapshot.restoreTree({ tree: from, paths }), {
    kind: "restored",
    files: ["a.txt", "made.txt"],
  });
  assert.equal(await readFile(join(cwd, "a.txt"), "utf8"), "before\n");
  assert.deepEqual(trashed, [join(await realpath(cwd), "made.txt")]);
  assert.deepEqual(await readdir(cwd), ["a.txt"]);
  assert.equal(await treeOf(snapshot), from);
});

test("without a discard hook a created file moves under the shadow trash", async () => {
  const cwd = await workspace({});
  const snapshot = createTreeSnapshot(cwd);
  const from = await treeOf(snapshot);
  await writeFile(join(cwd, "made.txt"), "new\n");
  const outcome = await snapshot.restoreTree({ tree: from, paths: ["made.txt"] });
  assert.equal(outcome.kind, "restored");
  assert.deepEqual(await readdir(cwd), []);
  const [shadow] = await readdir(join(root, "home", "snapshots"));
  const [stamp] = await readdir(join(root, "home", "snapshots", shadow ?? "", "trash"));
  assert.equal(
    await readFile(
      join(root, "home", "snapshots", shadow ?? "", "trash", stamp ?? "", "made.txt"),
      "utf8",
    ),
    "new\n",
  );
});

test("a path outside the workspace fails the restore before anything moves", async () => {
  const cwd = await workspace({ "a.txt": "x\n" });
  const snapshot = createTreeSnapshot(cwd);
  const from = await treeOf(snapshot);
  const outcome = await snapshot.restoreTree({ tree: from, paths: ["../escape.txt"] });
  assert.equal(outcome.kind, "failed");
});

test(".gitignore'd files are excluded from the tree", async () => {
  const cwd = await workspace({
    ".gitignore": "secret.txt\n",
    "secret.txt": "s\n",
    "a.txt": "a\n",
  });
  const snapshot = createTreeSnapshot(cwd);
  const from = await treeOf(snapshot);
  await writeFile(join(cwd, "secret.txt"), "changed\n");
  assert.equal(await treeOf(snapshot), from);
  await writeFile(join(cwd, "a.txt"), "changed\n");
  const to = await treeOf(snapshot);
  assert.deepEqual(
    (await snapshot.diffTrees({ from, to })).map((file) => file.path),
    ["a.txt"],
  );
});

test("git being absent answers unavailable with the reason", async () => {
  const cwd = await workspace({ "a.txt": "a\n" });
  vi.stubEnv("PATH", join(root, "empty-path"));
  const outcome = await createTreeSnapshot(cwd).tree();
  assert.equal(outcome.kind, "unavailable");
});
