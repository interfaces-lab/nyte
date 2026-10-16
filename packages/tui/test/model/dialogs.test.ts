import { asId } from "@nyte-ai/schema";
import type { SessionInfo, TreeNode, TreeView } from "@nyte-ai/sdk";
import { describe, expect, test } from "bun:test";
import type { Task } from "../../src/lib/tasks.ts";
import { dialogField, reduceDialog } from "../../src/model/dialogs/dialog.ts";
import type { Dialog } from "../../src/model/dialogs/dialog.ts";
import type { FieldEdit } from "../../src/model/dialogs/field.ts";
import { reduceList, visibleChoices } from "../../src/model/dialogs/list.ts";
import type { ListDialog } from "../../src/model/dialogs/list.ts";
import { rowDraft, visibleModels } from "../../src/model/dialogs/model-picker.ts";
import { treeRows } from "../../src/model/dialogs/tree.ts";
import type { TreeDialog } from "../../src/model/dialogs/tree.ts";
import { deriveScreen } from "../../src/model/screen.ts";
import type { State } from "../../src/model/state.ts";
import { followed, viewOf } from "../fixture/view.ts";
import { play, ready, S1, typed } from "./support.ts";

const idle = viewOf((v) => v.turn("t1", (t) => t.user("hi").text("ok").ended("completed")));

function top(state: State): Dialog | null {
  return deriveScreen(state, null).dialog;
}

function key(name: string) {
  return { kind: "dialog", command: { kind: "key", name } } as const;
}

function list(items: readonly string[], extra: Partial<ListDialog> = {}): ListDialog {
  return {
    kind: "list",
    id: "d",
    purpose: { kind: "palette" },
    title: "t",
    choices: {
      kind: "ready",
      items: items.map((id) => ({
        id,
        label: id,
        description: `${id} description`,
        timing: null,
        status: null,
        mark: null,
      })),
    },
    query: "",
    highlighted: 0,
    answering: null,
    busy: false,
    ...extra,
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

    const info = (id: string, at: number): SessionInfo => ({
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
    });

    const loaded = play(opened.state, {
      kind: "loaded",
      dialog: "dialog-1",
      data: { kind: "sessions", sessions: [info("s1", 1), info("s2", 2)] },
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

function node(
  id: string,
  parent: string | null,
  kind: TreeNode["kind"],
  preview: string,
  active = true,
): TreeNode {
  return {
    id: asId(id),
    parent: parent === null ? null : asId(parent),
    depth: 0,
    branch: false,
    active,
    heads: [],
    kind,
    partKind: kind === "part" ? "text" : null,
    preview,
    at: 1,
    run: null,
  };
}

const TREE: TreeView = {
  revision: asId("rev-7"),
  tip: { kind: "commit", id: asId("c3") },
  nodes: [
    node("c1", null, "user", "first"),
    node("c2", "c1", "part", "answer"),
    node("c3", "c2", "user", "second"),
    node("c4", "c1", "user", "abandoned branch", false),
  ],
};

function treeState(draft = "", view: TreeView = TREE): State {
  const opened = play(ready(idle), typed(draft), {
    kind: "open",
    dialog: { kind: "tree", filter: "default" },
  });
  const tip = view.tip.kind === "commit" ? view.tip.id : null;

  return play(opened.state, {
    kind: "loaded",
    dialog: "dialog-1",
    data: { kind: "tree", tree: { view, tip } },
  }).state;
}

function treeDialog(state: State): TreeDialog | null {
  const dialog = top(state);

  return dialog?.kind === "tree" ? dialog : null;
}

function selectTree(state: State, commit: string): State {
  const dialog = treeDialog(state);
  const rows = dialog === null ? [] : treeRows(dialog);
  const index = rows.findIndex((row) => row.oid === commit);
  const current = rows.findIndex((row) => row.oid === dialog?.selected);
  const presses = (index - current + rows.length) % rows.length;

  return play(state, ...Array.from({ length: presses }, () => key("picker.next"))).state;
}

describe("tree", () => {
  test("opens on the tip; picking a reply at the tip says so", () => {
    const state = treeState("", { ...TREE, tip: { kind: "commit", id: asId("c2") } });

    expect(treeDialog(state)?.selected).toBe(asId<"commit">("c2"));
    expect(play(state, key("picker.accept")).state.local.notice?.text).toBe(
      "Already at that point in the chat",
    );
  });

  test("picking the user message at the tip moves back to edit it", () => {
    const state = treeState();

    expect(treeDialog(state)?.selected).toBe(asId<"commit">("c3"));
    const moved = play(state, key("picker.accept"));

    expect(moved.state.local.notice?.text).not.toBe("Already at that point in the chat");
    expect(moved.effects).toEqual([
      {
        kind: "move",
        session: S1,
        position: { kind: "commit", id: asId("c3") },
        options: { running: "refuse", abandoned: "keep", expect: asId("rev-7") },
        handback: null,
      },
    ]);
    expect(moved.state.local.dialogs).toEqual([]);
  });

  test("a lone user message at the tip can be moved back to edit", () => {
    const moved = play(
      treeState("", {
        revision: asId("rev-1"),
        tip: { kind: "commit", id: asId("u1") },
        nodes: [node("u1", null, "user", "only message")],
      }),
      key("picker.accept"),
    );

    expect(moved.effects).toMatchObject([
      { kind: "move", position: { kind: "commit", id: asId("u1") } },
    ]);
  });

  test("a user message needs an empty composer", () => {
    const state = selectTree(treeState("draft"), "c1");

    expect(play(state, key("picker.accept")).state.local.notice?.text).toBe(
      "Clear the composer before editing a message",
    );
  });

  test("leaving the branch asks for a summary; a typed focus summarizes with it", () => {
    const state = selectTree(treeState(), "c4");
    const asked = play(state, key("picker.accept"));

    expect(top(asked.state)).toMatchObject({
      kind: "list",
      purpose: { kind: "summary", target: "c4" },
    });

    const moved = play(
      asked.state,
      key("picker.previous"),
      { kind: "dialog", command: { kind: "query", text: "the failing test" } },
      key("picker.accept"),
    );

    expect(moved.effects).toEqual([
      {
        kind: "move",
        session: S1,
        position: { kind: "commit", id: asId("c4") },
        options: {
          running: "refuse",
          abandoned: { summarize: { instructions: "the failing test" } },
          expect: asId("rev-7"),
        },
        handback: null,
      },
    ]);
    expect(moved.state.local.dialogs).toEqual([]);
  });

  test("Esc on the summary goes back to the tree at the pick", () => {
    const asked = play(selectTree(treeState(), "c4"), key("picker.accept"), key("picker.close"));

    expect(treeDialog(asked.state)?.selected).toBe(asId("c4"));
  });

  test("moving to a user message hands it back once the view no longer shows it landed", () => {
    const state = selectTree(treeState(), "c1");

    const moving = play(state, key("picker.accept"), {
      kind: "dialog",
      command: { kind: "key", name: "picker.accept" },
    });

    expect(moving.effects[0]).toMatchObject({
      kind: "move",
      position: { kind: "commit", id: "c1" },
    });

    const outcome = play(moving.state, {
      kind: "moved",
      outcome: {
        kind: "moved",
        revision: asId("rev-8"),
        position: { kind: "start" },
        summary: null,
        handback: "first",
      },
      handback: null,
    });

    expect(outcome.state.local.notice?.text).toBe(
      "Message moved back to the composer. Enter sends it again.",
    );
    expect(outcome.state.local.draft.text).toBe("first");
  });

  test("filters toggle, folds and search interact, Ctrl+X copies", () => {
    const state = treeState();

    expect(treeDialog(play(state, key("tree.filter.users")).state)?.filter).toBe("users");
    expect(
      treeDialog(play(state, key("tree.filter.users"), key("tree.filter.users")).state)?.filter,
    ).toBe("default");
    expect(treeDialog(play(state, key("tree.filter.next")).state)?.filter).toBe("no-tools");

    const users = treeDialog(play(state, key("tree.filter.users")).state);

    expect(users === null ? [] : treeRows(users).map((row) => String(row.oid))).toEqual([
      "c1",
      "c3",
      "c4",
    ]);
    expect(play(state, key("tree.copy")).effects).toEqual([{ kind: "copy", text: "second" }]);
  });
});

describe("task inspector", () => {
  const inspector: Dialog = {
    kind: "inspector",
    id: "i",
    task: "c1",
    following: true,
    scroll: null,
  };

  test("scrolling stops following and counts each request; Ctrl+O follows again", () => {
    const up = reduceDialog(inspector, { kind: "key", name: "picker.previous" }).dialog;

    expect(up).toMatchObject({ following: false, scroll: { seq: 1, by: "line-up" } });
    expect(
      up === null ? null : reduceDialog(up, { kind: "key", name: "chat.tools.toggle" }).dialog,
    ).toMatchObject({
      following: true,
      scroll: { seq: 2, by: "bottom" },
    });
    expect(
      up === null ? null : reduceDialog(up, { kind: "key", name: "chat.scroll.latest" }).dialog,
    ).toMatchObject({ following: true, scroll: { seq: 2, by: "bottom" } });
  });

  test("Ctrl+Up/Down step tasks, Ctrl+X stops this one, Esc goes back", () => {
    expect(reduceDialog(inspector, { kind: "key", name: "chat.message.next" }).intents).toEqual([
      { kind: "step-task", dialog: "i", direction: 1 },
    ]);
    expect(reduceDialog(inspector, { kind: "key", name: "chat.task.stop" }).intents).toEqual([
      { kind: "stop-task", task: "c1" },
    ]);
    expect(reduceDialog(inspector, { kind: "key", name: "picker.close" }).dialog).toBeNull();
  });
});

describe("auth", () => {
  test("login runs in a dialog; a link step opens the browser and unblocks Enter/O/C", () => {
    const started = play(ready(idle), {
      kind: "open",
      dialog: { kind: "auth", mode: "login", provider: "test" },
    });

    expect(started.effects).toEqual([{ kind: "login", provider: "test", dialog: "dialog-1" }]);

    const link = play(started.state, {
      kind: "loaded",
      dialog: "dialog-1",
      data: { kind: "auth", step: { kind: "link", url: "https://x.test/auth", code: "ABCD" } },
    });

    expect(link.effects).toEqual([{ kind: "open-external", target: "https://x.test/auth" }]);
    expect(deriveScreen(link.state, null).blocked).toEqual({
      kind: "authenticating",
      link: "https://x.test/auth",
    });
    expect(play(link.state, key("auth.copy")).effects).toEqual([{ kind: "copy", text: "ABCD" }]);
    expect(play(link.state, key("auth.open")).effects).toEqual([
      { kind: "open-external", target: "https://x.test/auth" },
    ]);
  });

  test("a secret step keeps code points, answers once, and Esc cancels", () => {
    const started = play(ready(idle), {
      kind: "open",
      dialog: { kind: "auth", mode: "login", provider: "test" },
    }).state;

    const secret = play(started, {
      kind: "loaded",
      dialog: "dialog-1",
      data: { kind: "auth", step: { kind: "secret", prompt: "API key", masked: true } },
    }).state;

    const answered = play(
      secret,
      { kind: "dialog", command: { kind: "query", text: "sk-1" } },
      key("auth.submit"),
    );

    expect(answered.effects).toEqual([
      { kind: "login-answer", dialog: "dialog-1", answer: "sk-1" },
    ]);
    expect(top(answered.state)).toMatchObject({ step: { kind: "waiting" } });

    expect(play(secret, key("auth.submit")).effects).toEqual([
      { kind: "login-answer", dialog: "dialog-1", answer: "" },
    ]);

    const cancelled = play(secret, key("auth.cancel"));

    expect(cancelled.effects).toEqual([{ kind: "login-answer", dialog: "dialog-1", answer: null }]);
    expect(cancelled.state.local.notice?.text).toBe("Authentication cancelled.");
    expect(deriveScreen(cancelled.state, null).blocked).toBeNull();
  });

  test("without a provider the provider list comes first; finishing closes the dialog", () => {
    const listed = play(ready(idle), {
      kind: "open",
      dialog: { kind: "auth", mode: "login", provider: null },
    });

    expect(top(listed.state)).toMatchObject({
      kind: "list",
      purpose: { kind: "provider", mode: "login" },
      title: "Sign in to a provider",
    });

    const chosen = play(listed.state, key("picker.accept"));

    expect(chosen.effects).toEqual([{ kind: "login", provider: "test", dialog: "dialog-2" }]);

    const done = play(chosen.state, {
      kind: "op-finished",
      op: "auth",
      notice: { tone: "info", text: "Signed in to Test.", at: 0 },
    });

    expect(done.state.local.dialogs).toEqual([]);
    expect(done.state.local.notice?.text).toBe("Signed in to Test.");
  });
});

describe("text panel", () => {
  test("shortcuts are ready at once; scrolling stays inside the lines", () => {
    const opened = play(ready(idle), {
      kind: "open",
      dialog: { kind: "text", content: "shortcuts" },
    }).state;

    const panel = top(opened);

    expect(panel?.kind === "text" && panel.body.kind === "ready" ? panel.body.lines : []).toContain(
      "enter send",
    );
    expect(top(play(opened, key("picker.previous")).state)).toMatchObject({ scroll: 0 });
    expect(top(play(opened, key("picker.next")).state)).toMatchObject({ scroll: 1 });
  });
});

const secret: Dialog = {
  kind: "auth",
  id: "a1",
  mode: "login",
  provider: "test",
  name: "Test",
  link: null,
  step: { kind: "secret", prompt: "Paste your API key", masked: true, codePoints: [] },
};

describe("paste", () => {
  test("clipboard replacement stays with its auth prompt and is discarded after the prompt changes", () => {
    const opened = play(ready(idle), {
      kind: "open",
      dialog: { kind: "auth", mode: "login", provider: "test" },
    }).state;
    const named = play(opened, {
      kind: "loaded",
      dialog: "dialog-1",
      data: { kind: "auth", step: { kind: "secret", prompt: "Account name", masked: false } },
    }).state;
    const requested = play(named, { kind: "paste", source: { kind: "clipboard" } });
    expect(requested.effects).toEqual([
      { kind: "read-dialog-clipboard", dialog: "dialog-1", promptVersion: 1 },
    ]);
    const replaced = play(
      named,
      { kind: "dialog", command: { kind: "query", text: "old" } },
      { kind: "dialog", command: { kind: "edit", edit: { kind: "select-all" } } },
      { kind: "dialog-pasted", dialog: "dialog-1", promptVersion: 1, text: "Personal" },
    ).state;
    expect(field(top(replaced))).toEqual({ text: "Personal", caret: 8 });
    const next = play(replaced, {
      kind: "loaded",
      dialog: "dialog-1",
      data: { kind: "auth", step: { kind: "secret", prompt: "API key", masked: true } },
    }).state;
    const late = play(next, {
      kind: "dialog-pasted",
      dialog: "dialog-1",
      promptVersion: 1,
      text: "wrong-prompt",
    }).state;
    expect(field(top(late))).toEqual({ text: "", caret: 0 });
    expect(late.local.draft.text).toBe("");
    const image = play(next, {
      kind: "dialog-pasted",
      dialog: "dialog-1",
      promptVersion: 2,
      text: null,
    });
    expect(image.effects).toEqual([]);
    expect(image.state).toBe(next);
  });

  test("a paste goes in at the caret as one trimmed line", () => {
    const pasted = reduceDialog(secret, { kind: "paste", text: "sk-key\n" }).dialog;

    expect(pasted === null ? null : dialogField(pasted)).toEqual({ text: "sk-key", caret: 6 });

    const inserted = reduceDialog(list(["a"], { query: "fi", caret: 1 }), {
      kind: "paste",
      text: "nd\r\nme",
    }).dialog;

    expect(field(inserted)).toEqual({ text: "fnd mei", caret: 6 });
  });

  test("a dialog without a typed field, or an empty paste, takes nothing", () => {
    const text: Dialog = {
      kind: "text",
      id: "x",
      title: "Usage",
      body: { kind: "ready", lines: [] },
      scroll: 0,
    };

    expect(reduceDialog(text, { kind: "paste", text: "hello" }).dialog).toBe(text);
    expect(reduceDialog(secret, { kind: "paste", text: "\n" }).dialog).toBe(secret);
  });
});

function edit(dialog: Dialog, ...edits: readonly FieldEdit[]): Dialog | null {
  return edits.reduce<Dialog | null>(
    (current, next) =>
      current === null ? null : reduceDialog(current, { kind: "edit", edit: next }).dialog,
    dialog,
  );
}

function field(dialog: Dialog | null) {
  return dialog === null ? null : dialogField(dialog);
}

describe("typed field", () => {
  test("the caret moves and text goes in where it is; the list filters on the result", () => {
    const moved = edit(
      list(["alpha", "beta"]),
      { kind: "insert", text: "bta" },
      { kind: "move", to: "left" },
      { kind: "move", to: "left" },
      { kind: "insert", text: "e" },
    );

    expect(field(moved)).toEqual({ text: "beta", caret: 2 });
    expect(moved?.kind === "list" ? visibleChoices(moved).map((row) => row.id) : []).toEqual([
      "beta",
    ]);
    expect(field(edit(list(["a"], { query: "one two" }), { kind: "move", to: "home" }))).toEqual({
      text: "one two",
      caret: 0,
    });
  });

  test("word and line deletes act from the caret", () => {
    const words = list(["a"], { query: "find the bug", caret: 8 });

    expect(field(edit(words, { kind: "delete", to: "word-left" }))).toEqual({
      text: "find  bug",
      caret: 5,
    });
    expect(field(edit(words, { kind: "delete", to: "home" }))).toEqual({ text: " bug", caret: 0 });
    expect(field(edit(words, { kind: "delete", to: "end" }))).toEqual({
      text: "find the",
      caret: 8,
    });
  });

  test("a secret is edited by code point and keeps its caret on the step", () => {
    const entered = edit(
      secret,
      { kind: "insert", text: "sk-ky" },
      { kind: "move", to: "left" },
      { kind: "insert", text: "e" },
    );

    expect(entered?.kind === "auth" ? entered.step : null).toMatchObject({
      codePoints: Array.from("sk-key", (character) => character.codePointAt(0)),
      caret: 5,
    });
  });

  test("a whole new text puts the caret at the end", () => {
    const set = reduceDialog(list(["a"], { query: "abc", caret: 1 }), {
      kind: "query",
      text: "xyz",
    }).dialog;

    expect(field(set)).toEqual({ text: "xyz", caret: 3 });
  });

  test("typing in the question panel moves the answer into the composer", () => {
    const asking = viewOf((v) =>
      v
        .turn("t", (t) => t.user("go"))
        .question(
          [
            {
              question: "Which?",
              header: "Question",
              options: [
                { label: "a", description: "" },
                { label: "b", description: "" },
              ],
            },
          ],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const step = play(ready(asking), {
      kind: "dialog",
      command: { kind: "edit", edit: { kind: "insert", text: "abc" } },
    });

    expect(step.state.local.draft).toMatchObject({ text: "abc", cursor: 3 });
    expect(top(step.state)).toBeNull();
    expect(step.effects).toEqual([
      { kind: "composer", op: { kind: "insert", text: "abc", at: "cursor" } },
      { kind: "composer", op: { kind: "focus" } },
    ]);
  });
});
