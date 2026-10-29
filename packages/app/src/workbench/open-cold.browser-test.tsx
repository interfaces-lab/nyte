import "../../test/window-bridge.ts";
import { createMemoryHistory } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { Deferred, publishDeferred, readDeferred } from "../lib/deferred.tsx";
import deferredUrls from "../lib/deferred-urls.ts";
import { createAppRouter } from "../shell/routes.tsx";
import { runWindowCommand } from "../commands/window-commands.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { ChangesPanel } from "./changes/changes-panel.tsx";
import { WORKBENCH_HOME_VIEW_KEY } from "./paths.ts";
import { useWorkbenchSnapshot, workbench } from "./store.ts";
import { FilesPanel } from "./files/files-panel.tsx";
import { TerminalPanel } from "./terminal/terminal-panel.tsx";
import {
  addTerminalToChat,
  clearTerminal,
  copyTerminal,
  focusTerminal,
} from "./terminal/terminal-runtime.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

let fallbackShown = false;

function Fallback(): null {
  useMountEffect(() => {
    fallbackShown = true;
  });

  return null;
}

function TerminalSlots(): ReactElement {
  const view = useWorkbenchSnapshot().views.get(WORKBENCH_HOME_VIEW_KEY);

  return (
    <>
      {view?.tabs
        .filter((tab) => tab.kind === "terminal")
        .map((tab) => (
          <Deferred key={tab.id} entry="workbench" fallback={<Fallback />}>
            {() => <output data-terminal={tab.id} />}
          </Deferred>
        ))}
    </>
  );
}

declare global {
  interface Window {
    publishWorkbench: () => void;
    readonly workbenchModuleUrl: string;
  }
}

export async function run(): Promise<string> {
  check(readDeferred("workbench") === undefined, "The panels' chunk was already loaded");
  window.publishWorkbench = () =>
    publishDeferred("workbench", {
      FilesPanel,
      ChangesPanel,
      TerminalPanel,
      addTerminalToChat,
      clearTerminal,
      copyTerminal,
      focusTerminal,
    });
  Object.assign(deferredUrls, { workbench: window.workbenchModuleUrl });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const terminals = (): number =>
    workbench.getView(WORKBENCH_HOME_VIEW_KEY).tabs.filter((tab) => tab.kind === "terminal").length;

  try {
    flushSync(() => root.render(<TerminalSlots />));
    const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });

    check(runWindowCommand(router, "new-terminal"), "New Terminal did not run");
    check(terminals() === 1, "The terminal's tab waited for its panel's chunk");

    const shown = (): boolean => container.querySelector("[data-terminal]") !== null;

    for (let frame = 0; frame < 120 && !shown(); frame++) await nextFrame();
    check(fallbackShown, "The terminal's panel never showed its fallback while its chunk loaded");
    check(shown(), "The terminal's panel never rendered");

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}
