/**
 * Who holds the keyboard. A field, editor, menu, list or dialog that holds
 * focus, or contains what does, owns the keys; nothing else does. A pane asks
 * this one rule before it takes focus or routes a typed character, so keeping
 * the keys somewhere new means making that place an owner, not adding a probe.
 */
const KEY_OWNERS =
  'input, textarea, select, [contenteditable], [role="textbox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

/** The focused element, then its ancestors, through open shadow roots. */
function focusPath(): readonly Element[] {
  let active = document.activeElement;

  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  const path: Element[] = [];

  for (let node = active; node !== null;) {
    path.push(node);
    const root = node.getRootNode();
    node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }

  return path;
}

/** The element that owns the keys now, if one does. */
export function keyOwner(): Element | undefined {
  return focusPath().find((element) => element.matches(KEY_OWNERS));
}
