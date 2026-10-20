export function selectionWithin(element: Element): boolean {
  const selection = element.ownerDocument.getSelection();

  if (selection === null || selection.isCollapsed) return false;

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(element)) return true;
  }

  return false;
}
