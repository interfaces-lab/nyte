import { useRef, useState } from "react";
import type { RefObject } from "react";
import { DESIGN_ATTRIBUTE, readSpanKey, spanKey } from "@nyte-ai/plugin/design/board-protocol";
import type { AppMessage, BoardMessage } from "@nyte-ai/plugin/design/board-protocol";
import { post } from "./bridge.ts";
import type { BoardCamera } from "./camera.ts";
import type { Point, Refusal } from "./frame-chrome.tsx";
import type { PageFrames } from "./page-frames.ts";
import { readVia } from "./runtime.ts";
import type { Held, Hover } from "./selection.tsx";
import { currentDrawn, findBase, hold, placeFrame, release } from "./sheets.ts";
import type { FrameBox } from "./sheets.ts";

interface Typing {
  readonly node: HTMLElement;
  readonly words: string;
}

type Gesture =
  | {
      readonly kind: "pan";
      readonly pointerX: number;
      readonly pointerY: number;
      readonly startX: number;
      readonly startY: number;
    }
  | {
      readonly kind: "frame";
      readonly frame: FrameBox;
      readonly pointerX: number;
      readonly pointerY: number;
      readonly at: Point | null;
    }
  | { readonly kind: "typing"; readonly node: HTMLElement };

type Answer = Extract<AppMessage, { kind: "applied" } | { kind: "refused" }>;

type Edit =
  | Omit<Extract<BoardMessage, { kind: "text" }>, "base">
  | Omit<Extract<BoardMessage, { kind: "move" }>, "base">;

export interface Gestures {
  readonly editing: Typing | null;
  readonly held: Held | null;
  readonly panning: boolean;
  readonly readOnly: Element | null;
  readonly refusal: Refusal | null;
  readonly pointerDown: (event: PointerEvent, pages: PageFrames) => void;
  readonly pointerMove: (event: PointerEvent, pages: PageFrames) => void;
  readonly pointerUp: () => void;
  readonly doubleClick: (event: MouseEvent, pages: PageFrames) => void;
  readonly keyDown: (event: KeyboardEvent, pages: PageFrames) => void;
  readonly answer: (message: Answer) => void;
}

const PAUSE_MS = 600;

const WORDS_LIMIT = 4096;

const SOURCE = `[${DESIGN_ATTRIBUTE.source}]`;

export function pick(event: Event): Element | null {
  const target = event.composedPath()[0];

  return target instanceof Element ? target : null;
}

function targetKey(node: Element, deep: boolean): string | null {
  const outermost = readVia(node)[0];

  return !deep && outermost !== undefined ? outermost : node.getAttribute(DESIGN_ATTRIBUTE.source);
}

function findFrames(): readonly FrameBox[] {
  return currentDrawn().sheets.flatMap((sheet) => sheet.frames);
}

function pointAt(pages: PageFrames, target: Element | null, deep: boolean): string | null {
  const page = pages.findAt(target);
  const node = target?.closest(SOURCE);

  if (page !== undefined) return page.frame.key;

  return node === null || node === undefined ? null : targetKey(node, deep);
}

function readWords(node: HTMLElement): string {
  return node.innerText.replaceAll("\n", " ").trimEnd();
}

function keepWords(node: HTMLElement): () => void {
  const words = [...node.childNodes].map((child) => ({ child, text: child.textContent }));

  return () => {
    for (const word of words) word.child.textContent = word.text;
    node.replaceChildren(...words.map((word) => word.child));
  };
}

export function useGestures(input: {
  readonly stage: RefObject<HTMLDivElement | null>;
  readonly camera: BoardCamera;
  readonly hover: Hover;
}): Gestures {
  const camera = input.camera;
  const [editing, setEditing] = useState<Typing | null>(null);
  const [readOnly, setReadOnly] = useState<Element | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [panning, setPanning] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const awaiting = useRef(new Map<string, () => void>());

  const select = (key: string | null): void => {
    camera.forget();
    setReadOnly(null);
    setRefusal(null);
    post({ kind: "select", span: key === null ? null : (readSpanKey(key) ?? null) });
  };

  const send = (edit: Edit, node: Node, restore: () => void): void => {
    const base = findBase(node, edit.key.path);

    if (base === undefined) {
      restore();

      return;
    }

    awaiting.current.set(spanKey(edit.key), restore);
    post({ ...edit, base });
  };

  const beginTyping = (node: HTMLElement, key: string): void => {
    const span = readSpanKey(key);

    if (span === undefined) return;
    hold();
    select(key);
    setEditing({ node, words: node.innerText });
    gesture.current = { kind: "typing", node };
    const before = readWords(node);
    const restore = keepWords(node);
    let keep = true;
    let pause = 0;
    node.contentEditable = "plaintext-only";
    node.style.setProperty("outline", "none", "important");
    node.focus();
    node.ownerDocument.getSelection()?.selectAllChildren(node);

    const onInput = (): void => {
      setEditing({ node, words: node.innerText });
      clearTimeout(pause);
      pause = window.setTimeout(() => node.blur(), PAUSE_MS);
    };

    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();

      if (event.key !== "Escape" && event.key !== "Enter") return;
      event.preventDefault();
      keep = event.key === "Enter";
      node.blur();
    };

    const onDone = (): void => {
      clearTimeout(pause);
      node.removeEventListener("input", onInput);
      node.removeEventListener("keydown", onKey);
      node.removeAttribute("contenteditable");
      node.style.removeProperty("outline");
      gesture.current = null;
      setEditing(null);
      const value = readWords(node);

      if (!keep) restore();
      else if (value.length > WORDS_LIMIT) {
        restore();
        setRefusal("too-long");
      } else if (value !== before) send({ kind: "text", key: span, value }, node, restore);
      release();
      camera.back();
    };

    node.addEventListener("input", onInput);
    node.addEventListener("keydown", onKey);
    node.addEventListener("blur", onDone, { once: true });
    camera.read(node);
  };

  return {
    editing,
    held,
    panning,
    readOnly,
    refusal,
    pointerDown: (event, pages) => {
      const target = pick(event);

      if (editing !== null) return;
      event.preventDefault();
      event.stopPropagation();
      input.stage.current?.focus();

      if (pages.leaveOutside(event)) return;

      if (event.button === 1 || event.altKey) {
        input.stage.current?.setPointerCapture(event.pointerId);
        setPanning(true);
        camera.stop();
        gesture.current = {
          kind: "pan",
          pointerX: event.clientX,
          pointerY: event.clientY,
          startX: camera.at().x,
          startY: camera.at().y,
        };

        return;
      }

      if (event.button !== 0) return;
      const label = target?.closest("[data-label]")?.getAttribute("data-label");

      const frame =
        label === undefined || label === null
          ? undefined
          : findFrames().find((found) => found.key === label);

      if (frame !== undefined) {
        select(frame.key);

        if (!frame.movable) return;
        input.stage.current?.setPointerCapture(event.pointerId);
        hold();
        frame.node.style.zIndex = "1";
        gesture.current = {
          kind: "frame",
          frame,
          pointerX: event.clientX,
          pointerY: event.clientY,
          at: null,
        };

        return;
      }

      select(pointAt(pages, target, event.metaKey));
    },
    pointerMove: (event, pages) => {
      const current = gesture.current;

      if (current === null || current.kind === "typing") {
        const target = editing === null ? pick(event) : null;

        input.hover.point(
          pointAt(pages, target, event.metaKey),
          target === null
            ? null
            : (findFrames().find((frame) => frame.node.contains(target))?.key ?? null),
        );

        return;
      }

      if (current.kind === "pan") {
        camera.moveTo({
          ...camera.at(),
          x: current.startX + event.clientX - current.pointerX,
          y: current.startY + event.clientY - current.pointerY,
        });

        return;
      }

      const frame = current.frame;
      const zoom = camera.at().zoom;
      const x = Math.round(frame.x + (event.clientX - current.pointerX) / zoom);
      const y = Math.round(frame.y + (event.clientY - current.pointerY) / zoom);

      if (current.at?.x === x && current.at.y === y) return;
      frame.node.style.left = `${String(x)}px`;
      frame.node.style.top = `${String(y)}px`;
      gesture.current = { ...current, at: { x, y } };
      setHeld({ key: frame.key, at: { x, y } });
    },
    pointerUp: () => {
      const current = gesture.current;

      if (current?.kind === "typing") return;
      gesture.current = null;
      setPanning(false);
      setHeld(null);

      if (current?.kind !== "frame") return;
      const frame = current.frame;
      const at = current.at;
      const span = readSpanKey(frame.key);
      frame.node.style.removeProperty("z-index");

      if (at !== null && span !== undefined && (at.x !== frame.x || at.y !== frame.y)) {
        placeFrame(frame.node, at);
        send({ kind: "move", key: span, x: at.x, y: at.y }, frame.node, () =>
          placeFrame(frame.node, null),
        );
      } else if (at !== null) placeFrame(frame.node, null);

      release();
    },
    doubleClick: (event, pages) => {
      const target = pick(event);
      const page = pages.findAt(target);
      const node = target?.closest(SOURCE);

      if (editing !== null) return;

      if (page !== undefined) {
        if (page.state === "entered") return;
        select(page.frame.key);
        pages.enter(page.frame.key);

        return;
      }

      if (node === null || node === undefined) return;
      const key = node.getAttribute(DESIGN_ATTRIBUTE.source) ?? "";

      if (node instanceof HTMLElement && currentDrawn().texts.has(key)) {
        beginTyping(node, key);

        return;
      }

      select(key);

      if (
        [...node.childNodes].some(
          (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "",
        )
      ) {
        setReadOnly(node);
      }
    },
    keyDown: (event, pages) => {
      if (!pages.onKey(event) && event.key === "Escape") select(null);
    },
    answer: (message) => {
      const key = spanKey(message.from);
      const restore = awaiting.current.get(key);

      if (restore === undefined) return;
      awaiting.current.delete(key);

      if (message.kind === "applied") return;
      restore();
      setRefusal(message.reason);
    },
  };
}
