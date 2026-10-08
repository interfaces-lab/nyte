import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { sessionId } from "@nyte-ai/protocol";
import type { JobInfo } from "@nyte-ai/protocol";
import { WorkbenchTabStrip } from "./tab-strip.tsx";
import { workbenchController, workbenchViewKey } from "./controller.ts";
import { fileActions } from "./file-store.ts";
import { terminalActions } from "./terminal-store.ts";
import { applyDisplayMode } from "../theme/appearance.ts";
import "../theme/tokens.stylex.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function drag(from: HTMLElement, distance: number): Promise<void> {
  const rect = from.getBoundingClientRect();
  const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const pointer = { bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, button: 0 };

  from.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, ...point, buttons: 1 }));

  for (let moved = 10; moved <= distance; moved += 10) {
    await nextFrame();
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        ...pointer,
        ...point,
        clientX: point.clientX + moved,
        buttons: 1,
      }),
    );
  }

  await nextFrame();
  document.dispatchEvent(
    new PointerEvent("pointerup", { ...pointer, ...point, clientX: point.clientX + distance }),
  );
  await nextFrame();
}

export async function run(): Promise<string> {
  const session = sessionId("browser-tab-strip-session");

  const job: JobInfo = {
    id: "browser-tab-strip-job",
    origin: { kind: "run", runId: "run", callId: "call" },
    head: "main",
    command: "pnpm test",
    isBackgrounded: true,
    phase: { kind: "running" },
    startedAt: 1,
    updatedAt: 1,
    output: "running\n",
  };

  const viewKey = workbenchViewKey("/workspace/browser-tab-strip");
  workbenchController.actions.openTab({
    view: viewKey,
    tab: {
      kind: "changes",
      scope: { kind: "uncommitted" },
      selectedPath: null,
      pathRevealRevision: 0,
      scrollTop: 0,
    },
    activate: true,
  });

  const terminalId = workbenchController.actions.openTab({
    view: viewKey,
    tab: { kind: "terminal", owner: { kind: "agent", sessionId: session, jobId: job.id } },
    activate: false,
  });

  terminalActions.openJob({ id: terminalId, sessionId: session, job });
  fileActions.open(viewKey, { path: "/workspace/browser-tab-strip/src/app.ts" });
  const active = workbenchController.getView(viewKey).active;

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    flushSync(() =>
      root.render(
        <WorkbenchTabStrip
          viewKey={viewKey}
          view={workbenchController.getView(viewKey)}
          scope={{ kind: "project" }}
          capabilities={{ terminal: true, browser: true }}
          workspacePath="/workspace"
        />,
      ),
    );
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    check(
      tabs.map((tab) => tab.getAttribute("aria-label")).join("|") ===
        "Changes|pnpm test|src/app.ts",
      "Tabs must keep the controller's interleaved order",
    );
    const agentTab = tabs[1];
    check(agentTab !== undefined, "Missing agent terminal tab");
    check(agentTab.getAttribute("aria-selected") === "false", "Agent job start stole focus");
    check(
      container.querySelector('[aria-label="Running"]') !== null,
      "Running state is not visible",
    );
    check(
      agentTab.title.includes("Agent command · read-only"),
      "Agent terminal tooltip lost its read-only label",
    );
    const glyph = agentTab.querySelector("svg");

    if (glyph === null) throw new Error("Missing agent terminal glyph");
    check(
      getComputedStyle(glyph).color === getComputedStyle(agentTab).color,
      "Agent terminal glyph must use its tab control color",
    );
    check(workbenchController.getView(viewKey).active === active, "Rendering changed activation");

    const kinds = (): string =>
      workbenchController
        .getView(viewKey)
        .tabs.map((tab) => tab.kind)
        .join("|");

    const [changesTab] = tabs;

    if (changesTab === undefined) throw new Error("Missing changes tab");
    const close = container.querySelector<HTMLElement>('[aria-label="Close Changes tab"]');

    if (close === null) throw new Error("Missing close button");
    await drag(close, 400);
    check(kinds() === "changes|terminal|file", "Pressing a close button started a drag");
    await drag(changesTab, 400);
    check(kinds() === "terminal|file|changes", "Dragging a tab past the end did not reorder it");
    check(
      workbenchController.getView(viewKey).active ===
        workbenchController.getView(viewKey).tabs.find((tab) => tab.kind === "changes")?.id,
      "Picking a tab up did not select it",
    );

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
