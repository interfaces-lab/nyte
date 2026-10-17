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
  ModelAccount,
  ModelCatalogView,
  ModelRef,
  PluginCheckReport,
  PluginReplacementReport,
  PrincipalId,
  PrincipalView,
  ProviderUsage,
  ReceiptId,
  SessionId,
  SettingOutcome,
  WorkspaceId,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import { advance, cover, repair } from "./execution.ts";
import type { Head } from "./head.ts";
import type { McpHubFactory } from "./mcp.ts";
import type { Host } from "./host.ts";
import { watchHost } from "./host.ts";
import { inspect } from "./inspect.ts";
import type { Kernel } from "./kernel.ts";
import type { Plugin } from "./plugin.ts";
import { ALL_AUTHORITY, LOCAL, gate, gated } from "./principals.ts";
import { forwarded } from "./watch.ts";
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
  /** Serves MCP servers to this host's sessions and clients; see {@link McpHub}. */
  readonly mcp?: McpHubFactory;
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
  get(key: string): Promise<Json | undefined>;

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
  /** Reads saved models, selection and last-known credentials without awaiting external checks; fresh availability arrives through HostView.catalog. */
  list(): Promise<ModelCatalogView>;

  /** Lists saved logins for one provider or all providers. Requires owner authority. */
  accounts(provider?: string): Promise<readonly ModelAccount[]>;

  /** Activates a saved login for subsequent requests. Requires owner authority. */
  selectAccount(provider: string, account: string): Promise<void>;

  /** Loads cached provider usage, refreshing expired entries. Requires owner authority. */
  usage(): Promise<readonly ProviderUsage[]>;

  refresh(provider?: string): Promise<void>;

  setDefault(ref: ModelRef): Promise<{ readonly kind: "set" } | { readonly kind: "unknown-model" }>;

  verify(
    provider: string,
  ): Promise<
    | { readonly kind: "verified" }
    | { readonly kind: "unverified" }
    | { readonly kind: "failed"; readonly reason: string }
  >;

  login(input: {
    readonly provider: string;
    readonly method: LoginMethod;
    readonly label?: string;
    readonly browser?: "host" | "elsewhere";
  }): Login;

  /** Removes the provider's active saved login while keeping its other accounts. */
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
          let done = true;

          try {
            const result = await iterator.next();
            done = result.done === true;

            return result;
          } finally {
            if (done) streams.delete(stop);
          }
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

  const client = {};

  const workspace = (id: WorkspaceId): Workspace => {
    const handle = workspaceHandle(kernel, context, id, client);

    return gated("workspace", handle, authority, {
      mcp: gated("mcp", handle.mcp, authority, {
        watch: () =>
          forwarded(async () => {
            gate(authority, "mcp.watch");

            return handle.mcp.watch();
          }),
        login(server) {
          gate(authority, "mcp.login");

          return handle.mcp.login(server);
        },
      }),
      files: () => capability("files", () => handle.files()),
      git: () => capability("git", () => handle.git()),
      browser: () => capability("browser", () => handle.browser()),
    });
  };

  const close = async (): Promise<void> => {
    for (const stop of streams) stop();
    streams.clear();
    await kernel.pages.release({ client });
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
          kernel.plugins.replace(await kernel.loadPlugins(listPluginPaths(plugins)), scope),
        check: async (plugins) =>
          kernel.plugins.check(await kernel.loadPlugins(listPluginPaths(plugins))),
      },
      authority,
    ),
    principals: gated("principals", kernel.principals, authority),
    close,
    [Symbol.asyncDispose]: close,
  };
}

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

function listPluginPaths(files: readonly PluginFile[]): readonly string[] {
  return files.map((file) => file.path);
}

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

function isPluginFile(plugin: Plugin<"core"> | PluginFile): plugin is PluginFile {
  return "path" in plugin && !("id" in plugin);
}
