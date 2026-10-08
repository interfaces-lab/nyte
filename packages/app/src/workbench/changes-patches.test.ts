import assert from "node:assert/strict";
import { test } from "vitest";
import { VCS_DIFF_PATHS_MAX } from "@nyte-ai/protocol";
import type { VcsDiff } from "@nyte-ai/protocol";
import { createPatchLoader } from "./changes-patches.ts";
import type { PatchSource } from "./changes-patches.ts";

interface Read {
  readonly paths: readonly string[];
  readonly answer: (diffs: readonly VcsDiff[]) => void;
  readonly fail: (cause: Error) => void;
}

/** A source whose reads answer only when the test answers them. */
function source(key: string, paths: readonly string[]) {
  const reads: Read[] = [];

  const value: PatchSource = {
    key,
    lineage: "worktree",
    paths,
    read: (batch) =>
      new Promise((answer, fail) => {
        reads.push({ paths: batch, answer, fail });
      }),
  };

  return { value, reads };
}

const binary = (
  path: string,
  patch = `Binary files a/${path} and b/${path} differ\n`,
): VcsDiff => ({
  path,
  status: "modified",
  kind: "binary",
  patch,
});

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("one read is in flight at a time, and a path the answer omits reads as empty", async () => {
  const loader = createPatchLoader();
  const current = source("k1", ["a", "b", "c"]);
  loader.setSource(current.value);
  loader.mount("a");
  loader.mount("b");
  await settled();
  loader.mount("c");
  await settled();

  assert.deepEqual(
    current.reads.map((read) => read.paths),
    [["a", "b"]],
  );

  current.reads[0]?.answer([binary("a")]);
  await settled();

  assert.equal(loader.getSnapshot().fresh.get("a")?.kind, "binary");
  assert.deepEqual(loader.getSnapshot().fresh.get("b"), { kind: "empty" });
  assert.deepEqual(
    current.reads.map((read) => read.paths),
    [["a", "b"], ["c"]],
  );
});

test("mark-all reads in protocol-sized batches and settles even when a batch fails", async () => {
  const loader = createPatchLoader();
  const paths = Array.from({ length: VCS_DIFF_PATHS_MAX + 4 }, (_, index) => `file-${index}`);
  const current = source("k1", paths);
  loader.setSource(current.value);
  const ensured = loader.ensure(paths);
  await settled();

  assert.equal(current.reads.length, 1);
  assert.equal(current.reads[0]?.paths.length, VCS_DIFF_PATHS_MAX);
  current.reads[0]?.answer((current.reads[0]?.paths ?? []).map((path) => binary(path)));
  await settled();
  assert.deepEqual(current.reads[1]?.paths, paths.slice(VCS_DIFF_PATHS_MAX));
  current.reads[1]?.fail(new Error("git stopped"));

  const answer = await ensured;
  assert.ok(answer.kind === "read");
  assert.equal(answer.entries.size, paths.length);
  assert.deepEqual(answer.entries.get(paths.at(-1) ?? ""), { kind: "failed" });
});

test("a source replaced during mark-all answers superseded and never publishes the old read", async () => {
  const loader = createPatchLoader();
  const paths = Array.from({ length: VCS_DIFF_PATHS_MAX + 4 }, (_, index) => `file-${index}`);
  const first = source("k1", paths);
  loader.setSource(first.value);
  const ensured = loader.ensure(paths);
  await settled();
  const published: string[] = [];
  loader.subscribe(() => {
    const { key, fresh } = loader.getSnapshot();

    for (const entry of fresh.values()) {
      if (entry.kind === "binary") published.push(`${String(key)} ${entry.text}`);
    }
  });

  const second = source("k2", paths);
  loader.setSource(second.value);
  assert.deepEqual(await ensured, { kind: "superseded" });

  first.reads[0]?.answer(paths.map((path) => binary(path, "old")));
  await settled();

  assert.equal(first.reads.length, 1);
  assert.equal(loader.getSnapshot().key, "k2");
  assert.equal(loader.getSnapshot().fresh.size, 0);
  assert.deepEqual(published, []);

  const again = loader.ensure(["file-0"]);
  await settled();
  assert.deepEqual(second.reads[0]?.paths, ["file-0"]);
  second.reads[0]?.answer([binary("file-0", "new")]);
  const answer = await again;
  const entry = answer.kind === "read" ? answer.entries.get("file-0") : undefined;
  assert.ok(entry?.kind === "binary");
  assert.equal(entry.text, "new");
  assert.deepEqual(published, ["k2 new"]);
});

test("release drops demand, answers waiters, and discards the read in flight", async () => {
  const loader = createPatchLoader();
  const current = source("k1", ["a"]);
  loader.setSource(current.value);
  loader.mount("a");
  const ensured = loader.ensure(["a"]);
  await settled();

  loader.release();
  assert.deepEqual(await ensured, { kind: "superseded" });
  current.reads[0]?.fail(new Error("answered after release"));
  await settled();

  assert.deepEqual(loader.getSnapshot(), {
    key: undefined,
    lineage: undefined,
    fresh: new Map(),
    stale: new Map(),
  });
  assert.equal(current.reads.length, 1);
  assert.deepEqual(await loader.ensure(["a"]), { kind: "superseded" });
});

test("stand-ins keep only the paths the comparison still reports", async () => {
  const loader = createPatchLoader();
  const first = source("k1", ["a", "b"]);
  loader.setSource(first.value);
  loader.mount("a");
  loader.mount("b");
  await settled();
  first.reads[0]?.answer([binary("a"), binary("b")]);
  await settled();

  loader.setSource(source("k2", ["a"]).value);
  assert.deepEqual([...loader.getSnapshot().stale.keys()], ["a"]);
  assert.equal(loader.getSnapshot().fresh.size, 0);

  loader.setSource(source("k2", []).value);
  assert.equal(loader.getSnapshot().stale.size, 0);
});

const answerAll = (read: Read | undefined): void => {
  read?.answer(read.paths.map((path) => binary(path)));
};

test("prepared paths are all read in bounded batches, and nothing else is", async () => {
  const loader = createPatchLoader();
  const paths = Array.from({ length: 20 }, (_, index) => `file-${index}`);
  const current = source("k1", paths);
  loader.setSource(current.value);
  const collapsed = new Set(["file-3", "file-11"]);
  loader.prepare(paths.filter((path) => !collapsed.has(path)));

  for (let turn = 0; turn < paths.length; turn += 1) {
    await settled();
    answerAll(current.reads.at(-1));
  }

  await settled();
  const requested = current.reads.flatMap((read) => read.paths);
  assert.ok(current.reads.every((read) => read.paths.length <= 8));
  assert.equal(requested.length, new Set(requested).size);
  assert.deepEqual(requested.toSorted(), paths.filter((path) => !collapsed.has(path)).toSorted());
  assert.equal(loader.getSnapshot().fresh.size, paths.length - collapsed.size);
});

test("a header that renders jumps ahead of queued background reads", async () => {
  const loader = createPatchLoader();
  const paths = Array.from({ length: 40 }, (_, index) => `file-${index}`);
  const current = source("k1", paths);
  loader.setSource(current.value);
  loader.prepare(paths);
  await settled();
  assert.deepEqual(current.reads[0]?.paths, paths.slice(0, 8));

  loader.mount("file-30");
  await settled();
  assert.equal(current.reads.length, 1, "The read in flight is not joined or overlapped");

  answerAll(current.reads[0]);
  await settled();
  assert.deepEqual(current.reads[1]?.paths, ["file-30"]);

  answerAll(current.reads[1]);
  await settled();
  assert.deepEqual(current.reads[2]?.paths, paths.slice(8, 16));
});

test("files with nothing to show are read before stand-ins are refreshed", async () => {
  const loader = createPatchLoader();
  const first = source("k1", ["a", "b"]);
  loader.setSource(first.value);
  loader.prepare(["a", "b"]);
  await settled();
  answerAll(first.reads[0]);
  await settled();

  const second = source("k2", ["a", "b", "c", "d"]);
  loader.setSource(second.value);
  loader.prepare(["a", "b", "c", "d"]);
  await settled();
  assert.deepEqual(second.reads[0]?.paths, ["c", "d"]);
  answerAll(second.reads[0]);
  await settled();
  assert.deepEqual(second.reads[1]?.paths, ["a", "b"]);
  assert.deepEqual([...loader.getSnapshot().stale.keys()].toSorted(), ["a", "b"]);
});

test("a replaced source drops queued background reads and the late answer", async () => {
  const loader = createPatchLoader();
  const paths = Array.from({ length: 12 }, (_, index) => `file-${index}`);
  const first = source("k1", paths);
  loader.setSource(first.value);
  loader.prepare(paths);
  await settled();

  const second = source("k2", ["other"]);
  loader.setSource(second.value);
  loader.prepare(["other"]);
  await settled();
  assert.equal(second.reads.length, 0, "The next read waits for the one in flight");

  answerAll(first.reads[0]);
  await settled();
  assert.equal(first.reads.length, 1);
  assert.deepEqual(second.reads[0]?.paths, ["other"]);
  assert.deepEqual([...loader.getSnapshot().fresh.keys()], []);

  loader.prepare([]);
  answerAll(second.reads[0]);
  await settled();
  assert.deepEqual([...loader.getSnapshot().fresh.keys()], ["other"]);
  assert.equal(second.reads.length, 1);
});
