/**
 * Whether a text selection reaches into `element`: the end of a drag across its
 * text, which a click must not treat as activation. Only the selection's ranges
 * count. A selection left elsewhere in the document, or the one a blurred text
 * field keeps and `toString()` still reports, says nothing about this element.
 */
export function selectionWithin(element: Element): boolean {
  const selection = element.ownerDocument.getSelection();

  if (selection === null || selection.isCollapsed) return false;

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(element)) return true;
  }

  return false;
}
