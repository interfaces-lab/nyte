import { applyFocusModality } from "./appearance.ts";

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
