import { describe, expect, test } from "bun:test";
import { deriveTranscript, turnStatus } from "../../src/model/transcript.ts";
import type { Row, TranscriptModel, TurnModel } from "../../src/model/transcript.ts";
import type { ShellJob, TranscriptLocal } from "../../src/model/state.ts";
import { mountWindow, revealEarlier, revealLater, WINDOW } from "../../src/model/window.ts";
import { buildView } from "../fixture/view.ts";

const LOCAL: TranscriptLocal = {
  following: true,
  window: { kind: "tail" },
  toolOutput: "collapsed",
  disclosures: new Set(),
};

function turnsIn(model: TranscriptModel): readonly TurnModel[] {
  return model.rows.flatMap((row) => (row.kind === "turn" ? [row.turn] : []));
}

function summary(model: TranscriptModel) {
  return turnsIn(model).map((turn) => ({
    clipped: turn.clipped,
    first: turn.blocks[0]?.kind,
    blocks: turn.blocks.length,
  }));
}

function shell(id: string, startedAt: number): ShellJob {
  return {
    id,
    session: null,
    command: "ls",
    include: true,
    startedAt,
    output: "",
    state: { kind: "running" },
    delivered: false,
  };
}

describe("rows", () => {
  test("a turn the window cut after its prompt starts with that prompt and is marked clipped until the prompt is among the messages", () => {
    const whole = buildView((v) =>
      v.turn("t1", (t) =>
        t.at(1_000).user("ask").text("one").text("two").text("three").ended("completed"),
      ),
    );

    const [prompt, , ...rest] = whole.messages;

    if (prompt?.kind !== "user") throw new Error("The fixture's turn starts with its prompt");
    const cut = { ...whole, messages: rest, leadingPrompt: prompt };

    expect(summary(deriveTranscript(cut, [], LOCAL, null))).toEqual([
      { clipped: true, first: "user", blocks: 3 },
    ]);
    expect(summary(deriveTranscript(whole, [], LOCAL, null))).toEqual([
      { clipped: false, first: "user", blocks: 4 },
    ]);
  });

  test("turns in view order with their notes in place, shells by start time; queued messages are not rows", () => {
    const view = buildView((v) =>
      v
        .turn("t1", (t) => t.at(1_000).user("a").text("b").ended("completed"))
        .turn("t2", (t) =>
          t
            .at(5_000)
            .user("c")
            .text("d")
            .ended("completed")
            .part("compaction", { tokensBefore: 10, summary: null }, { id: "n1", role: "note" }),
        )
        .pending("later", { schedule: { kind: "next-turn", reason: "run-ended" } })
        .live("run-t2"),
    );

    const model = deriveTranscript(view, [shell("s1", 4_000)], LOCAL, null);

    expect(model.rows.map((row) => row.key)).toEqual(["turn:t1", "shell:s1", "turn:t2"]);
    expect(turnsIn(model)[1]?.blocks.map((message) => message.id)).toEqual([
      expect.any(String),
      expect.any(String),
      "n1",
    ]);
  });

  test("a turn with nothing landed yet is not a row: an ended one, or a queued message's", () => {
    const view = buildView((v) =>
      v
        .turn("t1", (t) => t.ended("stopped"))
        .turn("t2", (t) => t.user("x").ended("completed"))
        .pending("queued", { schedule: { kind: "next-turn", reason: "run-ended" } })
        .live("run-t3"),
    );

    expect(deriveTranscript(view, [], LOCAL, null).rows.map((row) => row.key)).toEqual(["turn:t2"]);
  });

  test("a steer is a prompt from its send, and a queued message is not", () => {
    const view = buildView((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .pending("joined", { schedule: { kind: "joined", run: "run-t1" } }, { id: "m1" })
        .unsent("sending", { id: "m2" })
        .unsent("queued", { id: "m3", delivery: "queue" })
        .live(),
    );

    const prompts = deriveTranscript(view, [], LOCAL, null).rows.flatMap((row) =>
      row.kind === "prompt" ? [row.key] : [],
    );

    expect(prompts).toEqual(["prompt:m1", "prompt:m2"]);
  });

  test("a report that landed is a block of its turn, an action shows as its own block", () => {
    const view = buildView((v) =>
      v.turn("t1", (t) =>
        t.report({ child: "s9" }, "ok").action("Fix lint", "prompt").ended("completed"),
      ),
    );

    const model = deriveTranscript(view, [], LOCAL, null);
    const [turn] = turnsIn(model);

    expect(turn?.blocks.map((message) => message.kind)).toEqual(["user", "user"]);
  });

  test("unchanged rows and turns keep their identity across frames", () => {
    const view = buildView((v) => v.turn("t1", (t) => t.user("a").text("b").ended("completed")));
    const first = deriveTranscript(view, [], LOCAL, null);
    const second = deriveTranscript(view, [], LOCAL, first);

    expect(second.rows).toBe(first.rows);
    expect(turnsIn(second)[0]).toBe(turnsIn(first)[0]);
  });
  test("a streaming delta rebuilds only the live turn; settled turns keep their row", () => {
    const view = buildView((v) =>
      v
        .turn("t1", (t) => t.user("a").text("b").ended("completed"))
        .turn("t2", (t) => t.user("c").text("d", { id: "live", live: true }))
        .live(),
    );

    const first = deriveTranscript(view, [], LOCAL, null);

    const streamed = {
      ...view,
      messages: view.messages.map((message) =>
        message.id === "live" && message.kind === "part"
          ? { ...message, state: { markdown: "d e", signature: null } }
          : message,
      ),
    };

    const second = deriveTranscript(streamed, [], LOCAL, first);

    expect(second.rows[0]).toBe(first.rows[0]);
    expect(second.rows[1]).not.toBe(first.rows[1]);
    expect(turnsIn(second)[1]?.blocks.map((message) => message.id)).toEqual([
      expect.any(String),
      "live",
    ]);
  });
});

describe("turn status", () => {
  test("a settled turn reports Worked for from endedAt - startedAt", () => {
    const view = buildView((v) =>
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
    const view = buildView((v) => v.turn("t1", (t) => t.user("a").text("b").ended("stopped")));
    const model = deriveTranscript(view, [], LOCAL, null);

    expect(turnsIn(model)[0]?.status).toMatchObject({
      kind: "settled",
      stopped: true,
      failure: { class: "aborted", message: "Run stopped." },
    });
  });

  test("the live turn shows retrying, thinking or working; a lone prompt before its run is unanswered", () => {
    const thinking = buildView((v) =>
      v.turn("t1", (t) => t.user("a").thinking("hmm", { live: true })).live(),
    );

    const retrying = buildView((v) =>
      v.turn("t1", (t) => t.user("a")).retrying("rate limited", 9_000),
    );

    const working = buildView((v) =>
      v.turn("t1", (t) => t.user("a").activity("Exploring").tool("read", { running: true })).live(),
    );

    const unanswered = buildView((v) => v.turn("t1", (t) => t.user("a"), { run: undefined }));

    const status = (view: typeof thinking) =>
      turnsIn(deriveTranscript(view, [], LOCAL, null))[0]?.status;

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
    const view = buildView((v) =>
      v
        .turn("t1", (t) => t.user("a").waiting("q1"))
        .question(
          [{ question: "Pick", header: "Question", options: [{ label: "A", description: "" }] }],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    expect(turnsIn(deriveTranscript(view, [], LOCAL, null))[0]?.status).toEqual({
      kind: "waiting",
      question: true,
    });
  });
});

function rows(count: number): readonly Row[] {
  return Array.from({ length: count }, (_, index): Row => ({
    kind: "shell",
    key: `note:${String(index)}`,
    job: shell(`m${String(index)}`, index),
  }));
}

describe("mount window", () => {
  test("the tail mounts the last WINDOW.tail weight of rows", () => {
    const window = mountWindow(rows(100), () => 1, { kind: "tail" });

    expect(window).toEqual({ start: 100 - WINDOW.tail, end: 100 });
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

  test("browsing history mounts at most WINDOW.span weight; revealing later moves it forward", () => {
    const all = rows(400);
    const window = mountWindow(all, () => 1, { kind: "from", key: "note:20", index: 20 });

    expect(window).toEqual({ start: 20, end: 20 + WINDOW.span });

    const later = revealLater(all, () => 1, window);

    expect(later).toEqual({
      kind: "from",
      key: `note:${String(20 + WINDOW.step)}`,
      index: 20 + WINDOW.step,
    });
    expect(mountWindow(all, () => 1, later).end).toBe(20 + WINDOW.step + WINDOW.span);
  });

  test("a window that reaches the tail mounts through the last row", () => {
    const all = rows(200);

    expect(mountWindow(all, () => 1, { kind: "from", key: "note:120", index: 120 })).toEqual({
      start: 120,
      end: 200,
    });
  });

  test("an anchor survives rows inserted before it and falls back to its index when its row vanishes", () => {
    const all = rows(200);
    const start = { kind: "from" as const, key: "note:50", index: 50 };
    const inserted: readonly Row[] = [
      { kind: "shell", key: "shell:x", job: shell("x", 0) },
      ...all,
    ];

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
