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

const QUIET_KEYS = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Escape",
  "Fn",
  "Meta",
  "NumLock",
  "Shift",
]);

function innermostFocus(element: Element | null): Element | null {
  const inner = element?.shadowRoot?.activeElement ?? null;

  return inner === null ? element : innermostFocus(inner);
}

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
    const navigates = editingText(innermostFocus(document.activeElement))
      ? event.key === "Tab"
      : !QUIET_KEYS.has(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey;

    if (navigates) applyFocusModality("keyboard");
  },
  { capture: true },
);
