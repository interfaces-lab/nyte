import "../../test/window-bridge.ts";
import type { EditorSelection } from "@nyte-ai/ui/diffs/edit";
import { CodeView, EditProvider } from "@nyte-ai/ui/diffs/react";
import type { CodeViewHandle } from "@nyte-ai/ui/diffs/react";
import { createRef } from "react";
import { createRoot } from "react-dom/client";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { revealSelection } from "./editor-selection.ts";
import { createEditor } from "./file-code-view.tsx";
import { editorViewOptions } from "./editor-view-options.ts";

declare global {
  interface Window {
    readonly rendererMouseClick: (payload: string) => void;
    readonly rendererKey: (payload: string) => void;
    readonly rendererCompose: (payload: string) => void;
  }
}

const PATH = "/fixture/hub.go";

const SOURCE = [
  "package hub",
  "",
  "func Register(name string) string {",
  "\treturn name",
  "}",
  "",
  "func Use() string {",
  '\treturn Register("x")',
  "}",
  "",
  ...Array.from({ length: 400 }, (_, index) => `// filler ${String(index)}`),
  'func Far() string { return Register("far") }',
  ...Array.from({ length: 400 }, (_, index) => `// more ${String(index)}`),
  "",
].join("\n");

const FAR = 410;

const META = 4;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function paint(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function until<T>(read: () => T | null | undefined, what: string): Promise<T> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const value = read();

    if (value !== null && value !== undefined) return value;
    await paint();
  }

  throw new Error(`Timed out waiting for ${what}`);
}

async function click(x: number, y: number, modifiers?: number): Promise<void> {
  await new Promise<void>((resolve) => {
    document.addEventListener("renderer-mouse-clicked", () => resolve(), { once: true });
    window.rendererMouseClick(JSON.stringify({ x, y, shift: false, modifiers }));
  });
  await paint();
}

async function press(key: string, code: string, text?: string): Promise<void> {
  await new Promise<void>((resolve) => {
    document.addEventListener("renderer-key-pressed", () => resolve(), { once: true });
    window.rendererKey(
      JSON.stringify({ key, code, keyCode: key.toUpperCase().charCodeAt(0), text, modifiers: 0 }),
    );
  });
  await paint();
}

async function compose(steps: readonly string[], commit: string): Promise<void> {
  await new Promise<void>((resolve) => {
    document.addEventListener("renderer-composed", () => resolve(), { once: true });
    window.rendererCompose(JSON.stringify({ steps, commit }));
  });
  await paint();
}

/** The client point of a line's column, read from the editor's own geometry. */
function point(
  editor: { getRangeRect(range: EditorSelection): DOMRect | undefined },
  line: number,
  character: number,
): { readonly x: number; readonly y: number } {
  const at = { line, character };
  const rect = editor.getRangeRect({
    start: at,
    end: { line, character: character + 1 },
    direction: 0,
  });

  if (rect === undefined) throw new Error(`Line ${String(line)} isn't drawn.`);

  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export async function run(): Promise<string> {
  const viewer = createRef<CodeViewHandle<undefined, undefined>>();
  const seen: EditorSelection[][] = [];
  const clicked: string[] = [];
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;top:60px;left:200px;display:flex;width:560px;height:480px";
  document.body.append(container);
  let text = SOURCE;

  createRoot(container).render(
    <EditProvider createEditor={createEditor}>
      <CodeView
        ref={viewer}
        initialItems={[
          {
            id: PATH,
            type: "file",
            edit: true,
            file: { name: "hub.go", contents: SOURCE, cacheKey: PATH },
          },
        ]}
        editorOptions={{
          addCaretGesture: "alt-shift-click",
          onSelectionChange: (selections) => seen.push(selections),
        }}
        options={{
          ...editorViewOptions({
            theme: "light",
            lineNumbers: true,
            wordWrap: false,
            codeFontSize: 12,
          }),
          onTokenClick: (token, event) => {
            if (event.metaKey) clicked.push(token.tokenText);
          },
        }}
        onItemEditChange={(event) => {
          text = event.file.contents;
        }}
        style={{ flex: 1, height: "100%", minWidth: 0, minHeight: 0, overflow: "auto" }}
      />
    </EditProvider>,
  );

  const editor = await until(() => viewer.current?.getEditor(PATH), "the editor");

  await until(
    () => editor.getRangeRect({ start: { line: 7, character: 0 }, end: { line: 7, character: 1 } }),
    "line 8",
  );

  const token = await until(
    () =>
      [
        ...(container
          .querySelector("diffs-container")
          ?.shadowRoot?.querySelectorAll("[data-char]") ?? []),
      ].find(
        (element) =>
          element.textContent === "Register" && element.closest('[data-line="8"]') !== null,
      ),
    "the Register token",
  );
  token.setAttribute("data-declaration-link", "");
  await paint();
  const linked = getComputedStyle(token);

  check(
    linked.textDecorationLine === "underline" && linked.cursor === "pointer",
    `the declaration link draws as ${linked.textDecorationLine}, cursor ${linked.cursor}`,
  );
  token.removeAttribute("data-declaration-link");
  const measured = editor.getRangeRect({
    start: { line: 7, character: 8 },
    end: { line: 7, character: 16 },
  });
  const drawn = token.getBoundingClientRect();

  check(
    measured !== undefined &&
      Math.abs(measured.left - drawn.left) < 2 &&
      Math.abs(measured.top - drawn.top) < 4,
    `getRangeRect ${JSON.stringify(measured)} isn't where the token is drawn ${JSON.stringify(drawn)}`,
  );
  const handle = viewer.current;

  if (handle === null) throw new Error("The viewer is gone.");
  revealSelection(handle, editor, {
    path: PATH,
    box: container,
    selection: {
      start: { line: FAR, character: 0 },
      end: { line: FAR, character: 4 },
      direction: "forward",
    },
  });
  await until(
    () =>
      editor.getRangeRect({ start: { line: FAR, character: 5 }, end: { line: FAR, character: 6 } }),
    "the far line",
  );
  await paint();
  const target = point(editor, FAR, 5);
  const box = container.getBoundingClientRect();

  check(
    Math.abs(target.y - (box.top + box.height / 2)) < box.height / 4,
    `a jump left its line at y ${String(target.y)} in a viewport from ${String(box.top)} to ${String(box.bottom)}`,
  );
  await click(target.x, target.y);
  const farClick = editor.getViewState().selections?.at(-1);

  check(
    farClick?.start.line === FAR &&
      farClick.start.character === farClick.end.character &&
      farClick.start.character >= 4,
    `the first click one frame after a far jump was dropped: ${JSON.stringify(farClick)}`,
  );
  viewer.current?.scrollTo({ type: "line", id: PATH, lineNumber: 1, align: "start" });
  await until(
    () => editor.getRangeRect({ start: { line: 2, character: 5 }, end: { line: 2, character: 6 } }),
    "line 3 again",
  );
  await paint();

  editor.setSelections([
    { start: { line: 2, character: 5 }, end: { line: 2, character: 13 }, direction: "forward" },
  ]);
  editor.focus({ preventScroll: true });
  await paint();
  const programmatic = seen.at(-1)?.at(-1);

  check(
    programmatic?.start.line === 2 && programmatic.end.character === 13,
    `onSelectionChange missed setSelections: ${JSON.stringify(programmatic)}`,
  );
  const dom = getSelection();

  check(dom !== null && !dom.isCollapsed, "setSelections left the DOM selection collapsed");

  const first = point(editor, 2, 5);
  await click(first.x - 2, first.y);
  const afterClick = editor.getViewState().selections?.at(-1);

  check(
    afterClick?.start.line === 2 && afterClick.start.character === afterClick.end.character,
    `the first click after setSelections was dropped: ${JSON.stringify(afterClick)}`,
  );
  await press("x", "KeyX", "x");
  check(
    text.split("\n")[2]?.startsWith("func xRegister"),
    `typing after the click replaced the old selection: ${JSON.stringify(text.split("\n")[2])}`,
  );
  await press("Backspace", "Backspace");

  const call = point(editor, 7, 8);
  const before = editor.getViewState().selections?.at(-1);
  await click(call.x, call.y, META);
  const afterModifier = editor.getViewState().selections;

  check(clicked.includes("Register"), `⌘-click reached no token hook: ${JSON.stringify(clicked)}`);
  check(
    afterModifier?.length === 1 && afterModifier[0]?.start.line === before?.start.line,
    `⌘-click moved or added a caret: ${JSON.stringify(afterModifier)}`,
  );

  const second = point(editor, 3, 1);
  await click(second.x, second.y, 1 | 8);
  check(editor.getViewState().selections?.length === 2, "⌥⇧-click added no caret");

  const line = point(editor, 5, 0);
  await click(line.x, line.y);
  await compose(["n", "に", "にほ"], "日本");
  await compose(["ㅎ", "하", "한"], "한");
  check(
    text.split("\n")[5] === "日本한",
    `IME composition wrote ${JSON.stringify(text.split("\n")[5])}`,
  );
  check(
    editor.getViewState().selections?.at(-1)?.start.character === 3,
    `the caret after composition is at ${JSON.stringify(editor.getViewState().selections?.at(-1))}`,
  );

  editor.setOptions({ readOnly: true });
  await press("y", "KeyY", "y");
  await compose(["a"], "あ");
  check(
    text.split("\n")[5] === "日本한",
    `a read-only editor took input: ${JSON.stringify(text.split("\n")[5])}`,
  );

  editor.setOptions({ readOnly: false });
  editor.setSelections([
    { start: { line: FAR, character: 27 }, end: { line: FAR, character: 27 }, direction: "none" },
  ]);
  const far = await until(
    () =>
      [
        ...(container
          .querySelector("diffs-container")
          ?.shadowRoot?.querySelectorAll("[data-char]") ?? []),
      ].find(
        (element) =>
          element.textContent === "Register" &&
          element.closest(`[data-line="${String(FAR + 1)}"]`) !== null,
      ),
    "the far Register token",
  );
  await paint();
  const farMeasured = editor.getRangeRect({
    start: { line: FAR, character: 27 },
    end: { line: FAR, character: 35 },
  });
  const farDrawn = far.getBoundingClientRect();

  check(
    farMeasured !== undefined &&
      Math.abs(farMeasured.left - farDrawn.left) < 2 &&
      Math.abs(farMeasured.top - farDrawn.top) < 4,
    `scrolled getRangeRect ${JSON.stringify(farMeasured)} isn't where the token is drawn ${JSON.stringify(farDrawn)}`,
  );

  return "passed";
}
