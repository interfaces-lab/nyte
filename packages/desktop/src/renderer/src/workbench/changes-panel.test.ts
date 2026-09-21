import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { parsePatchFacts } from "@nyte-ai/client";
import type { Turn } from "@nyte-ai/protocol";
import { testRenderer } from "../../../../test/renderer.ts";
import { turnChangeOptions, visibleTurnOptions } from "./change-scopes.ts";

type ConversationTurn = Extract<Turn, { kind: "turn" }>;

/** One settled file_patch per patch, stamped the way the runner stamps it. */
function changedTurn(id: string, patches: readonly string[]): ConversationTurn {
  return {
    kind: "turn",
    id,
    run: { kind: "run", id: `${id}-run` },
    startedAt: 0,
    durationMs: 0,
    parts: patches.map((patch, index) => {
      const facts = parsePatchFacts(patch);
      const file = facts?.files[0];
      return {
        kind: "tool",
        callId: `${id}-call-${String(index)}`,
        class: {
          kind: "file_patch",
          op: "edit",
          path: file?.path ?? "",
          added: facts?.added ?? 0,
          removed: facts?.removed ?? 0,
          patch,
        },
        result: { commit: `${id}-result-${String(index)}`, output: "", isError: false },
        at: 1,
      };
    }),
  };
}

const addA = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1,2 @@", " old", "+first", ""].join("\n");
const editA = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -2 +2 @@", "-first", "+second", ""].join(
  "\n",
);
const addB = ["--- a/src/b.ts", "+++ b/src/b.ts", "@@ -0,0 +1 @@", "+new", ""].join("\n");

describe("turn change options", () => {
  test("projects per-turn totals and patches in one transcript fold", () => {
    const unchanged: ConversationTurn = {
      kind: "turn",
      id: "turn-2",
      run: { kind: "run", id: "turn-2-run" },
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
        run: { kind: "run", id: "turn-2-run" },
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

test("a result seen twice on the branch counts once, and its files keep their own hunks", () => {
  const turn = changedTurn("twice", [addA, addB]);
  const option = turnChangeOptions([{ ...turn, parts: [...turn.parts, ...turn.parts] }])[0];
  assert.ok(option);
  assert.deepEqual(option.stats, { added: 2, removed: 0 });
  assert.deepEqual(
    option.files.map((row) => [row.change.path, row.patch]),
    [
      ["src/a.ts", addA],
      ["src/b.ts", addB],
    ],
  );
});

test("a failed edit contributes no row while a later settled one survives", () => {
  const turn = changedTurn("mixed", [addB]);
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

test(
  "the native file tree and code view show files, counts, and diff-header actions",
  { timeout: 60_000 },
  async () => {
    assert.equal(
      await testRenderer(new URL("./changes-panel.browser-test.tsx", import.meta.url)),
      "passed",
    );
  },
);
