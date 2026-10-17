/**
 * The page side of a pick is main's script; this proves the panel's half: the
 * toggle and the chord start a pick, and a picked element reaches the chat as
 * its HTML under its selector with its crop as a PNG.
 */
import "../../test/window-bridge.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { receiveChatExcerpts } from "../conversation/add-to-chat.ts";
import { ComposerEditor } from "../conversation/composer-editor.tsx";
import type { ComposerEditorHandle } from "../conversation/composer-editor.tsx";
import { macPlatform } from "../platform.ts";
import { BrowserPanel } from "./browser-panel.tsx";

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

  const stop = receiveChatExcerpts(({ reference, image }) => {
    composer.current?.insertReference(reference);

    if (image !== undefined) images.push(image);
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
        metaKey: macPlatform(undefined),
        ctrlKey: !macPlatform(undefined),
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(() => window.__nytePicks === 2, "the chord to start a pick");

    return "passed";
  } finally {
    stop();
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
