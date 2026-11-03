import { SdkError } from "@nyte-ai/sdk";
import type {
  Connection,
  GitApi,
  GitHubAccountApi,
  GitHubApi,
  HostView,
  JobId,
  Json,
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
import type { HostConnection } from "@nyte-ai/sdk/client";
import { constant, scriptedLive } from "./scripted-live.ts";
import { installConnection } from "../src/data/connection.ts";

export interface ConnectionScript {
  readonly views?: ReadonlyMap<SessionId, readonly SessionView[] | ViewStream>;
  readonly sessions?: readonly SessionInfo[] | ViewStream<readonly SessionInfo[]>;
  /** A session left out has no children. */
  readonly children?: ReadonlyMap<SessionId, readonly SessionInfo[]>;
  readonly workspaces?: readonly WorkspaceInfo[];
  readonly session?: (id: SessionId) => Partial<Session>;
  readonly host?: ViewStream<HostView>;
  readonly models?: Partial<ModelsApi>;
  readonly github?: Partial<GitHubAccountApi>;
  /** Shared by every workspace; members left out are refused. */
  readonly git?: Partial<GitApi>;
  /** Shared by every workspace; members left out are refused. */
  readonly workspaceGitHub?: Partial<GitHubApi>;
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

/** A session's handle also stands for its heads, so `head()` returns what the script changes on it. */
export function scriptedConnection(script: ConnectionScript = {}): {
  readonly connection: Connection;
  readonly live: HostConnection;
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
    state: refuse,
    createPullRequest: refuse,
    ...script.workspaceGitHub,
  };

  const connection: Connection = {
    hostId: asId<"host">("scripted"),
    principal: asId<"principal">("tester"),
    credential: { kind: "token", token: "scripted-token-0000" },
    sessions: {
      start: refuse,
      list: async () => ({ items: rows, next: null }),
      read: async () => ({ seq: 0, ids: rows.map((row) => row.id), rows }),
    },
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
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };

  const live = scriptedLive({
    views(id) {
      const scripted = script.views?.get(id);

      if (scripted === undefined) return undefined;

      if ("watch" in scripted) return scripted;
      const last = scripted.at(-1);

      return last === undefined ? undefined : constant(last);
    },
    sessions: "watch" in listed ? listed : constant(rows),
    children: (parent) => script.children?.get(parent) ?? [],
  });

  return { connection, live, sent };
}

export function installScripted(scripted: {
  readonly connection: Connection;
  readonly live: HostConnection;
}): void {
  installConnection(scripted.connection, scripted.live);
}
