import assert from "node:assert/strict";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { registerPlainText } from "@lexical/plain-text";
import {
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  createEditor,
  DELETE_CHARACTER_COMMAND,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  PASTE_TAG,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import type { MentionFile } from "@nyte-ai/client";
import {
  $composerCompletion,
  $composerReferences,
  $composerSelection,
  $composerSubmission,
  $insertComposerReference,
  $readComposerDocument,
  $replaceComposerText,
  $restoreComposerDocument,
  $selectComposerRange,
  ComposerReferenceNode,
  registerComposerReferences,
} from "./composer-document.ts";
import { CONVERSATION_MENTION, referenceLabel, referenceText } from "./message-references.ts";
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
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function composer(files: readonly MentionFile[] = [file, folder]) {
  const editor = createEditor({
    namespace: "composer-test",
    nodes: [ComposerReferenceNode],
    onError: (error) => {
      throw error;
    },
  });
  cleanups.push(
    registerPlainText(editor),
    registerHistory(editor, createEmptyHistoryState(), 300),
    registerComposerReferences(editor, { files }),
  );
  const text = () => editor.getEditorState().read(() => $getRoot().getTextContent());
  const labels = () =>
    editor.getEditorState().read(() => $composerReferences().map(referenceLabel));
  const restore = (draft: string, caret = draft.length) =>
    editor.update(
      () => $restoreComposerDocument({ text: draft, selectionStart: caret, selectionEnd: caret }),
      { discrete: true, tag: HISTORY_MERGE_TAG },
    );
  return { editor, text, labels, restore };
}

describe("composer document", () => {
  it("reports collapsed and backward ranges across a long draft with chips, line breaks and emoji", () => {
    const { editor, restore } = composer();
    const prefix = `Paragraph 👋 ${"long text ".repeat(120)} @${file.url}\n\n`.repeat(24);
    const draft = `${prefix}finish /rev`;
    restore(draft);
    editor.getEditorState().read(() => {
      const document = $readComposerDocument();
      expect(document).toEqual({
        text: draft,
        selectionStart: draft.length,
        selectionEnd: draft.length,
      });
      expect($composerCompletion(document.selectionStart)).toEqual({
        kind: "/",
        query: "rev",
        start: prefix.length + "finish ".length,
        end: draft.length,
      });
      expect($composerReferences()).toHaveLength(24);
    });
    const start = "Paragraph 👋 ".length;
    const end = prefix.length + "finish".length;
    editor.update(() => $selectComposerRange(end, start), { discrete: true });
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      assert.ok($isRangeSelection(selection));
      expect(selection.isBackward()).toBe(true);
      expect(selection.getTextContent()).toBe(draft.slice(start, end));
      const document = $readComposerDocument();
      expect(document).toEqual({ text: draft, selectionStart: start, selectionEnd: end });
      expect($composerCompletion(document.selectionStart)).toBeUndefined();
    });
    editor.update(() => $getSelection()?.insertText("replacement"), { discrete: true });
    editor.getEditorState().read(() => {
      expect($readComposerDocument()).toEqual({
        text: `${draft.slice(0, start)}replacement${draft.slice(end)}`,
        selectionStart: start + "replacement".length,
        selectionEnd: start + "replacement".length,
      });
      expect($composerReferences()).toEqual([]);
    });
  });

  it("counts element carets on either side of chips and trailing line breaks", () => {
    const { editor, restore } = composer();
    const draft = `👋 @${file.url}\n\n`;
    restore(draft);
    for (const offset of [0, "👋 ".length, "👋 @".length + file.url.length, draft.length]) {
      editor.update(() => $selectComposerRange(offset), { discrete: true });
      editor.getEditorState().read(() => {
        expect($readComposerDocument()).toEqual({
          text: draft,
          selectionStart: offset,
          selectionEnd: offset,
        });
      });
    }
    restore("");
    editor.getEditorState().read(() => {
      expect($composerSelection()).toEqual({ start: 0, end: 0 });
      expect($composerCompletion(0)).toBeUndefined();
    });
  });

  it("places a file at the mention trigger and keeps the surrounding text and canonical URL", () => {
    const { editor, text, labels, restore } = composer();
    restore("Compare @a with the old version");
    editor.update(() => $insertComposerReference(fileReference, 8, 10), {
      discrete: true,
      tag: HISTORY_PUSH_TAG,
    });
    expect(text()).toBe(`Compare @${file.url}  with the old version`);
    expect(labels()).toEqual(["a file.ts"]);
    editor.getEditorState().read(() => {
      expect($composerSelection()).toEqual({
        start: 8 + file.url.length + 2,
        end: 8 + file.url.length + 2,
      });
    });
  });

  it("restores every chip kind from a draft string with the caret where it was left", () => {
    const { editor, text, labels, restore } = composer();
    const draft = `Compare @${file.url}\nwith [$review](${skillReference.path}) and @current-conversation now`;
    restore(draft, 8);
    expect(text()).toBe(draft);
    expect(labels()).toEqual(["a file.ts", "/review", "Current conversation"]);
    editor.getEditorState().read(() => {
      expect($readComposerDocument()).toEqual({
        text: draft,
        selectionStart: 8,
        selectionEnd: 8,
      });
      expect($composerReferences()[1]).toEqual(skillReference);
    });
  });

  it("does not complete a token the user is still typing, but does once a delimiter arrives", () => {
    const { editor, text, labels, restore } = composer([]);
    restore("");
    editor.update(() => $getSelection()?.insertText("look at @file:///project/new.ts"), {
      discrete: true,
    });
    expect(labels()).toEqual([]);
    editor.update(() => $getSelection()?.insertText(" "), { discrete: true });
    expect(labels()).toEqual(["new.ts"]);
    expect(text()).toBe("look at @file:///project/new.ts ");
    editor.getEditorState().read(() => {
      const document = $readComposerDocument();
      expect(document.selectionStart).toBe(document.text.length);
    });
  });

  it("completes a pasted token at once and chips a known file even before its delimiter", () => {
    const { editor, labels, restore } = composer();
    restore("");
    editor.update(() => $getSelection()?.insertText(`see @${folder.url}`), { discrete: true });
    expect(labels()).toEqual(["src/"]);
    editor.update(() => $getSelection()?.insertText(" @file:///project/x.ts"), {
      discrete: true,
      tag: PASTE_TAG,
    });
    expect(labels()).toEqual(["src/", "x.ts"]);
  });

  it("reads a submission whose text keeps file tokens and drops instruction tokens", () => {
    const { editor, restore } = composer();
    restore(`fix @${file.url} with [$review](${skillReference.path}) @current-conversation`);
    editor.getEditorState().read(() => {
      const submission = $composerSubmission();
      expect(submission.text).toBe(`fix @${file.url} with  `);
      expect(submission.references).toEqual([fileReference, skillReference, CONVERSATION_MENTION]);
    });
  });

  it("copies a selected mention as its URL and removes it atomically with Backspace", () => {
    const { editor, text, restore } = composer();
    restore(`use @${file.url} today`);
    editor.update(() => $selectComposerRange(4, 5 + file.url.length), { discrete: true });
    editor
      .getEditorState()
      .read(() => expect($getSelection()?.getTextContent()).toBe(`@${file.url}`));
    editor.update(
      () => {
        $selectComposerRange(5 + file.url.length);
        editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true);
      },
      { discrete: true, tag: HISTORY_PUSH_TAG },
    );
    expect(text()).toBe("use  today");
  });

  it("selects a chip as a whole when the caret steps onto it", () => {
    const { editor, restore } = composer();
    restore(`use @${file.url} today`, 4);
    editor.update(
      () => {
        $selectComposerRange(4);
        const selection = $getSelection();
        assert.ok($isRangeSelection(selection));
        selection.modify("move", false, "character");
      },
      { discrete: true },
    );
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isNodeSelection(selection)).toBe(true);
      expect(selection?.getTextContent()).toBe(`@${file.url}`);
    });
  });

  it("undoes and redoes a chip insertion as one edit, and forgets history after a restore", () => {
    const { editor, text, restore } = composer();
    restore("Compare @a");
    editor.update(() => $insertComposerReference(fileReference, 8, 10), {
      discrete: true,
      tag: HISTORY_PUSH_TAG,
    });
    editor.dispatchCommand(UNDO_COMMAND, undefined);
    editor.read(() => undefined);
    expect(text()).toBe("Compare @a");
    editor.dispatchCommand(REDO_COMMAND, undefined);
    editor.read(() => undefined);
    expect(text()).toBe(`Compare @${file.url} `);
    restore("another pane's draft");
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    editor.dispatchCommand(UNDO_COMMAND, undefined);
    editor.read(() => undefined);
    expect(text()).toBe("another pane's draft");
  });

  it.each(["before", "after"])(
    "refreshes discovered file chips with the caret %s the chip",
    (side) => {
      const { editor, text, labels, restore } = composer([]);
      const draft = `Review @${file.url} carefully`;
      const caret = side === "before" ? "Review ".length : draft.length;
      restore(draft, caret);
      expect(labels()).toEqual(["a file.ts"]);
      cleanups.push(registerComposerReferences(editor, { files: [file] }));
      editor.read(() => undefined);
      expect(text()).toBe(draft);
      editor.getEditorState().read(() => {
        expect($composerReferences()).toEqual([fileReference]);
        expect($composerSelection()).toEqual({ start: caret, end: caret });
      });
    },
  );

  it("keeps a selected fallback chip deletable after discovery without changing its saved state", () => {
    const { editor, text, restore } = composer([]);
    const draft = `Review @${file.url} carefully`;
    restore(draft, "Review ".length);
    editor.update(
      () => {
        const selection = $getSelection();
        assert.ok($isRangeSelection(selection));
        selection.modify("move", false, "character");
      },
      { discrete: true },
    );
    const previousState = editor.getEditorState();
    const previous = previousState.read(() => {
      const selection = $getSelection();
      assert.ok($isNodeSelection(selection));
      const node = selection.getNodes()[0];
      assert.ok(node instanceof ComposerReferenceNode);
      expect(selection.getTextContent()).toBe(`@${file.url}`);
      return { node, reference: node.decorate(), json: node.exportJSON() };
    });
    const discovered = { ...file, label: "Project source", displayPath: "workspace/a file.ts" };
    const reference: MessageReference = { kind: "file", file: discovered };
    expect(previous.reference).not.toEqual(reference);
    cleanups.push(registerComposerReferences(editor, { files: [discovered] }));
    expect(text()).toBe(draft);
    editor.getEditorState().read(() => {
      expect($composerReferences()).toEqual([reference]);
      const selection = $getSelection();
      assert.ok($isNodeSelection(selection));
      expect(selection.has(previous.node.getKey())).toBe(true);
      expect(selection.getNodes()).toHaveLength(1);
      expect(selection.getTextContent()).toBe(`@${file.url}`);
      expect(previous.node.decorate()).toEqual(reference);
      expect(previous.node.exportJSON().reference).toEqual(reference);
    });
    previousState.read(() => {
      expect($getRoot().getTextContent()).toBe(draft);
      expect($composerReferences()).toEqual([previous.reference]);
      expect(previous.node.decorate()).toEqual(previous.reference);
      expect(previous.node.exportJSON()).toEqual(previous.json);
    });
    editor.update(
      () => {
        const selection = $getSelection();
        assert.ok($isNodeSelection(selection));
        selection.deleteNodes();
      },
      { discrete: true },
    );
    expect(text()).toBe("Review  carefully");
    editor.getEditorState().read(() => expect($composerReferences()).toEqual([]));
  });

  it("snaps a restored offset inside a chip to its boundary instead of editing its token", () => {
    const { editor, text, restore } = composer();
    restore(`Review @${file.url}`, 12);
    editor.getEditorState().read(() =>
      expect($composerSelection()).toEqual({
        start: 8 + file.url.length,
        end: 8 + file.url.length,
      }),
    );
    editor.update(() => $getSelection()?.insertText(" next"), { discrete: true });
    expect(text()).toBe(`Review @${file.url} next`);
  });

  it("keeps the caret across a blank-line, wrapped, and emoji edit without moving it", () => {
    const { editor, text, restore } = composer();
    restore("one\n\ntwo 👋 three", 5);
    editor.update(() => $getSelection()?.insertText("x"), { discrete: true });
    expect(text()).toBe("one\n\nxtwo 👋 three");
    editor.getEditorState().read(() => expect($composerSelection()).toEqual({ start: 6, end: 6 }));
    const prefix = "one\n\nxtwo ";
    editor.update(() => $replaceComposerText(prefix.length, prefix.length + "👋".length, ""), {
      discrete: true,
    });
    expect(text()).toBe("one\n\nxtwo  three");
    editor
      .getEditorState()
      .read(() =>
        expect($composerSelection()).toEqual({ start: prefix.length, end: prefix.length }),
      );
  });

  it("unwraps a restored clipboard chip to its body on submit", () => {
    const body = "one\ntwo\nthree\nfour";
    const clipboard = { kind: "clipboard", body } as const;
    const token = referenceText(clipboard);
    const { editor, labels, restore } = composer();
    restore(token);
    expect(labels()).toEqual(["Clipboard (4 lines)"]);
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe(token);
      expect($composerSubmission()).toEqual({
        text: body,
        references: [clipboard],
      });
    });
  });

  it("opens a completion for a trigger at the caret and never for a file URL", () => {
    const { editor, restore } = composer();
    const prefix = `see @${file.url} and `;
    restore(`${prefix}/pl`);
    editor.getEditorState().read(() =>
      expect($composerCompletion()).toEqual({
        kind: "/",
        start: prefix.length,
        end: prefix.length + "/pl".length,
        query: "pl",
      }),
    );
    restore("look @file:///project/typing");
    editor.getEditorState().read(() => expect($composerCompletion()).toBeUndefined());
  });

  it("removes a skill chip with the replaced range and keeps its instruction only while present", () => {
    const { editor, text, labels, restore } = composer();
    restore("Please today");
    editor.update(() => $insertComposerReference(skillReference, 7, 7), { discrete: true });
    expect(text()).toBe(`Please [$review](${skillReference.path}) today`);
    expect(labels()).toEqual(["/review"]);
    editor.getEditorState().read(() => expect($composerSubmission().text).toBe("Please  today"));
    editor.update(() => $replaceComposerText(0, text().length, "replacement"), { discrete: true });
    expect(text()).toBe("replacement");
    expect(labels()).toEqual([]);
  });
});
