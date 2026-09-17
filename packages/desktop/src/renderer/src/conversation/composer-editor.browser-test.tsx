import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "@nyte-ai/ui/platform-tokens.css";
import "../theme/tokens.css";
import { ComposerEditor } from "./composer-editor.tsx";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import type { ComposerDocumentState } from "./composer-document.ts";
import type { MessageReference } from "./message-references.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function paint(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

export async function run(): Promise<string> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<ComposerEditorHandle>();
  const file = {
    path: "/project/source.ts",
    url: "file:///project/source.ts",
    displayPath: "source.ts",
    label: "Source",
  };
  let files = [file];
  let references: readonly MessageReference[] = [];
  let reports = 0;
  const prefix = `long 👋 text @${file.url}\n`.repeat(40);
  const text = `${prefix}ending`;
  let draft: ComposerDocumentState = {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  };
  const render = (): void => {
    flushSync(() =>
      root.render(
        <ComposerEditor
          ref={ref}
          document={draft}
          files={files}
          disabled={false}
          autoFocus={false}
          placeholder="Message"
          onKeyDown={() => {}}
          onReferencesChange={(next) => {
            references = next;
          }}
          onDocumentChange={(next) => {
            draft = next;
            reports += 1;
          }}
        />,
      ),
    );
  };
  try {
    render();
    await paint();
    const handle = ref.current;
    if (handle === null || handle.element === null) throw new Error("editor did not mount");
    const area = handle.element;
    area.style.cssText =
      "width: 600px; max-height: 150px; overflow: auto; font: 16px/24px sans-serif";
    check(handle.readDocument().text === text, "restored long draft survives chip conversion");
    check(references.length === 40, "initial restore reports every reference");

    files = [{ ...file, label: "Renamed source" }];
    render();
    await paint();
    check(
      references.every(
        (reference) => reference.kind === "file" && reference.file.label === "Renamed source",
      ),
      "catalog relabel reports references even with unchanged text",
    );
    check(handle.readDocument().text === text, "relabel keeps reference offsets and text");

    flushSync(() => handle.focus());
    await paint();
    const selection = document.getSelection();
    if (selection === null) throw new Error("native selection unavailable");
    const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    let last = walker.nextNode();
    while (last !== null && last.textContent !== "ending") last = walker.nextNode();
    if (!(last instanceof Text)) throw new Error("trailing text unavailable");
    selection.setBaseAndExtent(last, 6, last, 2);
    document.dispatchEvent(new Event("selectionchange"));
    await paint();
    const ranged = handle.readDocument();
    check(
      ranged.selectionStart === prefix.length + 2 && ranged.selectionEnd === text.length,
      "backward selection reports draft offsets",
    );
    check(selection.toString() === "ding", "native selected content preserved");
    const beforeEcho = reports;
    render();
    await paint();
    check(reports === beforeEcho, "parent echo does not restore the document");
    check(
      selection.anchorNode === last && selection.anchorOffset === 6 && selection.focusOffset === 2,
      "parent echo preserves backward native selection",
    );
    check(area.dataset["customCaret"] === "false", "ranged selection uses native rendering");

    flushSync(() => handle.replaceText(prefix.length + 2, text.length, "it"));
    await paint();
    check(
      handle.readDocument().text === `${prefix}enit`,
      "replacement preserves long prefix and chips",
    );
    flushSync(() => handle.replaceText(0, handle.readDocument().text.length, ""));
    await paint();
    check(
      handle.readDocument().text === "" && references.length === 0,
      "clear reports removed references",
    );
    draft = { ...draft };
    render();
    await paint();
    area.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    flushSync(() => handle.replaceText(0, 0, "unreported composition"));
    await paint();
    check(draft.text === "", "composition defers the parent document report");
    draft = { ...draft };
    render();
    await paint();
    check(
      handle.readDocument().text === "",
      "the parent document clears editor text missed during composition",
    );
    area.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await paint();
    check(handle.readDocument().text === "", "composition end keeps the parent-owned clear");
    flushSync(() => handle.insertReference({ kind: "file", file }));
    await paint();
    check(references.length === 1, "insertion reports new reference");

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await paint();
    check(area.dataset["customCaret"] === "false", "blur restores native caret fallback");
    let boundsReads = 0;
    const bounds = area.getBoundingClientRect.bind(area);
    area.getBoundingClientRect = () => {
      boundsReads += 1;
      return bounds();
    };
    for (let index = 0; index < 3; index += 1) {
      document.dispatchEvent(new Event("selectionchange"));
      await paint();
    }
    check(boundsReads === 0, "inactive selection changes do not measure editor bounds");
    area.getBoundingClientRect = bounds;
    outside.remove();
    flushSync(() => handle.focus());
    await paint();
    check(document.activeElement === area, "editor refocuses after inactive changes");
    flushSync(() => handle.replaceText(0, handle.readDocument().text.length, ""));
    await paint();
    flushSync(() => handle.replaceText(0, 0, "https://example.com/foo"));
    await paint();
    check(
      handle.readDocument().text === "https://example.com/foo",
      "typed URL stays the draft text",
    );
    const link = area.querySelector("a");
    check(link?.textContent === "https://example.com/foo", "AutoLink wraps the typed URL");
    check(
      area.querySelector("[data-composer-reference]") === null,
      "typed URL is not a composer chip",
    );
    const urlSelection = document.getSelection();
    check(
      urlSelection !== null &&
        urlSelection.isCollapsed &&
        link !== null &&
        urlSelection.anchorNode instanceof Node &&
        link.contains(urlSelection.anchorNode),
      "caret sits in the AutoLink path",
    );
    return "passed";
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}
