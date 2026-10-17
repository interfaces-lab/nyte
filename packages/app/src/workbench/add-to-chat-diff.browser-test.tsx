import "../../test/window-bridge.ts";
import { parsePatchFiles } from "@pierre/diffs";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { receiveChatExcerpts } from "../conversation/add-to-chat.ts";
import { ComposerEditor } from "../conversation/composer-editor.tsx";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import { nyte } from "../nyte.ts";
import { ChangesStack } from "./changes-stack.tsx";
import { patchDigest } from "./changes-viewed.ts";

const PATCH = [
  "--- a/src/alpha.ts",
  "+++ b/src/alpha.ts",
  "@@ -1,5 +1,6 @@",
  " one",
  "-two",
  "+TWO",
  "+two and a half",
  " three",
  " four",
  " five",
  "",
].join("\n");

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function paint(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
}

async function click(element: Element, shift: boolean): Promise<void> {
  const box = element.getBoundingClientRect();

  const pointer = (type: string): PointerEvent =>
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      shiftKey: shift,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    });

  element.dispatchEvent(pointer("pointerdown"));
  element.dispatchEvent(pointer("pointerup"));
  await paint();
}

/** Every element under `root`, through open shadow roots, that matches `selector`. */
function deepQuery(root: ParentNode, selector: string): readonly Element[] {
  const found = [...root.querySelectorAll(selector)];

  for (const element of root.querySelectorAll("*"))
    if (element.shadowRoot !== null) found.push(...deepQuery(element.shadowRoot, selector));

  return found;
}

/** The line-number cell the diff draws for `line` of the file after the change. */
function newLineNumber(container: HTMLElement, line: number): Element {
  const cell = deepQuery(container, `[data-column-number="${String(line)}"]`).find(
    (element) =>
      element.closest("[data-line-type]")?.getAttribute("data-line-type") !== "change-deletion",
  );

  if (cell === undefined) throw new Error(`Missing the number of new line ${String(line)}`);

  return cell;
}

export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;height:520px;width:760px";
  document.body.append(container);
  const root = createRoot(container);
  const composer = createRef<ComposerEditorHandle>();
  const digest = patchDigest(PATCH);

  const stop = receiveChatExcerpts(({ reference }) => composer.current?.insertReference(reference));

  flushSync(() =>
    root.render(
      <>
        <div style={{ height: 120 }}>
          <ComposerEditor
            ref={composer}
            document={{ text: "", selectionStart: 0, selectionEnd: 0 }}
            files={[]}
            disabled={false}
            placeholder="Message"
            onKeyDown={() => {}}
            onDocumentChange={() => {}}
          />
        </div>
        <ChangesStack
          items={[
            {
              kind: "diff",
              path: "src/alpha.ts",
              patch: PATCH,
              digest,
              files: parsePatchFiles(PATCH, digest).flatMap((parsed) => parsed.files),
              stat: { kind: "text", added: 2, removed: 1 },
            },
          ]}
          collapsedPaths={[]}
          onToggleCollapsed={() => {}}
          scrollTop={0}
          focusPath={undefined}
          focusRevision={0}
          layout="unified"
          wordWrap={false}
          viewedState={() => "unviewed"}
          onViewedChange={() => {}}
          onScrollTop={() => {}}
          onActivePath={() => {}}
        />
      </>,
    ),
  );

  try {
    const deadline = performance.now() + 10_000;

    while (deepQuery(container, '[data-column-number="4"]').length === 0) {
      if (performance.now() > deadline) throw new Error("Timed out waiting for the diff lines");
      await paint();
    }

    await click(newLineNumber(container, 2), false);
    await click(newLineNumber(container, 4), true);
    const add = container.querySelector('button[aria-label="Add to Chat"]');
    check(add instanceof HTMLButtonElement, "A picked range offers Add to Chat in its header");

    const chord = new KeyboardEvent("keydown", {
      code: "KeyL",
      key: "L",
      shiftKey: true,
      metaKey: nyte.platform === "darwin",
      ctrlKey: nyte.platform !== "darwin",
      bubbles: true,
      cancelable: true,
    });

    document.body.dispatchEvent(chord);
    await paint();
    check(chord.defaultPrevented, "The chord adds the picked range");

    const submission = composer.current?.read();
    const part = submission?.parts.find((candidate) => candidate.kind === "excerpt");
    check(part !== undefined, "The draft holds the range as an excerpt");
    check(
      JSON.stringify(part) ===
        JSON.stringify({
          kind: "excerpt",
          source: { kind: "diff", path: "src/alpha.ts", side: "new", start: 2, end: 4 },
          text: "@@ -3,1 +2,3 @@\n+TWO\n+two and a half\n three",
        }),
      `The excerpt carries the exact hunk rows, not ${JSON.stringify(part)}`,
    );
    const chip = container.querySelector('[data-composer-chip="excerpt"]');
    check(chip?.textContent === "alpha.ts:2-4", `The chip names the range: ${chip?.textContent}`);
    check(
      container.querySelector('button[aria-label="Add to Chat"]') === null,
      "Adding clears the picked range",
    );

    await click(newLineNumber(container, 1), false);
    const header = container.querySelector('button[aria-label="Add to Chat"]');

    if (!(header instanceof HTMLButtonElement)) throw new Error("The header offers Add to Chat");
    header.click();
    await paint();
    const chips = [...container.querySelectorAll('[data-composer-chip="excerpt"]')];
    check(
      chips.map((element) => element.textContent).join(" ") === "alpha.ts:2-4 alpha.ts:1",
      "The header button adds one picked line",
    );

    return "passed";
  } finally {
    stop();
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
