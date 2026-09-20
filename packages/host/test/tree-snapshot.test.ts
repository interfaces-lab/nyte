import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("GIT_") || value === undefined) continue;
    env[name] = value;
  }
  return {
    ...env,
    HOME: root,
    NYTE_HOME: join(root, "home"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: "0",
  };
}

function runLockChild(script: string, lock: string, marker: string, holdMs: number) {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", script, lock, marker, String(holdMs)],
    { env: childEnv(), stdio: "ignore" },
  );
  const exited = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolveExit({ code, signal }));
  });
  return { child, exited };
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function lockChildScript(): Promise<string> {
  const source = pathToFileURL(join(import.meta.dirname, "../src/tree-snapshot.ts")).href;
  const script = join(root, "lock-child.mjs");
  await writeFile(
    script,
    `import { writeFile } from "node:fs/promises";\nimport { withFileLeaseLock } from ${JSON.stringify(source)};\nconst options = { leaseMs: 300, refreshMs: 50, retryMs: 5 };\nawait withFileLeaseLock(process.argv[2], async () => {\n  await writeFile(process.argv[3], "entered");\n  await new Promise((resolve) => setTimeout(resolve, Number(process.argv[4])));\n}, options);\n`,
  );
  return script;
}

async function assertCleanExit(exited: ReturnType<typeof runLockChild>["exited"]): Promise<void> {
  assert.deepEqual(await exited, { code: 0, signal: null });
}

async function workspace(files: Readonly<Record<string, string>>): Promise<string> {
  const cwd = join(root, "workspace");
  await mkdir(cwd, { recursive: true });
  for (const [path, contents] of Object.entries(files)) await writeFile(join(cwd, path), contents);
  return cwd;
}

function snapshotAt(cwd: string, options: Parameters<typeof createTreeSnapshot>[0] = {}) {
  const snapshot = createTreeSnapshot(options);
  return {
    tree: () => snapshot.tree({ cwd }),
    diffTrees: (input: Omit<Parameters<typeof snapshot.diffTrees>[0], "cwd">) =>
      snapshot.diffTrees({ cwd, ...input }),
    restoreTree: (input: Omit<Parameters<typeof snapshot.restoreTree>[0], "cwd">) =>
      snapshot.restoreTree({ cwd, ...input }),
  };
}

async function treeOf(snapshot: ReturnType<typeof snapshotAt>): Promise<TreeId> {
  const outcome = await snapshot.tree();
  if (outcome.kind !== "tree") throw new Error(outcome.reason);
  return outcome.id;
}

test("a tree id is stable until the workspace changes, and the user's .git is never touched", async () => {
  const cwd = await workspace({ "a.txt": "one\n" });
  const snapshot = snapshotAt(cwd);
  const first = await treeOf(snapshot);
  assert.equal(await treeOf(snapshot), first);
  await writeFile(join(cwd, "a.txt"), "two\n");
  assert.notEqual(await treeOf(snapshot), first);
  assert.deepEqual(await readdir(cwd), ["a.txt"]);
  assert.deepEqual(await readdir(join(root, "home", "snapshots")).then((names) => names.length), 1);
});

test("tree records exact bytes without attribute normalization", async () => {
  const cwd = await workspace({
    ".gitattributes": "*.txt text eol=lf\n",
    "a.txt": "a\r\n",
  });
  const snapshot = snapshotAt(cwd);
  const crlf = await treeOf(snapshot);
  await writeFile(join(cwd, "a.txt"), "a\n");
  assert.notEqual(await treeOf(snapshot), crlf);
});

test("diffTrees reports added, modified, and deleted files with counts and patches", async () => {
  const cwd = await workspace({ "kept.txt": "a\nb\n", "gone.txt": "x\n" });
  const snapshot = snapshotAt(cwd);
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

test("diffTrees reports binary numstat as zero line counts", async () => {
  const cwd = await workspace({});
  const snapshot = snapshotAt(cwd);
  const from = await treeOf(snapshot);
  await writeFile(join(cwd, "binary.dat"), Buffer.from([0, 1, 2]));
  const to = await treeOf(snapshot);
  const files = await snapshot.diffTrees({ from, to });
  assert.equal(files[0]?.added, 0);
  assert.equal(files[0]?.removed, 0);
  assert.match(files[0]?.patch ?? "", /Binary files/u);
});

test("restoreTree puts a modified file back and removes a created one", async () => {
  const cwd = await workspace({ "a.txt": "before\n" });
  const trashed: string[] = [];
  const snapshot = snapshotAt(cwd, {
    discard: async (absolute) => {
      trashed.push(absolute);
      await rm(absolute);
    },
  });
  const from = await treeOf(snapshot);
  await writeFile(join(cwd, "a.txt"), "after\n");
  await writeFile(join(cwd, "made.txt"), "new\n");
  const to = await treeOf(snapshot);
  const files = await snapshot.diffTrees({ from, to });
  assert.deepEqual(await snapshot.restoreTree({ from, expect: to, paths: files }), {
    kind: "restored",
    files: ["a.txt", "made.txt"],
  });
  assert.equal(await readFile(join(cwd, "a.txt"), "utf8"), "before\n");
  assert.deepEqual(trashed, [join(await realpath(cwd), "made.txt")]);
  assert.deepEqual(await readdir(cwd), ["a.txt"]);
  assert.equal(await treeOf(snapshot), from);
});

test("restoreTree reports a conflict without writing over a later human edit", async () => {
  const cwd = await workspace({ "a.txt": "before\n" });
  const snapshot = snapshotAt(cwd);
  const from = await treeOf(snapshot);
  await writeFile(join(cwd, "a.txt"), "run\n");
  const expect = await treeOf(snapshot);
  const files = await snapshot.diffTrees({ from, to: expect });
  await writeFile(join(cwd, "a.txt"), "human\n");

  assert.deepEqual(await snapshot.restoreTree({ from, expect, paths: files }), {
    kind: "conflict",
    paths: ["a.txt"],
  });
  assert.equal(await readFile(join(cwd, "a.txt"), "utf8"), "human\n");
});

test("restoreTree restores a rename source and trashes the destination", async () => {
  const cwd = await workspace({ "from.txt": "before\n" });
  const trashed: string[] = [];
  const snapshot = snapshotAt(cwd, {
    discard: async (absolute) => {
      trashed.push(absolute);
      await rm(absolute);
    },
  });
  const from = await treeOf(snapshot);
  await rename(join(cwd, "from.txt"), join(cwd, "to.txt"));
  const expect = await treeOf(snapshot);
  const files = await snapshot.diffTrees({ from, to: expect });
  assert.deepEqual(
    files.map((file) => file.kind),
    ["renamed"],
  );
  assert.equal(files[0]?.kind === "renamed" ? files[0].from : "", "from.txt");

  assert.deepEqual(await snapshot.restoreTree({ from, expect, paths: files }), {
    kind: "restored",
    files: ["to.txt"],
  });
  assert.equal(await readFile(join(cwd, "from.txt"), "utf8"), "before\n");
  assert.deepEqual(trashed, [join(await realpath(cwd), "to.txt")]);
});

test("restoreTree rejects a directory and an intermediate symlink", async () => {
  const cwd = await workspace({ "a.txt": "a\n" });
  const outside = join(root, "outside");
  await mkdir(join(cwd, "folder"));
  await mkdir(outside);
  await writeFile(join(outside, "file.txt"), "outside\n");
  await symlink(outside, join(cwd, "linked"));
  const snapshot = snapshotAt(cwd);
  const tree = await treeOf(snapshot);
  const diff = (path: string) => ({
    path,
    kind: "added" as const,
    added: 1,
    removed: 0,
    patch: "",
  });

  const directory = await snapshot.restoreTree({
    from: tree,
    expect: tree,
    paths: [diff("folder")],
  });
  const linked = await snapshot.restoreTree({
    from: tree,
    expect: tree,
    paths: [diff("linked/file.txt")],
  });

  assert.equal(directory.kind, "failed");
  assert.equal(linked.kind, "failed");
  assert.equal(await readFile(join(outside, "file.txt"), "utf8"), "outside\n");
});

test("two processes serialize tree writes through the shadow lock", async () => {
  const cwd = await workspace({ "a.txt": "a\n" });
  const source = pathToFileURL(join(import.meta.dirname, "../src/tree-snapshot.ts")).href;
  const script = join(root, "tree-child.mjs");
  await writeFile(
    script,
    `import { createTreeSnapshot } from ${JSON.stringify(source)};\nconst result = await createTreeSnapshot().tree({ cwd: process.argv[2] });\nprocess.stdout.write(JSON.stringify(result));\n`,
  );
  const run = () =>
    new Promise<string>((resolveResult, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", script, cwd], {
        env: childEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolveResult(Buffer.concat(stdout).toString("utf8"));
        else reject(new Error(Buffer.concat(stderr).toString("utf8")));
      });
    });

  const [first, second] = await Promise.all([run(), run()]);
  assert.deepEqual(JSON.parse(first), JSON.parse(second));
});

test("two processes serialize through one lease lock", async () => {
  const script = await lockChildScript();
  const lock = join(root, "locks", "shared.lock");
  await mkdir(join(root, "locks"));
  const firstMarker = join(root, "first-entered");
  const secondMarker = join(root, "second-entered");
  const first = runLockChild(script, lock, firstMarker, 500);
  await waitForFile(firstMarker);
  const second = runLockChild(script, lock, secondMarker, 0);

  await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  await assert.rejects(access(secondMarker));
  await Promise.all([assertCleanExit(first.exited), assertCleanExit(second.exited)]);
  await access(secondMarker);
});

test("a killed holder's lock is taken over after its lease expires", async () => {
  const script = await lockChildScript();
  const lock = join(root, "killed.lock");
  const holderMarker = join(root, "killed-holder-entered");
  const contenderMarker = join(root, "killed-contender-entered");
  const holder = runLockChild(script, lock, holderMarker, 10_000);
  await waitForFile(holderMarker);
  holder.child.kill("SIGKILL");
  assert.deepEqual(await holder.exited, { code: null, signal: "SIGKILL" });

  const startedAt = Date.now();
  const contender = runLockChild(script, lock, contenderMarker, 0);
  await waitForFile(contenderMarker);
  assert.ok(Date.now() - startedAt >= 200);
  await assertCleanExit(contender.exited);
});

test("a live holder refreshes its lease and is never displaced", async () => {
  const script = await lockChildScript();
  const lock = join(root, "live.lock");
  const holderMarker = join(root, "live-holder-entered");
  const contenderMarker = join(root, "live-contender-entered");
  const holder = runLockChild(script, lock, holderMarker, 900);
  await waitForFile(holderMarker);
  const contender = runLockChild(script, lock, contenderMarker, 0);

  await new Promise<void>((resolveWait) => setTimeout(resolveWait, 500));
  await assert.rejects(access(contenderMarker));
  await assertCleanExit(holder.exited);
  await waitForFile(contenderMarker);
  await assertCleanExit(contender.exited);
});

test("without a discard hook a created file moves under the shadow trash", async () => {
  const cwd = await workspace({});
  const snapshot = snapshotAt(cwd);
  const from = await treeOf(snapshot);
  await writeFile(join(cwd, "made.txt"), "new\n");
  const to = await treeOf(snapshot);
  const files = await snapshot.diffTrees({ from, to });
  const outcome = await snapshot.restoreTree({ from, expect: to, paths: files });
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
  const snapshot = snapshotAt(cwd);
  const from = await treeOf(snapshot);
  const outcome = await snapshot.restoreTree({
    from,
    expect: from,
    paths: [{ path: "../escape.txt", kind: "added", added: 1, removed: 0, patch: "" }],
  });
  assert.equal(outcome.kind, "failed");
});

test(".gitignore'd files are excluded from the tree", async () => {
  const cwd = await workspace({
    ".gitignore": "secret.txt\n",
    "secret.txt": "s\n",
    "a.txt": "a\n",
  });
  const snapshot = snapshotAt(cwd);
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
  const outcome = await snapshotAt(cwd).tree();
  assert.equal(outcome.kind, "unavailable");
});
