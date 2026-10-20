const KEY_OWNERS =
  'input, textarea, select, [contenteditable], [role="textbox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

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

export function keyOwner(): Element | undefined {
  return focusPath().find((element) => element.matches(KEY_OWNERS));
}
