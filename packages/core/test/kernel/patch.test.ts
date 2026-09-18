import assert from "node:assert/strict";
import { test } from "vitest";
import { createPatch } from "diff";
import { parsePatchFacts } from "@nyte-ai/client";

const headerLines = "--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n---old\n+++new\n";
const deletion = "--- a/gone.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n";
const addition = "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n";
const rename =
  "diff --git a/old.txt b/renamed.txt\nsimilarity index 100%\nrename from old.txt\nrename to renamed.txt\n";

test("header-looking hunk lines count as changes and preserve raw content", () => {
  const facts = parsePatchFacts(headerLines);
  assert.equal(facts?.patch, headerLines);
  assert.deepEqual(facts?.files[0]?.hunks[0]?.lines, ["---old", "+++new"]);
  assert.deepEqual([facts?.added, facts?.removed], [1, 1]);
  const spaced = parsePatchFacts(headerLines.replace("---old\n+++new", "--- old\n+++ new"));
  assert.deepEqual([spaced?.added, spaced?.removed], [1, 1]);
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
  assert.deepEqual([facts?.added, facts?.removed], [3, 3]);
  assert.equal(facts?.patch, patch);
});

test.each([
  "--- a/a\n+++ b/a\n@@ -1,2 +1 @@\n-old\n+new\n",
  "--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old",
  "--- a/a\n+++ b/a\n@@ -1 +1 @@\n+new",
  "--- a/a\n+++ b/a\n@@ invalid @@\n-old\n+new\n",
  "--- a/a\n+++ b/a\n@@ nonsense\n",
  "--- a/a\n@@ -1 +1 @@\n-old\n+new\n",
])("malformed or truncated patch has no facts: %s", (patch) => {
  assert.equal(parsePatchFacts(patch), undefined);
});

test.each([rename, "--- a/same\n+++ b/same\n", "--- a/same\n+++ b/same\n@@ -1 +1 @@\n context\n"])(
  "a patch without textual changes counts zero: %s",
  (patch) => {
    const facts = parsePatchFacts(patch);
    assert.deepEqual([facts?.added, facts?.removed], [0, 0]);
  },
);

test("rename metadata parses without hunks, additions and deletions choose real paths", () => {
  assert.equal(parsePatchFacts(deletion)?.files[0]?.path, "gone.txt");
  assert.equal(parsePatchFacts(addition)?.files[0]?.path, "new.txt");
  assert.equal(parsePatchFacts(rename)?.files[0]?.path, "renamed.txt");
  assert.equal(parsePatchFacts(rename)?.files[0]?.isRename, true);
  const quoted = '--- "a/folder/a\\tfile"\n+++ "b/folder/a\\tfile"\n@@ -1 +1 @@\n-old\n+new\n';
  assert.equal(parsePatchFacts(quoted)?.files[0]?.path, "folder/a\tfile");
});

test("hunk-only patches have counts but no guessed path", () => {
  const facts = parsePatchFacts("@@ -1 +1 @@\n-old\n+new\n");
  assert.deepEqual([facts?.added, facts?.removed], [1, 1]);
  assert.equal(facts?.files[0]?.path, undefined);
});

test("a complete patch without a final newline retains its counts", () => {
  const facts = parsePatchFacts(headerLines.trimEnd());
  assert.equal(facts?.patch, headerLines.trimEnd());
  assert.deepEqual([facts?.added, facts?.removed], [1, 1]);
});
