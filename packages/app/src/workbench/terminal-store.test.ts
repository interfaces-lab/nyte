import assert from "node:assert/strict";
import { asId } from "@nyte-ai/schema";
import type { Connection, Job, JobView, OutputFrame, WorkspaceInfo } from "@nyte-ai/sdk";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  attachTerminalOutput,
  getTerminal,
  openJobTerminal,
  terminalActions,
} from "./terminal-store.ts";
import { createWorkbenchController, workbenchViewKey } from "./controller.ts";
import type { WorkbenchPersistence } from "./controller.ts";
import type { TerminalOutput } from "./terminal-store.ts";
import { installConnection } from "../sdk.tsx";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

const workspace = asId<"workspace">("terminal-workspace");

const firstSession = asId<"session">("terminal-session-1");

/** A job whose output the test feeds and whose input, sizes and stop it records. */
function fakeJob(key: string) {
  const frames: OutputFrame[] = [];
  let wake: (() => void) | null = null;
  const written: string[] = [];
  const sizes: { readonly columns: number; readonly rows: number }[] = [];
  let stopped = 0;

  const emit = (frame: OutputFrame): void => {
    frames.push(frame);
    wake?.();
  };

  const job: Job = {
    id: asId<"job">(`job-${key}`),
    key: asId<"job-key">(key),
    write: async (bytes) => {
      written.push(new TextDecoder().decode(bytes));
    },
    output: async function* () {
      for (;;) {
        const frame = frames.shift();

        if (frame === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        yield frame;

        if (frame.kind === "exit") return;
      }
    },
    resize: async (size) => {
      sizes.push(size);

      return { kind: "resized" };
    },
    idle: async () => true,
    stop: async () => {
      stopped += 1;
      emit({ kind: "exit", code: null });

      return { kind: "settled", outcome: { kind: "exited", code: null, reason: "terminated" } };
    },
    settled: async () => ({ kind: "exited", code: 0, reason: "exited" }),
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };

  return {
    job,
    written,
    sizes,
    get stopped() {
      return stopped;
    },
    print: (text: string) => emit({ kind: "bytes", data: new TextEncoder().encode(text) }),
    exit: (code: number) => emit({ kind: "exit", code }),
  };
}

const folder: WorkspaceInfo = {
  id: workspace,
  target: { kind: "local", path: "/workspace" },
  identity: asId("identity"),
  availability: { kind: "available" },
  projectResources: null,
  trusted: true,
  projectSources: [],
  addedBy: asId("tester"),
  sessions: 0,
  writers: [],
};

const started: { readonly pty: unknown; readonly title: unknown }[] = [];

let next = fakeJob("first");

let running = new Map<string, Job>();

const scripted = scriptedConnection({
  workspaces: [folder],
  sessions: [sessionRow(firstSession, { workspace })],
}).connection;

const connection: Connection = {
  ...scripted,
  workspace: (id) => ({
    ...scripted.workspace(id),
    jobs: {
      start: async (input) => {
        started.push({ pty: input.pty, title: input.title });

        return next.job;
      },
      recover: async (key) => running.get(key) ?? { kind: "missing" },
      list: async () => [],
      watch: async function* () {},
    },
    job: () => next.job,
  }),
};

installConnection(connection);

function sink() {
  let contents = "";

  return {
    get contents() {
      return contents;
    },
    write(data: string) {
      contents += data;
    },
    update(_tab: Parameters<TerminalOutput["update"]>[0]) {},
    dispose() {},
  } satisfies TerminalOutput & { readonly contents: string };
}

function command(id: string, change: Partial<JobView> = {}): JobView {
  return {
    id: asId<"job">(id),
    command: "Run tests",
    title: "Run tests",
    session: firstSession,
    pty: null,
    state: { kind: "running" },
    startedAt: 1,
    endedAt: null,
    tail: "",
    ...change,
  };
}

let index = 0;

function tabId(): string {
  index += 1;

  return `terminal-tab-${String(index)}`;
}

const storage = new Map<string, string>();

vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

beforeEach(() => {
  started.length = 0;
  running = new Map();
  storage.clear();
});

describe("shell terminals", () => {
  test("keeps a shell running when the input typed while it started fails to reach it", async () => {
    next = fakeJob("typeahead");
    const job = next;
    job.job.write = async () => {
      throw new Error("The pipe closed");
    };
    const id = tabId();
    const starting = terminalActions.create({ id, workspacePath: "/workspace" });

    await terminalActions.write(id, "ls\r");
    await starting;
    await terminalActions.write(id, "pwd\r");

    assert.equal(getTerminal(id)?.state.kind, "running");
    await terminalActions.close(id);
  });

  test("start a pty job in the open folder, stream its output, take input and sizes, and stop it on close", async () => {
    next = fakeJob("shell");
    const job = next;
    const id = tabId();
    await terminalActions.create({ id, workspacePath: "/workspace" });

    expect(started).toEqual([{ pty: { columns: 80, rows: 24 }, title: "Terminal" }]);
    assert.equal(getTerminal(id)?.state.kind, "running");

    job.print("$ ");
    const output = sink();
    attachTerminalOutput(id, output);
    await vi.waitFor(() => assert.equal(output.contents, "$ "));
    await terminalActions.write(id, "ls\r");
    await terminalActions.resize(id, 120, 40);

    expect(job.written).toEqual(["ls\r"]);
    expect(job.sizes).toEqual([{ columns: 120, rows: 40 }]);
    expect(JSON.parse(storage.get(`nyte.terminal.${id}`) ?? "null")).toMatchObject({
      workspace,
      key: "shell",
    });

    job.exit(7);
    await vi.waitFor(() =>
      assert.deepEqual(getTerminal(id)?.state, { kind: "exited", exitCode: 7 }),
    );
    await terminalActions.close(id);
    assert.equal(getTerminal(id), undefined);
    assert.equal(storage.has(`nyte.terminal.${id}`), false);
  });

  test("re-attach to a shell the host still runs after a reload, the host replaying its scrollback", async () => {
    const kept = fakeJob("kept");
    running.set("kept", kept.job);
    const id = tabId();
    storage.set(
      `nyte.terminal.${id}`,
      JSON.stringify({ workspace, key: "kept", printed: "saved output" }),
    );

    await terminalActions.restore({ id, workspacePath: "/workspace" });
    kept.print("replayed");
    const output = sink();
    attachTerminalOutput(id, output);

    await vi.waitFor(() => assert.equal(output.contents, "replayed"));
    expect(started).toEqual([]);
    await terminalActions.close(id);
    assert.equal(kept.stopped, 1);
  });

  test("start a new shell under the saved output when the host no longer runs the old one", async () => {
    next = fakeJob("fresh");
    const id = tabId();
    storage.set(
      `nyte.terminal.${id}`,
      JSON.stringify({ workspace, key: "gone", printed: "before restart" }),
    );

    await terminalActions.restore({ id, workspacePath: "/workspace" });
    const output = sink();
    attachTerminalOutput(id, output);

    expect(started).toHaveLength(1);
    assert.ok(output.contents.startsWith("before restart\r\n"));
    expect(JSON.parse(storage.get(`nyte.terminal.${id}`) ?? "null")).toMatchObject({
      key: "fresh",
    });
    await terminalActions.close(id);
  });

  test("the workbench keeps a user's shell tab across a reload and drops an agent's", () => {
    let stored: Parameters<WorkbenchPersistence["write"]>[0] | undefined;

    const persistence: WorkbenchPersistence = {
      read: () => stored,
      write: (value) => {
        stored = value;
      },
    };

    const capabilities = () => ({ browser: true });
    const view = workbenchViewKey("/workspace");
    const before = createWorkbenchController(capabilities, persistence);

    const shell = before.actions.openTab({
      view,
      tab: { kind: "terminal", owner: { kind: "user" } },
      activate: true,
    });

    before.actions.openTab({
      view,
      tab: { kind: "terminal", owner: { kind: "agent", sessionId: firstSession, jobId: "job" } },
      activate: false,
    });

    const after = createWorkbenchController(capabilities, persistence);

    expect(after.getView(view).tabs).toEqual([
      { id: shell, kind: "terminal", owner: { kind: "user" } },
    ]);
  });
});

describe("agent job terminals", () => {
  test("a job opens in the workspace view and streams the job's output, read-only", async () => {
    const controller = createWorkbenchController(() => ({ browser: true }));
    const view = workbenchViewKey("/workspace/displayed");
    const otherView = workbenchViewKey("/workspace/other");
    next = fakeJob("agent");
    const job = command(next.job.id);

    const id = openJobTerminal({ controller, view, sessionId: firstSession, job });

    assert.equal(controller.getView(view).active, id);
    assert.deepEqual(controller.getView(view).tabs[0], {
      id,
      kind: "terminal",
      owner: { kind: "agent", sessionId: firstSession, jobId: job.id },
    });
    assert.deepEqual(controller.getView(otherView).tabs, []);
    const output = sink();
    attachTerminalOutput(id, output);
    next.print("starting\n");
    await vi.waitFor(() => assert.equal(output.contents, "starting\n"));
    await terminalActions.write(id, "ignored");
    expect(next.written).toEqual([]);

    terminalActions.syncJobs(firstSession, [{ ...job, command: "Updated title" }]);
    const terminal = getTerminal(id);
    assert.ok(terminal);
    assert.ok(terminal.kind === "job");
    assert.equal(terminal.title, "Updated title");

    await terminalActions.close(id);
    assert.equal(next.stopped, 0);
    assert.equal(getTerminal(id), undefined);
  });

  test("keeps renderer failure separate from command state", () => {
    const id = tabId();
    terminalActions.openJob({ id, sessionId: firstSession, job: command(`job-${id}`) });

    terminalActions.fail(id, "Canvas rendering is unavailable");
    const terminal = getTerminal(id);
    assert.ok(terminal);
    assert.ok(terminal.kind !== "shell");
    assert.equal(terminal.state.kind, "running");
    assert.deepEqual(terminal.rendering, {
      kind: "failed",
      message: "Canvas rendering is unavailable",
    });
  });
});
