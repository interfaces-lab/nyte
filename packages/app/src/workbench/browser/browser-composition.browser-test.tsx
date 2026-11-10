import "../../../test/window-bridge.ts";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useState } from "react";
import type { ReactElement } from "react";
import { AddressField } from "./browser-address-field.tsx";
import { FindBar } from "./browser-find.tsx";
import "../../theme/tokens.stylex.ts";

declare global {
  interface Window {
    readonly __nyteFinds: readonly string[];
  }
}

const HISTORY = [
  { url: "http://127.0.0.1:3000/", title: "Dev server", visitedAt: 2, visits: 1 },
  { url: "http://example.com/path", title: "Example", visitedAt: 1, visits: 1 },
];

const opened: string[] = [];

let dismissed = 0;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function Harness(): ReactElement {
  const [draft, setDraft] = useState<string>();

  return (
    <AddressField
      ref={null}
      currentUrl=""
      draft={draft}
      onDraftChange={setDraft}
      history={HISTORY}
      bookmarks={[]}
      onOpen={(url) => opened.push(url)}
      onForget={() => undefined}
      onDismiss={() => {
        dismissed += 1;
      }}
    />
  );
}

const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

function input(field: HTMLInputElement, text: string, isComposing: boolean): void {
  value?.set?.call(field, text);
  field.setSelectionRange(text.length, text.length);
  field.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      isComposing,
      inputType: isComposing ? "insertCompositionText" : "insertText",
    }),
  );
}

function key(field: HTMLInputElement, name: string, isComposing: boolean): void {
  field.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name, isComposing }),
  );
}

function selection(field: HTMLInputElement): string {
  return `${field.value} [${String(field.selectionStart)}, ${String(field.selectionEnd)}]`;
}

export async function run(): Promise<string> {
  await find();
  await address();

  return "passed";
}

async function find(): Promise<void> {
  let closed = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() =>
    root.render(
      <FindBar
        surface="page"
        ref={null}
        onClose={() => {
          closed += 1;
        }}
      />,
    ),
  );
  const field = container.querySelector("input");

  if (field === null) throw new Error("The find field did not render");
  await nextFrame();

  input(field, "ㄱ", true);
  input(field, "가", true);
  key(field, "Enter", true);
  key(field, "Escape", true);
  check(window.__nyteFinds.length === 0, `Composing searched: ${window.__nyteFinds.join()}`);
  check(closed === 0, "Escape during composition closed find");

  field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "가" }));
  check(window.__nyteFinds.join() === "가", `The finished text: ${window.__nyteFinds.join()}`);

  await nextFrame();
  input(field, "가n", false);
  check(window.__nyteFinds.length === 2, "Typing after the composition did not search");

  await nextFrame();
  key(field, "Escape", false);
  check(closed === 1, "Escape did not close find");

  flushSync(() => root.unmount());
  container.remove();
}

async function address(): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  flushSync(() => createRoot(container).render(<Harness />));
  const field = container.querySelector("input");

  if (field === null) throw new Error("The field did not render");

  field.focus();
  await nextFrame();

  for (const text of ["1", "12", "127", "127.", "127.0"]) {
    input(field, text, true);
    check(
      selection(field) === `${text} [${String(text.length)}, ${String(text.length)}]`,
      `Composing ${text} changed the field: ${selection(field)}`,
    );
  }

  field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "127.0" }));
  check(
    selection(field) === "127.0.0.1:3000 [5, 14]",
    `The finished composition was not filled in: ${selection(field)}`,
  );

  field.blur();
  field.focus();
  await nextFrame();
  input(field, "exam", false);
  check(selection(field) === "example.com/path [4, 16]", `No completion: ${selection(field)}`);
  key(field, "Tab", false);
  await nextFrame();
  key(field, "Enter", false);
  check(
    opened.join() === "http://example.com/path",
    `Enter after Tab opened ${opened.join() || "nothing"}`,
  );

  field.focus();
  await nextFrame();
  key(field, "Escape", false);
  check(dismissed === 0 && document.activeElement === field, "Escape left before closing the list");
  await nextFrame();
  key(field, "Escape", false);
  check(
    dismissed === 1 && document.activeElement !== field,
    "The second Escape did not hand the keyboard back",
  );
}
