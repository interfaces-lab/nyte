import "../../test/window-bridge.ts";
import { createMemoryHistory } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { Deferred, publishDeferred, readDeferred } from "../deferred.tsx";
import deferredUrls from "../deferred-urls.ts";
import { createAppRouter } from "../router.tsx";
import { runWindowCommand } from "../shell/window-commands.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { ChangesPanel } from "./changes-panel.tsx";
import {
  useWorkbenchSnapshot,
  workbenchController,
  WORKBENCH_HOME_VIEW_KEY,
} from "./controller.ts";
import { FilesPanel } from "./files-panel.tsx";
import { TerminalPanel } from "./terminal-panel.tsx";
import {
  addTerminalToChat,
  clearTerminal,
  copyTerminal,
  focusTerminal,
} from "./terminal-runtime.ts";

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
  Object.assign(deferredUrls, { workbench: "data:text/javascript,window.publishWorkbench();" });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const terminals = (): number =>
    workbenchController
      .getView(WORKBENCH_HOME_VIEW_KEY)
      .tabs.filter((tab) => tab.kind === "terminal").length;

  try {
    flushSync(() => root.render(<TerminalSlots />));
    const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });

    check(runWindowCommand(router, "new-terminal"), "New Terminal did not run");
    check(terminals() === 0, "The terminal opened before its panel could render");

    const shown = (): boolean => container.querySelector("[data-terminal]") !== null;

    for (let frame = 0; frame < 120 && !shown(); frame++) await nextFrame();
    check(terminals() === 1, "The terminal never opened");
    check(shown(), "The terminal's panel never rendered");
    check(!fallbackShown, "The terminal's panel suspended behind its fallback");

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}
