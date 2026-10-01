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
import { Menu, MenuItem } from "@nyte-ai/ui/menu";
import { OverlayRefProvider } from "@nyte-ai/ui/overlay";
import { overlayRef } from "../components/overlay-occlusion.ts";
import { BrowserPanel } from "./browser-panel.tsx";
import { applyDisplayMode } from "../theme/appearance.ts";
import "../theme/tokens.stylex.ts";

const URL_UNDER_TEST = "https://example.com/";

interface RecordedBounds {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function recordedBounds(): readonly RecordedBounds[] {
  const raw: unknown = Reflect.get(window, "__nyteBounds");
  if (!Array.isArray(raw)) throw new Error("The bounds recorder is missing");
  return raw.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) throw new Error("Bad bounds message");
    const visible: unknown = Reflect.get(entry, "visible");
    const box: unknown = Reflect.get(entry, "bounds");
    if (typeof visible !== "boolean" || typeof box !== "object" || box === null) {
      throw new Error("Bad bounds message");
    }
    const read = (key: string): number => {
      const value: unknown = Reflect.get(box, key);
      if (typeof value !== "number") throw new Error(`Bad bounds ${key}`);
      return value;
    };
    return { visible, x: read("x"), y: read("y"), width: read("width"), height: read("height") };
  });
}

function last(): RecordedBounds {
  const message = recordedBounds().at(-1);
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
      <Menu
        label="Overlay"
        open={menuOpen}
        onOpenChange={() => undefined}
        trigger={
          <button type="button" style={{ position: "fixed", top: "50%", left: "50%" }}>
            Open
          </button>
        }
      >
        <MenuItem onSelect={() => undefined}>Files</MenuItem>
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
          <OverlayRefProvider value={overlayRef}>
            <Harness menuOpen={menuOpen} />
          </OverlayRefProvider>
        </QueryClientProvider>,
      ),
    );
  render(false);

  await until(() => recordedBounds().length > 0 && last().visible, "the page to be shown");
  const shown = last();
  check(shown.width > 0 && shown.height > 0, "The page was placed at zero size");

  render(true);
  await until(() => !last().visible, "the page to hide under the menu");
  const hidden = last();
  check(
    hidden.x === shown.x &&
      hidden.y === shown.y &&
      hidden.width === shown.width &&
      hidden.height === shown.height,
    "Hiding the page moved or resized it instead of leaving its bounds alone",
  );

  render(false);
  await until(() => last().visible, "the page to come back when the menu closes");
  return "passed";
}

applyDisplayMode("light");
