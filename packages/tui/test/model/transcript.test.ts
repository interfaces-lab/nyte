/**
 * The transcript as identities: rows in drawing order (notes before their
 * turn, shells by start time), turn blocks in view order with the status
 * last, "Worked for" from the turn's own clock, identity kept across frames,
 * and a mount window measured in row weight, anchored by row key.
 */
import { describe, expect, test } from "bun:test";
import { deriveTranscript, turnStatus } from "../../src/model/transcript.ts";
import type { Row } from "../../src/model/transcript.ts";
import type { ShellJob, TranscriptLocal } from "../../src/model/state.ts";
import { mountWindow, revealEarlier, WINDOW } from "../../src/model/window.ts";
import { viewOf } from "../fixture/view.ts";

const LOCAL: TranscriptLocal = {
  following: true,
  window: { kind: "tail" },
  toolOutput: "collapsed",
  disclosures: new Set(),
};

function shell(id: string, startedAt: number): ShellJob {
  return {
    id,
    command: "ls",
    include: true,
    startedAt,
    output: "",
    state: { kind: "running" },
    delivered: false,
  };
}

describe("rows", () => {
  test("turns in view order, notes before their turn, shells by start time; queued messages are not rows", () => {
    const view = viewOf((v) =>
      v
        .turn("t1", (t) => t.at(1_000).user("a").text("b").ended("completed"))
        .turn("t2", (t) =>
          t
            .at(5_000)
            .part("compaction", { tokensBefore: 10, summary: null }, { id: "n1", role: "note" })
            .user("c")
            .text("d")
            .ended("completed"),
        )
        .pending("later", { schedule: { kind: "next-turn", reason: "idle" } }),
    );

    const model = deriveTranscript(view, [shell("s1", 4_000)], LOCAL, null);

    expect(model.rows.map((row) => row.key)).toEqual(["turn:t1", "shell:s1", "note:n1", "turn:t2"]);
    expect([...model.turns.values()].map((turn) => turn.blocks.length)).toEqual([2, 2]);
  });

  test("a turn with nothing landed yet is not a row: an ended one, or a queued message's", () => {
    const view = viewOf((v) =>
      v
        .turn("t1", (t) => t.ended("stopped"))
        .turn("t2", (t) => t.user("x").ended("completed"))
        .pending("queued", { schedule: { kind: "next-turn", reason: "idle" } }),
    );

    expect(deriveTranscript(view, [], LOCAL, null).rows.map((row) => row.key)).toEqual(["turn:t2"]);
  });

  test("a report that landed is a block of its turn, an action shows as its own block", () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) =>
        t
          .report({ child: "s9" }, "Child s9 completed:\nok")
          .action("Fix lint", "prompt")
          .ended("completed"),
      ),
    );

    const model = deriveTranscript(view, [], LOCAL, null);
    const turn = [...model.turns.values()][0];

    expect(turn?.blocks.map((id) => model.messages.get(id)?.kind)).toEqual(["user", "user"]);
  });

  test("unchanged rows and turns keep their identity across frames", () => {
    const view = viewOf((v) => v.turn("t1", (t) => t.user("a").text("b").ended("completed")));
    const first = deriveTranscript(view, [], LOCAL, null);
    const second = deriveTranscript(view, [], LOCAL, first);

    expect(second.rows).toBe(first.rows);
    expect([...second.turns.values()][0]).toBe([...first.turns.values()][0]);
  });
});

describe("turn status", () => {
  test("a settled turn reports Worked for from endedAt - startedAt", () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) => t.at(1_000).user("a").text("b").ended("completed", { endedAt: 4_500 })),
    );

    const [info] = view.turns;

    expect(info === undefined ? null : turnStatus(info, view.messages, view)).toEqual({
      kind: "settled",
      durationMs: 3_500,
      failure: null,
      stopped: false,
    });
  });

  test("a stop reads as an aborted failure", () => {
    const view = viewOf((v) => v.turn("t1", (t) => t.user("a").text("b").ended("stopped")));
    const model = deriveTranscript(view, [], LOCAL, null);

    expect([...model.turns.values()][0]?.status).toMatchObject({
      kind: "settled",
      stopped: true,
      failure: { class: "aborted", message: "Run stopped." },
    });
  });

  test("the live turn shows retrying, thinking or working; a lone prompt before its run is unanswered", () => {
    const thinking = viewOf((v) =>
      v.turn("t1", (t) => t.user("a").thinking("hmm", { live: true })).live(),
    );

    const retrying = viewOf((v) =>
      v.turn("t1", (t) => t.user("a")).retrying("rate limited", 9_000),
    );

    const working = viewOf((v) =>
      v.turn("t1", (t) => t.user("a").activity("Exploring").tool("read", { running: true })).live(),
    );

    const unanswered = viewOf((v) => v.turn("t1", (t) => t.user("a"), { run: undefined }));

    const status = (view: typeof thinking) =>
      [...deriveTranscript(view, [], LOCAL, null).turns.values()][0]?.status;

    expect(status(thinking)).toMatchObject({ kind: "thinking" });
    expect(status(retrying)).toEqual({
      kind: "retrying",
      until: 9_000,
      reason: "rate limited",
      attempt: 0,
    });
    expect(status(working)).toMatchObject({ kind: "working", activity: "Exploring" });
    expect(status(unanswered)?.kind).not.toBe("settled");
  });

  test("a turn waiting on a question says so", () => {
    const view = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("a").waiting("q1"))
        .question("Pick", ["A"], { id: "q1" })
        .waiting("q1"),
    );

    expect([...deriveTranscript(view, [], LOCAL, null).turns.values()][0]?.status).toEqual({
      kind: "waiting",
      question: true,
    });
  });
});

function rows(count: number): readonly Row[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "note" as const,
    key: `note:${String(index)}`,
    message: `m${String(index)}`,
  })).map((row): Row => ({ kind: "shell", key: row.key, job: row.message }));
}

describe("mount window", () => {
  test("the tail mounts the last WINDOW.tail weight of rows", () => {
    const window = mountWindow(rows(100), () => 1, { kind: "tail" });

    expect(window).toEqual({ start: 100 - WINDOW.tail, hidden: 100 - WINDOW.tail });
  });

  test("revealing earlier moves the start back by WINDOW.step and anchors it by key", () => {
    const all = rows(200);
    const tail = mountWindow(all, () => 1, { kind: "tail" });
    const start = revealEarlier(all, () => 1, tail);

    expect(start).toEqual({
      kind: "from",
      key: `note:${String(160 - WINDOW.step)}`,
      index: 160 - WINDOW.step,
    });
    expect(mountWindow(all, () => 1, start).start).toBe(160 - WINDOW.step);
  });

  test("an anchor survives rows inserted before it and falls back to its index when its row vanishes", () => {
    const all = rows(200);
    const start = { kind: "from" as const, key: "note:50", index: 50 };
    const inserted = [{ kind: "shell" as const, key: "shell:x", job: "x" }, ...all];

    expect(mountWindow(inserted, () => 1, start).start).toBe(51);
    expect(
      mountWindow(
        all.filter((row) => row.key !== "note:50"),
        () => 1,
        start,
      ).start,
    ).toBe(50);
  });

  test("the tail always stays mounted", () => {
    expect(mountWindow(rows(50), () => 1, { kind: "from", key: "note:49", index: 49 }).start).toBe(
      10,
    );
  });
});
