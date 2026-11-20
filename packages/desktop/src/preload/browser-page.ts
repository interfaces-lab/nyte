import { ipcRenderer } from "electron";
import { BROWSER_PAGE_PRESS_CHANNEL } from "@nyte-ai/app/contract/bridge.ts";
import type { BrowserKey, BrowserWheel } from "@nyte-ai/app/contract/bridge.ts";
import type { DesignPageMessage } from "../shared/ipc-inputs.ts";
import {
  BROWSER_PAGE_BOARD_CHANNEL,
  BROWSER_PAGE_DESIGN_CHANNEL,
  BROWSER_PAGE_KEY_CHANNEL,
  WHEEL_DELTA_LIMIT,
} from "../shared/browser-page.ts";
import type { BoardMainMessage, DesignMainMessage } from "../shared/browser-page.ts";
import { designMode } from "./design-mode/design-mode.ts";
import { editsText } from "./edits-text.ts";

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

const LINE_PIXELS = 40;

const pageKeys = new Set(["Control", "Shift", "Alt", "Meta", "Insert", "Help"]);

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

if (window.opener === null && window.top === window) {
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.isTrusted) ipcRenderer.sendToHost(BROWSER_PAGE_PRESS_CHANNEL);
    },
    true,
  );

  const design = designMode((message: DesignPageMessage) =>
    ipcRenderer.send(BROWSER_PAGE_DESIGN_CHANNEL, message),
  );

  ipcRenderer.on(BROWSER_PAGE_DESIGN_CHANNEL, (_event, message: DesignMainMessage) =>
    design.receive(message),
  );

  let entered = false;

  const along = (delta: number, unit: number): number =>
    Math.max(-WHEEL_DELTA_LIMIT, Math.min(WHEEL_DELTA_LIMIT, delta * unit));

  // WARNING: keep handBack passive and first: a non-passive wheel listener holds every scroll on the page's main thread.
  const handBack = (event: WheelEvent): void => {
    if (!entered || !event.isTrusted || !(event.ctrlKey || event.metaKey)) return;

    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? LINE_PIXELS
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;

    ipcRenderer.send(BROWSER_PAGE_BOARD_CHANNEL, {
      x: event.clientX,
      y: event.clientY,
      deltaX: along(event.deltaX, unit),
      deltaY: along(event.deltaY, unit),
      zoom: event.ctrlKey,
    } satisfies BrowserWheel);

    if (event.ctrlKey) event.stopImmediatePropagation();
  };

  const holdPan = (event: WheelEvent): void => {
    if (!entered || !event.isTrusted || !event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener("wheel", handBack, { capture: true, passive: true });

  ipcRenderer.on(BROWSER_PAGE_BOARD_CHANNEL, (_event, message: BoardMainMessage) => {
    entered = message.entered;

    if (entered) window.addEventListener("wheel", holdPan, { capture: true, passive: false });
    else window.removeEventListener("wheel", holdPan, { capture: true });
  });
}
