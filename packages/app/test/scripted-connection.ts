/**
 * A scripted `Connection` for tests: sessions yield the views a test gives
 * them, the directory yields its rows, and every operation a test does not
 * script rejects `unavailable`. A test reads what was sent from `sent`.
 */
import { SdkError } from "@nyte-ai/sdk";
import type {
  Connection,
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

/** What a scripted connection answers. */
export interface ConnectionScript {
  /** Each session's views: the ones its watch yields in order, or a stream a test pushes to. */
  readonly views?: ReadonlyMap<SessionId, readonly SessionView[] | ViewStream>;
  /** The directory rows `sessions.watch` and `session(id).info()` answer from. */
  readonly sessions?: readonly SessionInfo[];
  readonly workspaces?: readonly WorkspaceInfo[];
  /** Overrides on one session's handle, by id. */
  readonly session?: (id: SessionId) => Partial<Session>;
  /** The host view `watch()` yields. */
  readonly host?: ViewStream<HostView>;
  /** Overrides on `models`. */
  readonly models?: Partial<ModelsApi>;
}

/** A send a scripted session received. */
export interface ScriptedSend {
  readonly session: SessionId;
  readonly content: UserContent;
  readonly options: Json | undefined;
}

/** Values a test pushes while a screen watches; the newest one is what a read answers. */
export interface ViewStream<T = SessionView> {
  readonly latest: () => T | undefined;
  readonly push: (value: T) => void;
  readonly watch: () => AsyncIterable<T>;
}

/** Returns a stream that starts at `first` and yields every value pushed after it. */
export function viewStream<T = SessionView>(first: T): ViewStream<T> {
  let latest = first;
  const waiting = new Set<(view: T) => void>();

  return {
    latest: () => latest,
    push: (view) => {
      latest = view;

      for (const wake of Array.from(waiting)) wake(view);
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

async function* replay<T>(values: readonly T[]): AsyncIterable<T> {
  yield* values;
  await new Promise<never>(() => undefined);
}

/** Returns a connection over `script`, and the sends it received. */
export function scriptedConnection(script: ConnectionScript = {}): {
  readonly connection: Connection;
  readonly sent: readonly ScriptedSend[];
} {
  const sent: ScriptedSend[] = [];
  const rows = script.sessions ?? [];

  const session = (id: SessionId): Session => {
    const scripted = script.views?.get(id) ?? [];
    const stream = "watch" in scripted ? scripted : undefined;
    const views = "watch" in scripted ? undefined : scripted;
    const row = rows.find((candidate) => candidate.id === id);
    const base: Session = {
      id,
      sessionId: id,
      name: asId<"head">("main"),
      send: async (content) => {
        sent.push({ session: id, content, options: null });

        return refuse();
      },
      configure: refuse,
      view: async () => {
        const last = stream?.latest() ?? views?.at(-1);

        if (last === undefined) throw new SdkError("unknown", "No view scripted.");

        return last;
      },
      watch: () => stream?.watch() ?? replay(views ?? []),
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
      parts: { create: refuse },
      part: (part) => ({ id: part, update: refuse, act: refuse, answer: refuse, close: refuse }),
    };

    return { ...base, ...script.session?.(id) };
  };

  const workspace = (id: WorkspaceId) => ({
    id,
    info: refuse,
    watch: refused,
    update: refuse,
    reload: refuse,
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
    git: refuse,
    browser: refuse,
  });

  const connection: Connection = {
    hostId: asId<"host">("scripted"),
    principal: asId<"principal">("tester"),
    credential: { kind: "token", token: "scripted-token-0000" },
    sessions: {
      watch: () => replay([rows]),
      create: refuse,
      list: async () => ({ items: rows, next: null }),
    },
    workspaces: {
      list: async () => script.workspaces ?? [],
      inspect: refuse,
      add: refuse,
      forget: refuse,
    },
    session,
    workspace,
    watch: () => script.host?.watch() ?? refused(),
    blob: refuse,
    models: {
      list: refuse,
      refresh: refuse,
      setDefault: refuse,
      verify: refuse,
      login: () => ({ steps: refused, answer: refuse }),
      logout: refuse,
      ...script.models,
    },
    settings: { apply: refuse },
    plugins: { replace: refuse, check: refuse },
    principals: { list: refuse, pair: refuse, revoke: refuse },
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };

  return { connection, sent };
}
