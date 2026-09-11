import assert from "node:assert/strict";
import { sessionId } from "@nyte-ai/protocol";
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
  getActiveTerminal,
  getJobTerminal,
  getTerminals,
  isJobTerminal,
  isShellTerminal,
  terminalActions,
} from "./terminal-store.ts";
import type { CommandJobInfo, TerminalOutput } from "./terminal-store.ts";

let ownerIndex = 0;

function owner(): string {
  ownerIndex += 1;
  return `terminal-store-test-${String(ownerIndex)}`;
}

const firstSession = sessionId("terminal-session-1");
const secondSession = sessionId("terminal-session-2");

function command(change: Partial<CommandJobInfo> = {}): CommandJobInfo {
  return {
    id: "job-1",
    kind: "command",
    runId: "run-1",
    callId: "call-1",
    head: "main",
    title: "Run tests",
    mode: "background",
    state: "running",
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
  ipc.jobsCancel.mockResolvedValue({ kind: "applied" });
  ipc.terminalAcknowledge.mockClear();
  ipc.terminalClose.mockClear();
  ipc.terminalCreate.mockClear();
  ipc.terminalResize.mockClear();
  ipc.terminalWrite.mockClear();
});

describe("job-backed terminal tabs", () => {
  test("deduplicates an owner/session/job identity and selects the existing tab", () => {
    const currentOwner = owner();
    terminalActions.openJob(currentOwner, firstSession, command());
    terminalActions.openJob(currentOwner, firstSession, command({ title: "Updated title" }));

    const tabs = getTerminals(currentOwner);
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0]?.title, "Updated title");
    assert.equal(getActiveTerminal(currentOwner)?.id, tabs[0]?.id);
    assert.equal(getJobTerminal(currentOwner, firstSession, "job-1")?.id, tabs[0]?.id);
  });

  test("isolates matching job IDs by owner and session", () => {
    const leftOwner = owner();
    const rightOwner = owner();
    terminalActions.openJob(leftOwner, firstSession, command());
    terminalActions.openJob(leftOwner, secondSession, command());
    terminalActions.openJob(rightOwner, firstSession, command());

    terminalActions.syncJobs(leftOwner, firstSession, [
      command({ title: "Only this tab", state: "completed", output: "done\n" }),
    ]);

    assert.equal(getJobTerminal(leftOwner, firstSession, "job-1")?.title, "Only this tab");
    assert.equal(getJobTerminal(leftOwner, firstSession, "job-1")?.state.kind, "completed");
    assert.equal(getJobTerminal(leftOwner, secondSession, "job-1")?.title, "Run tests");
    assert.equal(getJobTerminal(rightOwner, firstSession, "job-1")?.title, "Run tests");
  });

  test("streams cumulative and bounded snapshots without repeated prefixes", () => {
    const currentOwner = owner();
    terminalActions.openJob(currentOwner, firstSession, command());
    const tab = getJobTerminal(currentOwner, firstSession, "job-1");
    assert.ok(tab);
    const output = sink();
    attachTerminalOutput(tab.id, output);
    assert.equal(output.contents, "starting\n");

    terminalActions.syncJobs(currentOwner, firstSession, [
      command({ output: "starting\nrunning\n" }),
    ]);
    assert.equal(output.contents, "starting\nrunning\n");
    terminalActions.syncJobs(currentOwner, firstSession, [
      command({ output: "starting\nrunning\n" }),
    ]);
    assert.equal(output.contents, "starting\nrunning\n");

    const full = "R".repeat(50_000);
    terminalActions.syncJobs(currentOwner, firstSession, [command({ output: full })]);
    assert.equal(output.contents, full);

    const bounded = "R".repeat(40_000) + "N".repeat(10_000);
    terminalActions.syncJobs(currentOwner, firstSession, [command({ output: bounded })]);
    assert.equal(output.contents, bounded);
    assert.equal(getJobTerminal(currentOwner, firstSession, "job-1")?.source.output, bounded);
    terminalActions.syncJobs(currentOwner, firstSession, [command({ output: "Finished\n" })]);
    assert.equal(output.contents, "Finished\n");
  });

  test("closing and reopening a running job only changes its workbench view", async () => {
    const currentOwner = owner();
    terminalActions.openJob(currentOwner, firstSession, command());
    const tab = getJobTerminal(currentOwner, firstSession, "job-1");
    assert.ok(tab);

    await terminalActions.close(tab.id);

    expect(ipc.jobsCancel).not.toHaveBeenCalled();
    expect(ipc.terminalCreate).not.toHaveBeenCalled();
    expect(ipc.terminalClose).not.toHaveBeenCalled();
    expect(ipc.terminalWrite).not.toHaveBeenCalled();
    expect(ipc.terminalResize).not.toHaveBeenCalled();
    expect(ipc.terminalAcknowledge).not.toHaveBeenCalled();
    assert.equal(getJobTerminal(currentOwner, firstSession, "job-1"), undefined);
    terminalActions.openJob(currentOwner, firstSession, command({ output: "Still running\n" }));
    assert.equal(getTerminals(currentOwner).length, 1);
    assert.equal(
      getJobTerminal(currentOwner, firstSession, "job-1")?.source.output,
      "Still running\n",
    );
    expect(ipc.jobsCancel).not.toHaveBeenCalled();
    expect(ipc.terminalCreate).not.toHaveBeenCalled();
  });

  test("removes completed jobs without cancellation", async () => {
    const currentOwner = owner();
    terminalActions.openJob(currentOwner, firstSession, command({ state: "completed" }));
    const tab = getJobTerminal(currentOwner, firstSession, "job-1");
    assert.ok(tab);

    await terminalActions.close(tab.id);

    expect(ipc.jobsCancel).not.toHaveBeenCalled();
    expect(ipc.terminalClose).not.toHaveBeenCalled();
    assert.equal(getJobTerminal(currentOwner, firstSession, "job-1"), undefined);
  });

  test("keeps renderer failure and retry separate from the running job", () => {
    const currentOwner = owner();
    terminalActions.openJob(currentOwner, firstSession, command());
    const tab = getJobTerminal(currentOwner, firstSession, "job-1");
    assert.ok(tab);

    terminalActions.fail(tab.id, "Canvas rendering is unavailable");
    const failed = getJobTerminal(currentOwner, firstSession, "job-1");
    assert.equal(failed?.state.kind, "running");
    assert.deepEqual(failed?.rendering, {
      kind: "failed",
      message: "Canvas rendering is unavailable",
    });
    expect(ipc.jobsCancel).not.toHaveBeenCalled();
    expect(ipc.terminalClose).not.toHaveBeenCalled();

    terminalActions.retryRender(tab.id);
    assert.deepEqual(getJobTerminal(currentOwner, firstSession, "job-1")?.rendering, {
      kind: "ready",
    });
  });
});

describe("shell terminal tabs", () => {
  test("keeps host create, queued output, exit, and close behavior", async () => {
    const currentOwner = owner();
    await terminalActions.create(currentOwner, "/workspace");
    const tab = getTerminals(currentOwner)[0];
    assert.ok(tab);
    assert.ok(isShellTerminal(tab));
    assert.equal(tab.state.kind, "running");
    assert.equal(tab.title, "zsh");
    assert.equal(tab.cwd, "/workspace");
    expect(ipc.terminalCreate).toHaveBeenCalledWith({ id: tab.id, workspacePath: "/workspace" });

    applyTerminalEvent({ kind: "terminal_data", id: tab.id, data: "shell output" });
    const output = sink();
    attachTerminalOutput(tab.id, output);
    assert.equal(output.contents, "shell output");
    applyTerminalEvent({ kind: "terminal_exit", id: tab.id, exitCode: 7 });
    const exited = getTerminals(currentOwner)[0];
    assert.ok(exited);
    assert.ok(!isJobTerminal(exited));
    assert.deepEqual(exited.state, { kind: "exited", exitCode: 7 });

    await terminalActions.close(tab.id);
    expect(ipc.terminalClose).toHaveBeenCalledWith({ id: tab.id });
    expect(ipc.jobsCancel).not.toHaveBeenCalled();
    assert.equal(getTerminals(currentOwner).length, 0);
  });
});
