import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { asId } from "@nyte-ai/schema";
import type { JobView } from "@nyte-ai/sdk";
import { WorkbenchTabStrip } from "./tab-strip.tsx";
import { workbenchViewKey } from "./paths.ts";
import { workbench } from "./store.ts";
import { fileActions } from "./editor/file-store.ts";
import { terminalActions } from "./terminal/terminal-store.ts";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
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
  const workspace = asId<"workspace">("browser-tab-strip-workspace");

  const job: JobView = {
    id: asId<"job">("browser-tab-strip-job"),
    command: "pnpm test",
    title: "pnpm test",
    session: null,
    pty: null,
    state: { kind: "running" },
    startedAt: 1,
    endedAt: null,
    tail: "running\n",
    foreground: false,
  };

  const viewKey = workbenchViewKey("/workspace/browser-tab-strip");
  workbench.dispatch(viewKey, {
    kind: "open-changes",
    id: "changes",
    scope: { kind: "uncommitted" },
    path: null,
  });

  const terminalId = "agent-terminal";
  workbench.dispatch(viewKey, {
    kind: "open",
    tab: { id: terminalId, kind: "terminal", owner: { kind: "job", workspace, job: job.id } },
    activate: false,
  });

  terminalActions.openJob({ id: terminalId, workspace, job });
  fileActions.open(viewKey, { path: "/workspace/browser-tab-strip/src/app.ts" });
  await nextFrame();
  const active = workbench.getView(viewKey).active;

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    flushSync(() =>
      root.render(
        <WorkbenchTabStrip
          viewKey={viewKey}
          view={workbench.getView(viewKey)}
          scope={{ kind: "project" }}
          capabilities={{ browser: true }}
        />,
      ),
    );
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    check(
      tabs.map((tab) => tab.getAttribute("aria-label")).join("|") ===
        "Changes|pnpm test|src/app.ts",
      "Tabs must keep the store's interleaved order",
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
    check(workbench.getView(viewKey).active === active, "Rendering changed activation");

    const kinds = (): string =>
      workbench
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
      workbench.getView(viewKey).active ===
        workbench.getView(viewKey).tabs.find((tab) => tab.kind === "changes")?.id,
      "Picking a tab up did not select it",
    );

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
