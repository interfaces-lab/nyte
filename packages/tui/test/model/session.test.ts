import { asId } from "@nyte-ai/schema";
import { describe, expect, test } from "bun:test";
import { deriveScreen } from "../../src/model/screen.ts";
import { followed, buildView } from "../fixture/view.ts";
import type { ViewBuilder } from "../fixture/view.ts";
import { blank, CATALOG, play, ready, S1, typed } from "./support.ts";

const working = buildView((v) => v.turn("t1", (t) => t.user("hi")).live());

const stopped = buildView((v) =>
  v.turn("t1", (t) => t.user("hi").ended("stopped")).idle({ run: "run-t1", end: "stopped" }),
);

const retracted = buildView((v) => v.idle({ run: "run-t1", end: "stopped" }));

describe("views", () => {
  test("a view for a session we no longer follow is dropped", () => {
    const state = ready(working);
    const next = play(state, { kind: "view", session: asId("s2"), view: retracted });

    expect(next.state).toBe(state);
  });

  test("the first view after a switch ends the switch, announces it and restores that session's draft", () => {
    const state = play(ready(working), typed("half a thought")).state;
    const switched = play(state, { kind: "switch-session", session: asId("s2"), announce: true });

    expect(switched.effects).toContainEqual({ kind: "follow", target: asId("s2"), announce: true });
    expect(switched.state.local.drafts[S1]?.text).toBe("half a thought");
    expect(deriveScreen(switched.state, null).blocked).toEqual({ kind: "switching" });

    const s2 = followed(retracted, "s2");

    const back = play(
      switched.state,
      { kind: "session-opened", session: s2.id, info: s2.info, selection: s2.selection },
      { kind: "view", session: s2.id, view: retracted },
      { kind: "switch-session", session: S1, announce: false },
    );

    const s1 = followed(working);

    const restored = play(
      back.state,
      { kind: "session-opened", session: s1.id, info: s1.info, selection: s1.selection },
      { kind: "view", session: s1.id, view: working },
    );

    expect(restored.effects).toContainEqual({
      kind: "composer",
      op: { kind: "set", draft: { text: "half a thought", parts: new Map() } },
    });
    expect(restored.state.local.pending).toEqual([]);
  });

  test("a queue edit left open in a chat is still open on coming back to it", () => {
    const queued = buildView((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .live()
        .pending(
          "later",
          { schedule: { kind: "next-turn", reason: "requested" } },
          { id: "m2", delivery: "queue" },
        ),
    );

    const editing = play(
      ready(queued),
      { kind: "edit-queued", message: asId("m2") },
      typed("later, edited"),
    ).state;

    expect(editing.local.editing?.message).toBe(asId("m2"));

    const s2 = followed(retracted, "s2");
    const s1 = followed(queued);

    const back = play(
      editing,
      { kind: "switch-session", session: asId("s2"), announce: false },
      { kind: "session-opened", session: s2.id, info: s2.info, selection: s2.selection },
      { kind: "view", session: s2.id, view: retracted },
      { kind: "switch-session", session: S1, announce: false },
      { kind: "session-opened", session: s1.id, info: s1.info, selection: s1.selection },
      { kind: "view", session: s1.id, view: queued },
    );

    expect(back.state.local.editing?.message).toBe(asId("m2"));
    expect(back.state.local.edits).toEqual({});
    expect(back.effects).toContainEqual({
      kind: "composer",
      op: { kind: "set", draft: { text: "later, edited", parts: new Map() } },
    });
  });

  test("an older catalog listing that resolves late is dropped", () => {
    const state = play(blank(), { kind: "catalog", generation: 5, catalog: CATALOG }).state;

    expect(
      play(state, { kind: "catalog", generation: 4, catalog: { ...CATALOG, providers: [] } }).state,
    ).toBe(state);
  });

  test("tasks of another session are dropped", () => {
    const state = ready(working);

    expect(play(state, { kind: "tasks", session: asId("s2"), tasks: [] }).state).toBe(state);
  });
});

function answered(v: ViewBuilder): ViewBuilder {
  return v.turn("t0", (t) => t.user("first").text("ok").ended("completed"));
}

describe("run ended", () => {
  test("a stop with an empty composer retracts the prompt; it lands once the view drops it", () => {
    const later = buildView((v) =>
      answered(v)
        .turn("t1", (t) => t.user("hi"))
        .live(),
    );

    const ended = play(ready(later), {
      kind: "view",
      session: S1,
      view: buildView((v) =>
        answered(v)
          .turn("t1", (t) => t.user("hi").ended("stopped"))
          .idle({ run: "run-t1", end: "stopped" }),
      ),
    });

    expect(ended.effects).toEqual([
      { kind: "refresh-workspace", cwd: "/w" },
      {
        kind: "move",
        session: S1,
        position: { kind: "commit", id: asId("commit-3") },
        options: {},
        handback: null,
      },
    ]);

    const outcome = play(ended.state, {
      kind: "moved",
      outcome: {
        kind: "moved",
        revision: asId("rev-2"),
        position: { kind: "commit", id: asId("commit-2") },
        summary: null,
        handback: "hi",
      },
      handback: null,
    });

    expect(outcome.effects).toEqual([]);
    const dropped = buildView((v) => answered(v).idle({ run: "run-t1", end: "stopped" }));
    const landed = play(outcome.state, { kind: "view", session: S1, view: dropped });

    expect(landed.effects).toContainEqual({
      kind: "composer",
      op: { kind: "set", draft: { text: "hi", parts: new Map() } },
    });
    expect(landed.state.local.notice?.text).toBe("Stopped. Message is back in the composer.");
    expect(landed.state.local.draft.text).toBe("hi");

    const again = play(landed.state, { kind: "view", session: S1, view: dropped });

    expect(again.effects.filter((effect) => effect.kind === "composer")).toEqual([]);
  });

  test("a stop on the chat's first message keeps it: the chat would be empty", () => {
    const ended = play(ready(working), { kind: "view", session: S1, view: stopped });

    expect(ended.effects).toEqual([{ kind: "refresh-workspace", cwd: "/w" }]);
  });

  test("a stop with text in the composer retracts nothing", () => {
    const state = play(ready(working), typed("keep this draft")).state;
    const ended = play(state, { kind: "view", session: S1, view: stopped });

    expect(ended.effects.map((effect) => effect.kind)).toEqual(["refresh-workspace"]);
  });

  test("a failed run says why", () => {
    const failed = buildView((v) =>
      v
        .turn("t1", (t) => t.user("hi").text("x").ended("failed", { failure: "boom" }))
        .idle({ run: "run-t1", end: "failed" }),
    );

    const ended = play(ready(working), { kind: "view", session: S1, view: failed });

    expect(ended.state.local.notice).toMatchObject({ tone: "error", text: "Error: failed" });
  });
});

describe("handbacks", () => {
  test("a refused send waits for an empty composer, then lands exactly once", () => {
    const idle = buildView((v) => v.turn("t1", (t) => t.user("hi").text("ok").ended("completed")));
    const busy = play(ready(idle), typed("something new")).state;

    const refused = play(busy, {
      kind: "send-refused",
      submission: "submission-1",
      reason: "Blocked by plugin",
      snapshot: { text: "my message", parts: new Map() },
    });

    expect(refused.effects).toEqual([]);
    expect(refused.state.local.notice?.text).toBe("Blocked by plugin");

    const emptied = play(refused.state, typed(""));

    expect(emptied.effects).toEqual([
      { kind: "composer", op: { kind: "set", draft: { text: "my message", parts: new Map() } } },
    ]);
    expect(play(emptied.state, typed("")).effects).toEqual([]);
  });

  test("a handback waits while a dialog is open", () => {
    const idle = buildView((v) => v.turn("t1", (t) => t.user("hi").ended("completed")));

    const open = play(ready(idle), {
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "settings", highlight: null } },
    });

    const refused = play(open.state, {
      kind: "send-refused",
      submission: "x",
      reason: "no",
      snapshot: { text: "later", parts: new Map() },
    });

    expect(refused.effects).toEqual([]);
    expect(refused.state.local.handbacks[S1]?.length).toBe(1);
  });
});

describe("editing", () => {
  test("a queued message that lands while being edited ends the edit and keeps the text", () => {
    const queued = buildView((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .live()
        .pending(
          "tweak me",
          { schedule: { kind: "next-turn", reason: "run-ended" } },
          { id: "m9" },
        ),
    );

    const editing = play(
      ready(queued),
      { kind: "edit-queued", message: asId("m9") },
      typed("tweak me more"),
    );

    expect(editing.state.local.editing?.message).toBe(asId("m9"));

    const landedView = buildView((v) =>
      v
        .turn("t1", (t) => t.user("go").text("done").ended("completed"))
        .turn("t2", (t) => t.user("tweak me", { id: "m9" }))
        .live("run-t2"),
    );

    const landed = play(editing.state, { kind: "view", session: S1, view: landedView });

    expect(landed.state.local.editing).toBeNull();
    expect(landed.state.local.draft.text).toBe("tweak me more");
    expect(landed.effects.filter((effect) => effect.kind === "composer")).toEqual([]);
  });
});

describe("questions", () => {
  test("a question that opens while a dialog is up shows once the dialog closes", () => {
    const state = play(ready(working), {
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "settings", highlight: null } },
    }).state;

    const asking = buildView((v) =>
      v
        .turn("t1", (t) => t.user("hi").waiting("q1"))
        .question(
          [
            {
              question: "Pick",
              header: "Question",
              options: [
                { label: "A", description: "" },
                { label: "B", description: "" },
              ],
            },
          ],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const asked = play(state, { kind: "view", session: S1, view: asking }).state;

    expect(deriveScreen(asked, null).dialog).toMatchObject({
      kind: "list",
      purpose: { kind: "settings" },
    });

    const closed = play(asked, { kind: "dialog", command: { kind: "close" } }).state;

    expect(deriveScreen(closed, null).dialog).toMatchObject({
      kind: "list",
      purpose: { kind: "question", part: "q1" },
    });
  });

  test("Esc on the question leaves it open for the composer; Enter on an empty draft reopens it", () => {
    const asking = buildView((v) =>
      v
        .turn("t1", (t) => t.user("hi"))
        .question(
          [
            {
              question: "Pick",
              header: "Question",
              options: [
                { label: "A", description: "" },
                { label: "B", description: "" },
              ],
            },
          ],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const later = play(ready(asking), {
      kind: "dialog",
      command: { kind: "key", name: "picker.close" },
    }).state;

    const screen = deriveScreen(later, null);

    expect(screen.dialog).toBeNull();
    expect(screen.placeholder).toBe("Type an answer, or press Enter to pick one");
    expect(screen.interactions["chat.submit"].intent).toEqual({ kind: "open-question" });
    expect(deriveScreen(play(later, { kind: "open-question" }).state, null).dialog).toMatchObject({
      kind: "list",
    });
  });
});

describe("shell commands", () => {
  test("a finished `!cmd` puts its marker at the front of the draft once", () => {
    const state = ready(working);

    const job = {
      id: "shell-1",
      session: S1,
      command: "echo kept",
      include: true,
      startedAt: 1,
      output: "kept\n",
      state: { kind: "exited", code: 0 },
      delivered: false,
    } as const;

    const first = play(
      state,
      { kind: "shell-job", job: { ...job, state: { kind: "running" } } },
      { kind: "shell-job", job },
    );

    expect(first.effects).toEqual([
      { kind: "composer", op: { kind: "insert", text: "[Shell echo kept] ", at: "start" } },
    ]);
    expect(first.state.local.draft.parts.get("[Shell echo kept]")).toEqual({
      kind: "shell",
      command: "echo kept",
      output: "kept\n",
      exit: 0,
    });
    expect(play(first.state, { kind: "shell-job", job }).effects).toEqual([]);
  });

  test("a `!cmd` from another chat neither shows nor reaches this chat's draft", () => {
    const other = {
      id: "shell-9",
      session: asId<"session">("s9"),
      command: "echo elsewhere",
      include: true,
      startedAt: 1,
      output: "elsewhere\n",
      state: { kind: "exited", code: 0 },
      delivered: false,
    } as const;

    const step = play(ready(working), { kind: "shell-job", job: other });

    expect(step.effects).toEqual([]);
    expect(deriveScreen(step.state, null).welcome).toBe(false);
    expect(
      deriveScreen(step.state, null).transcript.rows.some((row) => row.key.includes("shell-9")),
    ).toBe(false);
  });

  test("a private `!!cmd` or a cancelled one puts nothing in the draft", () => {
    const state = ready(working);
    const base = {
      id: "j",
      session: S1,
      command: "x",
      startedAt: 1,
      output: "",
      delivered: false,
    } as const;

    expect(
      play(
        state,
        { kind: "shell-job", job: { ...base, include: false, state: { kind: "exited", code: 0 } } },
        {
          kind: "shell-job",
          job: { ...base, id: "k", include: true, state: { kind: "cancelled" } },
        },
      ).effects,
    ).toEqual([]);
  });
});

describe("watch", () => {
  test("a failed watch is visible and retried with `follow`", () => {
    const failed = play(ready(working), {
      kind: "watch-ended",
      session: S1,
      failure: "socket closed",
    });

    expect(deriveScreen(failed.state, null).watch).toEqual({ failure: "socket closed" });

    const retried = play(failed.state, { kind: "retry-watch" });

    expect(retried.effects).toEqual([{ kind: "follow", target: S1, announce: false }]);
    expect(deriveScreen(retried.state, null).watch).toBeNull();
    expect(play(retried.state, { kind: "retry-watch" }).effects).toEqual([]);
  });
});
