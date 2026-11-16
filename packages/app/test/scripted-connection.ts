import { SdkError } from "@nyte-ai/sdk";
import type {
  HeadName,
  PartId,
  RunId,
  DocumentsApi,
  GitApi,
  GitHubAccountApi,
  GitHubApi,
  HostView,
  JobId,
  Json,
  MessageId,
  ModelsApi,
  Session,
  SessionId,
  SessionInfo,
  SessionView,
  UserContent,
  WorkspaceId,
  WorkspaceInfo,
} from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { headView } from "@nyte-ai/sdk/client";
import type {
  Chat,
  ChatSnapshot,
  ClientConnection,
  HeadSnapshot,
  HeadStore,
  HeadView,
  Health,
  PartSnapshot,
  PartStore,
  RefusedSend,
  SessionsSnapshot,
  SessionsStore,
} from "@nyte-ai/sdk/client";
import { installConnection } from "../src/data/connection.ts";

export interface ConnectionScript {
  readonly views?: ReadonlyMap<SessionId, readonly SessionView[] | ViewStream>;
  readonly sessions?: readonly SessionInfo[] | ViewStream<readonly SessionInfo[]>;
  readonly children?: ReadonlyMap<SessionId, readonly SessionInfo[]>;
  readonly workspaces?: readonly WorkspaceInfo[];
  readonly session?: (id: SessionId) => Partial<Session>;
  readonly send?: (id: SessionId) => Chat["send"];
  readonly host?: ViewStream<HostView>;
  readonly health?: ViewStream<Health>;
  readonly refused?: ViewStream<readonly RefusedSend[]>;
  readonly models?: Partial<ModelsApi>;
  readonly github?: Partial<GitHubAccountApi>;
  readonly git?: Partial<GitApi>;
  readonly workspaceGitHub?: Partial<GitHubApi>;
  readonly documents?: Partial<DocumentsApi>;
}

export interface ScriptedSend {
  readonly session: SessionId;
  readonly content: UserContent;
  readonly options: Json | undefined;
}

export interface ViewStream<T = SessionView> {
  readonly latest: () => T | undefined;
  readonly push: (value: T) => void;
  readonly watch: () => AsyncIterable<T>;
  readonly subscribe: (listener: () => void) => () => void;
}

export function viewStream<T = SessionView>(first: T): ViewStream<T> {
  let latest = first;
  const waiting = new Set<(view: T) => void>();
  const listeners = new Set<() => void>();

  return {
    latest: () => latest,
    push: (view) => {
      latest = view;

      for (const wake of Array.from(waiting)) wake(view);

      for (const listener of Array.from(listeners)) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    watch: async function* () {
      let shown = latest;
      yield shown;

      for (;;) {
        if (latest !== shown) {
          shown = latest;
          yield shown;
          continue;
        }

        shown = await new Promise<T>((resolve) => {
          const wake = (view: T): void => {
            waiting.delete(wake);
            resolve(view);
          };
          waiting.add(wake);
        });
        yield shown;
      }
    },
  };
}

const refuse = async (): Promise<never> => {
  throw new SdkError("unavailable", "Not scripted.");
};

async function* refused(): AsyncIterable<never> {
  yield* [];
  throw new SdkError("unavailable", "Not scripted.");
}

export interface LiveSource<T> {
  readonly latest: () => T | undefined;
  readonly subscribe: (listener: () => void) => () => void;
}

const OPEN = { kind: "open", since: 0 } as const;

const MAIN = asId<"head">("main");

const NO_MESSAGES: readonly MessageId[] = [];

const NO_REFUSALS: readonly RefusedSend[] = [];

export function scriptedConnection(script: ConnectionScript = {}): {
  readonly connection: ClientConnection;
  readonly sent: readonly ScriptedSend[];
} {
  const sent: ScriptedSend[] = [];
  const listed = script.sessions ?? [];
  const rows = "watch" in listed ? (listed.latest() ?? []) : listed;

  const session = (id: SessionId): Session => {
    const scripted = script.views?.get(id) ?? [];
    const stream = "watch" in scripted ? scripted : undefined;
    const views = "watch" in scripted ? undefined : scripted;

    const row = [...rows, ...[...(script.children?.values() ?? [])].flat()].find(
      (candidate) => candidate.id === id,
    );

    const base: Session = {
      id,
      sessionId: id,
      name: asId<"head">("main"),
      send: async (content) => {
        sent.push({ session: id, content, options: null });

        return refuse();
      },
      revise: refuse,
      hold: refuse,
      configure: refuse,
      view: async () => {
        const last = stream?.latest() ?? views?.at(-1);

        if (last === undefined) throw new SdkError("unknown", "No view scripted.");

        return last;
      },
      see: async () => undefined,
      history: refuse,
      tree: refuse,
      move: refuse,
      compact: refuse,
      head: () => base,
      heads: { create: refuse, merge: refuse, remove: refuse },
      run: (run) => ({ id: run, stop: refuse, settled: refuse }),
      receipt: (receipt) => ({ id: receipt, status: refuse, settled: refuse, stop: refuse }),
      info: async () => {
        if (row === undefined) throw new SdkError("unknown", "No session scripted.");

        return row;
      },
      update: refuse,
      remove: refuse,
      fork: refuse,
      stop: refuse,
      command: refuse,
      completeCommand: refuse,
      parts: { create: refuse },
      part: (part) => ({
        id: part,
        update: refuse,
        act: refuse,
        answer: refuse,
        close: refuse,
      }),
    };

    const handle: Session = { ...base, head: () => handle, ...script.session?.(id) };

    return handle;
  };

  const workspace = (id: WorkspaceId) => ({
    id,
    info: refuse,
    watch: refused,
    mcp: {
      watch: refused,
      reconnect: refuse,
      setEnabled: refuse,
      login: () => ({ steps: refused, answer: refuse }),
      logout: refuse,
      add: refuse,
      remove: refuse,
    },
    update: refuse,
    reload: refuse,
    catalog: refuse,
    command: refuse,
    completeCommand: refuse,
    jobs: { start: refuse, recover: refuse, list: refuse, watch: refused },
    job: (job: JobId) => ({
      id: job,
      key: null,
      write: refuse,
      output: refused,
      resize: refuse,
      idle: refuse,
      stop: refuse,
      settled: refuse,
      close: refuse,
      [Symbol.asyncDispose]: refuse,
    }),
    changes: refuse,
    patches: refused,
    files: refuse,
    git: script.git === undefined ? refuse : async () => ({ kind: "available" as const, api: git }),
    github:
      script.workspaceGitHub === undefined
        ? refuse
        : async () => ({ kind: "available" as const, api: github }),
    browser: refuse,
  });

  const git: GitApi = {
    status: refuse,
    watch: refused,
    changes: refuse,
    watchChanges: refused,
    patches: refused,
    contents: refuse,
    log: refuse,
    refs: refuse,
    blame: refuse,
    stage: refuse,
    unstage: refuse,
    discard: refuse,
    commit: refuse,
    branch: refuse,
    checkout: refuse,
    push: refuse,
    ...script.git,
  };

  const github: GitHubApi = {
    repository: refuse,
    state: refuse,
    createPullRequest: refuse,
    ...script.workspaceGitHub,
  };

  const views = (id: SessionId): LiveSource<SessionView> | undefined => {
    const scripted = script.views?.get(id);

    if (scripted === undefined) return undefined;

    if ("watch" in scripted) return scripted;
    const last = scripted.at(-1);

    return last === undefined ? undefined : constant(last);
  };

  const sessions = "watch" in listed ? listed : constant(rows);

  const health: LiveSource<Health> = {
    latest: () => script.health?.latest() ?? OPEN,
    subscribe: (listener) => script.health?.subscribe(listener) ?? (() => undefined),
  };

  const connection: ClientConnection = {
    hostId: asId<"host">("scripted"),
    principal: asId<"principal">("tester"),
    credential: { kind: "token", token: "scripted-token-0000" },
    sessions: {
      start: refuse,
      list: async () => ({ items: rows, next: null }),
      read: async () => ({ seq: 0, ids: rows.map((row) => row.id), rows }),
      open(window) {
        const parents = window?.parents;

        if (parents?.kind === "children")
          return sessionsStore(constant(script.children?.get(parents.session) ?? []));

        return sessionsStore(sessions);
      },
    },
    projects: { create: refuse, draft: refuse },
    project: (id) => ({ id, update: refuse }),
    workspaces: {
      list: async () => script.workspaces ?? [],
      inspect: refuse,
      add: refuse,
      forget: refuse,
      cleanWorktrees: refuse,
    },
    session,
    workspace,
    watch: () => script.host?.watch() ?? refused(),
    blob: refuse,
    catalogs: { read: refuse },
    models: {
      list: refuse,
      accounts: refuse,
      selectAccount: refuse,
      renameAccount: refuse,
      usage: refuse,
      refresh: refuse,
      setDefault: refuse,
      setListing: refuse,
      verify: refuse,
      login: () => ({ steps: refused, answer: refuse }),
      logout: refuse,
      ...script.models,
    },
    settings: { apply: refuse },
    plugins: { replace: refuse, check: refuse },
    principals: { list: refuse, pair: refuse, revoke: refuse },
    operations: { describe: refuse },
    github: { account: refuse, signIn: refuse, signOut: refuse, ...script.github },
    documents: { read: refuse, bytes: refuse, write: refuse, watch: refused, ...script.documents },
    health: { subscribe: health.subscribe, snapshot: () => health.latest() ?? OPEN },
    refused: {
      subscribe: (listener) => script.refused?.subscribe(listener) ?? (() => undefined),
      snapshot: () => script.refused?.latest() ?? NO_REFUSALS,
      take(id) {
        const listed = script.refused?.latest() ?? NO_REFUSALS;

        if (listed.some((send) => send.id === id))
          script.refused?.push(listed.filter((send) => send.id !== id));
      },
    },
    retry: () => undefined,
    call: refuse,
    head: (id, head) => headStore(views(id), head),
    chat: (id, options) => {
      const chat = scriptedChat(headStore(views(id), options?.head ?? MAIN), session(id), health);

      return script.send === undefined ? chat : { ...chat, send: script.send(id) };
    },
    part: (id, part) => partStore(views(id), part),
    text: () => () => undefined,
    clients: () => ({
      subscribe: () => () => undefined,
      snapshot: () => new Map(),
      close: () => undefined,
    }),
    perform: refuse,
    offer: () => () => undefined,
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };

  return { connection, sent };
}

export function installScripted(scripted: { readonly connection: ClientConnection }): void {
  installConnection(scripted.connection);
}

function scriptedChat(store: HeadStore, handle: Session, health: LiveSource<Health>): Chat {
  let asked: { readonly run: RunId; readonly health: Health | undefined } | null = null;
  let older: Paged = NO_PAGES;

  let paged: { readonly base: HeadView; readonly older: Paged; readonly view: HeadView } | null =
    null;

  let shown: ChatSnapshot = {
    view: null,
    seq: 0,
    freshness: store.freshness(),
    expired: NO_MESSAGES,
    stopping: "no",
  };

  const snapshot = (): ChatSnapshot => {
    const rows = store.snapshot();
    const freshness = store.freshness();
    const base = rows === null ? null : headView(rows);

    if (base !== null && (paged?.base !== base || paged.older !== older))
      paged = {
        base,
        older,
        view: older === NO_PAGES ? base : withPages(base, older),
      };
    const view = base === null ? null : (paged?.view ?? base);
    const execution = view?.execution;

    const stopping =
      execution === undefined || execution.kind === "idle"
        ? "no"
        : execution.kind === "live" && execution.stopping
          ? "host"
          : asked?.run === execution.run.id && asked.health === health.latest()
            ? "asked"
            : "no";

    if (view === shown.view && sameJson(freshness, shown.freshness) && stopping === shown.stopping)
      return shown;
    const seq = freshness.kind === "fresh" ? freshness.seq : shown.seq;
    shown = { view, seq, freshness, expired: NO_MESSAGES, stopping };

    return shown;
  };

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      const stops = [store.subscribe(listener), health.subscribe(listener)];

      return () => {
        listeners.delete(listener);

        for (const stop of stops) stop();

        if (listeners.size === 0) older = NO_PAGES;
      };
    },
    snapshot,
    async send(content, options) {
      const id = options?.id ?? asId<"receipt">(crypto.randomUUID());

      return {
        id,
        delivered: handle
          .send(content, { ...options, id })
          .then((receipt) => ({ kind: "sent", receipt })),
      };
    },
    resend: async () => undefined,
    async remove(message) {
      await handle.receipt(asId<"receipt">(message)).stop();
    },
    stop() {
      const current = snapshot();
      const execution = current.view?.execution;

      if (execution === undefined || execution.kind === "idle" || current.stopping !== "no")
        return Promise.resolve();
      const ask = { run: execution.run.id, health: health.latest() };
      asked = ask;
      notify();

      return handle
        .run(ask.run)
        .stop()
        .then(
          () => undefined,
          (error: unknown) => {
            if (asked !== ask) return;
            asked = null;
            notify();

            throw error;
          },
        );
    },
    async earlier(count) {
      const oldest = shown.view?.messages[0];

      if (listeners.size === 0 || oldest === undefined) return 0;
      const page = await handle.history({ before: oldest.id, limit: count });

      if (page.messages.length === 0) return 0;
      const known = new Set(older.turns.map((turn) => turn.id));
      older = {
        messages: [...page.messages, ...older.messages],
        turns: [...page.turns.filter((turn) => !known.has(turn.id)), ...older.turns],
        leadingPrompt: page.leadingPrompt,
      };
      notify();

      return page.messages.length;
    },
    act: (part, action, input) => handle.part(part).act(action, input),
  };
}

type Paged = Pick<SessionView, "messages" | "turns" | "leadingPrompt">;

const NO_PAGES: Paged = { messages: [], turns: [], leadingPrompt: null };

function withPages(view: HeadView, pages: Paged): HeadView {
  const own = new Set(view.turns.map((turn) => turn.id));

  return {
    ...view,
    messages: [...pages.messages, ...view.messages],
    turns: [...pages.turns.filter((turn) => !own.has(turn.id)), ...view.turns],
    leadingPrompt: pages.leadingPrompt,
  };
}

export function constant<T>(value: T): LiveSource<T> {
  return { latest: () => value, subscribe: () => () => undefined };
}

const MISSING = new SdkError("unknown", "No view scripted.");

function headStore(source: LiveSource<SessionView> | undefined, head: HeadName): HeadStore {
  let view: SessionView | undefined;
  let snapshot: HeadSnapshot | null = null;

  const read = (): HeadSnapshot | null => {
    const latest = source?.latest();

    if (latest !== view) {
      view = latest;
      snapshot = latest === undefined ? null : keepSnapshot(viewSnapshot(latest, head), snapshot);
    }

    return snapshot;
  };

  return {
    subscribe: (listener) => source?.subscribe(listener) ?? (() => undefined),
    snapshot: read,
    freshness: () =>
      view === undefined
        ? { kind: "stale", since: 0, error: source === undefined ? MISSING : null }
        : { kind: "fresh", seq: view.seq },
    close: () => undefined,
  };
}

function partStore(source: LiveSource<SessionView> | undefined, part: PartId): PartStore {
  let view: SessionView | undefined;
  let snapshot: PartSnapshot | null = null;

  return {
    subscribe: (listener) => source?.subscribe(listener) ?? (() => undefined),
    snapshot() {
      const latest = source?.latest();

      if (latest !== view) {
        view = latest;

        snapshot =
          latest === undefined
            ? null
            : { part: latest.parts.find((row) => row.id === part) ?? null };
      }

      return snapshot;
    },
    freshness: () =>
      view === undefined
        ? { kind: "stale", since: 0, error: source === undefined ? MISSING : null }
        : { kind: "fresh", seq: view.seq },
    close: () => undefined,
  };
}

function keepSnapshot(next: HeadSnapshot, previous: HeadSnapshot | null): HeadSnapshot {
  if (previous === null) return next;
  const before = previous.rows;
  const after = next.rows;

  return {
    ...next,
    order: sameJson(next.order, previous.order) ? previous.order : next.order,
    rows: {
      messages: keepTable(after.messages, before.messages),
      turns: keepTable(after.turns, before.turns),
      parts: keepTable(after.parts, before.parts),
      changes: keepTable(after.changes, before.changes),
      catalog: keepTable(after.catalog, before.catalog),
      heads: keepTable(after.heads, before.heads),
      settings: keepTable(after.settings, before.settings),
      usage: keepTable(after.usage, before.usage),
      background: keepTable(after.background, before.background),
    },
  };
}

function keepTable<Row>(
  next: ReadonlyMap<string, Row>,
  previous: ReadonlyMap<string, Row>,
): ReadonlyMap<string, Row> {
  const rows = new Map(
    [...next].map(([key, row]) => {
      const held = previous.get(key);

      return [key, held !== undefined && sameJson(held, row) ? held : row] as const;
    }),
  );

  return rows.size === previous.size && [...rows].every(([key, row]) => previous.get(key) === row)
    ? previous
    : rows;
}

function sameJson<T>(left: T, right: T): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function sessionsStore(source: LiveSource<readonly SessionInfo[]>): SessionsStore {
  let rows: readonly SessionInfo[] | undefined;
  let snapshot: SessionsSnapshot | null = null;

  return {
    subscribe: source.subscribe,
    snapshot() {
      const latest = source.latest();

      if (latest !== rows) {
        rows = latest;
        snapshot =
          latest === undefined
            ? null
            : {
                ids: latest.map((row) => row.id),
                rows: new Map(latest.map((row) => [row.id, row])),
              };
      }

      return snapshot;
    },
    freshness: () => ({ kind: "fresh", seq: 0 }),
    close: () => undefined,
  };
}

export function viewSnapshot(view: SessionView, head: HeadName): HeadSnapshot {
  const messages = [
    ...(view.leadingPrompt === null ? [] : [view.leadingPrompt]),
    ...view.messages,
    ...view.queue,
  ];

  return {
    head,
    order: view.messages.map((message) => message.id),
    leadingPrompt: view.leadingPrompt?.id ?? null,
    activation: view.activation,
    rows: {
      messages: new Map(messages.map((message) => [message.id, message])),
      turns: new Map(view.turns.map((turn) => [turn.id, turn])),
      parts: new Map(view.parts.map((part) => [part.id, part])),
      changes: new Map(view.changes.map((change) => [change.path, change])),
      catalog: new Map(),
      heads: new Map([
        [
          head,
          {
            name: head,
            revision: view.revision,
            execution: view.execution,
            reportsHeld: view.reportsHeld,
            seenThrough: view.seenThrough,
            queue: view.queue.map((message) => message.id),
          },
        ],
      ]),
      settings: new Map([
        [head, { name: head, configuration: view.configuration, context: view.context }],
      ]),
      usage: new Map([[head, { name: head, usage: view.usage }]]),
      background: new Map(
        view.background.map((item) => [`${head}/${item.kind}/${item.id}`, { head, item }]),
      ),
    },
    catalog: view.catalog,
  };
}
