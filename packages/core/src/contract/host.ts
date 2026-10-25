import { asId } from "@nyte-ai/schema";
import type {
  AdvanceReport,
  Authority,
  Awaitable,
  BlobId,
  ByteReader,
  CallId,
  CredentialSource,
  Cursor,
  DecodedObjectView,
  Disposer,
  ExecutionCoverage,
  HeadName,
  HostDescription,
  HostId,
  HostView,
  IdentityChallenge,
  IntegrityReport,
  JournalEntry,
  Json,
  LoginMethod,
  ModelAccount,
  ModelCatalogView,
  ModelListing,
  ModelRef,
  Owned,
  Paged,
  PluginCheckReport,
  PluginReplacementReport,
  PrincipalId,
  PrincipalView,
  ProviderUsage,
  ReceiptId,
  Ref,
  RepairPage,
  RunId,
  Seq,
  SessionEvent,
  SessionId,
  SettingOutcome,
  WorkspaceId,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import type { Models, Provider } from "@nyte-ai/ai";
import type { Plugin } from "./plugin.ts";
import type { Session, Sessions } from "./session.ts";
import type { Store } from "./store.ts";
import type { GitHubAccountApi, McpHubFactory, Workspace, Workspaces } from "./workspace.ts";

export type CredentialStatus = ModelCatalogView["providers"][number]["credential"];

export interface ModelState {
  read(models: Models): Promise<ReadonlyMap<string, CredentialStatus>>;
  check(models: Models, provider: Provider): Promise<CredentialStatus>;
  refresh(models: Models, provider?: string): Promise<void>;
  verify(models: Models, provider: string): ReturnType<Models["verifyAuth"]>;
  invalidate(provider: string): void;
  close(): Promise<void>;
}

export interface ConnectionContext {
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly credential: CredentialSource;

  readonly origin: {
    readonly session: SessionId;
    readonly run: RunId | null;
    readonly head: HeadName | null;
    readonly call: CallId | null;
    readonly sequence: { next(): number };
  } | null;
}

export interface ConnectionRegistry {
  register(
    principal: PrincipalId,
    close: () => void,
  ): { readonly kind: "admitted"; readonly dispose: Disposer } | { readonly kind: "revoked" };

  revoke(principal: PrincipalId): void;
}

export const LOCAL: PrincipalId = asId<"principal">("local");

export const TOKEN: PrincipalId = asId<"principal">("token");

export const ALL_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>([
  "participant",
  "owner",
  "maintenance",
]);

export const TOKEN_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>(["participant", "owner"]);

export const CORE_CONTEXT: ConnectionContext = {
  principal: LOCAL,
  authority: TOKEN_AUTHORITY,
  credential: { kind: "token", token: "" },
  origin: null,
};

export const PARTICIPANT_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>(["participant"]);

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
  /** The serving machine's GitHub CLI login, served as `Connection.github`; absent, its calls throw `SdkError("unavailable")`. */
  readonly github?: GitHubAccountApi;
  readonly images?: ImageProcessor;
}

export interface ImageLimits {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxBase64Bytes: number;
}

export const IMAGE_LIMITS: ImageLimits = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBase64Bytes: 4.5 * 1024 * 1024,
};

export interface PreparedImage {
  readonly data: string;
  readonly mimeType: string;
  readonly resized?: {
    readonly from: { readonly width: number; readonly height: number };
    readonly to: { readonly width: number; readonly height: number };
  };
}

export interface ImageProcessor {
  prepare(
    bytes: Uint8Array,
    mimeType: string,
    limits: ImageLimits,
  ): Promise<PreparedImage | undefined>;
}

export interface ConnectOptions {
  readonly url: string;
  readonly credentials: CredentialSource;
  readonly expect?: { readonly hostId: HostId };
  readonly journal?: RequestJournal;
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
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
  /** The serving machine's GitHub CLI login, shared by every workspace; signing in and out needs owner authority, and a host without one throws `SdkError("unavailable")`. */
  readonly github: GitHubAccountApi;

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

  setListing(
    refs: readonly ModelRef[],
    listing: ModelListing,
  ): Promise<{ readonly kind: "set" } | { readonly kind: "unknown-model" }>;

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

export interface Host extends Connection {
  listen(options: ListenOptions): Promise<Listener>;
  readonly plugins: PluginsApi<Plugin<"core"> | PluginFile>;
  inspect(session: SessionId): {
    refs(): Promise<readonly Ref[]>;
    objects(input?: { readonly cursor?: Cursor }): Promise<Paged<DecodedObjectView>>;
    events(input: { readonly after: Seq }): AsyncIterable<SessionEvent>;
    verify(): Promise<IntegrityReport>;
  };
  readonly execution: {
    cover(coverage: ExecutionCoverage): Promise<Owned>;
    advance(input: {
      readonly session: SessionId;
      readonly head: HeadName;
    }): Promise<AdvanceReport>;
    repair(input: { readonly cursor?: Cursor; readonly limit: number }): Promise<RepairPage>;
  };
}

export interface ListenOptions {
  readonly transport:
    | { readonly kind: "http"; readonly hostname?: string; readonly port?: number }
    | { readonly kind: "fetch" };
  readonly auth:
    | {
        readonly kind: "token";
        readonly token: string;
        /** What the token grants; default {@link TOKEN_AUTHORITY}. Grant `maintenance` only to a token the host's owner minted for its own processes, never one handed to a peer. */
        readonly authority?: ReadonlySet<Authority>;
      }
    | {
        readonly kind: "custom";
        authorize(
          request: Request,
        ): Awaitable<
          | { readonly principal: PrincipalId; readonly authority: ReadonlySet<Authority> }
          | { readonly deny: "unauthorized" | "forbidden" }
        >;
      };
  readonly execution?:
    | { readonly kind: "run"; readonly coverage: ExecutionCoverage }
    | { readonly kind: "admit-only" };
  readonly origins?: readonly string[];
  readonly maxBodyBytes?: number;
  readonly identity?: { readonly id: HostId; sign(nonce: string): Awaitable<IdentityChallenge> };
  readonly describe?: () => Awaitable<HostDescription>;
  before?(request: Request): Awaitable<Response | undefined>;
}

export interface Listener {
  readonly address: string | null;
  fetch(request: Request): Promise<Response>;
  disconnectClients(): void;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export type HostViewFields = Pick<
  HostView,
  "catalog" | "plugins" | "settings" | "defaultWorkspace"
>;

export interface HostState {
  current(): HostViewFields;

  update(patch: Partial<HostViewFields>): void;

  report(row: HostViewFields["plugins"][number]): void;

  subscribe(listener: (fields: HostViewFields) => void): Disposer;
}
