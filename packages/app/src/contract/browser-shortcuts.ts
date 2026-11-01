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
  | "toggle-devtools"
  | "add-to-chat";

interface ShortcutKey {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

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
  ["KeyL", "add-to-chat"],
  ["KeyR", "hard-reload"],
  ["KeyG", "find-previous"],
  ["Equal", "zoom-in"],
  ["Minus", "zoom-out"],
]);

export function shortcutCharacter(event: Pick<ShortcutKey, "key" | "code">): string | undefined {
  const typed = event.key.toLowerCase();

  if (/^[a-z0-9]$/.test(typed)) return typed;

  return /^(?:Key|Digit)([A-Z0-9])$/.exec(event.code)?.[1]?.toLowerCase();
}

function keyName(event: ShortcutKey): string {
  const character = shortcutCharacter(event);

  if (character === undefined) return event.code;

  return /^\d$/.test(character) ? `Digit${character}` : `Key${character.toUpperCase()}`;
}

const HELD = new Set<BrowserShortcut>([
  "back",
  "forward",
  "find-next",
  "find-previous",
  "zoom-in",
  "zoom-out",
  "zoom-reset",
]);

export function repeatsWhenHeld(shortcut: BrowserShortcut): boolean {
  return HELD.has(shortcut);
}

export function resolveBrowserShortcut(
  event: ShortcutKey,
  mac: boolean,
  source: "page" | "panel",
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

  if (mac && source === "page" && !event.altKey && !event.shiftKey) {
    if (event.key === "ArrowLeft") return "back";

    if (event.key === "ArrowRight") return "forward";
  }

  const name = keyName(event);

  if (event.altKey)
    return mac && !event.shiftKey && name === "KeyI" ? "toggle-devtools" : undefined;

  if (event.shiftKey) return !mac && name === "KeyI" ? "toggle-devtools" : PRIMARY_SHIFT.get(name);

  return name === (mac ? "KeyY" : "KeyH") ? "history" : PRIMARY.get(name);
}
