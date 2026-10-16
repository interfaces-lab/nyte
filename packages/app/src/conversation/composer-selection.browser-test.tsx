import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import type { ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { ComposerFrame } from "./composer-frame.tsx";
import type { ComposerDocumentState } from "./composer-document.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";

declare global {
  interface Window {
    readonly rendererMouseClick: (payload: string) => void;
  }
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function paint(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function click(x: number, y: number, shift: boolean): Promise<void> {
  await new Promise<void>((resolve) => {
    document.addEventListener("renderer-mouse-clicked", () => resolve(), { once: true });
    window.rendererMouseClick(JSON.stringify({ x, y, shift }));
  });
  await paint();
}

function nativeOffset(area: HTMLElement, node: Node | null, offset: number): number {
  if (node === null || !area.contains(node)) return -1;
  const prefix = document.createRange();
  prefix.setStart(area, 0);
  prefix.setEnd(node, offset);

  return prefix.toString().length + prefix.cloneContents().querySelectorAll("br").length;
}

function textPoint(area: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let remaining = offset;
  let node = walker.nextNode();

  while (node !== null) {
    if (node instanceof Text) {
      if (remaining <= node.length) return { node, offset: remaining };
      remaining -= node.length;
    } else if (node instanceof HTMLBRElement) remaining -= 1;
    node = walker.nextNode();
  }

  throw new Error(`Text point unavailable at ${String(offset)}`);
}

function glyphBox(area: HTMLElement, offset: number): DOMRect {
  const point = textPoint(area, offset);
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.setEnd(point.node, point.offset + 1);

  return range.getBoundingClientRect();
}

const variants = [
  { name: "expanded", surface: "follow-up" },
  { name: "floating", surface: "follow-up", floating: true },
  { name: "new-chat", surface: "new-chat" },
  { name: "message-edit", surface: "follow-up", editing: { kind: "message", onCancel: () => {} } },
  { name: "compact", surface: "follow-up" },
  { name: "narrow", surface: "follow-up" },
] satisfies readonly (Pick<
  ComponentProps<typeof ComposerFrame>,
  "surface" | "floating" | "editing"
> & { name: string })[];

export async function run(): Promise<string> {
  const host = document.createElement("div");
  host.style.cssText = "width: 600px; margin: 40px";
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  const editorRef = createRef<ComposerEditorHandle>();
  let draft: ComposerDocumentState = { text: "", selectionStart: 0, selectionEnd: 0 };
  let trusted = 0;
  let clicks = 0;
  const failures: string[] = [];

  const observe = (event: MouseEvent): void => {
    if (event.isTrusted) trusted += 1;
  };

  document.addEventListener("mousedown", observe);

  try {
    for (const variant of variants) {
      host.style.width = variant.name === "narrow" ? "280px" : "600px";

      const render = (): void => {
        flushSync(() =>
          root.render(
            <QueryClientProvider client={client}>
              <ComposerFrame
                key={variant.name}
                {...variant}
                document={draft}
                onDocumentChange={(next) => {
                  draft = next;
                }}
                onSubmit={() => true}
                placeholder="Message"
                inputRef={(next) => {
                  editorRef.current = next;
                }}
                suggestionCatalog={{ status: "ready", data: { commands: [], skills: [] } }}
                mentionFiles={{ status: "ready", data: [] }}
              />
            </QueryClientProvider>,
          ),
        );
      };

      const texts =
        variant.name === "compact"
          ? ["First sentence here"]
          : [
              "First line here\nSecond sentence here",
              "The first sentence has enough words to wrap onto a second line inside the composer card without a hard line break.",
            ];

      for (const text of texts) {
        draft = { text, selectionStart: 0, selectionEnd: 0 };
        render();
        await paint();
        const editor = editorRef.current;

        const area = editor?.readElement() ?? null;

        if (editor === null || area === null) throw new Error("Editor unavailable");
        const selection = document.getSelection();

        if (selection === null) throw new Error("Selection unavailable");
        flushSync(() => editor.focus());
        await paint();
        const firstBox = glyphBox(area, 0);
        const lastBox = glyphBox(area, text.length - 1);
        const frame = area.closest("form");

        if (frame === null) throw new Error("Frame unavailable");
        const bounds = area.getBoundingClientRect();
        const frameBounds = frame.getBoundingClientRect();

        if (variant.name === "compact") {
          check(area.clientHeight === 38, "Single-line draft stays compact");
          check(frameBounds.height === 40, "Compact padding preserves the pill height");
        }

        const anchorOffset = text.includes("\n")
          ? text.indexOf("\n") + 1
          : Array.from({ length: text.length }, (_, index) => index).find(
              (index) => glyphBox(area, index).top > firstBox.top + 2,
            );

        const lastLineStart = Array.from({ length: text.length }, (_, index) => index).find(
          (index) => text[index] !== "\n" && glyphBox(area, index).top === lastBox.top,
        );

        if (lastLineStart === undefined) throw new Error("Last line unavailable");

        const probe = async (
          name: string,
          x: number,
          y: number,
          anchor: number,
          focus: number,
          shift: boolean,
        ): Promise<void> => {
          const point = textPoint(area, anchor);
          area.focus();
          selection.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
          await paint();
          const owner = document.elementFromPoint(x, y);
          check(
            owner instanceof HTMLElement && owner.isContentEditable,
            `${variant.name}/${name}: text hit area is editable`,
          );
          await click(x, y, shift);
          render();
          await paint();
          clicks += 1;
          const actualAnchor = nativeOffset(area, selection.anchorNode, selection.anchorOffset);
          const actualFocus = nativeOffset(area, selection.focusNode, selection.focusOffset);
          const start = Math.min(shift ? anchor : focus, focus);
          const end = Math.max(shift ? anchor : focus, focus);
          const state = editor.readDocument();

          const correct =
            actualAnchor === (shift ? anchor : focus) &&
            actualFocus === focus &&
            selection.toString() === text.slice(start, end) &&
            state.selectionStart === start &&
            state.selectionEnd === end;

          if (!correct)
            failures.push(
              `${variant.name}/${name}/${shift ? "shift" : "plain"}: owner=${owner?.tagName}, editable=${owner instanceof HTMLElement && owner.isContentEditable}, selected=${JSON.stringify(selection.toString())}, anchor=${String(actualAnchor)}, focus=${String(actualFocus)}, draft=${JSON.stringify(state)}`,
            );
        };

        if (variant.name !== "compact") {
          check(anchorOffset !== undefined, `${variant.name}: expected a second visual line`);

          if (anchorOffset === undefined) throw new Error("Second line unavailable");
          const pointBox = glyphBox(area, 5);
          await probe(
            text.includes("\n") ? "hard break earlier line" : "wrapped earlier line",
            pointBox.left + 1,
            pointBox.top + pointBox.height / 2,
            anchorOffset,
            5,
            true,
          );
        }

        for (const shift of [true, false]) {
          const anchor = Math.min(text.length, 8);
          await probe("top", firstBox.left + 40, frameBounds.top + 2, anchor, 0, shift);
          await probe(
            "top from end",
            firstBox.left + 40,
            frameBounds.top + 2,
            text.length,
            0,
            shift,
          );
          await probe("bottom", lastBox.left, bounds.bottom - 2, anchor, text.length, shift);
          await probe(
            "left",
            bounds.left + 1,
            firstBox.top + firstBox.height / 2,
            anchor,
            0,
            shift,
          );
          await probe(
            "left last line",
            bounds.left + 1,
            lastBox.top + lastBox.height / 2,
            anchor,
            lastLineStart,
            shift,
          );
          await probe(
            "right",
            bounds.right - 1,
            lastBox.top + lastBox.height / 2,
            anchor,
            text.length,
            shift,
          );
        }

        if (variant.name === "narrow") {
          const outside = document.createElement("button");
          document.body.append(outside);
          outside.focus();
          await paint();
          check(frame.getBoundingClientRect().height === 40, "Blur clips a narrow multiline draft");
          flushSync(() => editor.focus());
          await paint();
          check(frame.getBoundingClientRect().height > 40, "Focus restores the expanded draft");
          outside.remove();
        }
      }
    }

    check(trusted === clicks, `Expected ${String(clicks)} trusted clicks, got ${String(trusted)}`);
    check(failures.length === 0, failures.join("\n"));

    return "passed";
  } finally {
    document.removeEventListener("mousedown", observe);
    flushSync(() => root.unmount());
    client.clear();
    host.remove();
  }
}

applyDisplayMode("light");
