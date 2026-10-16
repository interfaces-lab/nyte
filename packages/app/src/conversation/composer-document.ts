import { combineTransactionSteps, Extension, getChangedRanges, Node } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { Fragment } from "@tiptap/pm/model";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import type { Command, Transaction } from "@tiptap/pm/state";
import { Value } from "typebox/value";
import { completionTrigger } from "../view-helpers.ts";
import type { CompletionTrigger } from "../view-helpers.ts";
import type { MentionFile } from "./message-references.ts";
import {
  messageParts,
  messageReferenceSchema,
  referencePromptText,
  referenceText,
} from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";

export const COMPOSER_RESTORE = "composerRestore";

const REFERENCE = "composerReference";

const HARD_BREAK = "hardBreak";

export function composerReference(node: ProseMirrorNode): MessageReference | undefined {
  const reference: unknown = node.attrs["reference"];

  return node.type.name === REFERENCE && Value.Check(messageReferenceSchema, reference)
    ? reference
    : undefined;
}

function draftLeafText(node: ProseMirrorNode): string {
  if (node.type.name === HARD_BREAK) return "\n";
  const reference = composerReference(node);

  return reference === undefined ? "" : referenceText(reference);
}

function promptLeafText(node: ProseMirrorNode): string {
  if (node.type.name === HARD_BREAK) return "\n";
  const reference = composerReference(node);

  return reference === undefined ? "" : referencePromptText(reference);
}

export const ComposerDocument = Node.create({ name: "doc", topNode: true, content: "paragraph" });

export const ComposerParagraph = Node.create<{ readonly HTMLAttributes: Record<string, string> }>({
  name: "paragraph",
  group: "block",
  content: "inline*",
  addOptions: () => ({ HTMLAttributes: {} }),
  parseHTML: () => [{ tag: "p" }],
  renderHTML() {
    return ["p", this.options.HTMLAttributes, 0];
  },
});

export const ComposerText = Node.create({ name: "text", group: "inline" });

export const ComposerHardBreak = Node.create({
  name: HARD_BREAK,
  inline: true,
  group: "inline",
  selectable: false,
  linebreakReplacement: true,
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
  renderText: () => "\n",
});

export const ComposerReference = Node.create({
  name: REFERENCE,
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  addAttributes: () => ({ reference: { default: null, rendered: false } }),
  renderHTML: ({ node }) => ["span", draftLeafText(node)],
  renderText: ({ node }) => draftLeafText(node),
});

export function deleteComposerReference(tr: Transaction, direction: -1 | 1): boolean {
  const cursor = tr.selection instanceof TextSelection ? tr.selection.$cursor : null;
  const node = direction < 0 ? cursor?.nodeBefore : cursor?.nodeAfter;

  if (cursor === null || node?.type.name !== REFERENCE) return false;
  const from = direction < 0 ? cursor.pos - node.nodeSize : cursor.pos;
  tr.delete(from, from + node.nodeSize);

  return true;
}

export const ComposerEditing = Extension.create({
  name: "composerEditing",
  priority: 1000,
  addProseMirrorPlugins: () => [history({ newGroupDelay: 300 })],
  addKeyboardShortcuts() {
    const run = (command: Command) => (): boolean =>
      this.editor.commands.command(({ state, dispatch }) => command(state, dispatch));

    const lineBreak = (): boolean =>
      this.editor.commands.command(({ tr }) => {
        tr.replaceSelectionWith(tr.doc.type.schema.nodes[HARD_BREAK].create()).scrollIntoView();

        return true;
      });

    return {
      Enter: lineBreak,
      "Shift-Enter": lineBreak,
      "Mod-Enter": lineBreak,
      Backspace: () => this.editor.commands.command(({ tr }) => deleteComposerReference(tr, -1)),
      Delete: () => this.editor.commands.command(({ tr }) => deleteComposerReference(tr, 1)),
      "Mod-z": run(undo),
      "Shift-Mod-z": run(redo),
      "Mod-y": run(redo),
    };
  },
});

export interface ComposerDocumentState {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

export function sameComposerDocument(
  left: ComposerDocumentState,
  right: ComposerDocumentState,
): boolean {
  return (
    left.text === right.text &&
    left.selectionStart === right.selectionStart &&
    left.selectionEnd === right.selectionEnd
  );
}

export interface ComposerSubmission {
  /** Provider text: file tokens stay, skill chips become instructions in place, and context mentions drop. */
  readonly text: string;
  readonly references: readonly MessageReference[];
}

export interface ComposerCompletion extends CompletionTrigger {
  readonly start: number;
  readonly end: number;
}

export function composerReferences(doc: ProseMirrorNode): readonly MessageReference[] {
  const references: MessageReference[] = [];
  doc.descendants((node) => {
    const reference = composerReference(node);

    if (reference !== undefined) references.push(reference);
  });

  return references;
}

/** A typed lookalike is text and stays text. */
export function composerSubmission(doc: ProseMirrorNode): ComposerSubmission {
  return {
    text: doc.textBetween(0, doc.content.size, "\n\n", promptLeafText),
    references: composerReferences(doc),
  };
}

function draftOffset(doc: ProseMirrorNode, position: number): number {
  let offset = 0;
  let start = 1;

  for (const child of doc.firstChild?.children ?? []) {
    if (start >= position) break;
    offset +=
      child.text === undefined
        ? draftLeafText(child).length
        : Math.min(child.text.length, position - start);
    start += child.nodeSize;
  }

  return offset;
}

function draftPosition(doc: ProseMirrorNode, offset: number): number {
  let remaining = Math.max(0, offset);
  let position = 1;

  for (const child of doc.firstChild?.children ?? []) {
    const size = child.text === undefined ? draftLeafText(child).length : child.text.length;

    if (remaining < size || (remaining === size && child.text !== undefined))
      return position + (child.text === undefined ? Number(remaining > 0) : remaining);
    remaining -= size;
    position += child.nodeSize;
  }

  return position;
}

export function readComposerDocument(state: EditorState): ComposerDocumentState {
  const { anchor, head } = state.selection;
  const anchorOffset = draftOffset(state.doc, anchor);
  const headOffset = anchor === head ? anchorOffset : draftOffset(state.doc, head);

  return {
    text: state.doc.textBetween(0, state.doc.content.size, "\n\n", draftLeafText),
    selectionStart: Math.min(anchorOffset, headOffset),
    selectionEnd: Math.max(anchorOffset, headOffset),
  };
}

export function composerCompletion(
  state: EditorState,
  caretOffset?: number,
): ComposerCompletion | undefined {
  const cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null;

  if (cursor === null) return undefined;
  const node = cursor.textOffset > 0 ? cursor.parent.child(cursor.index()) : cursor.nodeBefore;

  if (node?.text === undefined) return undefined;
  const offset = cursor.textOffset > 0 ? cursor.textOffset : node.text.length;
  const trigger = completionTrigger(node.text, offset);

  if (trigger === undefined || (trigger.kind === "@" && trigger.query.startsWith("file://")))
    return undefined;
  const start = (caretOffset ?? draftOffset(state.doc, cursor.pos)) - offset;

  return { ...trigger, start: start + trigger.start, end: start + trigger.end };
}

export function selectComposerRange(tr: Transaction, start: number, end = start): Transaction {
  return tr.setSelection(
    TextSelection.create(tr.doc, draftPosition(tr.doc, start), draftPosition(tr.doc, end)),
  );
}

function plainText(line: string): readonly JSONContent[] {
  return line === "" ? [] : [{ type: "text", text: line }];
}

interface ComposerReferenceCatalog {
  readonly files: ReadonlyMap<string, MentionFile>;
  readonly complete: boolean;
}

function referenceContent(
  catalog: ComposerReferenceCatalog,
): (line: string) => readonly JSONContent[] {
  return (line) =>
    messageParts(line, { form: "draft", ...catalog }).map((part) =>
      part.kind === "text"
        ? { type: "text", text: part.text }
        : { type: REFERENCE, attrs: { reference: part.reference } },
    );
}

function draftContent(
  text: string,
  inline: (line: string) => readonly JSONContent[],
): JSONContent[] {
  return text
    .split(/\r?\n/u)
    .flatMap((line, index) => [...(index === 0 ? [] : [{ type: HARD_BREAK }]), ...inline(line)]);
}

export function composerContent(
  text: string,
  files: ReadonlyMap<string, MentionFile>,
): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: draftContent(text, referenceContent({ files, complete: true })),
      },
    ],
  };
}

function insertComposerContent(tr: Transaction, content: readonly JSONContent[]): Transaction {
  const end = tr.doc.content.size - 1;
  const from = Math.min(Math.max(tr.selection.from, 1), end);
  const to = Math.min(Math.max(tr.selection.to, 1), end);
  const fragment = Fragment.fromJSON(tr.doc.type.schema, content);
  tr.replaceWith(from, to, fragment);

  return tr.setSelection(TextSelection.create(tr.doc, from + fragment.size));
}

export function replaceComposerText(
  tr: Transaction,
  start: number,
  end: number,
  text: string,
): Transaction {
  return insertComposerContent(selectComposerRange(tr, start, end), draftContent(text, plainText));
}

export function pasteComposerText(tr: Transaction, text: string): Transaction {
  return insertComposerContent(tr, draftContent(text, plainText)).setMeta("paste", true);
}

export function restoreComposerDocument(
  tr: Transaction,
  document: ComposerDocumentState,
): Transaction {
  tr.replaceWith(
    1,
    tr.doc.content.size - 1,
    Fragment.fromJSON(tr.doc.type.schema, draftContent(document.text, plainText)),
  );
  const end = tr.doc.content.size - 1;
  const position = (offset: number): number => Math.min(1 + Math.max(offset, 0), end);
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      position(document.selectionStart),
      position(document.selectionEnd),
    ),
  );

  return tr.setMeta(COMPOSER_RESTORE, true);
}

export function clearComposerHistory(state: EditorState): EditorState {
  return EditorState.create({ doc: state.doc, selection: state.selection, plugins: state.plugins });
}

export function insertComposerReference(
  tr: Transaction,
  reference: MessageReference,
  start?: number,
  end?: number,
): Transaction {
  if (start !== undefined) selectComposerRange(tr, start, end);

  return insertComposerContent(tr, [
    { type: REFERENCE, attrs: { reference } },
    { type: "text", text: " " },
  ]);
}

function referenceTokens(
  tr: Transaction,
  ranges: readonly { readonly from: number; readonly to: number }[],
  catalog: ComposerReferenceCatalog,
): Transaction {
  const texts = new Map<number, string>();

  for (const { from, to } of ranges) {
    tr.doc.nodesBetween(
      Math.max(0, from - 1),
      Math.min(tr.doc.content.size, to + 1),
      (node, pos) => {
        if (node.text !== undefined) texts.set(pos, node.text);
      },
    );
  }

  const replacements = [...texts]
    .flatMap(([pos, text]) => {
      const content = referenceContent(catalog)(text);

      return content.some((node) => node.type === REFERENCE) ? [{ pos, text, content }] : [];
    })
    .toSorted((left, right) => right.pos - left.pos);

  if (replacements.length === 0) return tr;
  const anchor = draftOffset(tr.doc, tr.selection.anchor);
  const head = draftOffset(tr.doc, tr.selection.head);

  for (const { pos, text, content } of replacements)
    tr.replaceWith(pos, pos + text.length, Fragment.fromJSON(tr.doc.type.schema, content));

  return tr.setSelection(
    TextSelection.create(tr.doc, draftPosition(tr.doc, anchor), draftPosition(tr.doc, head)),
  );
}

export function composerReferencesPlugin(files: () => ReadonlyMap<string, MentionFile>): Plugin {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;

      const complete = transactions.some(
        (transaction) =>
          transaction.getMeta("paste") === true || transaction.getMeta(COMPOSER_RESTORE) === true,
      );

      const ranges = getChangedRanges(combineTransactionSteps(oldState.doc, [...transactions]));

      const tr = referenceTokens(
        newState.tr,
        ranges.map(({ newRange }) => newRange),
        { files: files(), complete },
      );

      return tr.docChanged ? tr : null;
    },
  });
}

export function refreshComposerReferences(
  tr: Transaction,
  files: ReadonlyMap<string, MentionFile>,
): Transaction {
  tr.doc.descendants((node, pos) => {
    const reference = composerReference(node);

    if (reference?.kind !== "file") return;
    const file = files.get(reference.file.url);

    if (file !== undefined && file !== reference.file)
      tr.setNodeMarkup(pos, undefined, { reference: { kind: "file", file } });
  });

  return referenceTokens(tr, [{ from: 0, to: tr.doc.content.size }], {
    files,
    complete: false,
  }).setMeta("addToHistory", false);
}
