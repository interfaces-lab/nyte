/**
 * Runs in every browser page's isolated world, and in its DevTools: it shares the
 * page's DOM, never its JavaScript, and exposes nothing. A key the page leaves
 * unhandled goes to main so Nyte's shortcuts work while the page has focus. Editing keys, typed characters,
 * and Escape stay with the page. Assume a hostile page: main validates every message.
 */
import { ipcRenderer } from "electron";
import type { BrowserKey } from "@nyte-ai/app/bridge.ts";
import { BROWSER_PAGE_KEY_CHANNEL } from "../shared/browser-page.ts";

const mac = process.platform === "darwin";

const editing = mac
  ? {
      always: new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "backspace", "delete"]),
      plain: new Set(["a", "c", "v", "x", "z"]),
      shifted: new Set(["v", "z"]),
    }
  : {
      always: new Set([
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        "home",
        "end",
        "backspace",
        "delete",
      ]),
      plain: new Set(["a", "c", "v", "x", "z", "y"]),
      shifted: new Set(["v", "z"]),
    };

const pageKeys = new Set(["Control", "Shift", "Alt", "Meta", "Insert", "Help"]);

/** In text the user edits, ⌘← and ⌘→ move the caret; elsewhere they go back and forward. */
function editsText(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function pageKeeps(event: KeyboardEvent): boolean {
  const named =
    /^F\d+$/.test(event.key) ||
    event.key.startsWith("Audio") ||
    event.key.startsWith("Media") ||
    event.key.startsWith("Browser");

  if (!(event.ctrlKey || event.altKey || event.metaKey) && !named) return true;

  if (pageKeys.has(event.key)) return true;

  if (event.altKey && !event.ctrlKey && !event.metaKey && (mac || /^Numpad\d+$/.test(event.code)))
    return true;

  if (event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey)
    return true;

  if (!(mac ? event.metaKey : event.ctrlKey) || event.altKey) return false;
  const typed = event.key.toLowerCase();

  const key =
    !/^[a-z]$/.test(typed) && /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : typed;

  if (mac && !event.ctrlKey && !event.shiftKey && (key === "arrowleft" || key === "arrowright"))
    return editsText(event);

  return (
    editing.always.has(key) ||
    (event.shiftKey ? editing.shifted : editing.plain).has(key) ||
    (mac && event.ctrlKey && !event.shiftKey && key === " ")
  );
}

// A sign-in popup shares the page's session, and so this preload, but has no panel.
if (window.opener === null)
  window.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.defaultPrevented || event.isComposing || pageKeeps(event)) return;
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send(BROWSER_PAGE_KEY_CHANNEL, {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
    } satisfies BrowserKey);
  });
