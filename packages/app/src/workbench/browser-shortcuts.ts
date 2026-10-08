/** The browser panel's shortcuts, for keys pressed in its controls and keys its focused page forwards. */
export type BrowserShortcut =
  | "back"
  | "forward"
  | "reload"
  | "hard-reload"
  | "focus-address"
  | "find"
  | "find-next"
  | "find-previous"
  | "bookmark"
  | "history"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "toggle-devtools";

interface ShortcutKey {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** Under the primary modifier: ⌘ on macOS, Ctrl elsewhere. Punctuation goes by physical key. */
const PRIMARY = new Map<string, BrowserShortcut>([
  ["BracketLeft", "back"],
  ["BracketRight", "forward"],
  ["KeyR", "reload"],
  ["KeyL", "focus-address"],
  ["KeyF", "find"],
  ["KeyG", "find-next"],
  ["KeyD", "bookmark"],
  ["Equal", "zoom-in"],
  ["NumpadAdd", "zoom-in"],
  ["Minus", "zoom-out"],
  ["NumpadSubtract", "zoom-out"],
  ["Digit0", "zoom-reset"],
  ["Numpad0", "zoom-reset"],
]);

const PRIMARY_SHIFT = new Map<string, BrowserShortcut>([
  ["KeyR", "hard-reload"],
  ["KeyG", "find-previous"],
  ["Equal", "zoom-in"],
  ["Minus", "zoom-out"],
]);

/** Letters follow the layout, so ⌘R is R on Dvorak too; other keys go by position. */
function keyName(event: ShortcutKey): string {
  const typed = event.key.toLowerCase();

  return /^[a-z]$/.test(typed) ? `Key${typed.toUpperCase()}` : event.code;
}

export function resolveBrowserShortcut(
  event: ShortcutKey,
  mac: boolean,
): BrowserShortcut | undefined {
  const modified = event.ctrlKey || event.altKey || event.metaKey;

  if (event.key === "BrowserBack") return "back";

  if (event.key === "BrowserForward") return "forward";

  if (event.key === "BrowserRefresh") return "reload";

  if (event.key === "F12" && !modified && !event.shiftKey) return "toggle-devtools";

  if (!mac && event.key === "F5" && !event.altKey && !event.metaKey)
    return event.ctrlKey || event.shiftKey ? "hard-reload" : "reload";

  if (!mac && event.key === "F3" && !modified)
    return event.shiftKey ? "find-previous" : "find-next";

  if (!mac && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (event.key === "ArrowLeft") return "back";

    if (event.key === "ArrowRight") return "forward";
  }

  if (!(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return undefined;
  const name = keyName(event);

  if (event.altKey)
    return mac && !event.shiftKey && name === "KeyI" ? "toggle-devtools" : undefined;

  if (event.shiftKey) return !mac && name === "KeyI" ? "toggle-devtools" : PRIMARY_SHIFT.get(name);

  return name === (mac ? "KeyY" : "KeyH") ? "history" : PRIMARY.get(name);
}
