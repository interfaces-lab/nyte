/**
 * Focus rings follow the input that moved focus. A window launches quiet, so
 * one that autofocuses its composer does not open ringed; the first Tab earns
 * the ring, and it survives until a pointer takes over. The listeners capture,
 * so the modality is settled before any handler moves focus.
 *
 * A keypress earns the ring back when it moves focus. Inside a field only Tab
 * qualifies: Cmd+A, Cmd+V and every letter are edits, and popping a ring
 * mid-sentence is the exact jolt this module exists to avoid. Everywhere else
 * any real key is navigation: arrows walk a menu, Enter activates a row,
 * Escape backs out.
 */
import { applyFocusModality } from "./appearance.ts";

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

/** True while the caret sits in a field, where every key but Tab is text entry. */
function editingText(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;

  if (element.isContentEditable || element instanceof HTMLTextAreaElement) return true;

  return element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type);
}

applyFocusModality("pointer");

window.addEventListener("pointerdown", () => applyFocusModality("pointer"), { capture: true });

window.addEventListener(
  "keydown",
  (event) => {
    const navigates = editingText(document.activeElement)
      ? event.key === "Tab"
      : !MODIFIER_KEYS.has(event.key);

    if (navigates) applyFocusModality("keyboard");
  },
  { capture: true },
);
