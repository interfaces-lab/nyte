import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { TurnPart } from "@nyte-ai/protocol";
import { transcriptRows } from "./transcript-rows.ts";
import type { RenderedTurn } from "./transcript-rows.ts";

function turn(id: string, parts: TurnPart[]): RenderedTurn {
  return { kind: "turn", id, parts, startedAt: 0, durationMs: 0 };
}

const user: TurnPart = { kind: "user", commit: "u1", parent: null, content: "hello" };
const prose = (text: string): TurnPart => ({
  kind: "assistant",
  commit: "a1",
  contentIndex: 0,
  text,
});

describe("transcriptRows", () => {
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
      rows.map((row) => row.kind),
      ["turn", "turn", "live", "selections"],
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
      rows.map((row) => row.kind),
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
