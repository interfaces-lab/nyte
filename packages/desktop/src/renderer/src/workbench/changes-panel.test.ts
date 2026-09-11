import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { parsePatchFacts } from "@nyte-ai/core/views";
import type { Turn } from "@nyte-ai/core";
import { turnChangeOptions, visibleTurnOptions } from "./change-scopes.ts";
import { fileListLabel } from "./file-list-label.ts";

type ConversationTurn = Extract<Turn, { kind: "turn" }>;

function changedTurn(id: string, patches: readonly string[]): ConversationTurn {
  return {
    kind: "turn",
    id,
    outcome: "completed",
    startedAt: 0,
    durationMs: 0,
    parts: patches.map((patch, index) => ({
      kind: "tool",
      callId: `${id}-call-${String(index)}`,
      toolName: "edit",
      result: {
        commit: `${id}-result-${String(index)}`,
        output: "",
        isError: false,
        details: { patch },
      },
    })),
  };
}

const addA = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1,2 @@", " old", "+first", ""].join("\n");
const editA = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -2 +2 @@", "-first", "+second", ""].join(
  "\n",
);
const addB = ["--- a/src/b.ts", "+++ b/src/b.ts", "@@ -0,0 +1 @@", "+new", ""].join("\n");

describe("turn change options", () => {
  test("lists every turn newest first and keeps all patches for a file", () => {
    const unchanged: ConversationTurn = {
      kind: "turn",
      id: "turn-2",
      outcome: "completed",
      startedAt: 0,
      durationMs: 0,
      parts: [],
    };
    const options = turnChangeOptions([
      changedTurn("turn-1", [addA, editA]),
      unchanged,
      changedTurn("turn-3", [addB]),
    ]);

    assert.deepEqual(
      options.map((option) => ({
        label: option.label,
        turnId: option.scope.turnId,
        stats: option.stats,
      })),
      [
        { label: "Latest", turnId: "turn-3", stats: { added: 1, removed: 0 } },
        { label: "Turn 2", turnId: "turn-2", stats: { added: 0, removed: 0 } },
        { label: "Turn 1", turnId: "turn-1", stats: { added: 2, removed: 1 } },
      ],
    );
    assert.equal(options[2]?.files[0]?.patch, `${addA}\n${editA}`);
  });

  test("hides empty turns unless they are selected or show-all is on", () => {
    const options = turnChangeOptions([
      changedTurn("turn-1", [addA]),
      {
        kind: "turn",
        id: "turn-2",
        outcome: "completed",
        startedAt: 0,
        durationMs: 0,
        parts: [],
      },
      changedTurn("turn-3", [addB]),
    ]);

    assert.deepEqual(
      visibleTurnOptions(options, false, undefined).map((option) => option.scope.turnId),
      ["turn-3", "turn-1"],
    );
    assert.deepEqual(
      visibleTurnOptions(options, false, "turn-2").map((option) => option.scope.turnId),
      ["turn-3", "turn-2", "turn-1"],
    );
    assert.equal(visibleTurnOptions(options, true, undefined).length, 3);
  });
});

describe("file list labels", () => {
  test("uses the basename until a peer shares it", () => {
    assert.equal(fileListLabel("src/a.ts", ["src/a.ts", "src/b.ts"]), "a.ts");
    assert.equal(
      fileListLabel("src/theme/styles.ts", ["src/theme/styles.ts", "src/conversation/styles.ts"]),
      "theme/styles.ts",
    );
    assert.equal(fileListLabel("a/styles.ts", ["a/styles.ts", "b/a/styles.ts"]), "a/styles.ts");
    assert.equal(fileListLabel("b/a/styles.ts", ["a/styles.ts", "b/a/styles.ts"]), "b/a/styles.ts");
  });
});

test("multi-file rows isolate their patches and retain the original tool output", () => {
  const deletion = "--- a/deleted.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n";
  const rename =
    "diff --git a/old.txt b/renamed.txt\nsimilarity index 100%\nrename from old.txt\nrename to renamed.txt\n--- a/old.txt\n+++ b/renamed.txt\n";
  const unchanged = "--- a/unchanged.txt\n+++ b/unchanged.txt\n";
  const raw = `${addA}${addB}${deletion}${rename}${unchanged}`;
  const turn = changedTurn("multi", [raw]);
  const option = turnChangeOptions([{ ...turn, parts: [...turn.parts, ...turn.parts] }])[0];
  assert.ok(option);
  assert.deepEqual(option.stats, { added: 2, removed: 1 });
  assert.deepEqual(
    option.files.map((row) => row.change.path),
    ["src/a.ts", "src/b.ts", "deleted.txt", "renamed.txt", "unchanged.txt"],
  );
  for (const row of option.files) {
    assert.deepEqual(row.rawPatches, [raw]);
    const facts = parsePatchFacts(row.patch);
    assert.ok(facts);
    assert.equal(facts.files.length, 1);
    assert.equal(facts.files[0]?.path, row.change.path);
    assert.equal(facts.added, row.change.added);
    assert.equal(facts.removed, row.change.removed);
    assert.equal(row.change.lastCommit, "multi-result-0");
  }
  assert.match(option.files[3]?.rawPatches[0] ?? "", /rename from old.txt\nrename to renamed.txt/);
  const renamed = parsePatchFacts(option.files[3]?.patch ?? "")?.files[0];
  assert.equal(renamed?.oldFileName, "a/old.txt");
  assert.equal(renamed?.newFileName, "b/renamed.txt");
  assert.deepEqual(
    option.files.slice(3).map((row) => [row.change.added, row.change.removed]),
    [
      [0, 0],
      [0, 0],
    ],
  );
});

test("invalid and failed patches contribute no rows while valid later results survive", () => {
  const turn = changedTurn("mixed", ["--- a/bad\n+++ b/bad\n@@ -1 +1 @@\n-old\n", addB]);
  const failed = changedTurn("failed", [addA]);
  const option = turnChangeOptions([
    {
      ...turn,
      parts: [
        ...failed.parts.map((part) =>
          part.kind === "tool" && part.result !== undefined
            ? { ...part, result: { ...part.result, isError: true } }
            : part,
        ),
        ...turn.parts,
      ],
    },
  ])[0];
  assert.deepEqual(
    option?.files.map((row) => row.change.path),
    ["src/b.ts"],
  );
  assert.deepEqual(option?.stats, { added: 1, removed: 0 });
});
