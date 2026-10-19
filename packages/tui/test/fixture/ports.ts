import { asId } from "@nyte-ai/schema";
import { ManualClock } from "@opentui/core/testing";
import type {
  CommandOutcome,
  HostView,
  ModelCatalogView,
  ModelRef,
  SessionId,
  SessionInfo,
  SessionView,
  SubmitDraft,
  UserContent,
  WorkspaceCatalogView,
  WorkspaceCommandOutcome,
} from "@nyte-ai/sdk";
import { createHandle } from "../../src/effects/local-ports.ts";
import type {
  FilesPort,
  FirstFramePort,
  HostPort,
  PluginsPort,
  Ports,
  SessionPort,
  SettingsPort,
  ShellEnd,
  ShellPort,
  TerminalPort,
} from "../../src/effects/ports.ts";
import type { Task } from "../../src/lib/tasks.ts";
import type { DraftInsert } from "../../src/model/draft.ts";
import type { Selection } from "../../src/model/state.ts";
import { CATALOG, SETTINGS } from "./state.ts";
import { CONFIGURATION } from "./view.ts";

export interface FakeSession extends SessionPort {
  push(view: SessionView): void;
  end(failure: string | null): void;
  pushTasks(tasks: readonly Task[]): void;
  watchTasks(): AsyncIterable<readonly Task[]>;
  readonly calls: {
    readonly send: { readonly content: UserContent; readonly delivery: string | undefined }[];
    readonly withdraw: string[];
    readonly revise: { readonly message: string; readonly content: UserContent }[];
    readonly stopRun: string[];
    readonly answer: { readonly part: string; readonly answers: string[][] }[];
    readonly move: unknown[];
    readonly configure: { readonly model?: ModelRef; readonly effort?: string }[];
    readonly commands: { readonly name: string; readonly argument: string }[];
    readonly settings: { readonly id: string; readonly value: unknown }[];
    readonly stoppedTasks: unknown[];
  };
  withdrawResult: "withdrawn" | "landed-first" | "gone";
  answerResult: boolean | Error;
  commandResult: CommandOutcome | null;
}

export interface FakeHost extends HostPort {
  addSession(id: string): FakeSession;
  readonly sessions: ReadonlyMap<string, FakeSession>;
  publishCatalog(catalog: ModelCatalogView): void;
  publishSessions(sessions: readonly SessionInfo[]): void;
  readonly hostSettings: { readonly id: string; readonly value: unknown }[];
  readonly starts: Parameters<HostPort["start"]>[0][];
  readonly folders: (string | null)[];
  folderCatalog: WorkspaceCatalogView;
  readonly folderRuns: { readonly name: string; readonly argument: string }[];
  folderCommandResult: WorkspaceCommandOutcome | null;
}

function queue<T>(): AsyncIterable<T> & {
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
} {
  const values: T[] = [];
  let done: { readonly error: unknown } | "closed" | null = null;
  let waiting: (() => void) | null = null;

  const wake = (): void => {
    const resume = waiting;
    waiting = null;
    resume?.();
  };

  return {
    push(value) {
      values.push(value);
      wake();
    },
    close() {
      done = "closed";
      wake();
    },
    fail(error) {
      done = { error };
      wake();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = values.shift();

        if (next !== undefined) {
          yield next;
          continue;
        }

        if (done === "closed") return;

        if (done !== null) throw done.error;

        await new Promise<void>((resolve) => {
          waiting = resolve;
        });
      }
    },
  };
}

function buildSessionInfo(id: string): SessionInfo {
  return {
    id: asId(id),
    name: null,
    parent: null,
    call: null,
    workspace: asId("workspace"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [],
    createdAt: 1_000,
    lastActivityAt: 1_000,
  };
}

function fakeSession(id: string): FakeSession {
  const views = queue<SessionView>();
  const tasks = queue<readonly Task[]>();
  let sent = 0;

  const calls: FakeSession["calls"] = {
    send: [],
    withdraw: [],
    revise: [],
    stopRun: [],
    answer: [],
    move: [],
    configure: [],
    commands: [],
    settings: [],
    stoppedTasks: [],
  };

  const session: FakeSession = {
    id: asId(id),
    calls,
    withdrawResult: "withdrawn",
    answerResult: true,
    commandResult: null,
    push: (view) => views.push(view),
    end: (failure) => (failure === null ? views.close() : views.fail(new Error(failure))),
    pushTasks: (list) => tasks.push(list),
    watchTasks: () => tasks,
    watch: () => views,
    earlier: async () => 0,
    info: async () => buildSessionInfo(id),
    workspace: async () => ({ id: asId("workspace"), cwd: "/tmp/fake-workspace" }),
    async send(content, options) {
      calls.send.push({ content, delivery: options.delivery });
      sent += 1;

      return { message: asId(`sent-${String(sent)}`) };
    },
    async withdraw(message) {
      calls.withdraw.push(message);

      return session.withdrawResult;
    },
    async revise(message, content) {
      calls.revise.push({ message, content });

      return "revised";
    },
    async stopRun(run) {
      calls.stopRun.push(run);

      return "stopped";
    },
    async answer(part, answers) {
      calls.answer.push({ part, answers });

      if (session.answerResult instanceof Error) throw session.answerResult;

      return session.answerResult;
    },
    approve: async () => null,
    async move(position, options) {
      calls.move.push({ position, options });

      return {
        kind: "moved",
        revision: asId("rev-2"),
        position,
        summary: null,
        handback: null,
      };
    },
    tree: async () => ({ revision: null, tip: { kind: "start" }, nodes: [] }),
    compact: async () => "started",
    async configure(patch) {
      calls.configure.push(patch);

      return {
        kind: "configured",
        selected: {
          ...CONFIGURATION,
          model: patch.model ?? CONFIGURATION.model,
          thinking: patch.effort ?? CONFIGURATION.thinking,
        },
        revision: asId("rev-3"),
      };
    },
    async applySetting(key, value) {
      calls.settings.push({ id: key, value });

      return { kind: "configured", selected: CONFIGURATION, revision: asId("rev-4") };
    },
    async command(name, argument) {
      calls.commands.push({ name, argument });

      return session.commandResult ?? { kind: "ran", output: `ran ${name}` };
    },
    completeCommand: async () => [],
    async stopTask(task) {
      calls.stoppedTasks.push(task);

      return "stopped";
    },
    changeDirectory: async (path) => ({ kind: "changed", cwd: path }),
    reload: async () => "updated",
    upload: async () => asId("blob-1"),
    mentions: async () => [],
  };

  return session;
}

export function fakeHost(): FakeHost {
  const sessions = new Map<string, FakeSession>();
  const catalogs = queue<Pick<HostView, "catalog" | "settings" | "version">>();

  const directory = queue<readonly SessionInfo[]>();
  const hostSettings: FakeHost["hostSettings"] = [];
  const starts: FakeHost["starts"] = [];
  const folders: FakeHost["folders"] = [];
  let catalog = CATALOG;

  const addSession = (id: string): FakeSession => {
    const session = sessions.get(id) ?? fakeSession(id);
    sessions.set(id, session);

    return session;
  };

  const host: FakeHost = {
    sessions,
    hostSettings,
    addSession,
    starts,
    folders,
    folderCatalog: { commands: [], skills: [] },
    folderRuns: [],
    folderCommandResult: null,
    session: (id) => addSession(id),
    workspace: (id) => ({
      id,
      catalog: async () => host.folderCatalog,
      async command(name, argument) {
        host.folderRuns.push({ name, argument });

        return host.folderCommandResult ?? { kind: "ran", output: `ran ${name}` };
      },
      completeCommand: async () => [],
      cwd: async () => "/tmp/fake-workspace",
      upload: async () => asId("blob-1"),
      mentions: async () => [],
    }),
    async openFolder(path) {
      folders.push(path);

      return asId("workspace");
    },
    async start(input) {
      starts.push(input);

      const { message } = await addSession(input.id).send(input.content, { delivery: "steer" });

      return { kind: "started", message };
    },
    async *rootSessions() {
      yield* [...sessions.keys()].map(buildSessionInfo);
    },
    catalog: () => catalogs,
    sessionInfos: () => directory,
    publishSessions: (list) => directory.push(list),
    publishCatalog(next) {
      catalog = next;
      catalogs.push({ catalog: next.generation, settings: [], version: "0.0.0" });
    },
    listModels: async () => catalog,
    accounts: async () => [],
    selectAccount: async () => undefined,
    usage: async () => [],
    refreshModels: async () => undefined,
    login: async () => {
      throw new Error("Login is not scripted in the fake host.");
    },
    logout: async () => {
      throw new Error("Logout is not scripted in the fake host.");
    },
    hostPlugins: async () => [],
    github: async () => null,
    mcp: async () => ({ servers: [], issues: [] }),
    mcpAction: async () => ({ kind: "missing" }),
    mcpLogin: async () => undefined,
    trustInfo: async () => ({
      path: "/work",
      home: false,
      decision: true,
      trusted: true,
      sources: [],
    }),
    trust: async () => undefined,
    async applySetting(id, value) {
      hostSettings.push({ id, value });

      return { kind: "applied" };
    },
    tasks: (id) => addSession(id).watchTasks(),
    async *blob() {
      yield new Uint8Array();
    },
  };

  return host;
}

export interface FakeTerminal extends TerminalPort {
  readonly titles: string[];
  readonly statuses: string[];
  closed: boolean;
  readonly copies: string[];
  readonly notifications: { readonly title: string; readonly body: string }[];
  readonly opened: string[];
  clipboard: Awaited<ReturnType<TerminalPort["readClipboard"]>>;
}

export interface FakeShell extends ShellPort {
  finish(id: string, end: ShellEnd, output?: string): void;
  readonly started: { readonly id: string; readonly command: string; readonly cwd: string }[];
  readonly stopped: string[];
}

export interface FakeFiles extends FilesPort {
  pasteResult: DraftInsert | Error;
  readonly texts: Map<string, string>;
  editorResult: string | null;
}

export interface FakePlugins extends PluginsPort {
  decision:
    | { readonly kind: "accept" }
    | { readonly kind: "reject"; readonly reason: string }
    | { readonly kind: "throw"; readonly message: string };
  readonly submitted: SubmitDraft[];
  readonly switches: { readonly previous: SessionId | null; readonly next: SessionId }[];
}

export interface FakePorts extends Ports {
  readonly host: FakeHost;
  readonly terminal: FakeTerminal;
  readonly shell: FakeShell;
  readonly files: FakeFiles;
  readonly plugins: FakePlugins;
  readonly settings: SettingsPort;
  readonly firstFrame: FakeFirstFrame;
  readonly clock: ManualClock;
  readonly log: {
    readonly path: string;
    readonly entries: { readonly origin: string; readonly error: unknown }[];
    write(origin: string, error: unknown): void;
  };
}

export interface FakeFirstFrame extends FirstFramePort {
  saved: Selection | null;
}

export function fakePorts(host: FakeHost): FakePorts {
  const clock = new ManualClock();
  clock.setTime(10_000);
  let settings = SETTINGS;
  const running = new Map<string, { resolve(end: ShellEnd): void; update(output: string): void }>();

  const terminal: FakeTerminal = {
    titles: [],
    statuses: [],
    closed: false,
    copies: [],
    notifications: [],
    opened: [],
    clipboard: { kind: "empty" },
    setTitle(title) {
      terminal.titles.push(title);
    },
    programStatus(encoded) {
      if (terminal.closed) throw new Error("NativeSession is closing or disposed");
      terminal.statuses.push(encoded);
    },
    notify(title, body) {
      terminal.notifications.push({ title, body });
    },
    copy(text) {
      terminal.copies.push(text);
    },
    readClipboard: async () => terminal.clipboard,
    suspended: (work) => work(),
    open(target) {
      terminal.opened.push(target);
    },
  };

  const shell: FakeShell = {
    started: [],
    stopped: [],
    start(id, command, cwd, update) {
      shell.started.push({ id, command, cwd });

      return new Promise<ShellEnd>((resolve) => {
        running.set(id, { resolve, update });
      });
    },
    stop(id) {
      shell.stopped.push(id);
      running.get(id)?.resolve({ kind: "cancelled" });
      running.delete(id);
    },
    finish(id, end, output) {
      const entry = running.get(id);

      if (entry === undefined) throw new Error(`No running shell ${id}`);

      if (output !== undefined) entry.update(output);
      entry.resolve(end);
      running.delete(id);
    },
  };

  const files: FakeFiles = {
    pasteResult: { kind: "text", text: "" },
    texts: new Map(),
    editorResult: null,
    async resolvePaste(text) {
      if (files.pasteResult instanceof Error) throw files.pasteResult;

      return files.pasteResult.kind === "text" ? { kind: "text", text } : files.pasteResult;
    },
    listDirectory: async () => [],
    resolveMention: async () => null,
    readText: async (path) => files.texts.get(path) ?? null,
    editor: async () => files.editorResult,
  };

  const plugins: FakePlugins = {
    ids: ["fake-plugin"],
    decision: { kind: "accept" },
    submitted: [],
    switches: [],
    async beforeSubmit(draft) {
      plugins.submitted.push(draft);
      const { decision } = plugins;

      if (decision.kind === "throw") throw new Error(decision.message);

      return decision.kind === "accept" ? { kind: "accept", draft } : decision;
    },
    async switched(previous, next) {
      plugins.switches.push({ previous, next });
    },
  };

  const log: FakePorts["log"] = {
    path: "/tmp/fake-tui.log",
    entries: [],
    write(origin, error) {
      log.entries.push({ origin, error });
    },
  };

  const firstFrame: FakeFirstFrame = {
    saved: null,
    read: () => firstFrame.saved,
    async write(selection) {
      firstFrame.saved = selection;
    },
  };

  return {
    host,
    terminal,
    firstFrame,
    composer: createHandle(),
    scroll: createHandle(),
    settings: {
      read: () => ({ settings, invalid: [] }),
      async write(_cwd, patch) {
        settings = { ...settings, ...patch };

        return settings;
      },
      settled: async () => undefined,
    },
    plugins,
    shell,
    files,
    clock,
    log,
  };
}
