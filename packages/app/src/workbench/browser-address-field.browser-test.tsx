/**
 * The address field under typing as Chromium delivers it: composed text is not
 * filled in until the composition ends, and an accepted completion opens the
 * visited page rather than its text read afresh.
 */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useState } from "react";
import type { ReactElement } from "react";
import { AddressField } from "./browser-address-field.tsx";
import "../theme/tokens.stylex.ts";

const HISTORY = [
  { url: "http://127.0.0.1:3000/", title: "Dev server", visitedAt: 2, visits: 1 },
  { url: "http://example.com/path", title: "Example", visitedAt: 1, visits: 1 },
];

const opened: string[] = [];

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
    />
  );
}

const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

/** Sets the text with the caret at its end and fires the input event Chromium would. */
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

function key(field: HTMLInputElement, name: string): void {
  field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name }));
}

function selection(field: HTMLInputElement): string {
  return `${field.value} [${String(field.selectionStart)}, ${String(field.selectionEnd)}]`;
}

export async function run(): Promise<string> {
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
  key(field, "Tab");
  await nextFrame();
  key(field, "Enter");
  check(
    opened.join() === "http://example.com/path",
    `Enter after Tab opened ${opened.join() || "nothing"}`,
  );

  return "passed";
}
