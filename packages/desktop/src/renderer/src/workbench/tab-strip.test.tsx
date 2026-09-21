import { afterAll, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { JobInfo } from "@nyte-ai/protocol";
import { WorkbenchTabStrip } from "./tab-strip.tsx";
import { workbenchController, workbenchViewKey } from "./controller.ts";
import { fileActions } from "./file-store.ts";
import { terminalActions } from "./terminal-store.ts";

vi.hoisted(() => {
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: () => {} },
    nyte: {
      jobs: { list: async () => [] },
      host: {
        terminal: {
          create: async (input: { readonly id: string }) => ({
            id: input.id,
            title: "zsh",
            cwd: "/workspace",
          }),
          close: async () => undefined,
          idle: async () => true,
        },
      },
    },
  });
  vi.stubGlobal("localStorage", window.localStorage);
  const styleHost = { insertBefore: () => {}, appendChild: () => {}, firstChild: null };
  vi.stubGlobal("document", {
    documentElement: { dataset: {}, style: { setProperty: () => {} } },
    getElementById: () => null,
    getElementsByTagName: () => [styleHost],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, textContent: "" }),
    createTextNode: (text: string) => ({ text }),
    head: styleHost,
  });
});
afterAll(() => vi.unstubAllGlobals());

const session = sessionId("tab-strip-session");
const job: JobInfo = {
  id: "tab-strip-job",
  origin: { kind: "run", runId: "run", callId: "call" },
  head: "main",
  command: "pnpm test",
  phase: { kind: "running", mode: "background" },
  startedAt: 1,
  updatedAt: 1,
  output: "running\n",
};

describe("workbench tab strip", () => {
  test("renders panel, terminal, and file tabs in controller order", () => {
    const viewKey = workbenchViewKey({
      paneKey: "strip-order",
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
    workbenchController.actions.openTab({
      view: viewKey,
      tab: { kind: "browser", url: "about:blank" },
      activate: true,
    });

    const html = renderToStaticMarkup(
      <WorkbenchTabStrip
        viewKey={viewKey}
        view={workbenchController.getView(viewKey)}
        scope={{ kind: "project" }}
        workspacePath="/workspace"
      />,
    );
    const changes = html.indexOf(">Changes<");
    const terminal = html.indexOf(">pnpm test<");
    const file = html.indexOf(">app.ts<");
    const browser = html.indexOf(">Browser<");

    expect(changes).toBeGreaterThan(-1);
    expect(terminal).toBeGreaterThan(changes);
    expect(file).toBeGreaterThan(terminal);
    expect(browser).toBeGreaterThan(file);
  });

  test("marks a running agent terminal with its accent class without focusing it", () => {
    const viewKey = workbenchViewKey({ paneKey: "agent-strip", target: { kind: "home" } });
    const browser = workbenchController.actions.openTab({
      view: viewKey,
      tab: { kind: "browser", url: "about:blank" },
      activate: true,
    });
    const terminalId = workbenchController.actions.openTab({
      view: viewKey,
      tab: { kind: "terminal", owner: { kind: "agent", sessionId: session, jobId: job.id } },
      activate: false,
    });
    terminalActions.openJob({ id: terminalId, sessionId: session, job });

    const html = renderToStaticMarkup(
      <WorkbenchTabStrip
        viewKey={viewKey}
        view={workbenchController.getView(viewKey)}
        scope={{ kind: "pathless" }}
        workspacePath={null}
      />,
    );

    expect(workbenchController.getView(viewKey).active).toBe(browser);
    expect(html).toContain("Agent command · read-only");
    expect(html).toContain('aria-label="Running"');
    expect(html).toMatch(/data-agent-terminal="true" class="[^"]+"/);
  });
});
