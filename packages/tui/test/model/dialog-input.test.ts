import { describe, expect, test } from "bun:test";
import { dialogField, reduceDialog } from "../../src/model/dialogs/dialog.ts";
import type { Dialog } from "../../src/model/dialogs/dialog.ts";
import type { FieldEdit } from "../../src/model/dialogs/field.ts";
import { visibleChoices } from "../../src/model/dialogs/list.ts";
import { deriveScreen } from "../../src/model/screen.ts";
import { buildView } from "../fixture/view.ts";
import { play, ready } from "./support.ts";
import { idle, top, key, list } from "./dialog-support.ts";

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
    const asking = buildView((v) =>
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
