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
import type { BrowserDesignChange, BrowserSurfaceState } from "../contract/bridge.ts";
import { BrowserPanel } from "../workbench/browser/browser-panel.tsx";
import { applyBrowserEvent, applyBrowserPick } from "../workbench/browser/browser-surfaces.ts";

declare global {
  interface Window {
    readonly __nyteChanges: BrowserDesignChange[];
  }
}

const SURFACE = "add-to-chat-test";

const PAGE: BrowserSurfaceState = {
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  secure: "https",
  blocking: "off",
  blocked: 0,
  error: undefined,
  agentHolders: 0,
  fullscreen: false,
  deniedPermissions: [],
  design: { on: false, views: { xray: false, rulers: false, grid: false, contrast: false } },
};

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
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
          surface={SURFACE}
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
    container.querySelector('button[aria-label="Design Mode"]');

  const chips = (): readonly Element[] => [
    ...container.querySelectorAll('[data-composer-chip="excerpt"]'),
  ];

  const changes = (): string => JSON.stringify(window.__nyteChanges);

  try {
    await until(() => toggle() !== null, "the page to load");
    toggle()?.click();
    await until(() => window.__nyteChanges.length === 1, "the toggle to ask for Design Mode");
    check(changes() === '[{"kind":"on"}]', `The toggle asks to turn Design Mode on: ${changes()}`);
    check(
      toggle()?.getAttribute("aria-pressed") === "false",
      "The toggle follows the surface, which hasn't answered yet",
    );

    const on: BrowserSurfaceState = { ...PAGE, design: { ...PAGE.design, on: true } };
    applyBrowserEvent({ kind: "browser_changed", surface: SURFACE, state: on });
    await until(() => toggle()?.getAttribute("aria-pressed") === "true", "the surface to turn on");

    const rulers = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Rulers",
    );

    rulers?.click();
    rulers?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "G", code: "KeyG", shiftKey: true, bubbles: true }),
    );
    rulers?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(() => window.__nyteChanges.length === 4, "the bar's view, key and Esc changes");
    check(
      changes() ===
        JSON.stringify([
          { kind: "on" },
          { kind: "view", view: "rulers", shown: true },
          { kind: "view", view: "grid", shown: true },
          { kind: "off" },
        ]),
      `The bar's toggle, ⇧G and Esc each ask for one change: ${changes()}`,
    );

    applyBrowserPick({
      kind: "browser_design_pick",
      surface: SURFACE,
      pick: {
        source: { kind: "browser", url: "https://example.com/", selector: "main > button.primary" },
        text: "label: button .primary",
        image: "data:image/png;base64,AQIDBA==",
      },
    });
    await until(() => chips().length === 1, "the picked element's chip");
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
          text: "label: button .primary",
        }),
      `The element goes to the chat as its facts under its selector, not ${JSON.stringify(part)}`,
    );
    check(
      chips()[0]?.textContent === "button.primary",
      `The chip names the element: ${chips()[0]?.textContent}`,
    );
    const [image] = images;
    check(
      image?.type === "image/png" && image.name === "element.png" && image.size === 4,
      "The crop goes beside the chip as a PNG",
    );

    applyBrowserPick({
      kind: "browser_design_pick",
      surface: SURFACE,
      pick: {
        source: {
          kind: "browser",
          url: "https://example.com/",
          selector: "main",
          region: { x: 0, y: 40, width: 320.4, height: 180 },
        },
        text: "label: main",
        image: undefined,
      },
    });
    await until(() => chips().length === 2, "the picked area's chip");
    check(
      chips()[1]?.textContent === "Area 320 × 180",
      `The chip names an area by its size: ${chips()[1]?.textContent}`,
    );

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
    await until(() => window.__nyteChanges.length === 5, "the chord to ask for Design Mode off");
    check(
      JSON.stringify(window.__nyteChanges[4]) === '{"kind":"off"}',
      "The chord turns Design Mode off while it is on",
    );

    const alert = (): string => browser?.querySelector('[role="alert"]')?.textContent ?? "";

    stop();
    stop = receiveChatExcerpts(() => false);
    applyBrowserPick({
      kind: "browser_design_pick",
      surface: SURFACE,
      pick: {
        source: { kind: "browser", url: "https://example.com/", selector: "main" },
        text: "label: main",
        image: undefined,
      },
    });
    await until(() => alert().includes("Open a chat"), "the pick with no chat open to report");

    stop();
    stop = receiveChatExcerpts(async () => {
      throw new Error("Could not read element.png");
    });
    applyBrowserPick({
      kind: "browser_design_pick",
      surface: SURFACE,
      pick: {
        source: { kind: "browser", url: "https://example.com/", selector: "main" },
        text: "label: main",
        image: "data:image/png;base64,AQIDBA==",
      },
    });
    await until(
      () => alert().includes("Could not read element.png"),
      "the picked image's intake error",
    );

    return "passed";
  } finally {
    stop();
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
