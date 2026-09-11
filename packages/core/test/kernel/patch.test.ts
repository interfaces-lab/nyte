import assert from "node:assert/strict";
import { test } from "vitest";
import { createPatch } from "diff";
import { parsePatchFacts } from "../../src/views.ts";
import {
  appendTurnChanges,
  changesFromTurns,
  diffStat,
  EMPTY_CHANGES,
  patchedPath,
  readPatch,
} from "../../src/kernel/views/changes.ts";
import { createPresenter, presentTool } from "../../src/kernel/views/presentation.ts";
import type { Turn } from "../../src/kernel/views/transcript.ts";

const headerLines = "--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n---old\n+++new\n";
const deletion = "--- a/gone.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n";
const addition = "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n";
const rename =
  "diff --git a/old.txt b/renamed.txt\nsimilarity index 100%\nrename from old.txt\nrename to renamed.txt\n";

function turn(patch: string, commit = "result", isError = false): Extract<Turn, { kind: "turn" }> {
  return {
    kind: "turn",
    id: commit,
    startedAt: 0,
    durationMs: 0,
    outcome: "completed",
    parts: [
      {
        kind: "tool",
        callId: commit,
        toolName: "edit",
        result: {
          commit,
          output: "changed",
          isError,
          details: { patch },
        },
      },
    ],
  };
}

test("header-looking hunk lines count as changes and preserve raw content", () => {
  const facts = parsePatchFacts(headerLines);
  assert.equal(facts?.patch, headerLines);
  assert.deepEqual(facts?.files[0]?.hunks[0]?.lines, ["---old", "+++new"]);
  assert.deepEqual(diffStat(headerLines), { added: 1, removed: 1 });
  assert.deepEqual(changesFromTurns([turn(headerLines)]), [
    { path: "example.txt", added: 1, removed: 1, lastCommit: "result" },
  ]);
  const presented = presentTool({
    toolName: "edit",
    result: {
      output: "changed",
      isError: false,
      details: { patch: headerLines },
    },
  });
  assert.equal(presented.status, "done");
  assert.deepEqual(presented.body, { kind: "diff", ...facts, path: "example.txt" });
  assert.deepEqual(diffStat(headerLines.replace("---old\n+++new", "--- old\n+++ new")), {
    added: 1,
    removed: 1,
  });
});

function assertContentPatch(patch: string, lines: readonly string[]): void {
  const facts = parsePatchFacts(patch);
  assert.ok(facts !== undefined);
  assert.equal(facts.patch, patch);
  assert.deepEqual([facts.added, facts.removed], [1, 1]);
  assert.deepEqual(
    facts.files.map((file) => [file.path, file.added, file.removed]),
    [["example.txt", 1, 1]],
  );
  assert.deepEqual(
    facts.files[0]?.hunks.map((hunk) => hunk.lines),
    [lines],
  );
  assert.deepEqual(changesFromTurns([turn(patch)]), [
    { path: "example.txt", added: 1, removed: 1, lastCommit: "result" },
  ]);
  assert.deepEqual(
    presentTool({
      toolName: "edit",
      result: { output: "changed", isError: false, details: { patch } },
    }).body,
    { kind: "diff", ...facts, path: "example.txt" },
  );
}

test.each(["\r", "\u2028", "\u2029"])(
  "a line separator %j inside a line stays in that line, whether the patch is hand-written or generated",
  (separator) => {
    const line = `+new${separator}@@ -1 +1 @@`;
    assertContentPatch(`--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n${line}\n`, [
      "-old",
      line,
    ]);
    const generated = createPatch(
      "example.txt",
      "context\nold\n",
      `context\nnew${separator}@@ -1 +1 @@\n`,
    );
    assertContentPatch(generated, [" context", "-old", `+new${separator}@@ -1 +1 @@`]);
  },
);

test("CRLF patch headers and body retain their raw bytes", () => {
  assertContentPatch("--- a/example.txt\r\n+++ b/example.txt\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n", [
    "-old\r",
    "+new\r",
  ]);
});

test("multiple hunks and files retain their own counts and source order", () => {
  const patch = headerLines + "@@ -8 +8,2 @@\n context\n+extra\n" + deletion + addition;
  const facts = parsePatchFacts(patch);
  assert.deepEqual(
    facts?.files.map((file) => [file.path, file.added, file.removed]),
    [
      ["example.txt", 2, 1],
      ["gone.txt", 0, 2],
      ["new.txt", 1, 0],
    ],
  );
  assert.deepEqual(diffStat(patch), { added: 3, removed: 3 });
  assert.equal(facts?.patch, patch);
  const first = appendTurnChanges(EMPTY_CHANGES, turn(patch));
  const second = appendTurnChanges(first, turn(headerLines, "latest"));
  assert.deepEqual(second.files, [
    { path: "example.txt", added: 3, removed: 2, lastCommit: "latest" },
    { path: "gone.txt", added: 0, removed: 2, lastCommit: "result" },
    { path: "new.txt", added: 1, removed: 0, lastCommit: "result" },
  ]);
  assert.equal(first.files[0]?.added, 2);
  assert.equal(appendTurnChanges(second, turn(patch)), second);
  assert.equal(appendTurnChanges(second, turn(addition, "failed", true)), second);
  assert.deepEqual(
    changesFromTurns([turn(patch), turn(headerLines, "latest"), turn(patch)]),
    second.files,
  );
  const presented = presentTool({
    toolName: "edit",
    result: { output: "", isError: false, details: { patch } },
  });
  assert.ok(presented.body.kind === "diff");
  assert.equal(presented.body.path, undefined);
  assert.equal(presented.body.added, 3);
});

test.each([
  "--- a/a\n+++ b/a\n@@ -1,2 +1 @@\n-old\n+new\n",
  "--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old",
  "--- a/a\n+++ b/a\n@@ -1 +1 @@\n+new",
  "--- a/a\n+++ b/a\n@@ invalid @@\n-old\n+new\n",
  "--- a/a\n+++ b/a\n@@ nonsense\n",
  "--- a/a\n@@ -1 +1 @@\n-old\n+new\n",
])("malformed or truncated patch falls back to output: %s", (patch) => {
  assert.equal(parsePatchFacts(patch), undefined);
  assert.deepEqual(diffStat(patch), { added: 0, removed: 0 });
  assert.equal(appendTurnChanges(EMPTY_CHANGES, turn(patch)), EMPTY_CHANGES);
  for (const output of ["ordinary result", " \n"]) {
    assert.deepEqual(
      presentTool({ toolName: "edit", result: { output, isError: false, details: { patch } } })
        .body,
      output.trim() === "" ? { kind: "none" } : { kind: "text", text: output },
    );
  }
});

test.each([
  rename,
  "--- a/same\n+++ b/same\n",
  "--- a/same\n+++ b/same\n@@ -1 +1 @@\n context\n",
  "not a patch",
])("no textual changes use ordinary output: %s", (patch) => {
  assert.deepEqual(diffStat(patch), { added: 0, removed: 0 });
  assert.deepEqual(
    presentTool({
      toolName: "edit",
      result: { output: "unchanged", isError: false, details: { patch } },
    }).body,
    { kind: "text", text: "unchanged" },
  );
  assert.deepEqual(
    presentTool({ toolName: "edit", result: { output: " \n", isError: false, details: { patch } } })
      .body,
    { kind: "none" },
  );
});

test("rename metadata accounts without hunks, additions and deletions choose real paths", () => {
  assert.equal(patchedPath(deletion), "gone.txt");
  assert.equal(patchedPath(addition), "new.txt");
  assert.equal(patchedPath(rename), "renamed.txt");
  assert.equal(parsePatchFacts(rename)?.files[0]?.isRename, true);
  assert.deepEqual(changesFromTurns([turn(rename)]), [
    { path: "renamed.txt", added: 0, removed: 0, lastCommit: "result" },
  ]);
  const quoted = '--- "a/folder/a\\tfile"\n+++ "b/folder/a\\tfile"\n@@ -1 +1 @@\n-old\n+new\n';
  assert.equal(patchedPath(quoted), "folder/a\tfile");
});

test("hunk-only patches have counts but no guessed path", () => {
  const patch = "@@ -1 +1 @@\n-old\n+new\n";
  assert.deepEqual(diffStat(patch), { added: 1, removed: 1 });
  assert.equal(patchedPath(patch), undefined);
  assert.equal(appendTurnChanges(EMPTY_CHANGES, turn(patch)), EMPTY_CHANGES);
  const presented = presentTool({
    toolName: "edit",
    args: { path: "guess.txt" },
    result: { output: "", isError: false, details: { patch } },
  });
  assert.ok(presented.body.kind === "diff");
  assert.equal(presented.body.path, undefined);
  assert.equal(presented.body.patch, patch);
});

test("errors always retain ordinary output and patch extraction preserves bytes", () => {
  assert.equal(readPatch({ patch: headerLines }), headerLines);
  assert.equal(readPatch({ diff: headerLines }), headerLines);
  const presented = presentTool({
    toolName: "edit",
    result: { output: "denied", isError: true, details: { patch: headerLines } },
  });
  assert.equal(presented.status, "failed");
  assert.deepEqual(presented.body, { kind: "text", text: "denied" });
});

test("a complete patch without a final newline retains its counts and diff body", () => {
  const patch = headerLines.trimEnd();
  assert.deepEqual(diffStat(patch), { added: 1, removed: 1 });
  assert.deepEqual(changesFromTurns([turn(patch)]), [
    { path: "example.txt", added: 1, removed: 1, lastCommit: "result" },
  ]);
  const presented = createPresenter().tool({
    toolName: "edit",
    result: { output: "changed", isError: false, details: { patch } },
  });
  assert.ok(presented.body.kind === "diff");
  assert.equal(presented.body.patch, patch);
  assert.equal(presented.body.added, 1);
  assert.equal(presented.body.removed, 1);
});

test.each(["constructor", "toString"])(
  "presenter uses only configured own refiners for %s and preserves error fallback",
  (name) => {
    const view = {
      toolName: name,
      result: { output: "ordinary output", isError: false, details: { patch: headerLines } },
    };
    const note = {
      commit: "note",
      at: 0,
      body: { kind: "note", type: name, data: {} },
    } as const;
    const base = createPresenter();
    assert.deepEqual(base.tool(view), presentTool(view));
    assert.deepEqual(base.note(note), { text: `[${name}]` });
    const refined = createPresenter({
      tools: { [name]: (_view, presentation) => ({ ...presentation, title: "Custom title" }) },
      notes: { [name]: () => ({ text: "Custom note" }) },
    });
    assert.deepEqual(refined.tool(view), { ...presentTool(view), title: "Custom title" });
    assert.deepEqual(refined.note(note), { text: "Custom note" });
    const failing = createPresenter({
      tools: {
        [name]: () => {
          throw new Error("tool refinement failed");
        },
      },
      notes: {
        [name]: () => {
          throw new Error("note refinement failed");
        },
      },
    });
    assert.deepEqual(failing.tool(view), base.tool(view));
    assert.deepEqual(failing.note(note), base.note(note));
  },
);
