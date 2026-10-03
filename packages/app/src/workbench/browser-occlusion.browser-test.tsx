/**
 * The occlusion contract, end to end: a menu that opens over a browser panel
 * must make the panel report its page hidden, without changing its bounds, and
 * must hand the page back when the menu closes.
 *
 * `window.nyte` is installed by the setup script below, before this module's
 * imports run, because the renderer reads the bridge at import time.
 */
import "../../test/window-bridge.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactElement } from "react";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import type { BrowserBoundsMessage } from "../bridge.ts";
import { BrowserPanel } from "./browser-panel.tsx";
import { applyDisplayMode } from "../theme/appearance.ts";
import "../theme/tokens.stylex.ts";

const URL_UNDER_TEST = "https://example.com/";

declare global {
  interface Window {
    readonly __nyteBounds: readonly BrowserBoundsMessage[];
  }
}

function last(): BrowserBoundsMessage {
  const message = window.__nyteBounds.at(-1);

  if (message === undefined) throw new Error("The panel never reported bounds");

  return message;
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

/** A menu anchored at the centre of the viewport, so its popup lands on the page. */
function Harness({ menuOpen }: { menuOpen: boolean }): ReactElement {
  return (
    <>
      <BrowserPanel
        surface="occlusion-test"
        visible
        historyVisible={false}
        url={URL_UNDER_TEST}
        onUrlChange={() => undefined}
        workspacePath={null}
      />
      <Menu open={menuOpen} onOpenChange={() => undefined}>
        <MenuTrigger
          render={
            <button type="button" style={{ position: "fixed", top: "50%", left: "50%" }}>
              Open
            </button>
          }
        />
        <MenuContent>
          <MenuItem>Files</MenuItem>
        </MenuContent>
      </Menu>
    </>
  );
}

export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:600px;width:900px";
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();

  const render = (menuOpen: boolean): void =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness menuOpen={menuOpen} />
        </QueryClientProvider>,
      ),
    );

  render(false);

  await until(() => window.__nyteBounds.length > 0 && last().visible, "the page to be shown");
  const shown = last();
  check(shown.bounds.width > 0 && shown.bounds.height > 0, "The page was placed at zero size");

  render(true);
  await until(() => !last().visible, "the page to hide under the menu");
  const hidden = last();
  check(
    hidden.bounds.x === shown.bounds.x &&
      hidden.bounds.y === shown.bounds.y &&
      hidden.bounds.width === shown.bounds.width &&
      hidden.bounds.height === shown.bounds.height,
    "Hiding the page moved or resized it instead of leaving its bounds alone",
  );

  render(false);
  await until(() => last().visible, "the page to come back when the menu closes");

  return "passed";
}

applyDisplayMode("light");
