import assert from "node:assert/strict";
import { sessionId } from "@nyte-ai/protocol";
import type { JobInfo } from "@nyte-ai/protocol";
import { beforeEach, describe, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => {
  const terminalCreate = vi.fn(
    async (input: { readonly id: string; readonly workspacePath: string | null }) => ({
      id: input.id,
      title: "zsh",
      cwd: input.workspacePath ?? "/home/test",
    }),
  );
  const terminalWrite = vi.fn(async () => undefined);
  const terminalResize = vi.fn(async () => undefined);
  const terminalAcknowledge = vi.fn(async () => undefined);
  const terminalClose = vi.fn(async () => undefined);
  const jobsCancel = vi.fn<
    (input: {
      readonly sessionId: string;
      readonly jobId: string;
    }) => Promise<{ readonly kind: "applied" | "finished" | "not_found" }>
  >(async () => ({ kind: "applied" }));
  vi.stubGlobal("window", {
    nyte: {
      jobs: { cancel: jobsCancel },
      host: {
        terminal: {
          create: terminalCreate,
          write: terminalWrite,
          resize: terminalResize,
          acknowledge: terminalAcknowledge,
          close: terminalClose,
        },
      },
    },
  });
  return {
    jobsCancel,
    terminalAcknowledge,
    terminalClose,
    terminalCreate,
    terminalResize,
    terminalWrite,
  };
});

import {
  applyTerminalEvent,
  attachTerminalOutput,
  getTerminal,
  isJobTerminal,
  isShellTerminal,
  openJobTerminal,
  openSessionJobTerminal,
  terminalActions,
} from "./terminal-store.ts";
import { createWorkbenchController, workbenchViewKey } from "./controller.ts";
import type { TerminalOutput } from "./terminal-store.ts";

let index = 0;
function tabId(): string {
  index += 1;
  return `terminal-tab-${String(index)}`;
}

const firstSession = sessionId("terminal-session-1");

function command(id: string, change: Partial<JobInfo> = {}): JobInfo {
  return {
    id,
    origin: { kind: "run", runId: "run-1", callId: "call-1" },
    head: "main",
    command: "Run tests",
    phase: { kind: "running", mode: "background" },
    startedAt: 1,
    updatedAt: 1,
    output: "starting\n",
    ...change,
  };
}

function sink() {
  let contents = "";
  return {
    get contents() {
      return contents;
    },
    write(data: string) {
      contents += data;
    },
    replace(data: string) {
      contents = data;
    },
    update(_tab: Parameters<TerminalOutput["update"]>[0]) {},
    dispose() {},
  } satisfies TerminalOutput & { readonly contents: string };
}

beforeEach(() => {
  ipc.jobsCancel.mockClear();
  ipc.terminalAcknowledge.mockClear();
  ipc.terminalClose.mockClear();
  ipc.terminalCreate.mockClear();
  ipc.terminalResize.mockClear();
  ipc.terminalWrite.mockClear();
});

describe("job-backed terminal runtime", () => {
  test("a job start adds an unfocused agent-owned tab with running runtime state", () => {
    const controller = createWorkbenchController();
    const view = workbenchViewKey({ paneKey: tabId(), target: { kind: "home" } });
    const browser = controller.actions.openTab({
      view,
      tab: { kind: "browser", url: "about:blank" },
      activate: true,
    });
    const job = command(`job-${tabId()}`);

    const id = openJobTerminal({
      controller,
      view,
      sessionId: firstSession,
      job,
      activate: false,
    });

    const tab = controller.getView(view).tabs.find((candidate) => candidate.id === id);
    assert.deepEqual(tab, {
      id,
      kind: "terminal",
      owner: { kind: "agent", sessionId: firstSession, jobId: job.id },
    });
    assert.equal(controller.getView(view).active, browser);
    const terminal = getTerminal(id);
    assert.ok(terminal);
    assert.ok(isJobTerminal(terminal));
    assert.equal(terminal.state.kind, "running");
  });

  test("a child job opens in the displayed parent session view", () => {
    const controller = createWorkbenchController();
    const parentSession = sessionId("displayed-parent");
    const childSession = sessionId("tray-child");
    const job = command(`job-${tabId()}`);

    const id = openSessionJobTerminal({
      controller,
      displayedSessionId: parentSession,
      jobSessionId: childSession,
      job,
      activate: true,
    });

    const parentView = workbenchViewKey({
      paneKey: "stage",
      target: { kind: "session", sessionId: parentSession },
    });
    const childView = workbenchViewKey({
      paneKey: "stage",
      target: { kind: "session", sessionId: childSession },
    });
    assert.equal(controller.getView(parentView).active, id);
    assert.deepEqual(controller.getView(parentView).tabs[0], {
      id,
      kind: "terminal",
      owner: { kind: "agent", sessionId: childSession, jobId: job.id },
    });
    assert.deepEqual(controller.getView(childView).tabs, []);
  });

  test("binds output and job state to the controller tab ID", () => {
    const id = tabId();
    const job = command(`job-${id}`);
    terminalActions.openJob({ id, sessionId: firstSession, job });
    const output = sink();
    attachTerminalOutput(id, output);

    terminalActions.syncJobs(firstSession, [
      { ...job, command: "Updated title", output: "starting\nrunning\n" },
    ]);

    const terminal = getTerminal(id);
    assert.ok(terminal);
    assert.ok(isJobTerminal(terminal));
    assert.equal(terminal.title, "Updated title");
    assert.equal(output.contents, "starting\nrunning\n");
  });

  test("closing an agent tab leaves the queried job running", async () => {
    const id = tabId();
    const job = command(`job-${id}`);
    terminalActions.openJob({ id, sessionId: firstSession, job });

    await terminalActions.close(id);

    expect(ipc.jobsCancel).not.toHaveBeenCalled();
    expect(ipc.terminalClose).not.toHaveBeenCalled();
    assert.equal(job.phase.kind, "running");
    assert.equal(getTerminal(id), undefined);
  });

  test("keeps renderer failure separate from command state", () => {
    const id = tabId();
    terminalActions.openJob({ id, sessionId: firstSession, job: command(`job-${id}`) });

    terminalActions.fail(id, "Canvas rendering is unavailable");
    const terminal = getTerminal(id);
    assert.ok(terminal);
    assert.ok(isJobTerminal(terminal));
    assert.equal(terminal.state.kind, "running");
    assert.deepEqual(terminal.rendering, {
      kind: "failed",
      message: "Canvas rendering is unavailable",
    });
    expect(ipc.jobsCancel).not.toHaveBeenCalled();
  });
});

describe("shell terminal runtime", () => {
  test("keeps host create, queued output, exit, and close behavior", async () => {
    const id = tabId();
    await terminalActions.create({ id, workspacePath: "/workspace" });
    const tab = getTerminal(id);
    assert.ok(tab);
    assert.ok(isShellTerminal(tab));
    assert.equal(tab.state.kind, "running");
    assert.equal(tab.title, "zsh");
    expect(ipc.terminalCreate).toHaveBeenCalledWith({ id, workspacePath: "/workspace" });

    applyTerminalEvent({ kind: "terminal_data", id, data: "shell output" });
    const output = sink();
    attachTerminalOutput(id, output);
    assert.equal(output.contents, "shell output");
    applyTerminalEvent({ kind: "terminal_exit", id, exitCode: 7 });
    const exited = getTerminal(id);
    assert.ok(exited);
    assert.ok(!isJobTerminal(exited));
    assert.deepEqual(exited.state, { kind: "exited", exitCode: 7 });

    await terminalActions.close(id);
    expect(ipc.terminalClose).toHaveBeenCalledWith({ id });
    expect(ipc.jobsCancel).not.toHaveBeenCalled();
    assert.equal(getTerminal(id), undefined);
  });
});
