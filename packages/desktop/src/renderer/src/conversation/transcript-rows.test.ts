import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { TurnPart } from "@nyte-ai/protocol";
import { estimateRowSize, transcriptRows } from "./transcript-rows.ts";
import type { RenderedTurn } from "./transcript-rows.ts";

function turn(id: string, parts: TurnPart[]): RenderedTurn {
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
      landing: [{ key: "outbox:1", content: "next", pending: false }],
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

  test("drops config turns and trails the last turn that renders", () => {
    const rows = transcriptRows({
      loading: false,
      failed: false,
      turns: [
        turn("t1", [user]),
        { kind: "config", commit: "c1", at: 0, body: { kind: "config", agent: "plan" } },
        turn("t2", [prose("reply")]),
        { kind: "config", commit: "c2", at: 0, body: { kind: "config" } },
      ],
      landing: [],
      retrying: undefined,
      working: false,
      selections: 0,
    });
    assert.deepEqual(
      rows.map((row) => row.key),
      ["t1", "t2", "live", "selections"],
    );
    assert.deepEqual(
      rows.filter((row) => row.kind === "turn").map((row) => row.trailing),
      [false, true],
    );
  });

  test("a transcript of only config turns has no turn rows to trail", () => {
    const rows = transcriptRows({
      loading: false,
      failed: false,
      turns: [{ kind: "config", commit: "c1", at: 0, body: { kind: "config" } }],
      landing: [],
      retrying: undefined,
      working: false,
      selections: 0,
    });
    assert.deepEqual(
      rows.map((row) => row.key),
      ["live", "selections"],
    );
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
    // Turns that never reach a row leave the transcript empty, so the skeleton
    // stands in for them rather than the reader seeing nothing at all.
    const configOnly = transcriptRows({
      loading: true,
      failed: false,
      turns: [{ kind: "config", commit: "c1", at: 0, body: { kind: "config" } }],
      landing: [],
      retrying: undefined,
      working: false,
      selections: 0,
    });
    assert.equal(configOnly[0]?.kind, "skeleton");
  });
});

describe("estimateRowSize", () => {
  test("sizes a turn by its parts", () => {
    const only = (parts: TurnPart[]): number =>
      estimateRowSize(
        { kind: "turn", key: "t", turn: turn("t", parts), trailing: false },
        "balanced",
      );
    assert.equal(only([user]), 76);
    assert.equal(only([user, tool]), 76 + 140);
    assert.equal(only([prose("x".repeat(200))]), 40 + 22 * 3);
    assert.equal(only([user, prose("x".repeat(90))]), 76 + 40 + 22);
  });

  test("a work group's guess follows the density", () => {
    const row = { kind: "turn", key: "t", turn: turn("t", [user, tool]), trailing: false } as const;
    assert.equal(estimateRowSize(row, "compact"), 76 + 64);
    assert.equal(estimateRowSize(row, "balanced"), 76 + 140);
    assert.equal(estimateRowSize(row, "detailed"), 76 + 240);
  });

  test("sizes records, banners, and trailing rows", () => {
    assert.equal(
      estimateRowSize(
        {
          kind: "turn",
          key: "summary:c",
          turn: { kind: "summary", commit: "c", at: 0, body: { kind: "summary", text: "left" } },
          trailing: true,
        },
        "balanced",
      ),
      40,
    );
    assert.equal(
      estimateRowSize({ kind: "landing", key: "l", content: "hi", pending: false }, "balanced"),
      76,
    );
    assert.equal(estimateRowSize({ kind: "live", key: "live", working: true }, "balanced"), 60);
    assert.equal(estimateRowSize({ kind: "live", key: "live", working: false }, "balanced"), 0);
    assert.equal(
      estimateRowSize({ kind: "selections", key: "selections", selections: 0 }, "balanced"),
      0,
    );
    assert.equal(
      estimateRowSize({ kind: "selections", key: "selections", selections: 2 }, "balanced"),
      240,
    );
    assert.equal(estimateRowSize(undefined, "balanced"), 0);
  });
});
