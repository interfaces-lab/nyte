import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { Turn, TurnPart } from "@nyte-ai/core";
import { estimateRowSize, promptRowCount, transcriptRows } from "./transcript-rows.ts";

function turn(id: string, parts: TurnPart[]): Turn {
  return { kind: "turn", id, parts, outcome: "completed", startedAt: 0, durationMs: 0 };
}

const user: TurnPart = { kind: "user", commit: "u1", parent: null, content: "hello" };
const prose = (text: string): TurnPart => ({
  kind: "assistant",
  commit: "a1",
  contentIndex: 0,
  text,
});
const tool: TurnPart = { kind: "tool", callId: "c1", toolName: "read" };

describe("transcriptRows", () => {
  test("keeps the keys the flow layout used", () => {
    const rows = transcriptRows({
      loading: false,
      failed: false,
      turns: [
        turn("t1", [user]),
        { kind: "summary", commit: "c9", at: 0, body: { kind: "summary", text: "left" } },
      ],
      landing: [{ key: "outbox:1", content: "next" }],
      retrying: "network",
      working: true,
      selections: 0,
    });
    assert.deepEqual(
      rows.map((row) => row.key),
      ["t1", "summary:c9", "outbox:1", "retry", "live", "selections"],
    );
    const first = rows[0];
    assert.equal(first?.kind === "turn" && first.trailing, false);
    const second = rows[1];
    assert.equal(second?.kind === "turn" && second.trailing, true);
  });

  test("shows the skeleton only for an empty loading transcript", () => {
    const empty = transcriptRows({
      loading: true,
      failed: false,
      turns: [],
      landing: [],
      retrying: undefined,
      working: false,
      selections: 0,
    });
    assert.equal(empty[0]?.kind, "skeleton");
    const filled = transcriptRows({
      loading: true,
      failed: false,
      turns: [turn("t1", [user])],
      landing: [],
      retrying: undefined,
      working: false,
      selections: 0,
    });
    assert.equal(filled[0]?.kind, "turn");
  });
});

describe("promptRowCount", () => {
  test("counts landed and in-flight prompts, not records or replies", () => {
    const rows = transcriptRows({
      loading: false,
      failed: false,
      turns: [
        turn("t1", [user, prose("hi")]),
        turn("t2", [prose("continuation")]),
        { kind: "summary", commit: "s1", at: 0, body: { kind: "summary", text: "..." } },
      ],
      landing: [{ key: "p1", content: "again" }],
      retrying: undefined,
      working: true,
      selections: 0,
    });
    assert.equal(promptRowCount(rows), 2);
  });
});

describe("estimateRowSize", () => {
  test("sizes a turn by its parts", () => {
    const only = (parts: TurnPart[]): number =>
      estimateRowSize({ kind: "turn", key: "t", turn: turn("t", parts), trailing: false });
    assert.equal(only([user]), 76);
    assert.equal(only([user, tool]), 76 + 140);
    assert.equal(only([prose("x".repeat(200))]), 40 + 22 * 3);
    assert.equal(only([user, prose("x".repeat(90))]), 76 + 40 + 22);
  });

  test("sizes records, banners, and trailing rows", () => {
    assert.equal(
      estimateRowSize({
        kind: "turn",
        key: "summary:c",
        turn: { kind: "summary", commit: "c", at: 0, body: { kind: "summary", text: "left" } },
        trailing: true,
      }),
      40,
    );
    assert.equal(estimateRowSize({ kind: "landing", key: "l", content: "hi" }), 76);
    assert.equal(estimateRowSize({ kind: "live", key: "live", working: true }), 60);
    assert.equal(estimateRowSize({ kind: "live", key: "live", working: false }), 0);
    assert.equal(estimateRowSize({ kind: "selections", key: "selections", selections: 0 }), 0);
    assert.equal(estimateRowSize({ kind: "selections", key: "selections", selections: 2 }), 240);
    assert.equal(estimateRowSize(undefined), 0);
  });
});
