import "../../test/window-bridge.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactElement } from "react";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import type { BrowserBoundsMessage } from "../contract/bridge.ts";
import { BrowserPanel } from "../workbench/browser/browser-panel.tsx";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";

const URL_UNDER_TEST = "https://example.com/";

interface RecordedBounds extends BrowserBoundsMessage {
  /** Whether the still had loaded in the slot when the panel sent these bounds. */
  readonly still: boolean;
}

declare global {
  interface Window {
    readonly __nyteBounds: readonly RecordedBounds[];
    readonly __nyteCapture: {
      readonly calls: number;
      mode: "still" | "hold" | "reject" | "broken";
    };
  }
}

function last(): RecordedBounds {
  const message = window.__nyteBounds.at(-1);

  if (message === undefined) throw new Error("The panel never reported bounds");

  return message;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function still(): Element | null {
  return document.querySelector('section[aria-label="Browser"] img[src^="data:image/"]');
}

function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left === 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };

    step(count);
  });
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function Harness({ menuOpen }: { menuOpen: boolean }): ReactElement {
  return (
    <>
      <BrowserPanel
        surface="occlusion-test"
        visible
        historyVisible={false}
        onToggleHistory={() => undefined}
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
  await frames(10);
  check(
    still() === null && window.__nyteCapture.calls === 0,
    "The page was captured while nothing covered it",
  );

  render(true);
  await until(() => !last().visible, "the page to hide under the menu");
  const hidden = last();
  check(window.__nyteCapture.calls === 1, "Covering the page did not capture it exactly once");
  check(hidden.still, "The page hid before its still had loaded under it");
  check(
    hidden.bounds.x === shown.bounds.x &&
      hidden.bounds.y === shown.bounds.y &&
      hidden.bounds.width === shown.bounds.width &&
      hidden.bounds.height === shown.bounds.height,
    "Hiding the page moved or resized it instead of leaving its bounds alone",
  );

  render(false);
  await until(() => last().visible, "the page to come back when the menu closes");
  check(still() !== null, "The still left before the page came back over it");
  await until(() => still() === null, "the still to leave once the page shows");

  window.__nyteCapture.mode = "hold";
  render(true);
  const covered = performance.now();
  await frames(5);
  check(last().visible, "The page hid before its capture arrived or the wait ran out");
  await until(() => !last().visible, "the page to hide when its capture never arrives");
  const waited = performance.now() - covered;
  check(waited >= 400 && waited < 1_000, `The page waited ${String(waited)} ms for its capture`);
  check(still() === null, "A still showed although no capture arrived");

  render(false);
  await until(() => last().visible, "the page to come back after a capture that never arrived");

  for (const mode of ["reject", "broken"] as const) {
    window.__nyteCapture.mode = mode;
    const calls = window.__nyteCapture.calls;
    render(true);
    await until(() => window.__nyteCapture.calls > calls, `the ${mode} capture to start`);
    await frames(2);
    check(!last().visible, `The page waited for the cap after a ${mode} capture`);
    check(still() === null, `A still showed after a ${mode} capture`);
    render(false);
    await until(() => last().visible, `the page to come back after a ${mode} capture`);
  }

  return "passed";
}

applyDisplayMode("light");
