import type { Models } from "@nyte-ai/ai";
import type {
  Authority,
  BlobId,
  ByteReader,
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
  PrincipalId,
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
import { watchHost } from "./host-view.ts";
import { inspect } from "./inspect.ts";
import type { Kernel } from "./kernel.ts";
import type { Plugin } from "./plugin.ts";
import { ALL_AUTHORITY, LOCAL, requireAuthority } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { sessionHandle } from "./session.ts";
import type { Session } from "./session.ts";
import { createSessions } from "./sessions.ts";
import type { Sessions } from "./sessions.ts";
import type { Store } from "./store.ts";
import type { Workspace, Workspaces } from "./workspace.ts";
import { createWorkspaces, workspaceHandle } from "./workspaces.ts";

/**
 * Describes everything `sdk.open` needs to compose a host.
 *
 * **Details**
 *
 * Everything else is a plugin or per-session configuration. A knob with no
 * plausible second value is not an option. Each field is an object the
 * caller made and owns.
 *
 * @category entry
 * @since 0.1.0
 */
export interface OpenOptions {
  /** Sessions, refs, objects, receipts, parts, settings: one interface. */
  readonly store: Store;
  /**
   * Catalog, execution and default model, one object.
   *
   * **Details**
   *
   * This is the `@nyte-ai/ai` Models object, with the credential store. The
   * sdk projects it as {@link ModelCatalogView} and never exposes
   * `Model<Api>`, stream functions or `thinkingLevelMap`; the provider
   * boundary lowers a {@link Thinking} to a provider value, and a fast ref to
   * its base with the mode set.
   */
  readonly models: Models;
  /** Core plugins; exactly one environment provider per workspace kind. */
  readonly plugins: readonly Plugin<"core">[];
  /** Where a root session acts when `create` names no workspace. */
  readonly workspace: WorkspaceTarget;
  /**
   * Run sessions here, only admit and leave running to a driver, or admit
   * and hand each head to a dispatcher. Default run.
   *
   * **Details**
   *
   * - `run`: this host drives the covered sessions in process.
   * - `admit-only`: this host admits; a driver (alarms, a listener) runs.
   * - `dispatch`: the kernel writes `admitted` with `covered: true` and,
   *   after the commit, calls `dispatch` for every wake of a head
   *   (admission of a non-`attach` input, a part answer, a child run's
   *   end, a job's end, a stop, a timer), deduplicated per instance while
   *   one for that head is pending. A rejection is recorded in no event:
   *   the head stays owed and `repair` re-dispatches it. A session with a
   *   resolved dispatch in this instance counts as covered, and activation
   *   attaches as for `run`. A Vercel deploy dispatches each head to a
   *   workflow, which ends when it finds the head `busy`: the lease
   *   holder's loop re-reads after each turn and sees the wake.
   */
  readonly execution?:
    | { readonly kind: "run"; readonly coverage: ExecutionCoverage }
    | { readonly kind: "admit-only" }
    | { readonly kind: "dispatch"; dispatch(target: { readonly session: SessionId; readonly head: HeadName }): Promise<void> };
  /** The key core encrypts secrets with before storing them. The host composes it: OS keychain, else a 0600 file. Omitted = `secrets.set` answers unavailable. */
  readonly secrets?: { key(): Promise<Uint8Array> };
}

/**
 * Describes how `sdk.connect` reaches and authenticates to one host.
 *
 * @category entry
 * @since 0.1.0
 */
export interface ConnectOptions {
  /** Always a URL: LAN, tunnel, account relay. The relay is a URL plus a pairing credential, not a transport kind. */
  readonly url: string;
  /** How the client proves who it is. */
  readonly credentials: CredentialSource;
  /**
   * The host this client pinned for this URL.
   *
   * **Gotchas**
   *
   * A different host answering throws `stale` with its `hostId`. The client
   * re-asks the user (repair); it never silently re-pins.
   */
  readonly expect?: { readonly hostId: HostId };
  /** Default memory; persistent only to survive your own restart mid-request. */
  readonly journal?: RequestJournal;
}

/**
 * Stores the client's outbox so a send survives the client dying mid-request.
 *
 * **Details**
 *
 * The journal is the outbox, moved from the desktop into the sdk. `send()`
 * mints the id locally and writes the entry before the wire; the view shows
 * the message `unsent`. On acknowledgement the entry is removed. If the client
 * dies in between, `connect()` loads the journal and resends each entry with
 * the same id; the host admits it or replays the receipt it already has. Same
 * id plus same content is one message, never two, never lost.
 *
 * It journals sends only: everything else is idempotent or a receipt the host
 * holds. It is the one durable client state the sdk owns, because its
 * correctness is the wire's id scheme.
 *
 * **When to use**
 *
 * Memory is the default and is enough for a cli or a script. A desktop passes
 * a disk adapter, a web client localStorage.
 *
 * @category connection
 * @since 0.1.0
 */
export interface RequestJournal {
  /** Returns every entry written and not yet removed; `connect` resends them. */
  load(): Promise<readonly JournalEntry[]>;
  /** Writes an entry before the send reaches the wire. */
  put(entry: JournalEntry): Promise<void>;
  /** Removes an entry once the host acknowledges it. */
  remove(id: ReceiptId): Promise<void>;
}

/**
 * Stores one plugin's JSON values so they survive restart.
 *
 * **Details**
 *
 * Per plugin. The default scope is the session on core and the app on a
 * client; `at` reaches the same keys under another scope.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface PluginStorage {
  /** Returns the stored value, or `undefined` when the key was never set. */
  get<T extends Json>(key: string): Promise<T | undefined>;
  /** Stores a value under the key. */
  set(key: string, value: Json): Promise<void>;
  /** Removes the key. */
  delete(key: string): Promise<void>;
  /** Returns every key in this scope. */
  keys(): Promise<readonly string[]>;
  /** Returns the same keys under another scope: remember browser access per folder. */
  at(scope: "host" | "workspace" | "session"): PluginStorage;
  /** Host-scope, encrypted at rest, never in a view or a log. API keys live here. */
  readonly secrets: { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> };
}

/**
 * Returns a client's surface onto exactly one host.
 *
 * **Details**
 *
 * A connection is one host, forever. Handles made through it are bound to
 * it; a desktop holding a local host and three remote ones holds four
 * connections, and nothing retargets when the user clicks another one.
 *
 * Link loss is not close:
 *
 * - `watch()` streams resume from their last seq; nothing is missed or repeated.
 * - journaled sends are resent by id; the host replays the receipt.
 * - receipts and runs are unaffected; they live on the host.
 *
 * In-process (`open`) the link is always connected.
 *
 * @see {@link Host}
 * @category connection
 * @since 0.1.0
 */
export interface Connection {
  /** The host this connection is bound to. */
  readonly hostId: HostId;
  /** Who this connection acts as. */
  readonly principal: PrincipalId;
  /** The credential to reconnect with: for a pairing connect, the device token it yielded. The client persists it; the sdk keeps it in memory. */
  readonly credential: CredentialSource;
  /** The session directory: create, list, watch. */
  readonly sessions: Sessions;
  /** The workspaces registered on this host. */
  readonly workspaces: Workspaces;
  /**
   * Returns a handle on a session by id.
   *
   * @handle
   */
  session(id: SessionId): Session;
  /**
   * Returns a handle on a workspace by id.
   *
   * @handle
   */
  workspace(id: WorkspaceId): Workspace;
  /**
   * Yields the host view whenever it changes: the one host-level stream.
   *
   * **Details**
   *
   * Carries the catalog generation (models, plugins, commands), settings and
   * link state. Read a namespace again when its generation moves.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<HostView>;

  /**
   * Reads a blob a message or tool result refers to: an attached image, a
   * screenshot. Blobs are content-addressed and immutable.
   *
   * @stream frames
   * @throws {SdkError} unknown when no blob has this id.
   * @authority participant
   */
  blob(id: BlobId): Promise<ByteReader>;
  /** Providers, credentials, models, limits: one thing. Authority is per operation. */
  readonly models: ModelsApi;
  /** Host-scope settings, builtin and plugin. */
  readonly settings: SettingsApi;

  /** Closes the link and drops its streams; accepted work continues on the host. */
  close(): Promise<void>;
  /** Closes the connection; for `await using`. */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Manages providers, credentials and the model catalog on a host.
 *
 * **Details**
 *
 * Authority is per operation: `list` is participant, the rest owner.
 *
 * @category connection
 * @since 0.1.0
 */
export interface ModelsApi {
  /**
   * Returns the model catalog.
   *
   * **Details**
   *
   * Read once; read again when `connection.watch()` bumps the catalog
   * generation. No stream: the catalog changes by your own calls, rarely
   * otherwise.
   *
   * @authority participant
   */
  list(): Promise<ModelCatalogView>;
  /**
   * Pulls dynamic model lists from a provider, or all of them; never required
   * to pick a model.
   *
   * @authority owner
   */
  refresh(provider?: string): Promise<void>;
  /**
   * Sets the model `sessions.create` uses when nothing is chosen.
   *
   * @authority owner
   */
  setDefault(ref: ModelRef): Promise<{ readonly kind: "set" } | { readonly kind: "unknown-model" }>;
  /**
   * Sends one non-generating request to check a provider's credential;
   * configured is not working.
   *
   * @authority owner
   */
  verify(provider: string): Promise<{ readonly kind: "verified" } | { readonly kind: "unverified" } | { readonly kind: "failed"; readonly reason: string }>;
  /**
   * Starts a login flow the host runs; the client draws its steps.
   *
   * **Details**
   *
   * The host runs the flow because it holds the credential store and
   * provider secrets. Returns at once; nothing happens until `steps()` is
   * iterated.
   *
   * @authority owner
   */
  login(input: { readonly provider: string; readonly method: LoginMethod }): Login;
  /**
   * Removes a provider's saved credential.
   *
   * @authority owner
   */
  logout(provider: string): Promise<void>;
}

/**
 * Returns one provider login attempt, run by the host and drawn by the client.
 *
 * **Details**
 *
 * The host runs the flow because it holds the credential store and the
 * provider secrets; the client owns every pixel of it. `steps()` is the
 * primitive; an app that wants `{ getState, subscribe }` wraps the iterator
 * itself. There is no client package: the sdk is the client.
 *
 * @category connection
 * @since 0.1.0
 */
export interface Login {
  /**
   * Yields each step of the flow in order.
   *
   * **Details**
   *
   * - `open`: show the user the url (and code); the host polls.
   * - `paste`: the host wants text the user copies back through `answer`:
   *   `message` says what, `secret` whether to mask it (an API key).
   * - `choose`: the host wants one of `options`; `answer(id)` picks it.
   * - `waiting`, `done`, `failed`: progress and the end.
   *
   * **Gotchas**
   *
   * Dropping the iterator cancels the attempt, never a saved account. It does
   * not survive a reload; start again.
   *
   * @stream frames
   * @authority owner
   */
  steps(): AsyncIterable<
    | { readonly kind: "open"; readonly url: string; readonly code?: string }
    | { readonly kind: "paste"; readonly message: string; readonly secret: boolean }
    | { readonly kind: "choose"; readonly message: string; readonly options: readonly { readonly id: string; readonly label: string }[] }
    | { readonly kind: "waiting" }
    | { readonly kind: "done" }
    | { readonly kind: "failed"; readonly reason: string }
  >;
  /**
   * Sends the text the user pasted after a `paste` step, or the option id chosen after a `choose` step.
   *
   * @authority owner
   */
  answer(code: string): Promise<void>;
}

/**
 * Writes host-scope settings, builtin and plugin.
 *
 * @category connection
 * @since 0.1.0
 */
export interface SettingsApi {
  /**
   * Validates a value against the setting's schema and stores it.
   *
   * **Details**
   *
   * Core owns the value; dependents re-evaluate.
   *
   * @returns {@link SettingOutcome}
   * @authority owner
   */
  apply(id: string, value: Json): Promise<SettingOutcome>;
}

/** Returns a connection bound to the kernel's host as one principal: every member checks its `@authority` tag against the context's authority. */
export function createConnection(kernel: Kernel, context: ConnectionContext): Connection {
  const need = (needed: Authority, operation: string): void =>
    requireAuthority(context.authority, needed, operation);

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
    workspaces: createWorkspaces(kernel, context),
    session: (id) => session(sessionHandle(kernel, context, id)),
    workspace: (id) => workspaceHandle(kernel, context, id),
    watch() {
      need("participant", "watch");

      return track(
        watchHost(kernel, { principal: context.principal, authority: context.authority }),
      );
    },
    async blob(id) {
      need("participant", "blob");
      const reader = await kernel.store.objects.blob(id);

      if (reader === null) throw new SdkError("unknown", `No blob has the id ${id}.`);

      return reader;
    },
    models: {
      async list() {
        need("participant", "models.list");

        return kernel.models.list();
      },
      async refresh(provider) {
        need("owner", "models.refresh");

        return kernel.models.refresh(provider);
      },
      async setDefault(ref) {
        need("owner", "models.setDefault");

        return kernel.models.setDefault(ref);
      },
      async verify(provider) {
        need("owner", "models.verify");

        return kernel.models.verify(provider);
      },
      login(input) {
        need("owner", "models.login");

        return kernel.models.login(input);
      },
      async logout(provider) {
        need("owner", "models.logout");

        return kernel.models.logout(provider);
      },
    },
    settings: {
      async apply(id, value) {
        need("owner", "settings.apply");

        return kernel.settings.apply(id, value);
      },
    },
    close,
    [Symbol.asyncDispose]: close,
  };
}

/** Returns the in-process host: a connection as `LOCAL` with every authority, plus plugins, principals, prune, inspect and execution. */
export function createHost(
  kernel: Kernel,
  input: { readonly credential: CredentialSource },
): Omit<Host, "listen"> {
  const context: ConnectionContext = {
    principal: LOCAL,
    authority: ALL_AUTHORITY,
    credential: input.credential,
    origin: null,
  };

  const need = (operation: string): void =>
    requireAuthority(context.authority, "maintenance", operation);

  return {
    ...createConnection(kernel, context),
    plugins: {
      async replace(plugins, scope) {
        need("plugins.replace");

        return kernel.plugins.replace(plugins, scope);
      },
      async check(plugins) {
        need("plugins.check");

        return kernel.plugins.check(plugins);
      },
    },
    prune: () => kernel.prune(),
    principals: {
      async list() {
        need("principals.list");

        return kernel.principals.list();
      },
      async pair(request) {
        need("principals.pair");

        return kernel.principals.pair(request);
      },
      async revoke(id) {
        need("principals.revoke");

        return kernel.principals.revoke(id);
      },
    },
    inspect: (session) => inspect(kernel, session),
    execution: {
      cover: (coverage) => cover(kernel, coverage),
      advance: (step) => advance(kernel, step),
      repair: (page) => repair(kernel, page),
    },
  };
}
