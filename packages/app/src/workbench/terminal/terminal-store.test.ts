import assert from "node:assert/strict";
import { asId } from "@nyte-ai/schema";
import type { Connection, Job, JobView, OutputFrame, WorkspaceInfo } from "@nyte-ai/sdk";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { attachTerminalOutput, getTerminal, terminalActions } from "./terminal-store.ts";
import { openJobTerminal } from "../commands.ts";
import { workbenchViewKey } from "../paths.ts";
import type { WorkbenchPersistence } from "../persistence.ts";
import { createWorkbenchStore, workbench } from "../store.ts";
import type { TerminalOutput } from "./terminal-store.ts";
import { installConnection } from "../../data/connection.ts";
import { scriptedConnection } from "../../../test/scripted-connection.ts";
import { sessionRow } from "../../../test/view-fixtures.ts";

const workspace = asId<"workspace">("terminal-workspace");

const firstSession = asId<"session">("terminal-session-1");

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
  isolation: null,
};

const started: { readonly pty: unknown; readonly title: unknown }[] = [];

let next = fakeJob("first");

let running = new Map<string, Job>();

const scriptedSet = scriptedConnection({
  workspaces: [folder],
  sessions: [sessionRow(firstSession, { workspace })],
});

const scripted = scriptedSet.connection;

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

installConnection(connection, scriptedSet.live);

function sink() {
  const decoder = new TextDecoder();
  let contents = "";

  return {
    get contents() {
      return contents;
    },
    reset() {
      contents = "";
    },
    write(data: Uint8Array) {
      contents += decoder.decode(data, { stream: true });
    },
    update(_tab: Parameters<TerminalOutput["update"]>[0]) {},
    visible: () => false,
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
    foreground: false,
    ...change,
  };
}

let index = 0;

function tabId(): string {
  index += 1;

  return `terminal-tab-${String(index)}`;
}

const storage = new Map<string, string>();

let full = false;

vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      storage.set(key, value);
    },
    removeItem: (key: string) => storage.delete(key),
  },
});

beforeEach(() => {
  started.length = 0;
  running = new Map();
  storage.clear();
  full = false;
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

    await terminalActions.write(id, new TextEncoder().encode("ls\r"));
    await starting;
    await terminalActions.write(id, new TextEncoder().encode("pwd\r"));

    assert.equal(getTerminal(id)?.state.kind, "running");
    await terminalActions.close(id);
  });

  test("a started shell keeps running and streaming when its recovery record can't be stored", async () => {
    next = fakeJob("unsaved");
    const job = next;
    const id = tabId();
    full = true;

    await terminalActions.create({ id, workspacePath: "/workspace" });
    full = false;
    assert.equal(getTerminal(id)?.state.kind, "running");
    assert.equal(storage.has(`nyte.terminal.${id}`), false);

    job.print("$ ");
    const output = sink();
    attachTerminalOutput(id, output);
    await vi.waitFor(() => assert.equal(output.contents, "$ "));
    assert.equal(job.stopped, 0);
    await terminalActions.close(id);
  });

  test("a starting shell whose recovery record can't be stored stops when it's closed", async () => {
    next = fakeJob("closed-while-starting");
    const job = next;
    const id = tabId();
    full = true;

    const starting = terminalActions.create({ id, workspacePath: "/workspace" });
    await terminalActions.close(id);
    await starting;

    assert.equal(job.stopped, 1);
    assert.equal(getTerminal(id), undefined);
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
    await terminalActions.write(id, new TextEncoder().encode("ls\r"));
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

  test("restarting an exited shell twice in a row starts one new shell and stops the old one once", async () => {
    next = fakeJob("exits");
    const old = next;
    const id = tabId();
    await terminalActions.create({ id, workspacePath: "/workspace" });
    old.exit(0);
    await vi.waitFor(() => assert.equal(getTerminal(id)?.state.kind, "exited"));

    let release = (): void => undefined;

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const stop = old.job.stop.bind(old.job);
    old.job.stop = async () => {
      await held;

      return stop();
    };

    next = fakeJob("restarted");

    const first = terminalActions.restart({ id, workspacePath: "/workspace" });
    const second = terminalActions.restart({ id, workspacePath: "/workspace" });
    release();
    await Promise.all([first, second]);

    expect(started).toHaveLength(2);
    assert.equal(old.stopped, 1);
    assert.equal(getTerminal(id)?.state.kind, "running");
    await terminalActions.close(id);
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
    let stored: Parameters<WorkbenchPersistence["set"]>[0] | undefined;

    const persistence: WorkbenchPersistence = {
      get: () => stored,
      set: (value) => {
        stored = value;
      },
    };

    const capabilities = () => ({ browser: true });
    const view = workbenchViewKey("/workspace");
    const before = createWorkbenchStore(capabilities, persistence);
    const shell = "shell";

    before.dispatch(view, {
      kind: "add",
      tab: { id: shell, kind: "terminal", owner: { kind: "user" } },
    });
    before.dispatch(view, {
      kind: "open",
      tab: {
        id: "job",
        kind: "terminal",
        owner: { kind: "job", workspace, job: asId<"job">("job") },
      },
      activate: false,
    });

    const after = createWorkbenchStore(capabilities, persistence);

    expect(after.getView(view).tabs).toEqual([
      { id: shell, kind: "terminal", owner: { kind: "user" } },
    ]);
  });
});

describe("agent job terminals", () => {
  test("a job opens in the workspace view and streams the job's output, read-only", async () => {
    const view = workbenchViewKey("/workspace/displayed");
    const otherView = workbenchViewKey("/workspace/other");
    next = fakeJob("agent");
    const job = command(next.job.id);

    const id = openJobTerminal(view, workspace, job);

    assert.equal(workbench.getView(view).active, id);
    assert.deepEqual(workbench.getView(view).tabs[0], {
      id,
      kind: "terminal",
      owner: { kind: "job", workspace, job: job.id },
    });
    assert.equal(openJobTerminal(view, workspace, job), id);
    assert.deepEqual(workbench.getView(otherView).tabs, []);
    const output = sink();
    attachTerminalOutput(id, output);
    next.print("starting\n");
    await vi.waitFor(() => assert.equal(output.contents, "starting\n"));
    await terminalActions.write(id, new TextEncoder().encode("ignored"));
    expect(next.written).toEqual([]);

    terminalActions.syncJobs(workspace, [{ ...job, command: "Updated title" }]);
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
    terminalActions.openJob({ id, workspace, job: command(`job-${id}`) });

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
