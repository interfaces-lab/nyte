/**
 * Dialogs as explicit state machines: the one list (filter, wrap, typed
 * row, per-row actions), accepting per purpose (settings push and pop back,
 * the queue's actions, the tree's summary step), the model picker, the
 * tree, the task inspector, the auth steps and the text panel. Loads are
 * addressed by dialog id, so a closed dialog never receives one.
 */
import { asId } from "@nyte-ai/schema";
import type { SessionInfo, TreeNode, TreeView } from "@nyte-ai/sdk";
import { describe, expect, test } from "bun:test";
import type { Task } from "../../src/lib/tasks.ts";
import { reduceDialog } from "../../src/model/dialogs/dialog.ts";
import type { Dialog } from "../../src/model/dialogs/dialog.ts";
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
        .question("Pick", ["First", "Second"], { id: "q1" })
        .waiting("q1"),
    );

    const state = ready(asking);
    const chosen = play(state, key("picker.next"), key("picker.accept"));

    expect(chosen.effects).toEqual([
      { kind: "answer", session: S1, part: asId("q1"), choice: "Second", typed: null },
    ]);
    expect(top(chosen.state)).toBeNull();

    const typedAnswer = play(
      state,
      key("picker.previous"),
      { kind: "dialog", command: { kind: "query", text: "Green" } },
      key("picker.accept"),
    );

    expect(typedAnswer.effects).toEqual([
      { kind: "answer", session: S1, part: asId("q1"), choice: "Green", typed: null },
    ]);
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

    expect(top(play(open, key("picker.next"), key("picker.accept")).state)).toMatchObject({
      title: "Tasks · Finished",
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

function treeState(draft = ""): State {
  const opened = play(ready(idle), typed(draft), {
    kind: "open",
    dialog: { kind: "tree", filter: "default" },
  });

  return play(opened.state, {
    kind: "loaded",
    dialog: "dialog-1",
    data: { kind: "tree", tree: { view: TREE, tip: asId<"commit">("c3") } },
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
  test("opens on the tip; picking the tip says so", () => {
    const state = treeState();

    expect(treeDialog(state)?.selected).toBe(asId<"commit">("c3"));
    expect(play(state, key("picker.accept")).state.local.notice?.text).toBe(
      "Already at that point in the chat",
    );
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
