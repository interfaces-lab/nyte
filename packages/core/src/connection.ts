import type { Models } from "@nyte-ai/ai";
import type {
  Authority,
  BlobId,
  ByteReader,
  Capability,
  CredentialSource,
  ExecutionCoverage,
  HeadName,
  HostId,
  HostView,
  JournalEntry,
  Json,
  LoginMethod,
  ModelCatalogView,
  ModelRef,
  PluginCheckReport,
  PluginReplacementReport,
  PrincipalId,
  PrincipalView,
  ReceiptId,
  SessionId,
  SettingOutcome,
  WorkspaceId,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import { advance, cover, repair } from "./execution.ts";
import type { Head } from "./head.ts";
import type { Host } from "./host.ts";
import { watchHost } from "./host.ts";
import { inspect } from "./inspect.ts";
import type { Kernel } from "./kernel.ts";
import type { Plugin } from "./plugin.ts";
import { ALL_AUTHORITY, LOCAL, gate, gated } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { createSessions, sessionHandle } from "./session.ts";
import type { Session, Sessions } from "./session.ts";
import type { Store } from "./store.ts";
import { createWorkspaces, workspaceHandle } from "./workspaces.ts";
import type { Workspace, Workspaces } from "./workspaces.ts";

export interface OpenOptions {
  readonly store: Store;
  readonly models: Models;
  readonly plugins: readonly Plugin<"core">[];
  readonly workspace: WorkspaceTarget;
  readonly execution?:
    | { readonly kind: "run"; readonly coverage: ExecutionCoverage }
    | { readonly kind: "admit-only" }
    | {
        readonly kind: "dispatch";
        dispatch(target: { readonly session: SessionId; readonly head: HeadName }): Promise<void>;
      };
  readonly secrets?: { key(): Promise<Uint8Array> };
}

export interface ConnectOptions {
  readonly url: string;
  readonly credentials: CredentialSource;
  readonly expect?: { readonly hostId: HostId };
  readonly journal?: RequestJournal;
  readonly fetch?: typeof fetch;
}

export interface RequestJournal {
  load(): Promise<readonly JournalEntry[]>;
  put(entry: JournalEntry): Promise<void>;
  remove(id: ReceiptId): Promise<void>;
}

export interface PluginStorage {
  get<T extends Json>(key: string): Promise<T | undefined>;
  set(key: string, value: Json): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
  at(scope: "host" | "workspace" | "session"): PluginStorage;
  readonly secrets: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
}

export interface Connection {
  readonly hostId: HostId;
  readonly principal: PrincipalId;
  readonly credential: CredentialSource;
  readonly sessions: Sessions;
  readonly workspaces: Workspaces;
  session(id: SessionId): Session;
  workspace(id: WorkspaceId): Workspace;
  watch(): AsyncIterable<HostView>;
  blob(id: BlobId): Promise<ByteReader>;
  readonly models: ModelsApi;
  readonly settings: SettingsApi;
  readonly plugins: PluginsApi<PluginFile>;
  readonly principals: PrincipalsApi;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface ModelsApi {
  list(): Promise<ModelCatalogView>;
  refresh(provider?: string): Promise<void>;
  setDefault(ref: ModelRef): Promise<{ readonly kind: "set" } | { readonly kind: "unknown-model" }>;
  verify(
    provider: string,
  ): Promise<
    | { readonly kind: "verified" }
    | { readonly kind: "unverified" }
    | { readonly kind: "failed"; readonly reason: string }
  >;
  login(input: { readonly provider: string; readonly method: LoginMethod }): Login;
  logout(provider: string): Promise<void>;
}

export interface Login {
  steps(): AsyncIterable<
    | { readonly kind: "open"; readonly url: string; readonly code?: string }
    | { readonly kind: "paste"; readonly message: string; readonly secret: boolean }
    | {
        readonly kind: "choose";
        readonly message: string;
        readonly options: readonly { readonly id: string; readonly label: string }[];
      }
    | { readonly kind: "waiting" }
    | { readonly kind: "done" }
    | { readonly kind: "failed"; readonly reason: string }
  >;
  answer(code: string): Promise<void>;
}

export type PluginFile = { readonly path: string };

export interface PluginsApi<Entry> {
  replace(
    plugins: readonly Entry[],
    scope?: { readonly session: SessionId },
  ): Promise<PluginReplacementReport>;
  check(plugins: readonly Entry[]): Promise<PluginCheckReport>;
}

export interface PrincipalsApi {
  list(): Promise<readonly PrincipalView[]>;
  pair(input: {
    readonly authority: ReadonlySet<Authority>;
    readonly label?: string;
  }): Promise<{ readonly code: string; readonly expiresAt: number }>;
  revoke(id: PrincipalId): Promise<void>;
}

export interface SettingsApi {
  apply(id: string, value: Json): Promise<SettingOutcome>;
}

/** Returns a connection bound to the kernel's host as one principal; each member a row needs more than participant for is `gated` by the context's authority. */
export function createConnection(kernel: Kernel, context: ConnectionContext): Connection {
  const { authority } = context;
  const streams = new Set<() => void>();
  const sessions = createSessions(kernel, context);

  const track = <T>(source: AsyncIterable<T>): AsyncIterable<T> => ({
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();

      const stop = (): void => {
        void iterator.return?.();
      };

      streams.add(stop);

      return {
        async next() {
          const result = await iterator.next();

          if (result.done === true) streams.delete(stop);

          return result;
        },
        async return() {
          streams.delete(stop);
          await iterator.return?.();

          return { done: true, value: undefined };
        },
      };
    },
  });

  const head = (handle: Head): Head => ({
    ...handle,
    watch: (options) => track(handle.watch(options)),
  });

  const session = (handle: Session): Session => ({
    ...handle,
    watch: (options) => track(handle.watch(options)),
    head: (name) => head(handle.head(name)),
  });

  const capability = async <T extends object>(
    kind: string,
    found: () => Promise<Capability<T>>,
  ): Promise<Capability<T>> => {
    const provided = await found();

    return provided.kind === "available"
      ? { ...provided, api: gated(kind, provided.api, authority) }
      : provided;
  };

  const workspace = (id: WorkspaceId): Workspace => {
    const handle = workspaceHandle(kernel, context, id);

    return gated("workspace", handle, authority, {
      files: () => capability("files", () => handle.files()),
      git: () => capability("git", () => handle.git()),
      browser: () => capability("browser", () => handle.browser()),
    });
  };

  const close = async (): Promise<void> => {
    for (const stop of streams) stop();
    streams.clear();
  };

  return {
    hostId: kernel.hostId,
    principal: context.principal,
    credential: context.credential,
    sessions: {
      watch: (input) => track(sessions.watch(input)),
      create: async (input) => session(await sessions.create(input)),
      list: (input) => sessions.list(input),
    },
    workspaces: gated("workspaces", createWorkspaces(kernel, context), authority),
    session: (id) => session(sessionHandle(kernel, context, id)),
    workspace,
    watch: () =>
      track(watchHost(kernel, { principal: context.principal, authority: context.authority })),
    async blob(id) {
      const reader = await kernel.store.objects.blob(id);

      if (reader === null) throw new SdkError("unknown", `No blob has the id ${id}.`);

      return reader;
    },
    models: gated("models", kernel.models, authority, {
      login(input) {
        gate(authority, "models.login");

        return kernel.models.login(input);
      },
    }),
    settings: gated("settings", kernel.settings, authority),
    plugins: gated(
      "plugins",
      {
        replace: async (plugins, scope) =>
          kernel.plugins.replace(await kernel.loadPlugins(pathsOf(plugins)), scope),
        check: async (plugins) => kernel.plugins.check(await kernel.loadPlugins(pathsOf(plugins))),
      },
      authority,
    ),
    principals: gated("principals", kernel.principals, authority),
    close,
    [Symbol.asyncDispose]: close,
  };
}

/** Returns the in-process host: a connection as `LOCAL` with every authority, its `plugins` taking plugin objects and files alike, plus inspect and execution. */
export function createHost(
  kernel: Kernel,
  input: { readonly credential: CredentialSource },
): Omit<Host, "listen"> {
  const connection = createConnection(kernel, {
    principal: LOCAL,
    authority: ALL_AUTHORITY,
    credential: input.credential,
    origin: null,
  });

  return {
    ...connection,
    plugins: {
      replace: async (plugins, scope) =>
        kernel.plugins.replace(await loaded(kernel, plugins), scope),
      check: async (plugins) => kernel.plugins.check(await loaded(kernel, plugins)),
    },
    inspect: (session) => inspect(kernel, session),
    execution: {
      cover: (coverage) => cover(kernel, coverage),
      advance: (step) => advance(kernel, step),
      repair: (page) => repair(kernel, page),
    },
  };
}

function pathsOf(files: readonly PluginFile[]): readonly string[] {
  return files.map((file) => file.path);
}

/** Returns plugin objects and files as the kernel takes them, in order, each file loaded through `kernel.loadPlugins`. */
async function loaded(
  kernel: Kernel,
  plugins: readonly (Plugin<"core"> | PluginFile)[],
): Promise<readonly Plugin<"core">[]> {
  const each = await Promise.all(
    plugins.map(async (plugin) =>
      isPluginFile(plugin) ? kernel.loadPlugins([plugin.path]) : [plugin],
    ),
  );

  return each.flat();
}

/** Returns whether an entry names a file: a plugin has an `id` and no `path`. */
function isPluginFile(plugin: Plugin<"core"> | PluginFile): plugin is PluginFile {
  return "path" in plugin && !("id" in plugin);
}
