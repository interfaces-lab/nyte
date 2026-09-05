import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  $setSelection,
  DecoratorNode,
} from "lexical";
import type { LexicalNode, NodeKey, PointType, SerializedLexicalNode } from "lexical";
import type { MentionFile } from "@nyte-ai/core/views";
import type { ComposerChip } from "./composer.tsx";

/** Drafts and clipboard keep file URLs; only the editor renders compact labels. */
export class ComposerMentionNode extends DecoratorNode<ComposerChip> {
  readonly __chip: ComposerChip;

  constructor(chip: ComposerChip, key?: NodeKey) {
    super(key);
    this.__chip = chip;
  }

  static getType(): string {
    return "composer-mention";
  }
  static clone(node: ComposerMentionNode): ComposerMentionNode {
    return new ComposerMentionNode(node.__chip, node.__key);
  }
  static importJSON(
    serialized: SerializedLexicalNode & { chip: ComposerChip },
  ): ComposerMentionNode {
    return $applyNodeReplacement(new ComposerMentionNode(serialized.chip));
  }
  exportJSON(): SerializedLexicalNode & { chip: ComposerChip } {
    return { ...super.exportJSON(), chip: this.__chip };
  }
  createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.contentEditable = "false";
    return element;
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
  getTextContent(): string {
    return this.__chip.kind === "file" ? `@${this.__chip.file.url}` : "";
  }
  decorate(): ComposerChip {
    return this.__chip;
  }
}

export function $composerChips(): readonly ComposerChip[] {
  return $nodesOfType(ComposerMentionNode).map((node) => node.__chip);
}

/** Character offsets refer to the submitted text, not the shortened chip label. */
function $pointOffset(point: PointType): number {
  const node = point.getNode();
  const before = node
    .getPreviousSiblings()
    .reduce((sum, sibling) => sum + sibling.getTextContentSize(), 0);
  const inside =
    point.type === "text"
      ? point.offset
      : point
          .getNode()
          .getChildren()
          .slice(0, point.offset)
          .reduce((sum, child) => sum + child.getTextContentSize(), 0);
  const parent = node.getParent();
  return (
    before +
    inside +
    (parent === null || parent.is($getRoot())
      ? 0
      : parent
          .getPreviousSiblings()
          .reduce((sum, sibling) => sum + sibling.getTextContentSize() + 2, 0))
  );
}

export function $composerSelection(): { start: number; end: number } {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    const length = $getRoot().getTextContentSize();
    return { start: length, end: length };
  }
  const anchor = $pointOffset(selection.anchor);
  const focus = $pointOffset(selection.focus);
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

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
  $getSelection()?.insertRawText(text);
}

export function $setComposerText(text: string): void {
  $getRoot().clear().append($createParagraphNode());
  $getRoot().selectEnd();
  $getSelection()?.insertRawText(text);
}

export function $insertComposerChip(chip: ComposerChip, start?: number, end?: number): void {
  if (start !== undefined) $selectComposerRange(start, end);
  const selection = $getSelection();
  if (selection === null) $getRoot().selectEnd();
  $getSelection()?.insertNodes([
    $applyNodeReplacement(new ComposerMentionNode(chip)),
    $createTextNode(" "),
  ]);
}

export function fileMentionParts(
  text: string,
  files: ReadonlyMap<string, MentionFile>,
): readonly ({ kind: "text"; text: string } | { kind: "file"; file: MentionFile })[] {
  const parts: ({ kind: "text"; text: string } | { kind: "file"; file: MentionFile })[] = [];
  let offset = 0;
  for (const match of text.matchAll(/@file:\/\/[^\s]+/gu)) {
    const file = files.get(match[0].slice(1));
    if (file === undefined) continue;
    if (match.index > offset) parts.push({ kind: "text", text: text.slice(offset, match.index) });
    parts.push({ kind: "file", file });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ kind: "text", text: text.slice(offset) });
  return parts;
}

export function $fileMentionNodes(
  text: string,
  files: ReadonlyMap<string, MentionFile>,
): LexicalNode[] {
  return fileMentionParts(text, files).map((part) =>
    part.kind === "text"
      ? $createTextNode(part.text)
      : $applyNodeReplacement(
          new ComposerMentionNode({
            kind: "file",
            id: `file:${part.file.path}`,
            label: part.file.label,
            tokenId: crypto.randomUUID(),
            file: part.file,
          }),
        ),
  );
}
