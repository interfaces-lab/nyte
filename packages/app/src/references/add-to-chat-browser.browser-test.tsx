import "../../test/window-bridge.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { receiveChatExcerpts } from "./add-to-chat.ts";
import { ComposerEditor } from "../chat/composer/composer-editor.tsx";
import type { ComposerEditorHandle } from "../chat/composer/composer-editor.tsx";
import { nyte } from "../contract/nyte.ts";
import { BrowserPanel } from "../workbench/browser/browser-panel.tsx";

declare global {
  interface Window {
    readonly __nytePicks: number;
  }
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;height:600px;width:900px";
  document.body.append(container);
  const root = createRoot(container);
  const composer = createRef<ComposerEditorHandle>();
  const images: File[] = [];

  let stop = receiveChatExcerpts((excerpt) => {
    if ("reference" in excerpt) composer.current?.insertReference(excerpt.reference);

    if (excerpt.image !== undefined) images.push(excerpt.image);

    return composer.current?.readElement() ?? false;
  });

  flushSync(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <div style={{ height: 96 }}>
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
        <BrowserPanel
          surface="add-to-chat-test"
          visible
          historyVisible={false}
          onToggleHistory={() => undefined}
          url="https://example.com/"
          onUrlChange={() => undefined}
          workspacePath={null}
        />
      </QueryClientProvider>,
    ),
  );

  const toggle = (): HTMLButtonElement | null =>
    container.querySelector('button[aria-label="Add Element to Chat"]');

  try {
    await until(() => toggle() !== null, "the page to load");
    toggle()?.click();
    await until(() => window.__nytePicks === 1, "the toggle to start a pick");
    await until(
      () => container.querySelector('[data-composer-chip="excerpt"]') !== null,
      "the picked element's chip",
    );

    const part = composer.current?.read().parts.find((candidate) => candidate.kind === "excerpt");
    check(
      JSON.stringify(part) ===
        JSON.stringify({
          kind: "excerpt",
          source: {
            kind: "browser",
            url: "https://example.com/",
            selector: "main > button.primary",
          },
          text: '<button class="primary">Save</button>',
        }),
      `The element goes to the chat as its HTML under its selector, not ${JSON.stringify(part)}`,
    );
    const chip = container.querySelector('[data-composer-chip="excerpt"]');
    check(
      chip?.textContent === "button.primary",
      `The chip names the element: ${chip?.textContent}`,
    );
    const [image] = images;
    check(
      image?.type === "image/png" && image.size === 4,
      "The crop goes beside the chip as a PNG",
    );
    check(toggle()?.getAttribute("aria-pressed") === "false", "The pick ends once it answers");

    const browser = container.querySelector('section[aria-label="Browser"]');
    browser?.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyL",
        key: "L",
        shiftKey: true,
        metaKey: nyte.platform === "darwin",
        ctrlKey: nyte.platform !== "darwin",
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(() => window.__nytePicks === 2, "the chord to start a pick");
    await until(
      () => toggle()?.getAttribute("aria-pressed") === "false",
      "the shortcut pick to finish",
    );
    stop();
    stop = receiveChatExcerpts(async () => {
      throw new Error("Could not read element.png");
    });
    toggle()?.click();
    await until(() => window.__nytePicks === 3, "the failing image pick to start");
    await until(
      () =>
        browser
          ?.querySelector('[role="alert"]')
          ?.textContent?.includes("Could not read element.png") === true,
      "the picked image's intake error",
    );
    check(toggle()?.getAttribute("aria-pressed") === "false", "A failed intake must end the pick");

    return "passed";
  } finally {
    stop();
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
