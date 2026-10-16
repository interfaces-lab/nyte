import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { getSchema, getTextBetween, getTextSerializersFromSchema } from "@tiptap/core";
import { closeHistory, history, redo, undo } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { MentionFile } from "./message-references.ts";
import {
  clearComposerHistory,
  ComposerDocument,
  ComposerHardBreak,
  ComposerParagraph,
  ComposerReference,
  ComposerText,
  composerCompletion,
  composerReference,
  composerReferences,
  composerReferencesPlugin,
  composerSubmission,
  deleteComposerReference,
  insertComposerReference,
  pasteComposerText,
  readComposerDocument,
  refreshComposerReferences,
  replaceComposerText,
  restoreComposerDocument,
  selectComposerRange,
} from "./composer-document.ts";
import { referenceLabel, referenceText } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";

const file: MentionFile = {
  path: "/project/a file.ts",
  url: "file:///project/a%20file.ts",
  displayPath: "a file.ts",
  label: "a file.ts",
};

const folder: MentionFile = {
  path: "/project/src/",
  url: "file:///project/src/",
  displayPath: "src/",
  label: "src/",
};

const fileReference: MessageReference = { kind: "file", file };

const skillReference: MessageReference = {
  kind: "skill",
  name: "review",
  path: "/home/me/.agents/skills/review/SKILL.md",
};

const schema = getSchema([
  ComposerDocument,
  ComposerParagraph,
  ComposerText,
  ComposerHardBreak,
  ComposerReference,
]);

function selectedText(state: EditorState): string {
  return getTextBetween(state.doc, state.selection, {
    textSerializers: getTextSerializersFromSchema(schema),
  });
}

function composer(files: readonly MentionFile[] = [file, folder]) {
  let catalog: ReadonlyMap<string, MentionFile> = new Map(files.map((each) => [each.url, each]));

  let state = EditorState.create({
    schema,
    plugins: [composerReferencesPlugin(() => catalog), history({ newGroupDelay: 300 })],
  });

  const dispatch = (tr: Transaction): void => {
    state = state.apply(tr);
  };

  const update = (edit: (tr: Transaction) => Transaction): void => dispatch(edit(state.tr));
  const text = () => readComposerDocument(state).text;
  const labels = () => composerReferences(state.doc).map(referenceLabel);

  const restore = (draft: string, caret = draft.length) =>
    update((tr) =>
      restoreComposerDocument(tr, { text: draft, selectionStart: caret, selectionEnd: caret }),
    );

  const discover = (next: readonly MentionFile[]) => {
    catalog = new Map(next.map((each) => [each.url, each]));
    update((tr) => refreshComposerReferences(tr, catalog));
  };

  return {
    get state() {
      return state;
    },
    dispatch,
    update,
    text,
    labels,
    restore,
    discover,
    clearHistory: () => {
      state = clearComposerHistory(state);
    },
  };
}

describe("composer document", () => {
  it("reports collapsed and backward ranges across a long draft with chips, line breaks and emoji", () => {
    const editor = composer();
    const prefix = `Paragraph 👋 ${"long text ".repeat(120)} @${file.url}\n\n`.repeat(24);
    const draft = `${prefix}finish /rev`;
    editor.restore(draft);
    const document = readComposerDocument(editor.state);
    expect(document).toEqual({
      text: draft,
      selectionStart: draft.length,
      selectionEnd: draft.length,
    });
    expect(composerCompletion(editor.state, document.selectionStart)).toEqual({
      kind: "/",
      query: "rev",
      start: prefix.length + "finish ".length,
      end: draft.length,
    });
    expect(composerReferences(editor.state.doc)).toHaveLength(24);
    const start = "Paragraph 👋 ".length;
    const end = prefix.length + "finish".length;
    editor.update((tr) => selectComposerRange(tr, end, start));
    expect(editor.state.selection.head < editor.state.selection.anchor).toBe(true);
    expect(selectedText(editor.state)).toBe(draft.slice(start, end));
    const ranged = readComposerDocument(editor.state);
    expect(ranged).toEqual({ text: draft, selectionStart: start, selectionEnd: end });
    expect(composerCompletion(editor.state, ranged.selectionStart)).toBeUndefined();
    editor.update((tr) => tr.insertText("replacement"));
    expect(readComposerDocument(editor.state)).toEqual({
      text: `${draft.slice(0, start)}replacement${draft.slice(end)}`,
      selectionStart: start + "replacement".length,
      selectionEnd: start + "replacement".length,
    });
    expect(composerReferences(editor.state.doc)).toEqual([]);
  });

  it("counts element carets on either side of chips and trailing line breaks", () => {
    const editor = composer();
    const draft = `👋 @${file.url}\n\n`;
    editor.restore(draft);

    for (const offset of [0, "👋 ".length, "👋 @".length + file.url.length, draft.length]) {
      editor.update((tr) => selectComposerRange(tr, offset));
      expect(readComposerDocument(editor.state)).toEqual({
        text: draft,
        selectionStart: offset,
        selectionEnd: offset,
      });
    }

    editor.restore("");
    expect(readComposerDocument(editor.state)).toEqual({
      text: "",
      selectionStart: 0,
      selectionEnd: 0,
    });
    expect(composerCompletion(editor.state, 0)).toBeUndefined();
  });

  it("places a file at the mention trigger and keeps the surrounding text and canonical URL", () => {
    const editor = composer();
    editor.restore("Compare @a with the old version");
    editor.update((tr) => closeHistory(insertComposerReference(tr, fileReference, 8, 10)));
    expect(editor.text()).toBe(`Compare @${file.url}  with the old version`);
    expect(editor.labels()).toEqual(["a file.ts"]);
    const caret = 8 + file.url.length + 2;
    expect(readComposerDocument(editor.state)).toMatchObject({
      selectionStart: caret,
      selectionEnd: caret,
    });
  });

  it("restores every chip kind from a draft string with the caret where it was left", () => {
    const editor = composer();
    const draft = `Compare @${file.url}\nwith [$review](${skillReference.path}) and @current-conversation now`;
    editor.restore(draft, 8);
    expect(editor.text()).toBe(draft);
    expect(editor.labels()).toEqual(["a file.ts", "/review", "Current conversation"]);
    expect(readComposerDocument(editor.state)).toEqual({
      text: draft,
      selectionStart: 8,
      selectionEnd: 8,
    });
    expect(composerReferences(editor.state.doc)[1]).toEqual(skillReference);
  });

  it("does not complete a token the user is still typing, but does once a delimiter arrives", () => {
    const editor = composer([]);
    editor.restore("");
    editor.update((tr) => tr.insertText("look at @file:///project/new.ts"));
    expect(editor.labels()).toEqual([]);
    editor.update((tr) => tr.insertText(" "));
    expect(editor.labels()).toEqual(["new.ts"]);
    expect(editor.text()).toBe("look at @file:///project/new.ts ");
    const document = readComposerDocument(editor.state);
    expect(document.selectionStart).toBe(document.text.length);
  });

  it("completes a pasted token at once and chips a known file even before its delimiter", () => {
    const editor = composer();
    editor.restore("");
    editor.update((tr) => tr.insertText(`see @${folder.url}`));
    expect(editor.labels()).toEqual(["src/"]);
    editor.update((tr) => pasteComposerText(tr, " @file:///project/x.ts"));
    expect(editor.labels()).toEqual(["src/", "x.ts"]);
  });

  it("copies a selected mention as its URL and removes it atomically with Backspace", () => {
    const editor = composer();
    editor.restore(`use @${file.url} today`);
    editor.update((tr) => selectComposerRange(tr, 4, 5 + file.url.length));
    expect(selectedText(editor.state)).toBe(`@${file.url}`);
    editor.update((tr) => {
      selectComposerRange(tr, 5 + file.url.length);
      assert.ok(deleteComposerReference(tr, -1));

      return closeHistory(tr);
    });
    expect(editor.text()).toBe("use  today");
  });

  it("undoes and redoes a chip insertion as one edit, and forgets history after a restore", () => {
    const editor = composer();
    editor.restore("Compare @a");
    editor.update((tr) => closeHistory(insertComposerReference(tr, fileReference, 8, 10)));
    undo(editor.state, editor.dispatch);
    expect(editor.text()).toBe("Compare @a");
    redo(editor.state, editor.dispatch);
    expect(editor.text()).toBe(`Compare @${file.url} `);
    editor.restore("another pane's draft");
    editor.clearHistory();
    undo(editor.state, editor.dispatch);
    expect(editor.text()).toBe("another pane's draft");
  });

  it.each(["before", "after"])(
    "refreshes discovered file chips with the caret %s the chip",
    (side) => {
      const editor = composer([]);
      const draft = `Review @${file.url} carefully`;
      const caret = side === "before" ? "Review ".length : draft.length;
      editor.restore(draft, caret);
      expect(editor.labels()).toEqual(["a file.ts"]);
      editor.discover([file]);
      expect(editor.text()).toBe(draft);
      expect(composerReferences(editor.state.doc)).toEqual([fileReference]);
      expect(readComposerDocument(editor.state)).toMatchObject({
        selectionStart: caret,
        selectionEnd: caret,
      });
    },
  );

  it("keeps a selected fallback chip deletable after discovery without changing its saved state", () => {
    const editor = composer([]);
    const draft = `Review @${file.url} carefully`;
    editor.restore(draft, "Review ".length);
    editor.update((tr) => selectComposerRange(tr, "Review ".length, `Review @${file.url}`.length));
    const previousState = editor.state;
    const previousNode = previousState.doc.nodeAt(previousState.selection.from);
    assert.ok(previousNode !== null);
    const previousReference = composerReference(previousNode);
    const previousJson = previousNode.toJSON();
    expect(selectedText(previousState)).toBe(`@${file.url}`);
    const discovered = { ...file, label: "Project source", displayPath: "workspace/a file.ts" };
    const reference: MessageReference = { kind: "file", file: discovered };
    expect(previousReference).not.toEqual(reference);
    editor.discover([discovered]);
    expect(editor.text()).toBe(draft);
    expect(composerReferences(editor.state.doc)).toEqual([reference]);
    const node = editor.state.doc.nodeAt(editor.state.selection.from);
    assert.ok(node !== null);
    expect(composerReference(node)).toEqual(reference);
    expect(selectedText(editor.state)).toBe(`@${file.url}`);
    expect(readComposerDocument(previousState).text).toBe(draft);
    expect(composerReferences(previousState.doc)).toEqual([previousReference]);
    expect(composerReference(previousNode)).toEqual(previousReference);
    expect(previousNode.toJSON()).toEqual(previousJson);
    editor.update((tr) => tr.deleteSelection());
    expect(editor.text()).toBe("Review  carefully");
    expect(composerReferences(editor.state.doc)).toEqual([]);
  });

  it("snaps a restored offset inside a chip to its boundary instead of editing its token", () => {
    const editor = composer();
    editor.restore(`Review @${file.url}`, 12);
    expect(readComposerDocument(editor.state)).toMatchObject({
      selectionStart: 8 + file.url.length,
      selectionEnd: 8 + file.url.length,
    });
    editor.update((tr) => tr.insertText(" next"));
    expect(editor.text()).toBe(`Review @${file.url} next`);
  });

  it("keeps the caret across a blank-line, wrapped, and emoji edit without moving it", () => {
    const editor = composer();
    editor.restore("one\n\ntwo 👋 three", 5);
    editor.update((tr) => tr.insertText("x"));
    expect(editor.text()).toBe("one\n\nxtwo 👋 three");
    expect(readComposerDocument(editor.state)).toMatchObject({
      selectionStart: 6,
      selectionEnd: 6,
    });
    const prefix = "one\n\nxtwo ";
    editor.update((tr) => replaceComposerText(tr, prefix.length, prefix.length + "👋".length, ""));
    expect(editor.text()).toBe("one\n\nxtwo  three");
    expect(readComposerDocument(editor.state)).toMatchObject({
      selectionStart: prefix.length,
      selectionEnd: prefix.length,
    });
  });

  it("unwraps a restored clipboard chip to its body on submit", () => {
    const body = "one\ntwo\nthree\nfour";
    const clipboard = { kind: "clipboard", body } as const;
    const token = referenceText(clipboard);
    const editor = composer();
    editor.restore(token);
    expect(editor.labels()).toEqual(["Clipboard (4 lines)"]);
    expect(editor.text()).toBe(token);
    expect(composerSubmission(editor.state.doc)).toEqual({
      text: body,
      references: [clipboard],
    });
  });

  it("opens a completion for a trigger at the caret and never for a file URL", () => {
    const editor = composer();
    const prefix = `see @${file.url} and `;
    editor.restore(`${prefix}/pl`);
    expect(composerCompletion(editor.state)).toEqual({
      kind: "/",
      start: prefix.length,
      end: prefix.length + "/pl".length,
      query: "pl",
    });
    editor.restore("look @file:///project/typing");
    expect(composerCompletion(editor.state)).toBeUndefined();
  });

  it("removes a skill chip with the replaced range", () => {
    const editor = composer();
    editor.restore("Please today");
    editor.update((tr) => insertComposerReference(tr, skillReference, 7, 7));
    expect(editor.text()).toBe(`Please [$review](${skillReference.path}) today`);
    expect(editor.labels()).toEqual(["/review"]);
    editor.update((tr) => replaceComposerText(tr, 0, editor.text().length, "replacement"));
    expect(editor.text()).toBe("replacement");
    expect(editor.labels()).toEqual([]);
  });
});
