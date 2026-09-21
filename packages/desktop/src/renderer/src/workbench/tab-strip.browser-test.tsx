import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { sessionId } from "@nyte-ai/protocol";
import type { JobInfo } from "@nyte-ai/protocol";
import { WorkbenchTabStrip } from "./tab-strip.tsx";
import { workbenchController, workbenchViewKey } from "./controller.ts";
import { fileActions } from "./file-store.ts";
import { terminalActions } from "./terminal-store.ts";
import "../theme/tokens.css";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export async function run(): Promise<string> {
  const session = sessionId("browser-tab-strip-session");
  const job: JobInfo = {
    id: "browser-tab-strip-job",
    origin: { kind: "run", runId: "run", callId: "call" },
    head: "main",
    command: "pnpm test",
    phase: { kind: "running", mode: "background" },
    startedAt: 1,
    updatedAt: 1,
    output: "running\n",
  };
  const viewKey = workbenchViewKey({
    paneKey: "browser-tab-strip",
    target: { kind: "workspace", workspacePath: "/workspace" },
  });
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
  fileActions.open(viewKey, { path: "/workspace/src/app.ts", displayPath: "src/app.ts" });
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
    const accent = agentTab.querySelector<HTMLElement>('[data-agent-terminal="true"]');
    if (accent === null) throw new Error("Agent terminal has no accent class");
    const probe = document.createElement("span");
    probe.style.color = "var(--nyte-purple)";
    container.append(probe);
    check(
      getComputedStyle(accent).color === getComputedStyle(probe).color,
      "Agent terminal does not use the agent accent token",
    );
    check(workbenchController.getView(viewKey).active === active, "Rendering changed activation");
    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}
