/**
 * The composer's document, in Lexical. A chip is a node, not a substring: it
 * carries its reference, serializes to that reference's one token, and
 * deletes atomically. The draft string is `$getRoot().getTextContent()` and
 * nothing else, and offsets count that string, so a chip counts for its token
 * and a caret can never rest inside one.
 */
import {
  $addUpdateTag,
  $applyNodeReplacement,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $hasUpdateTag,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  DecoratorNode,
  HISTORY_MERGE_TAG,
  PASTE_TAG,
  SKIP_DOM_SELECTION_TAG,
  TextNode,
} from "lexical";
import type {
  DOMExportOutput,
  LexicalEditor,
  NodeKey,
  PointType,
  SerializedLexicalNode,
} from "lexical";
import { completionTrigger } from "@nyte-ai/core/views";
import type { CompletionTrigger, MentionFile } from "@nyte-ai/core/views";
import { messageParts, referencePromptText, referenceText } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";

/** Marks an update whose text came from outside the editor: a restored draft, a pane switch, a clear. */
export const COMPOSER_EXTERNAL_TAG = "composer-external";

export class ComposerReferenceNode extends DecoratorNode<MessageReference> {
  __reference: MessageReference;

  constructor(reference: MessageReference, key?: NodeKey) {
    super(key);
    this.__reference = reference;
  }

  static getType(): string {
    return "composer-reference";
  }
  static clone(node: ComposerReferenceNode): ComposerReferenceNode {
    return new ComposerReferenceNode(node.__reference, node.__key);
  }
  static importJSON(
    serialized: SerializedLexicalNode & { reference: MessageReference },
  ): ComposerReferenceNode {
    return $applyNodeReplacement(new ComposerReferenceNode(serialized.reference));
  }
  exportJSON(): SerializedLexicalNode & { reference: MessageReference } {
    return { ...super.exportJSON(), reference: this.getReference() };
  }
  createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.contentEditable = "false";
    element.dataset["composerReference"] = this.getReference().kind;
    // Lexical sizes this host before React portals the chip. An empty inline
    // span collapses, and the chip paints outside the composer.
    element.style.display = "inline-block";
    element.style.verticalAlign = "baseline";
    element.style.whiteSpace = "nowrap";
    element.style.maxWidth = "100%";
    return element;
  }
  /** HTML clipboard carries the token, so a paste anywhere reads as the draft did. */
  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.textContent = this.getTextContent();
    return { element };
  }
  updateDOM(): false {
    return false;
  }
  isInline(): true {
    return true;
  }
  isKeyboardSelectable(): true {
    return true;
  }
  getReference(): MessageReference {
    return this.getLatest().__reference;
  }
  setReference(reference: MessageReference): void {
    this.getWritable().__reference = reference;
  }
  getTextContent(): string {
    return referenceText(this.getReference());
  }
  decorate(): MessageReference {
    return this.getReference();
  }
}

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
  readonly text: string;
  readonly references: readonly MessageReference[];
}

export interface ComposerCompletion extends CompletionTrigger {
  readonly start: number;
  readonly end: number;
}

function $inlineNodes() {
  return $getRoot()
    .getChildren()
    .flatMap((block) => ($isElementNode(block) ? block.getChildren() : [block]));
}

export function $composerReferences(): readonly MessageReference[] {
  return $inlineNodes().flatMap((node) =>
    node instanceof ComposerReferenceNode ? [node.getReference()] : [],
  );
}

/** Instructions come from their nodes; a typed lookalike is text and stays text. */
export function $composerSubmission(): ComposerSubmission {
  const text = $getRoot()
    .getChildren()
    .map((block) => {
      if (!$isElementNode(block)) return block.getTextContent();
      return block
        .getChildren()
        .map((node) =>
          node instanceof ComposerReferenceNode
            ? referencePromptText(node.getReference())
            : node.getTextContent(),
        )
        .join("");
    })
    .join("\n\n");
  return { text, references: $composerReferences() };
}

/** Offsets count the draft string, so a chip counts for its token. */
function $pointOffset(point: PointType): number {
  const root = $getRoot();
  const block = root.getFirstChild();
  // Plain-text drafts have one paragraph containing text, line breaks and chips.
  // Count those leaves without allocating a root-to-caret string. Keep Lexical's
  // range semantics for other shapes, whose block separators differ from root text.
  if (root.getChildrenSize() === 1 && $isElementNode(block)) {
    let offset = 0;
    let index = 0;
    let child = block.getFirstChild();
    while (child !== null) {
      if (point.key === block.getKey() && point.offset === index) return offset;
      if (point.key === child.getKey() && $isTextNode(child)) return offset + point.offset;
      if ($isElementNode(child)) break;
      offset += child.getTextContentSize();
      index += 1;
      child = child.getNextSibling();
    }
    if (child === null) {
      if (point.key === block.getKey()) return offset;
      if (point.key === root.getKey()) return point.offset === 0 ? 0 : offset;
    }
  }
  const range = $createRangeSelection();
  range.anchor.set($getRoot().getKey(), 0, "element");
  range.focus.set(point.key, point.offset, point.type);
  return range.getTextContent().length;
}

/** The caret when the document has none yet is its end, where seeding and focus put it. */
export function $composerSelection(): { readonly start: number; readonly end: number } {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    const length = $getRoot().getTextContentSize();
    return { start: length, end: length };
  }
  const anchor = $pointOffset(selection.anchor);
  const focus = selection.isCollapsed() ? anchor : $pointOffset(selection.focus);
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

export function $readComposerDocument(): ComposerDocumentState {
  const selection = $composerSelection();
  return {
    text: $getRoot().getTextContent(),
    selectionStart: selection.start,
    selectionEnd: selection.end,
  };
}

export function $composerCompletion(caretOffset?: number): ComposerCompletion | undefined {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== "text")
    return undefined;
  const trigger = completionTrigger(
    selection.anchor.getNode().getTextContent(),
    selection.anchor.offset,
  );
  if (trigger === undefined || (trigger.kind === "@" && trigger.query.startsWith("file://")))
    return undefined;
  const offset = (caretOffset ?? $pointOffset(selection.anchor)) - selection.anchor.offset;
  return { ...trigger, start: offset + trigger.start, end: offset + trigger.end };
}

/** An offset inside a chip snaps to the chip's boundary; a caret never enters a token. */
function $setPoint(point: PointType, offset: number): void {
  const root = $getRoot();
  const blocks = root.getChildren();
  let remaining = Math.max(0, offset);
  for (const block of blocks) {
    if (!$isElementNode(block)) continue;
    const children = block.getChildren();
    for (const [index, child] of children.entries()) {
      const size = child.getTextContentSize();
      if (remaining < size || (remaining === size && $isTextNode(child))) {
        if ($isTextNode(child)) point.set(child.getKey(), remaining, "text");
        else point.set(block.getKey(), index + Number(remaining > 0), "element");
        return;
      }
      remaining -= size;
    }
    if (remaining <= 0 || block === blocks.at(-1)) {
      point.set(block.getKey(), children.length, "element");
      return;
    }
    remaining -= 2;
  }
  point.set(root.getKey(), root.getChildrenSize(), "element");
}

export function $selectComposerRange(start: number, end = start): void {
  const selection = $createRangeSelection();
  $setPoint(selection.anchor, start);
  $setPoint(selection.focus, end);
  $setSelection(selection);
}

export function $replaceComposerText(start: number, end: number, text: string): void {
  $selectComposerRange(start, end);
  if (text === "") {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.removeText();
    return;
  }
  $getSelection()?.insertRawText(text);
}

/** Replace the whole document with an outside draft. Chips rebuild from its tokens through the reference transform. */
export function $restoreComposerDocument(document: ComposerDocumentState): void {
  $addUpdateTag(COMPOSER_EXTERNAL_TAG);
  $getRoot().clear().append($createParagraphNode());
  $getRoot().selectEnd();
  $getSelection()?.insertRawText(document.text);
  $selectComposerRange(document.selectionStart, document.selectionEnd);
}

export function $insertComposerReference(
  reference: MessageReference,
  start?: number,
  end?: number,
): void {
  if (start !== undefined) $selectComposerRange(start, end);
  const selection = $getSelection();
  if (selection === null) $getRoot().selectEnd();
  $getSelection()?.insertNodes([
    $applyNodeReplacement(new ComposerReferenceNode(reference)),
    $createTextNode(" "),
  ]);
}

interface ComposerReferenceCatalog {
  /** Workspace entries; a known file keeps its workspace label and relative path. */
  readonly files: readonly MentionFile[];
}

/**
 * Turn tokens into chips as they arrive: pasted or restored text completes at
 * once, typed text only when a delimiter closes the token. The draft string
 * does not change, so offsets survive and the caret stays where it was.
 */
export function registerComposerReferences(
  editor: LexicalEditor,
  catalog: ComposerReferenceCatalog,
): () => void {
  const files = new Map(catalog.files.map((file) => [file.url, file]));
  const unregister = editor.registerNodeTransform(TextNode, (node) => {
    const parts = messageParts(node.getTextContent(), {
      form: "draft",
      files,
      complete: $hasUpdateTag(PASTE_TAG) || $hasUpdateTag(COMPOSER_EXTERNAL_TAG),
    });
    if (!parts.some((part) => part.kind === "reference")) return;
    const selection = $getSelection();
    const offsets = $isRangeSelection(selection) ? $composerSelection() : undefined;
    const nodes = parts.map((part) =>
      part.kind === "text"
        ? $createTextNode(part.text)
        : $applyNodeReplacement(new ComposerReferenceNode(part.reference)),
    );
    const first = nodes[0];
    if (first === undefined) return;
    node.replace(first);
    let previous = first;
    for (const next of nodes.slice(1)) {
      previous.insertAfter(next);
      previous = next;
    }
    if (offsets !== undefined) $selectComposerRange(offsets.start, offsets.end);
  });
  // A catalog that arrives after the draft re-reads it. Only a focused editor may touch the DOM selection.
  const root = editor.getRootElement();
  editor.update(
    () => {
      // Restored URLs may already be chips before the workspace catalog arrives.
      for (const node of $inlineNodes()) {
        if (!(node instanceof ComposerReferenceNode)) continue;
        const reference = node.getReference();
        if (reference.kind !== "file") continue;
        const file = files.get(reference.file.url);
        if (file === undefined || file === reference.file) continue;
        node.setReference({ kind: "file", file });
      }
      for (const node of $getRoot().getAllTextNodes()) node.markDirty();
    },
    {
      discrete: true,
      tag:
        root !== null && root.ownerDocument.activeElement === root
          ? HISTORY_MERGE_TAG
          : [HISTORY_MERGE_TAG, SKIP_DOM_SELECTION_TAG],
    },
  );
  return unregister;
}
