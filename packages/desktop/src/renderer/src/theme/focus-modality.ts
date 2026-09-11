/**
 * Records how focus last moved, so the accent ring stays keyboard-only.
 *
 * Chromium matches `:focus-visible` on every text field focus, mouse clicks
 * included — the spec assumes a field you clicked still wants the keyboard
 * affordance. So a `:focus-visible` ring snaps an accent box around any input
 * the user merely clicked into, and no selector alone can tell the two apart.
 * tokens.css resolves `--nyte-focus-ring` to `transparent` while the attribute
 * written here reads `pointer`, which leaves the ring to Tab and nothing else.
 */

/** Input types that hold no caret: a keypress there is navigation, not typing. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Held down rather than pressed: on their own they move focus nowhere. */
const MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Fn",
  "Meta",
  "NumLock",
  "Shift",
]);

/**
 * Whether a keypress moved focus, which is what earns the ring back.
 *
 * Inside a field only Tab qualifies: Cmd+A, Cmd+V and every letter are edits,
 * and popping a ring mid-sentence is the exact jolt this module exists to
 * avoid. Everywhere else any real key is navigation — arrows walk a menu,
 * Enter activates a row, Escape backs out.
 */
export function keyboardNavigates(key: string, editing: boolean): boolean {
  return editing ? key === "Tab" : !MODIFIER_KEYS.has(key);
}

/** True while the caret sits in a field, where every key but Tab is text entry. */
export function editingText(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable || element instanceof HTMLTextAreaElement) return true;
  return element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type);
}

function setModality(modality: "keyboard" | "pointer"): void {
  document.documentElement.dataset["nyteFocusModality"] = modality;
}

// Launch quiet: a window that autofocuses its composer should not open ringed.
// The first Tab earns the ring, and it survives until a pointer takes over.
setModality("pointer");

// Capture, so the modality is settled before any handler moves focus.
window.addEventListener("pointerdown", () => setModality("pointer"), { capture: true });
window.addEventListener(
  "keydown",
  (event) => {
    if (keyboardNavigates(event.key, editingText(document.activeElement))) setModality("keyboard");
  },
  { capture: true },
);
