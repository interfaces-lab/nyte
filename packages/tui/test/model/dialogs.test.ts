import { asId } from "@nyte-ai/schema";
import type { SessionInfo } from "@nyte-ai/sdk";
import { describe, expect, test } from "bun:test";
import type { Task } from "../../src/lib/tasks.ts";
import { reduceList, visibleChoices } from "../../src/model/dialogs/list.ts";
import { rowDraft, visibleModels } from "../../src/model/dialogs/model-picker.ts";
import { deriveScreen } from "../../src/model/screen.ts";
import { followed, viewOf } from "../fixture/view.ts";
import { play, ready, S1, typed } from "./support.ts";
import { idle, top, key, list } from "./dialog-support.ts";

function sessionInfo(id: string, at: number): SessionInfo {
  return {
    ...followed(idle, id).info,
    lastActivityAt: at,
    heads: [
      {
        name: asId("main"),
        tip: { kind: "commit", id: asId("c") },
        stack: null,
        execution: { kind: "idle", lastRun: null },
        unread: false,
      },
    ],
  };
}

describe("the choice list", () => {
  test("filters by every whitespace term over label, description, status and id", () => {
    const dialog = reduceList(list(["alpha", "beta", "gamma"]), {
      kind: "query",
      text: "a desc",
    }).dialog;

    expect(dialog === null ? [] : visibleChoices(dialog).map((choice) => choice.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);

    const narrowed = reduceList(list(["alpha", "beta"]), { kind: "query", text: "be" }).dialog;

    expect(narrowed === null ? [] : visibleChoices(narrowed).map((choice) => choice.id)).toEqual([
      "beta",
    ]);
  });

  test("movement wraps both ways; Esc clears the query before closing", () => {
    const start = list(["a", "b", "c"]);

    expect(reduceList(start, { kind: "key", name: "picker.previous" }).dialog?.highlighted).toBe(2);
    expect(
      reduceList({ ...start, highlighted: 2 }, { kind: "key", name: "picker.next" }).dialog
        ?.highlighted,
    ).toBe(0);
    expect(
      reduceList({ ...start, query: "a" }, { kind: "key", name: "picker.close" }).dialog?.query,
    ).toBe("");
    expect(reduceList(start, { kind: "key", name: "picker.close" }).dialog).toBeNull();
  });

  test("Enter emits `choose` for the highlighted row; the typed row needs text", () => {
    const step = reduceList(
      { ...list(["a", "b"]), highlighted: 1 },
      { kind: "key", name: "picker.accept" },
    );

    expect(step.intents).toEqual([
      { kind: "choose", dialog: "d", choice: "b", typed: null, action: null },
    ]);

    const typedRow = list(["a"], { answering: "", highlighted: 1 });

    expect(reduceList(typedRow, { kind: "key", name: "picker.accept" }).intents).toEqual([]);

    const answered = reduceList(typedRow, { kind: "query", text: "my own" }).dialog;

    expect(
      answered === null ? [] : reduceList(answered, { kind: "key", name: "picker.accept" }).intents,
    ).toEqual([{ kind: "choose", dialog: "d", choice: null, typed: "my own", action: null }]);
  });

  test("Esc clears a typed answer before it closes", () => {
    const typing = list(["a"], { answering: "my own", highlighted: 1 });
    const cleared = reduceList(typing, { kind: "key", name: "picker.close" }).dialog;

    expect(cleared).toMatchObject({ answering: "" });
    expect(
      cleared === null ? "gone" : reduceList(cleared, { kind: "key", name: "picker.close" }).dialog,
    ).toBeNull();
  });

  test("per-row actions exist only for purposes that define them", () => {
    const queueList = list(["m1"], { purpose: { kind: "queue", message: asId("m1") } });

    expect(reduceList(queueList, { kind: "key", name: "chat.queue.delete" }).intents).toEqual([
      { kind: "choose", dialog: "d", choice: "m1", typed: null, action: "chat.queue.delete" },
    ]);
    expect(reduceList(list(["x"]), { kind: "key", name: "chat.queue.delete" }).intents).toEqual([]);
  });
});

describe("accepting a row", () => {
  test("the question panel answers, with a choice or typed words, and steps aside meanwhile", () => {
    const asking = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("hi"))
        .question(
          [
            {
              question: "Pick",
              header: "Question",
              options: [
                { label: "First", description: "" },
                { label: "Second", description: "" },
              ],
            },
          ],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const state = ready(asking);
    const chosen = play(state, key("picker.next"), key("picker.accept"));

    expect(chosen.effects).toEqual([
      { kind: "answer", session: S1, part: asId("q1"), answers: [["Second"]], typed: null },
    ]);
    expect(top(chosen.state)).toBeNull();

    const typing = play(state, { kind: "dialog", command: { kind: "query", text: "Green" } });

    expect(typing.state.local.draft.text).toBe("Green");
    expect(top(typing.state)).toBeNull();
    const intent = deriveScreen(typing.state, null).interactions["chat.submit"].intent;
    const typedAnswer = intent === null ? typing : play(typing.state, intent);

    expect(typedAnswer.effects).toEqual([
      { kind: "composer", op: { kind: "clear" } },
      {
        kind: "answer",
        session: S1,
        part: asId("q1"),
        answers: [["Green"]],
        typed: { session: S1, draft: { text: "Green", parts: new Map() } },
      },
    ]);
  });

  test("grouped questions retain selections through Back and submit one complete group", () => {
    const asking = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .question(
          [
            {
              question: "Pick an approach",
              header: "Approach",
              options: [
                { label: "A", description: "First approach" },
                { label: "B", description: "Second approach" },
              ],
            },
            {
              question: "Pick features",
              header: "Features",
              multiple: true,
              options: [
                { label: "X", description: "Feature X" },
                { label: "Y", description: "Feature Y" },
              ],
            },
            {
              question: "Anything else?",
              header: "Other",
              options: [{ label: "Z", description: "Extra work" }],
            },
          ],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const state = ready(asking);

    const panel = top(state);

    expect(panel).toMatchObject({ title: "1/3 · Pick an approach" });
    expect(
      panel?.kind === "list" && panel.choices.kind === "ready"
        ? panel.choices.items[0]?.description
        : null,
    ).toBe("First approach");

    const chosen = play(state, key("picker.accept"));

    const selected = play(
      chosen.state,
      key("picker.accept"),
      key("picker.next"),
      key("picker.accept"),
    );

    expect(selected.effects).toEqual([]);
    expect(selected.state.local.question.drafts.get(S1)?.get(asId("q1"))).toMatchObject({
      active: 1,
      fields: [
        { kind: "single", selection: { kind: "option", value: "A" } },
        { kind: "multiple", options: ["X", "Y"] },
        { kind: "single", selection: { kind: "empty" } },
      ],
    });

    const next = play(selected.state, { kind: "dialog", command: { kind: "pick", index: 3 } });

    const back = play(next.state, { kind: "dialog", command: { kind: "pick", index: 3 } });

    expect(back.state.local.question.drafts.get(S1)?.get(asId("q1"))).toMatchObject({
      active: 1,
      fields: [
        { kind: "single", selection: { kind: "option", value: "A" } },
        { kind: "multiple", options: ["X", "Y"] },
        { kind: "single", selection: { kind: "empty" } },
      ],
    });

    const last = play(back.state, { kind: "dialog", command: { kind: "pick", index: 3 } });

    const submitted = play(last.state, { kind: "dialog", command: { kind: "pick", index: 2 } });

    expect(submitted.effects).toEqual([
      {
        kind: "answer",
        session: S1,
        part: asId("q1"),
        answers: [["A"], ["X", "Y"], []],
        typed: null,
      },
    ]);
    expect(
      play(submitted.state, {
        kind: "answer",
        session: S1,
        part: asId("q1"),
        value: "Z",
        typed: false,
      }).effects,
    ).toEqual([]);

    const failed = play(submitted.state, {
      kind: "answered",
      request: { session: S1, part: asId("q1") },
      result: { kind: "failed", message: "offline" },
      typed: null,
    });

    expect(failed.state.local.question.drafts.get(S1)?.get(asId("q1"))).toMatchObject({
      fields: [
        { kind: "single", selection: { kind: "option", value: "A" } },
        { kind: "multiple", options: ["X", "Y"] },
        { kind: "single", selection: { kind: "empty" } },
      ],
    });
    expect(
      play(failed.state, { kind: "dialog", command: { kind: "pick", index: 2 } }).effects,
    ).toEqual([
      {
        kind: "answer",
        session: S1,
        part: asId("q1"),
        answers: [["A"], ["X", "Y"], []],
        typed: null,
      },
    ]);
  });

  test("editing custom text after Back preserves an offered option with the same label", () => {
    const asking = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .question(
          [
            {
              question: "Features",
              header: "Features",
              multiple: true,
              options: [
                { label: "X", description: "Feature X" },
                { label: "Y", description: "Feature Y" },
              ],
            },
            {
              question: "Finish?",
              header: "Finish",
              options: [{ label: "Finish", description: "Finish" }],
            },
          ],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const selected = play(ready(asking), { kind: "dialog", command: { kind: "pick", index: 0 } });

    const custom = play(selected.state, typed("X"), {
      kind: "answer",
      session: S1,
      part: asId("q1"),
      value: "X",
      typed: true,
    });

    const back = play(custom.state, { kind: "dialog", command: { kind: "pick", index: 3 } });

    const panel = top(back.state);

    expect(
      panel?.kind === "list" && panel.choices.kind === "ready" ? panel.choices.items[2] : null,
    ).toMatchObject({ label: "Type an answer", description: "X", mark: { glyph: "✓" } });

    const toggled = play(
      back.state,
      { kind: "dialog", command: { kind: "pick", index: 0 } },
      { kind: "dialog", command: { kind: "pick", index: 0 } },
    );

    const typing = play(toggled.state, { kind: "dialog", command: { kind: "query", text: "Z" } });

    const intent = deriveScreen(typing.state, null).interactions["chat.submit"].intent;

    const edited = intent === null ? typing : play(typing.state, intent);

    const submitted = play(edited.state, { kind: "dialog", command: { kind: "pick", index: 0 } });

    expect(submitted.effects).toEqual([
      {
        kind: "answer",
        session: S1,
        part: asId("q1"),
        answers: [["X", "Z"], ["Finish"]],
        typed: null,
      },
    ]);
  });

  test("a parent question preserves an unfinished child's group with the same part id", () => {
    const childView = viewOf((v) =>
      v
        .turn("c", (t) => t.user("go"))
        .question(
          [
            {
              question: "Child first",
              header: "First",
              options: [{ label: "A", description: "First" }],
            },
            {
              question: "Child second",
              header: "Second",
              options: [{ label: "B", description: "Second" }],
            },
          ],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const child: Task = {
      kind: "agent",
      id: asId("c1"),
      info: { ...followed(childView, "c1").info, parent: S1 },
      view: childView,
    };

    const started = play(
      ready(idle),
      { kind: "tasks", session: S1, tasks: [child] },
      { kind: "dialog", command: { kind: "pick", index: 0 } },
    );

    const parent = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("parent"))
        .question(
          [
            {
              question: "Parent question",
              header: "Parent",
              options: [{ label: "P", description: "Parent" }],
            },
          ],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const interrupted = play(started.state, { kind: "view", session: S1, view: parent });

    expect(top(interrupted.state)).toMatchObject({ title: "Parent question" });

    const resumed = play(interrupted.state, { kind: "view", session: S1, view: idle });

    expect(top(resumed.state)).toMatchObject({ title: "2/2 · Subagent c1: Child second" });
    expect(
      play(resumed.state, { kind: "dialog", command: { kind: "pick", index: 0 } }).effects,
    ).toEqual([
      {
        kind: "answer",
        session: asId("c1"),
        part: asId("q1"),
        answers: [["A"], ["B"]],
        typed: null,
      },
    ]);
  });

  test("late answer outcomes release only their own request", () => {
    const old = viewOf((v) =>
      v
        .turn("old", (t) => t.user("go"))
        .question(
          [{ question: "Old", header: "Old", options: [{ label: "A", description: "Old" }] }],
          { id: "q-old" },
        )
        .waiting("q-old"),
    );

    const next = viewOf((v) =>
      v
        .turn("new", (t) => t.user("go"))
        .question(
          [{ question: "New", header: "New", options: [{ label: "A", description: "New" }] }],
          { id: "q-new" },
        )
        .waiting("q-new"),
    );

    const submitted = play(
      ready(old),
      { kind: "dialog", command: { kind: "pick", index: 0 } },
      { kind: "view", session: S1, view: next },
      { kind: "dialog", command: { kind: "pick", index: 0 } },
    );

    expect(submitted.effects).toEqual([
      { kind: "answer", session: S1, part: asId("q-old"), answers: [["A"]], typed: null },
      { kind: "answer", session: S1, part: asId("q-new"), answers: [["A"]], typed: null },
    ]);

    for (const result of [
      { kind: "failed" as const, message: "old request failed" },
      { kind: "accepted" as const },
    ]) {
      const settled = play(submitted.state, {
        kind: "answered",
        request: { session: S1, part: asId("q-old") },
        result,
        typed: null,
      });

      expect(settled.state.local.question.drafts.get(S1)?.get(asId("q-new"))?.phase).toBe(
        "submitting",
      );
      expect(
        play(settled.state, {
          kind: "answer",
          session: S1,
          part: asId("q-new"),
          value: "A",
          typed: false,
        }).effects,
      ).toEqual([]);
    }
  });

  test("settings push a setting's choices; applying pops back to settings on the same row", () => {
    const opened = play(ready(idle), {
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "settings", highlight: null } },
    });

    const theme = play(opened.state, key("picker.next"), key("picker.next"), key("picker.accept"));

    expect(top(theme.state)).toMatchObject({
      purpose: { kind: "setting", key: "theme" },
      title: "Theme",
      highlighted: 1,
    });

    const applied = play(theme.state, key("picker.next"), key("picker.accept"));

    expect(applied.effects).toEqual([{ kind: "write-settings", patch: { theme: "light" } }]);
    expect(top(applied.state)).toMatchObject({ purpose: { kind: "settings" }, highlighted: 2 });
    expect(applied.state.facts.settings.theme).toBe("light");

    const back = play(theme.state, key("picker.close"));

    expect(top(back.state)).toMatchObject({ purpose: { kind: "settings" } });
    expect(top(play(back.state, key("picker.close")).state)).toBeNull();
  });

  test("the model row of settings opens the model picker on top", () => {
    const opened = play(
      ready(idle),
      { kind: "open", dialog: { kind: "list", purpose: { kind: "settings", highlight: null } } },
      key("picker.accept"),
    );

    expect(opened.state.local.dialogs.map((dialog) => dialog.kind)).toEqual(["list", "model"]);
  });

  test("the queue list: Enter sends now, edit and delete close, earlier and later keep it open", () => {
    const queued = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("go"))
        .live()
        .pending("one", { schedule: { kind: "next-turn", reason: "run-ended" } }, { id: "m1" })
        .pending("two", { schedule: { kind: "next-turn", reason: "run-ended" } }, { id: "m2" }),
    );

    const open = play(ready(queued), {
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "queue", message: asId("m2") } },
    }).state;

    expect(top(open)).toMatchObject({ highlighted: 1 });
    expect(play(open, key("picker.accept")).effects).toMatchObject([
      { kind: "revise", message: "m2", delivery: "steer" },
    ]);

    const earlier = play(open, key("chat.queue.up"));

    expect(earlier.effects).toMatchObject([
      { kind: "revise", message: "m2", position: { kind: "before", message: "m1" } },
    ]);
    expect(top(earlier.state)).toMatchObject({ purpose: { kind: "queue" } });

    const deleted = play(open, key("chat.queue.delete"));

    expect(deleted.effects).toEqual([{ kind: "withdraw", session: S1, message: asId("m2") }]);
    expect(top(deleted.state)).toBeNull();
  });

  test("resume loads root sessions, labels the current one, and refuses it", () => {
    const opened = play(ready(idle), {
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "resume", sessions: [] } },
    });

    expect(opened.effects).toEqual([
      { kind: "load", dialog: "dialog-1", request: { kind: "sessions" } },
    ]);

    const loaded = play(opened.state, {
      kind: "loaded",
      dialog: "dialog-1",
      data: { kind: "sessions", sessions: [sessionInfo("s1", 1), sessionInfo("s2", 2)] },
    });

    expect(top(loaded.state)).toMatchObject({
      choices: {
        kind: "ready",
        items: [
          { id: "s2", label: "s2" },
          { id: "s1", label: "s1 (current)" },
        ],
      },
      highlighted: 1,
    });
    expect(play(loaded.state, key("picker.accept")).state.local.notice?.text).toBe("Already in s1");
    expect(play(loaded.state, key("picker.previous"), key("picker.accept")).effects).toContainEqual(
      {
        kind: "follow",
        target: asId("s2"),
        announce: true,
      },
    );
  });

  test("a load for a dialog that closed is dropped", () => {
    const opened = play(
      ready(idle),
      { kind: "open", dialog: { kind: "text", content: "usage" } },
      key("picker.close"),
    ).state;

    expect(
      play(opened, { kind: "loaded", dialog: "dialog-1", data: { kind: "text", lines: ["late"] } })
        .state,
    ).toBe(opened);
  });

  test("the palette runs a command, prefills /cd, and dispatches a key action", () => {
    const palette = play(ready(idle), {
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "palette" } },
    }).state;

    const pick = (query: string) =>
      play(
        palette,
        { kind: "dialog", command: { kind: "query", text: query } },
        key("picker.accept"),
      );

    expect(pick("cmd:usage").effects).toEqual([
      { kind: "load", dialog: "dialog-2", request: { kind: "usage", session: S1 } },
    ]);
    expect(pick("cmd:cd").effects).toEqual([
      { kind: "composer", op: { kind: "insert", text: "/cd ", at: "start" } },
    ]);
    expect(pick("action:chat.thinking.cycle").effects).toMatchObject([
      { kind: "configure", selection: { effort: "high" } },
    ]);
    expect(top(pick("shortcuts").state)).toMatchObject({
      kind: "text",
      title: "Keyboard shortcuts",
    });
  });

  test("the tasks list switches sections, inspects a task and stops one without closing", () => {
    const running = viewOf((v) => v.turn("c", (t) => t.user("go")).live("run-c"));

    const task: Task = {
      kind: "agent",
      id: asId("c1"),
      info: { ...followed(running, "c1").info, parent: S1 },
      view: running,
    };

    const open = play(
      ready(idle),
      { kind: "tasks", session: S1, tasks: [task] },
      {
        kind: "open",
        dialog: { kind: "list", purpose: { kind: "tasks", section: "active" } },
      },
    ).state;

    const finished = play(open, key("picker.next"), key("picker.accept")).state;

    expect(top(finished)).toMatchObject({ title: "Tasks · Finished" });
    expect(top(play(finished, key("picker.close")).state)).toMatchObject({
      purpose: { kind: "tasks", section: "active" },
    });
    expect(top(play(open, key("picker.accept")).state)).toMatchObject({
      kind: "inspector",
      task: "c1",
    });

    const stopped = play(open, key("chat.task.stop"));

    expect(stopped.effects).toEqual([
      { kind: "stop-task", session: S1, task: { kind: "agent", session: asId("c1") } },
    ]);
    expect(top(stopped.state)).toMatchObject({ kind: "list" });
  });
});

describe("model picker", () => {
  test("opens on the current model; Left/Right change effort within the model's levels; Enter configures", () => {
    const opened = play(ready(idle), { kind: "open", dialog: { kind: "model" } });
    const dialog = top(opened.state);

    expect(dialog).toMatchObject({ kind: "model", highlighted: 0 });

    const next = play(opened.state, key("model.next"));
    const picker = top(next.state);
    const row = picker?.kind === "model" ? visibleModels(picker)[1] : undefined;

    expect(picker?.kind === "model" && row !== undefined ? rowDraft(picker, row) : null).toEqual({
      effort: "off",
      fast: false,
    });

    const chosen = play(next.state, key("model.increase"), key("picker.accept"));

    expect(chosen.effects).toContainEqual({
      kind: "configure",
      session: S1,
      selection: { model: { provider: "test", id: "other" }, effort: "high", fast: false },
    });
    expect(chosen.state.local.notice?.text).toBe("Model: test/other · high");
    expect(top(chosen.state)).toBeNull();
  });

  test("Enter on the current model and effort says so and changes nothing", () => {
    const step = play(
      ready(idle),
      { kind: "open", dialog: { kind: "model" } },
      key("picker.accept"),
    );

    expect(step.effects.filter((effect) => effect.kind === "configure")).toEqual([]);
    expect(step.state.local.notice?.text).toBe("Already using test/model · medium");
  });
});
