/**
 * Find under typing as Chromium delivers it: composed text searches once the
 * composition ends, keys that finish a composition do not act, and closing the
 * bar hands the keyboard back to the page.
 */
import "../../test/window-bridge.ts";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { FindBar } from "./browser-find.tsx";
import "../theme/tokens.stylex.ts";

declare global {
  interface Window {
    readonly __nyteFinds: readonly string[];
  }
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

function input(field: HTMLInputElement, text: string, isComposing: boolean): void {
  value?.set?.call(field, text);
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

export async function run(): Promise<string> {
  let closed = 0;
  const container = document.createElement("div");
  document.body.append(container);
  flushSync(() =>
    createRoot(container).render(
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

  input(field, "\u3131", true);
  input(field, "\uac00", true);
  key(field, "Enter", true);
  key(field, "Escape", true);
  check(window.__nyteFinds.length === 0, `Composing searched: ${window.__nyteFinds.join()}`);
  check(closed === 0, "Escape during composition closed find");

  field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "\uac00" }));
  check(window.__nyteFinds.join() === "\uac00", `The finished text: ${window.__nyteFinds.join()}`);

  await nextFrame();
  input(field, "\uac00n", false);
  check(window.__nyteFinds.length === 2, "Typing after the composition did not search");

  await nextFrame();
  key(field, "Escape", false);
  check(closed === 1, "Escape did not close find");

  return "passed";
}
