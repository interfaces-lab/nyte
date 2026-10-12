/**
 * Nyte SDK baseline.
 *
 * The logical shape core, host, protocol and the clients are written to.
 * Declarations only. Names used here without a declaration are declared in
 * the rewrite document (Part 2 §15) and written into @nyte-ai/schema by the work order
 * that first needs them; nothing is unresolved. The old surfaces are listed
 * in the rewrite document (Part 3); nothing here is defined in terms of them.
 *
 * **Rules**
 *
 * - Acquisition and defects throw. `open`, `connect`, `create`: await and use.
 * - Domain commands return one discriminated outcome. No Result wrapper.
 * - Streams yield values; a broken stream throws when iterated.
 * - Handles bind synchronously, no I/O, no existence check. Missing is an
 *   outcome of the call that needs it.
 * - Every surface is closures over its owner's state, so destructuring works.
 * - Keys are minted inside and returned in the receipt; pass one in only to
 *   retry across your own restart.
 * - Core asks nothing. No permission, trust or confirmation is requested by
 *   core by default. A client that wants to ask does so before it calls; a
 *   policy that wants to gate does so as a core plugin on a decide hook with
 *   a modal part it declares. Core ships no part that asks and no state that
 *   means "waiting for consent".
 *
 * **Tags**
 *
 * - `@handle`: binds synchronously, does no I/O, never throws.
 * - `@stream watch`: coalesced views, latest wins; `@stream frames`: every
 *   frame in order.
 * - `@authority participant|owner|maintenance`: what a served operation needs.
 * - `@throws {SdkError}` lists the codes specific to a call. Every served call
 *   may also throw `invalid` (input failed its declaration schema), `denied`
 *   (the principal lacks the authority), `unavailable` (the link closed) and
 *   `internal` (a host defect); those four are not repeated per member.
 *
 * **Packages**
 *
 * - `@nyte-ai/schema`: every record type in this file, plus the
 *   provider-facing `ModelMessage` and `Model<Api>` it imports from
 *   `@nyte-ai/ai`. One definition per record; the wire, the views and the
 *   hooks read the same one.
 * - `@nyte-ai/protocol`: the declaration table and what is generated from it:
 *   routes, codecs, the catalog `HostView.operations` serves, the delta format
 *   `watch()` resumes from, the wire error.
 * - `@nyte-ai/core`: the kernel: admission, runs, the fold, parts, refs,
 *   durability, authority. Store and driver interfaces are its exports.
 * - `@nyte-ai/host`: `listen`; the stores (sqlite, postgres, durable object);
 *   the execution drivers (local loop, Cloudflare alarms, Vercel workflows);
 *   the environment providers (local, sandbox, chat-only). The local provider
 *   is the largest piece: git CLI, hidden-ref snapshots, pty, and whatever a
 *   desktop adds through `wrapEnv`.
 * - `@nyte-ai/sdk`: `open`, `connect`, the typed client generated from the
 *   table, the journal. The sdk is the client; there is no other.
 * - `@nyte-ai/plugin`: the `Plugin<Side>` types under `/core` and `/client`.
 *
 * **Wire rules**
 *
 * - strict in, lenient out: an unknown field in an input is invalid; an
 *   unknown field in a view is ignored; an unknown kind in a view skips that
 *   record, never coerces it. A newer host serves an older client.
 * - one error: core throws {@link SdkError} `{ code, message, hostId, issues,
 *   correlation }`; protocol serialises it; the sdk rethrows the same class.
 *   Protocol has no types of its own: it listens to core and matches.
 * - streams: upload, bytes, capture and output are Declaration kind
 *   `"stream"`; watch is kind `"watch"`. The table drives the routes, the sdk
 *   folds watch deltas and resumes from seq.
 * - settings file: `~/.nyte/settings.json` seeds `sdk.settings` on first open;
 *   core owns the values after. Not a second source of truth.
 *
 * @module
 * @since 0.1.0
 */

// 0. Schemas

import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
/** Catalog, execution and credential store together. */
import type { Models } from "@nyte-ai/ai";
/** The provider-facing message; never the view's Message. Renamed only to avoid the collision. */
import type { Message as ModelMessage } from "@nyte-ai/schema/model";
/**
 * Accepts any validator that implements both Standard Schema halves.
 *
 * **Details**
 *
 * The SDK never imports a validator. Each half has one job:
 *
 * - `validate`: model tool args, client actions, command args.
 * - `jsonSchema.input`: tool parameters to the model.
 * - `jsonSchema.output`: part state and actions to clients, the catalog.
 *
 * Who implements both halves natively, as of their current releases:
 *
 * - zod 4.2+: every schema, directly.
 * - arktype 2.1.28+: every type, directly.
 * - valibot 1.2+: through `toStandardJsonSchema()` from `@valibot/to-json-schema`.
 * - typebox 1.3.x: **neither half**. `Compile()` returns a `Validator` with
 *   `Check`/`Parse` and no `~standard`. TypeBox schemas are already JSON
 *   Schema, so the adapter is small and lives in `@nyte-ai/schema`:
 *
 * ```ts
 * import { Compile } from "typebox/compile";
 * import type { TSchema, StaticDecode } from "typebox";
 *
 * export function standard<T extends TSchema>(schema: T): Schema<StaticDecode<T>> {
 *   const validator = Compile(schema);
 *   return {
 *     "~standard": {
 *       version: 1,
 *       vendor: "typebox",
 *       validate: (value) =>
 *         validator.Check(value)
 *           ? { value: validator.Parse(value) }
 *           : { issues: validator.Errors(value).map((e) => ({ message: e.message, path: e.path.split("/").filter(Boolean) })) },
 *       jsonSchema: { input: () => schema, output: () => schema },
 *       types: undefined, // phantom; StaticDecode<T> carries the types
 *     },
 *   };
 * }
 * ```
 *
 * Core's own records are written with TypeBox and cross the plugin boundary
 * through `standard()`. A plugin author may use any of the four; the kernel
 * only ever sees `~standard`.
 *
 * **Gotchas**
 *
 * A schema that cannot convert to JSON Schema is a load-time
 * {@link ValidationIssue}, not a runtime failure. `jsonSchema` may throw
 * per the spec; core calls it at plugin load, never at request time.
 *
 * @category schemas
 * @since 0.1.0
 */
type Schema<T> = StandardSchemaV1<unknown, T> & StandardJSONSchemaV1<unknown, T>;
/**
 * Returns the output type a Standard Schema validates to.
 *
 * @category schemas
 * @since 0.1.0
 */
type Infer<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

// 1. Entry

/**
 * Returns the SDK root: `open` composes a host in-process, `connect` reaches
 * one over a URL. Both resolve to the same surface.
 *
 * **Details**
 *
 * Acquisition throws; everything after it returns outcomes. A {@link Host}
 * is a {@link Connection} with composition-root members added, so code
 * written against a connection runs unchanged in-process.
 *
 * **Example** (Connecting to a host and sending a message)
 *
 * ```ts
 * import { sdk } from "@nyte-ai/sdk";
 *
 * const connection = await sdk.connect({
 *   url: "https://studio.local:7420",
 *   credentials: { kind: "token", token: process.env.NYTE_TOKEN ?? "" },
 * });
 * const session = await connection.sessions.create({ name: "triage" });
 * const receipt = await session.send("Summarise the open issues.");
 * ```
 *
 * @see {@link Connection}
 * @see {@link Host}
 * @category entry
 * @since 0.1.0
 */
declare const sdk: {
  /**
   * Composes a host in-process from a store, models and plugins, and starts
   * running every session unless `execution` says otherwise.
   *
   * @throws {SdkError} invalid when a plugin fails its preflight or two plugins provide the same environment kind.
   * @throws {SdkError} unavailable when the store cannot be opened.
   */
  open(options: OpenOptions): Promise<Host>;
  /**
   * Opens a connection to one host at a URL, authenticates, and replays the
   * request journal.
   *
   * @throws {SdkError} unavailable when the URL is unreachable.
   * @throws {SdkError} unauthenticated when the host rejects the credential.
   * @throws {SdkError} stale when a host other than `expect.hostId` answers; `hostId` is the one that did.
   */
  connect(options: ConnectOptions): Promise<Connection>;
};

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
interface OpenOptions {
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
interface ConnectOptions {
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
  /** The `fetch` every request goes through; default the global. For tests, React Native and relays (§47b). */
  readonly fetch?: typeof fetch;
}


/**
 * Returns how a client authenticates: a static token, a one-time pairing
 * code, or headers computed per request.
 *
 * **Details**
 *
 * - `token`: a bearer token.
 * - `pairing`: a code from `host.principals.pair`; exchanged once for a
 *   device credential the sdk keeps.
 * - `custom`: borrowed; `headers()` is called again per request, so it can
 *   refresh.
 *
 * @category connection
 * @since 0.1.0
 */
type CredentialSource =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "pairing"; readonly code: string }
  | { readonly kind: "custom"; headers(): Awaitable<Readonly<Record<string, string>>> };
/**
 * Records one send the host has not yet acknowledged.
 *
 * @category connection
 * @since 0.1.0
 */
interface JournalEntry { readonly id: ReceiptId; readonly session: SessionId; readonly head: HeadName; readonly content: UserContent; readonly options: SendOptions; readonly at: number }
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
interface RequestJournal {
  /** Returns every entry written and not yet removed; `connect` resends them. */
  load(): Promise<readonly JournalEntry[]>;
  /** Writes an entry before the send reaches the wire. */
  put(entry: JournalEntry): Promise<void>;
  /** Removes an entry once the host acknowledges it. */
  remove(id: ReceiptId): Promise<void>;
}
/**
 * Opens core's persistence: sessions, refs, objects, receipts, parts and
 * settings behind one interface.
 *
 * **Details**
 *
 * sqlite, postgres and durable-object storage implement it. The contract is
 * two tables and two primitives: immutable content-addressed objects written
 * before any publish, and refs, the only mutable thing, published as one
 * all-or-nothing `refs.set` batch. There is no transaction function: every
 * durable change is "put objects, then one set".
 *
 * **Example** (Opening a host on a store)
 *
 * ```ts
 * import { sdk } from "@nyte-ai/sdk";
 *
 * declare const store: Store;
 * declare const models: Models;
 * declare const local: Plugin<"core">;
 *
 * const host = await sdk.open({
 *   store,
 *   models,
 *   plugins: [local],
 *   workspace: { kind: "local", path: "/Users/ada/project" },
 * });
 * ```
 *
 * @see {@link StoreConnection}
 * @see {@link RefStore}
 * @category store
 * @since 0.1.0
 */
interface Store {
  /** Names the backend: "sqlite", "postgres", "durable-object". */
  readonly kind: string;
  /** Opens a connection to the objects and refs tables. */
  open(): Promise<StoreConnection>;
  /** Releases the backend. */
  close(): Promise<void>;
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
interface PluginStorage {
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
interface Connection {
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
  /** Hot plugin replacement and preflight over plugin files the host loads, the only kind the wire carries. A participant is answered `denied`; a client hides the controls by `HostView.authority` (§47e, §47l). */
  readonly plugins: PluginsApi<PluginFile>;
  /** Who may connect. A participant is answered `denied` (§47e). */
  readonly principals: PrincipalsApi;

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
interface ModelsApi {
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
 * Returns the host's providers and their models as one catalog, stamped with
 * a generation.
 *
 * @category connection
 * @since 0.1.0
 */
interface ModelCatalogView {
  /** Moves whenever the catalog changes; `HostView.catalog` carries the latest. */
  readonly generation: CatalogGeneration;
  /** What `sessions.create` uses when nothing is chosen. */
  readonly default: ModelRef | null;
  /** Every configured or configurable provider. */
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly credential: "missing" | "configured" | "verified" | "failed";
    /** How a credential can be obtained: oauth, key. A device-code flow is an oauth login whose `open` step carries a code. */
    readonly methods: readonly LoginMethod[];
    /** Account windows the provider reported on its last response. */
    readonly limits: readonly { readonly label: string; readonly used: number; readonly limit: number; readonly resetsAt: number | null }[];
    /** Base models only. */
    readonly models: readonly ModelInfo[];
  }[];
}
/**
 * Describes one base model: what it accepts, its limits and its cost.
 *
 * @category connection
 * @since 0.1.0
 */
interface ModelInfo {
  /** Provider and id. */
  readonly ref: ModelRef;
  /** Display name. */
  readonly name: string;
  /** Whether the model reasons. */
  readonly reasoning: boolean;
  /** The levels this model accepts; "off" is always one. The picker shows exactly these. */
  readonly thinking: readonly Thinking[];
  /** The fast sibling, selected through this row. Fast is a model ref, not a flag. */
  readonly fast: ModelRef | null;
  /** Context window in tokens. */
  readonly contextWindow: number;
  /** Token count at which core compacts. */
  readonly compactAt: number;
  /** Maximum output tokens. */
  readonly maxOutput: number;
  /** Input kinds the model takes; anything else is sent as a text reference. */
  readonly input: readonly ("text" | "image")[];
  /** Per million tokens. */
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
}
/**
 * Names a model by provider and id.
 *
 * @category connection
 * @since 0.1.0
 */
type ModelRef = { readonly provider: string; readonly id: string };
/**
 * Lists the reasoning effort levels a model may accept.
 *
 * @category connection
 * @since 0.1.0
 */
type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
/**
 * Names how a provider credential can be obtained.
 *
 * @category connection
 * @since 0.1.0
 */
type LoginMethod = { readonly kind: "oauth" } | { readonly kind: "key" };
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
interface Login {
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
 * Returns the context size as the view carries it.
 *
 * @category views
 * @since 0.1.0
 */
interface ContextView {
  /** What the next request would send, estimated; exact after each provider report. */
  readonly tokens: number;
  /** The effective model's context window. */
  readonly window: number;
  /** The last settled request's usage. */
  readonly lastRequest: Usage | null;
}
/**
 * Returns token counts and cost for one provider request.
 *
 * @category views
 * @since 0.1.0
 */
interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Subset of output when the provider reports it. */
  readonly reasoning: number | null;
  readonly total: number;
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly total: number };
}

/**
 * Names a plugin file a host loads with its own loader: what a connection
 * passes to {@link PluginsApi}, since only paths cross the wire (§40b, §47l).
 *
 * @category plugins
 * @since 0.1.0
 */
type PluginFile = { readonly path: string };
/**
 * Replaces and preflights a host's plugins, given as `Entry`.
 *
 * **Details**
 *
 * A connection takes {@link PluginFile}s; the in-process host takes plugin
 * objects and files alike (§47l).
 *
 * @category plugins
 * @since 0.1.0
 */
interface PluginsApi<Entry> {
  /**
   * Replaces the host's plugins, or one session's.
   *
   * **Details**
   *
   * Per plugin: `activated`, `rejected` or `kept-previous`.
   *
   * @authority maintenance
   */
  replace(plugins: readonly Entry[], scope?: { readonly session: SessionId }): Promise<PluginReplacementReport>;
  /**
   * Runs the preflight `open` runs; touches nothing.
   *
   * @authority maintenance
   */
  check(plugins: readonly Entry[]): Promise<PluginCheckReport>;
}
/**
 * Lists, pairs and revokes the principals that may connect to a host.
 *
 * @category connection
 * @since 0.1.0
 */
interface PrincipalsApi {
  /**
   * Returns every paired principal.
   *
   * @authority maintenance
   */
  list(): Promise<readonly PrincipalView[]>;
  /**
   * Mints a pairing code; a device presents it to connect and becomes a
   * principal with the given authority.
   *
   * @authority maintenance
   */
  pair(input: { readonly authority: ReadonlySet<Authority>; readonly label?: string }): Promise<{ readonly code: string; readonly expiresAt: number }>;
  /**
   * Revokes a principal: open streams drop; accepted work continues.
   *
   * @authority maintenance
   */
  revoke(id: PrincipalId): Promise<void>;
}
/**
 * Writes host-scope settings, builtin and plugin.
 *
 * @category connection
 * @since 0.1.0
 */
interface SettingsApi {
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
/**
 * Returns the result of writing a setting.
 *
 * **Outcomes**
 *
 * - `applied`: the value is stored; dependents re-evaluate.
 * - `invalid`: the value failed the setting's schema; `issues` says where.
 * - `unknown`: no setting has this id.
 *
 * @category connection
 * @since 0.1.0
 */
type SettingOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unknown" };

/**
 * Returns the host as one watched view: identity, link, catalog generation,
 * plugins, settings and the served operations.
 *
 * @category connection
 * @since 0.1.0
 */
interface HostView {
  /** The host's id. */
  readonly id: HostId;
  /**
   * The link state. It changes without the client's action, so it is here,
   * watched.
   */
  readonly link: { readonly kind: "connected" } | { readonly kind: "reconnecting"; readonly since: number; readonly attempts: number } | { readonly kind: "closed"; readonly reason: "client" | "revoked" | "host-gone" };
  /** Machine label. */
  readonly name: string;
  /** Host operating system. */
  readonly platform: string;
  /** Host version. */
  readonly version: string;
  /** Catalog generation; read `models.list()` again when it moves. */
  readonly catalog: CatalogGeneration;
  /** Every loaded plugin with where it came from and its live issues. */
  readonly plugins: readonly { readonly id: string; readonly source: "builtin" | "user" | "project" | "inline"; readonly path: string | null; readonly issues: readonly ValidationIssue[] }[];
  /** Host-scope settings with their current values. */
  readonly settings: readonly SettingInfo[];
  /** What the connected principal may do. A client hides owner-only controls from a participant. */
  readonly authority: ReadonlySet<Authority>;
  /** The declaration table, served: what a non-TS client binds to. */
  readonly operations: readonly { readonly name: string; readonly kind: Declaration<unknown, unknown>["kind"]; readonly authority: Authority; readonly input: JsonSchema; readonly output: JsonSchema }[];
}

/**
 * Registers and lists the folders and environments a host serves.
 *
 * **Details**
 *
 * There is no trust state. A registered workspace runs; `projectResources` says
 * whether its own code runs too. A tool invocation's sdk has no owner
 * authority, so a run cannot register a folder.
 *
 * @category workspaces
 * @since 0.1.0
 */
interface Workspaces {
  /**
   * Returns the workspaces registered on this host.
   *
   * @authority participant
   */
  list(): Promise<readonly WorkspaceInfo[]>;
  /**
   * Resolves a target's identity and scans its project resources; registers
   * nothing. What a client shows before `add`.
   *
   * @throws {SdkError} unavailable when no environment provider serves the target's kind.
   * @authority owner
   */
  inspect(target: WorkspaceTarget): Promise<WorkspaceInspection>;
  /**
   * Registers a workspace.
   *
   * **Outcomes**
   *
   * - `added`: registered; `workspace` is its id.
   * - `exists`: already registered; `workspace` is the existing id.
   * - `stale`: the identity no longer matches `expect`; `identity` is current.
   * - `unavailable`: the provider cannot reach it; `reason` says why.
   *
   * **Details**
   *
   * `projectResources` defaults to true: the owner adding it is the consent. Pass
   * the inspected identity as `expect` so a folder swapped under the path is
   * `stale`, not added.
   *
   * **Example** (Open Folder, or /cd in the tui)
   *
   * ```ts
   * declare const connection: Connection;
   * declare const session: Session;
   * declare function askUser(seen: WorkspaceInspection): Promise<boolean>;
   *
   * async function openFolder(path: string) {
   *   const seen = await connection.workspaces.inspect({ kind: "local", path });
   *   // The client's own dialog, if it wants one; core behaves the same without it.
   *   if (seen.registered === null && seen.projectSources.length > 0 && !(await askUser(seen))) return;
   *   const added = await connection.workspaces.add(seen.target, {
   *     expect: { identity: seen.identity },
   *   });
   *   // stale: the folder changed under the path; inspect again.
   *   if (added.kind === "stale") return openFolder(path);
   *   // The idle tree relocates; busy if a run is live.
   *   if (added.kind === "added" || added.kind === "exists") await session.update({ workspace: added.workspace });
   * }
   * ```
   *
   * @authority owner
   */
  add(target: WorkspaceTarget, options?: { readonly projectResources?: boolean; readonly expect?: { readonly identity: EnvironmentIdentity } }): Promise<AddOutcome>;
  /**
   * Removes the workspace record; never touches files.
   *
   * **Outcomes**
   *
   * - `forgotten`: the record is gone.
   * - `busy`: `sessions` still use it.
   *
   * @authority owner
   */
  forget(id: WorkspaceId): Promise<ForgetOutcome>;
}
/**
 * Returns what a target is before it is registered.
 *
 * @category workspaces
 * @since 0.1.0
 */
interface WorkspaceInspection {
  /** The target as resolved. */
  readonly target: WorkspaceTarget;
  /** Equal identities see the same files. Pass it back as `expect` so a swapped folder is stale, not added. */
  readonly identity: EnvironmentIdentity;
  /** Whether the provider can serve it. */
  readonly availability: Availability;
  /** ".nyte/plugins/x.ts", "AGENTS.md": what would run. */
  readonly projectSources: readonly string[];
  /** The workspace already registered for this target, if any. */
  readonly registered: WorkspaceId | null;
}
/**
 * Returns whether an environment provider can serve a workspace.
 *
 * @category workspaces
 * @since 0.1.0
 */
type Availability = { readonly kind: "available" } | { readonly kind: "unavailable"; readonly reason: "unsupported" | "unreachable" };
/**
 * Names where a workspace lives: a local absolute path, or a locator for any
 * registered environment provider.
 *
 * @category workspaces
 * @since 0.1.0
 */
type WorkspaceTarget =
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: string; readonly locator: Json };
/**
 * Returns the in-process composition root: a {@link Connection} plus
 * listening, plugin replacement, principals and maintenance.
 *
 * **Details**
 *
 * Host is the composition root; nothing on it is "admin". Store and lease
 * internals are exports of `@nyte-ai/core` for driver authors, not SDK
 * methods. `packages/host` and `packages/protocol` are generated from these
 * declarations. Nothing on Host is reachable over a listener except through
 * declarations.
 *
 * @category host
 * @since 0.1.0
 */
interface Host extends Connection {
  /**
   * Serves this host over HTTP or as a fetch handler.
   *
   * @throws {SdkError} invalid when the options are malformed, such as a token shorter than 16 characters.
   * @throws {SdkError} unavailable when the port cannot be bound.
   */
  listen(options: ListenOptions): Promise<Listener>;
  /** Hot plugin replacement and preflight: plugin objects and plugin files alike (§47l). */
  readonly plugins: PluginsApi<Plugin<"core"> | PluginFile>;
  /** Collects unreachable history. The only GC entry point. In-process only. */
  prune(): Promise<PruneReport>;
  /**
   * Returns raw store reads for one session, for maintenance and tests; never
   * served remotely.
   */
  inspect(session: SessionId): {
    /** Returns every ref under the session. */
    refs(): Promise<readonly Ref[]>;
    /** Returns the session's objects, decoded, a page at a time. */
    objects(input?: { readonly cursor?: Cursor }): Promise<Paged<DecodedObjectView>>;
    /**
     * Yields the durable log after a seq, raw.
     *
     * @stream frames
     */
    events(input: { readonly after: Seq }): AsyncIterable<SessionEvent>;
    /** Checks that every ref resolves and every object parses. */
    verify(): Promise<IntegrityReport>;
  };
  /**
   * Drives execution by hand. For drivers only: listeners, Cloudflare alarms,
   * Vercel workflows. `open` runs everything by default.
   */
  readonly execution: {
    /** Registers this host's coverage of the sessions, taking no lease (a lease is what an advance holds while a turn runs); the returned handle unregisters it and releases the leases its advances still hold. */
    cover(coverage: ExecutionCoverage): Promise<Owned>;
    /** Runs one leased kernel step on a head; the driver schedules the next. */
    advance(input: { readonly session: SessionId; readonly head: HeadName }): Promise<AdvanceReport>;
    /** Pages through heads owed a step that no wake reached. */
    repair(input: { readonly cursor?: Cursor; readonly limit: number }): Promise<RepairPage>;
  };
}

/**
 * Returns a host's answer to `GET /.nyte/identity?nonce=`, so a client can
 * pin it: the host's id, the nonce, an Ed25519 signature over
 * `nyte/identity\n<hostId>\n<nonce>` and the raw public key, both base64url.
 *
 * @category host
 * @since 0.1.0
 */
type IdentityChallenge = { readonly hostId: HostId; readonly nonce: string; readonly signature: string; readonly publicKey: string };

/**
 * Describes how a host listens: transport, authentication, execution and
 * request limits.
 *
 * **Example** (Serving over HTTP with a token)
 *
 * ```ts
 * declare const host: Host;
 *
 * const listener = await host.listen({
 *   transport: { kind: "http", port: 7420 },
 *   auth: { kind: "token", token: process.env.NYTE_TOKEN ?? "" },
 *   origins: ["https://app.nyte.dev"],
 * });
 * ```
 *
 * **Example** (Serving as a fetch handler)
 *
 * ```ts
 * declare const host: Host;
 *
 * const listener = await host.listen({
 *   transport: { kind: "fetch" },
 *   auth: { kind: "token", token: "a-token-of-16-chars" },
 * });
 * export default { fetch: (request: Request) => listener.fetch(request) };
 * ```
 *
 * @category host
 * @since 0.1.0
 */
interface ListenOptions {
  /**
   * `http` binds a socket (default 127.0.0.1, port 0). `fetch` binds none;
   * `Listener.fetch` is the handler: Cloudflare, Vercel, tests, and any
   * relay: a relay dials out and forwards each frame to `fetch()`,
   * authorising through `auth.custom`.
   */
  readonly transport:
    | { readonly kind: "http"; readonly hostname?: string; readonly port?: number }
    | { readonly kind: "fetch" };
  /**
   * `token` is Bearer, compared in constant time, at least 16 characters.
   * `custom` maps a request to a principal and its authority, or denies it.
   */
  readonly auth:
    | { readonly kind: "token"; readonly token: string }
    | { readonly kind: "custom"; authorize(request: Request): Awaitable<{ readonly principal: PrincipalId; readonly authority: ReadonlySet<Authority> } | { readonly deny: "unauthorized" | "forbidden" }> };
  /** Default: run, covering every session this listener serves. */
  readonly execution?: { readonly kind: "run"; readonly coverage: ExecutionCoverage } | { readonly kind: "admit-only" };
  /** Browser Origins beyond same-origin. */
  readonly origins?: readonly string[];
  /** Default 8 MiB: one inline image plus its message. */
  readonly maxBodyBytes?: number;
  /** Lets a client pin this host. */
  readonly identity?: { readonly id: HostId; sign(nonce: string): Awaitable<IdentityChallenge> };
  /** Returns what the listener advertises about this host. */
  readonly describe?: () => Awaitable<HostDescription>;
  /** Answers first: the static web shell, health. Never sees the sdk. */
  before?(request: Request): Awaitable<Response | undefined>;
}
/**
 * Returns a running listener: its address, its fetch handler and its
 * shutdown.
 *
 * @category host
 * @since 0.1.0
 */
interface Listener {
  /** Null for fetch transport. */
  readonly address: string | null;
  /** The whole protocol as one handler. */
  fetch(request: Request): Promise<Response>;
  /** Drops streams; accepted work continues; clients re-authenticate. */
  disconnectClients(): void;
  /** Releases this listener's coverage, not durable Stop. */
  close(): Promise<void>;
  /** Closes the listener; for `await using`. */
  [Symbol.asyncDispose](): Promise<void>;
}
/**
 * Names the authority a served operation needs.
 *
 * **Details**
 *
 * Authority is three words. Every declaration names the authority it needs;
 * `authorize` names what a principal has; the listener answers denied for the
 * rest, and the client sees Capability denied where a namespace is gated.
 *
 * - `participant`: sessions, parts, watches.
 * - `owner`: workspaces, providers, settings, git writes.
 * - `maintenance`: `plugins.*` and `principals.*`.
 *
 * `inspect`, `prune` and `execution` are in-process only and have no
 * authority. A token principal has participant + owner.
 *
 * @category host
 * @since 0.1.0
 */
type Authority = "participant" | "owner" | "maintenance";

/**
 * Describes one served operation: its schemas, kind, authority, scope and
 * recovery.
 *
 * **Details**
 *
 * One table is the source of every generated artifact: the client Connection
 * types, the listener's route table, codecs, the catalog a non-TS client
 * reads, and authority gating. There is no second schema for the wire: input
 * and output schemas are the wire records; handles are bound on the client
 * from returned ids.
 *
 * **Example** (Declaring a session command)
 *
 * ```ts
 * declare const SendInput: Schema<{ readonly content: UserContent; readonly options: SendOptions }>;
 * declare const ReceiptIdSchema: Schema<ReceiptId>;
 *
 * const send = {
 *   input: SendInput,
 *   output: ReceiptIdSchema,
 *   kind: "receipt",
 *   authority: "participant",
 *   scope: "session",
 *   recovery: "replay",
 * } satisfies Declaration<{ readonly content: UserContent; readonly options: SendOptions }, ReceiptId>;
 * ```
 *
 * @see {@link declarations}
 * @category host
 * @since 0.1.0
 */
interface Declaration<Input, Output> {
  /** The wire record the call takes. */
  readonly input: Schema<Input>;
  /** The wire record the call returns. */
  readonly output: Schema<Output>;
  /**
   * `query` reads once; `watch` yields coalesced views, latest wins;
   * `command` returns its outcome; `receipt` returns a ReceiptId and the
   * outcome is a later query; `stream` yields every frame in order (bytes,
   * scan, search, patches).
   */
  readonly kind: "query" | "watch" | "command" | "receipt" | "stream";
  /** What the calling principal must hold. */
  readonly authority: Authority;
  /** What the call is addressed to. */
  readonly scope: "host" | "session" | "workspace";
  /** Gated per environment or principal; absent = always. */
  readonly capability?: "files" | keyof Pick<EnvironmentProvider, "git" | "browser">;
  /** Commands only: same id + same digest replays the receipt; volatile actions (pty write, page click) never. */
  readonly recovery?: "replay" | "never";
}
/**
 * Returns the declaration table, keyed by Connection path.
 *
 * **Details**
 *
 * Names are the Connection paths: "sessions.create", "session.send",
 * "git.patches", and so on. `@nyte-ai/protocol` exports the table and the
 * schema types; `@nyte-ai/host` exports listen, the drivers and the
 * environment providers; `@nyte-ai/sdk` exports connect and open with the
 * typed client generated from the table.
 *
 * @category host
 * @since 0.1.0
 */
declare const declarations: { readonly [Name in `${string}.${string}`]: Declaration<unknown, unknown> };


/**
 * Creates, lists and watches the session directory.
 *
 * @category sessions
 * @since 0.1.0
 */
interface Sessions {
  /**
   * Yields the directory as it changes: the sidebar.
   *
   * @stream watch
   * @authority participant
   */
  watch(input?: { readonly parents?: ParentFilter; readonly limit?: number }): AsyncIterable<readonly SessionInfo[]>;
  /**
   * Creates a durable session and returns its handle.
   *
   * **Details**
   *
   * Children and workspaces:
   *
   * - `create({ parent })` inherits the parent's workspace.
   * - `create({ parent, workspace })` must name a registered workspace.
   * - a tool's `invocation.workspace` is the session's; a tool cannot reach
   *   another folder's files without a registered workspace id.
   *
   * **Gotchas**
   *
   * A subagent sent to folder 2 when only folder 1 is registered: create
   * throws `unknown`. Nothing asks; never a dialog; the parent reports it.
   *
   * @throws {SdkError} unknown when `workspace` is not registered on this host.
   * @authority participant
   */
  create(input?: {
    /** Only to retry across your own restart. */
    readonly id?: SessionId;
    readonly name?: string;
    readonly workspace?: WorkspaceId;
    /** A child is a session with lineage, nothing more. */
    readonly parent?: SessionId;
    readonly configuration?: Configuration | ConfigurationPatch;
    /** This session's own system prompt section: a subagent's role, without a registered agent. */
    readonly prompt?: PromptOverride;
  }): Promise<Session>;
  /**
   * Returns one page of the directory.
   *
   * **Details**
   *
   * The directory is metadata and small; search and archived filtering are
   * the client's, over what `list()` and `watch()` give it.
   *
   * @authority participant
   */
  list(input?: {
    readonly parents?: ParentFilter;
    readonly cursor?: Cursor;
    readonly limit?: number;
  }): Promise<Paged<SessionInfo>>;
}
/**
 * Returns one directory row: a session's identity, lineage, workspace, flags,
 * activation and heads.
 *
 * @category sessions
 * @since 0.1.0
 */
interface SessionInfo {
  readonly id: SessionId;
  /** Null until named. */
  readonly name: string | null;
  /** The session that spawned it; null for a root. */
  readonly parent: SessionId | null;
  readonly workspace: WorkspaceId;
  readonly pinned: boolean;
  readonly archived: boolean;
  /** Whether this host is serving the session's workspace. */
  readonly activation: Activation;
  /** Every head with its tip, stack, execution and unread mark; `info()` is enough for a picker. */
  readonly heads: readonly HeadInfo[];
  readonly createdAt: number;
  readonly lastActivityAt: number;
}
/**
 * Returns one head as a directory row: tip, stack, execution and unread.
 *
 * @category sessions
 * @since 0.1.0
 */
interface HeadInfo {
  readonly name: HeadName;
  readonly tip: Position;
  /** What `heads.create({ from })` defaults to and `heads.merge()` targets. */
  readonly stack: { readonly parent: HeadName; readonly base: Position; readonly stale: boolean } | null;
  readonly execution: Execution;
  /** Tip !== sessions/<id>/seen/<principal>/<head>. */
  readonly unread: boolean;
}

// 2. Session and head

/**
 * Returns one head of a session: a ref into the commit DAG you can send to,
 * configure, watch and move.
 *
 * **Details**
 *
 * A head is a ref into the commit DAG; `tree`, `move` and `compact` are ref
 * operations on it. Creating, merging and removing heads is
 * `session.heads`. A {@link Session} is its main head plus session
 * management.
 *
 * @see {@link Session}
 * @category heads
 * @since 0.1.0
 */
interface Head {
  readonly sessionId: SessionId;
  readonly name: HeadName;

  /**
   * Admits user content to this head and returns a receipt: admission, not an
   * answer.
   *
   * **Details**
   *
   * The id is minted before the network and journaled, so the message shows
   * `unsent` at once and is never sent twice. {@link Delivery} decides when
   * it runs; `configuration` overrides the head's selection for this input
   * only.
   *
   * **Editing**
   *
   * `send(content, { replace: id })` acts by the replaced message's status:
   *
   * - `unsent`: rewrite the journal row; nothing reached the host. Same id.
   * - `pending`: revise on the host in place. Same id.
   * - `landed`: one keyed command. Stop the live run if `running: "stop"`
   *   (durable Stop, settled before anything moves), move the head to the
   *   message's parent, admit the new input as a fresh id. The old path is
   *   retained as a sibling of the new message.
   *
   * The new message says what happened: `status.landed.replaced { previous,
   * stopped }`. Edit is a send option, not a method, so the move and the
   * admission are one CAS. A user message carries `siblings`: user commits
   * sharing its parent, in creation order, with this one's index. The client
   * draws "< 2/3 >" and switches with `move({ kind: "commit", id: sibling })`;
   * the view follows the head. Core maintains siblings in the fold; no client
   * walks the tree.
   *
   * What the view shows while an edit lands, in order:
   *
   * 1. the old run's live parts flip to status `failed { stopped }` at the
   *    fence, synchronously;
   * 2. messages after the edited one's parent leave the list; the edited
   *    message's siblings count grows by one;
   * 3. the new user message appears unsent → pending → landed, and a new run
   *    goes live under it.
   *
   * A watcher sees these as at most three coalesced views, never a view with
   * both the old tail and the new input.
   *
   * **Gotchas**
   *
   * Stop is exact: an edit stops the head's run and nothing else. Children
   * and jobs in `view.background` keep working; a child's report attaches to
   * the head wherever the head is by then. A landed edit settles the receipt
   * with a {@link MoveOutcome} failure instead of running: `stale` (expect
   * lost), `busy` (`running: "refuse"` and a run is live), `pending-input`
   * (other inputs queued behind the edited one; withdraw or place them first).
   *
   * **Example** (Sending and waiting for the message to land)
   *
   * ```ts
   * declare const session: Session;
   *
   * const receipt = await session.send("Add a test for the parser.", { delivery: "queue" });
   * const landed = await receipt.landed();
   * if (landed.kind === "landed" && landed.run !== null) {
   *   const end = await session.run(landed.run).settled();
   * }
   * ```
   *
   * **Example** (Editing a landed message)
   *
   * ```ts
   * declare const session: Session;
   * declare const message: MessageId;
   * declare const revision: Revision;
   *
   * const receipt = await session.send("Use the v2 parser instead.", {
   *   replace: message,
   *   expect: revision,
   * });
   * ```
   *
   * @see {@link SendOptions}
   * @see {@link SendReceipt}
   * @authority participant
   */
  send(content: UserContent, options?: SendOptions): Promise<SendReceipt>;
  /**
   * Changes this head's durable defaults: model, thinking, agent, settings.
   *
   * @returns {@link ConfigureOutcome}
   * @authority participant
   */
  configure(patch: ConfigurationPatch): Promise<ConfigureOutcome>;

  /**
   * Returns one snapshot of the head's view. Moves no seen mark.
   *
   * @authority participant
   */
  view(options?: ViewOptions): Promise<SessionView>;
  /**
   * Yields the same snapshot as `view()` on every change. Reading is seeing.
   *
   * **Details**
   *
   * There is no `events()`. A client never subscribes to a delta stream and
   * never invalidates a cache. The deltas that build the view are internal
   * to `watch()`; the durable log is `host.inspect(id).events()`.
   *
   * A watch exists where things change without the client's own action: a
   * session while the model talks, the directory while sessions come and go,
   * git status while a run edits, a page while it loads. Not where the only
   * writer is the caller. Nothing polls; a watch is the host pushing.
   *
   * Seen is not an operation. While `watch()` is open for a principal, each
   * tip it yields becomes `sessions/<id>/seen/<principal>/<head>`. A head is
   * unread when its tip is not that ref.
   *
   * Identity: each view's unchanged messages and turns are the same objects.
   * A token appends to one part; everything else keeps identity, so a
   * memoised row does not re-render.
   *
   * **Delta guarantees**
   *
   * Core is the editor, not the wire service: it already holds the page, so
   * it updates the paragraph and hands over the page, rather than shouting
   * "token" and letting each client re-lay the sheet.
   *
   * 1. Core folds incrementally. A token touches one part and the spine above
   *    it; every other message, turn and field is the same object.
   * 2. Core maintains derived data incrementally. `turn.state`,
   *    `turn.summary` and `view.changes` update when one tool settles: one
   *    tool, one turn, one path. No client walks the transcript to build
   *    anything.
   * 3. `watch()` coalesces. At most one yield per frame (~16 ms outside a
   *    browser), newest view wins, never more than one pending.
   * 4. One fold per session per connection, shared by every watcher. The
   *    last watcher leaving drops it. Memory is bounded by what is on screen.
   * 5. Remote carries deltas, never views; the SDK folds with the same code
   *    on the client side. In-process on a Host nothing is serialized.
   *
   * **Example** (Drawing the transcript)
   *
   * ```ts
   * declare const session: Session;
   * declare function draw(view: SessionView): void;
   *
   * for await (const view of session.watch()) {
   *   draw(view);
   * }
   * ```
   *
   * @stream watch
   * @authority participant
   */
  watch(options?: ViewOptions): AsyncIterable<SessionView>;
  /**
   * Returns older messages for scroll-back, newest last, ending before
   * `before`. The view's `messages` is the tail; this is the rest.
   *
   * @authority participant
   */
  history(input: { readonly before: MessageId; readonly limit: number }): Promise<readonly Message[]>;

  /**
   * Returns the whole DAG, projected by core: every commit on every branch,
   * the active path marked. The /tree picker's data; a client draws rows and
   * folds.
   *
   * @authority participant
   */
  tree(): Promise<TreeView>;
  /**
   * Moves the head to a position, as a durable command that may summarise
   * the abandoned path with a model.
   *
   * **Details**
   *
   * Moving to a user commit lands on its parent and hands its content back
   * for the composer.
   *
   * @returns {@link MoveOutcome}, through the receipt.
   * @authority participant
   */
  move(position: Position, options?: MoveOptions): Promise<Receipt<MoveOutcome>>;
  /**
   * Starts a compaction of this head's context.
   *
   * **Outcomes**
   *
   * - `started`: the compaction part appears live as `message`; its status says the rest.
   * - `busy`: `run` is live.
   * - `nothing-to-compact`: the context is already as small as it gets.
   *
   * @authority participant
   */
  compact(input?: { readonly instructions?: string }): Promise<{ readonly kind: "started"; readonly message: MessageId } | { readonly kind: "busy"; readonly run: RunId } | { readonly kind: "nothing-to-compact" }>;
}
/**
 * Bounds what a view carries. The tail is what a client draws on open; the
 * rest comes from `history()` as the user scrolls back. Turns, parts and
 * everything else are whole.
 *
 * @category views
 * @since 0.1.0
 */
interface ViewOptions {
  /** How many messages from the end to carry. Default: the host's bound. */
  readonly tail?: number;
}
/**
 * Returns the head's commit DAG as flat rows, ready to draw in one pass.
 *
 * **Details**
 *
 * Filters (hide tools, users only, all) are the client's one pass over
 * `nodes`; folding is client state. Nothing walks the DAG outside core.
 *
 * @category heads
 * @since 0.1.0
 */
interface TreeView {
  /** Pass as `expect` to `move`; stale if the tree grew meanwhile. Null when the host holds no revision paired with this tip (§54a): read the tree again. */
  readonly revision: Revision | null;
  readonly tip: Position;
  /** Parents before children; siblings in creation order. One pass draws it. */
  readonly nodes: readonly TreeNode[];
}
/**
 * Returns one commit as a tree row.
 *
 * @category heads
 * @since 0.1.0
 */
interface TreeNode {
  readonly id: CommitId;
  readonly parent: CommitId | null;
  readonly depth: number;
  /** First child of a parent with several: draw a connector. */
  readonly branch: boolean;
  /** On the path from the root to this head's tip. */
  readonly active: boolean;
  /** Heads whose tip is here. */
  readonly heads: readonly HeadName[];
  readonly kind: "user" | "part" | "compaction" | "branchSummary";
  /** "text" | "thinking" | "tool" | ... for kind part; what a filter keys on. */
  readonly partKind: string | null;
  /** One line. */
  readonly preview: string;
  readonly at: number;
  readonly run: RunId | null;
}
/**
 * Returns the result of creating a head.
 *
 * **Outcomes**
 *
 * - `created`: the head exists at `basedOn`.
 * - `exists`: a head with this name already exists; nothing changed.
 * - `missing-source`: `from` names a position that does not exist.
 *
 * @category heads
 * @since 0.1.0
 */
type CreateHeadOutcome =
  | { readonly kind: "created"; readonly basedOn: Position }
  | { readonly kind: "exists" }
  | { readonly kind: "missing-source" };
/**
 * Returns the result of merging a head into its stack parent.
 *
 * **Outcomes**
 *
 * - `merged`: the parent advanced; `revision` is current.
 * - `stale`: another client moved first; `revision` is current.
 * - `diverged`: the parent moved since `base`; move or recreate.
 * - `is-main`: main has no parent to merge into.
 *
 * @category heads
 * @since 0.1.0
 */
type MergeOutcome =
  | { readonly kind: "merged"; readonly revision: Revision }
  | { readonly kind: "stale"; readonly revision: Revision }
  | { readonly kind: "diverged"; readonly base: Position }
  | { readonly kind: "is-main" };
/**
 * Returns the result of removing a head.
 *
 * **Outcomes**
 *
 * - `removed`: the head is gone; its commits stay reachable from the others.
 * - `missing`: no head has this name.
 * - `is-main`: main cannot be removed.
 * - `busy`: `run` is live on the head.
 *
 * @category heads
 * @since 0.1.0
 */
type RemoveHeadOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "missing" }
  | { readonly kind: "is-main" }
  | { readonly kind: "busy"; readonly run: RunId };
/**
 * Returns the result of moving a head, directly or as part of an edit.
 *
 * **Outcomes**
 *
 * - `moved`: the head is at `position`; `summary` is the branch summary if
 *   one was written; `handback` is a user commit's content returned for the
 *   composer, because moving to a user commit lands on its parent.
 * - `stale`: another client moved first; `revision` is current.
 * - `busy`: `run` is live and `running` was `"refuse"`.
 * - `pending-input`: `messages` are queued behind the target; withdraw or place them first.
 * - `missing-target`: the position does not exist.
 * - `summary-failed`: summarising the abandoned path failed; nothing moved.
 *
 * @category heads
 * @since 0.1.0
 */
type MoveOutcome =
  | { readonly kind: "moved"; readonly revision: Revision; readonly position: Position; readonly summary: MessageId | null; readonly handback: UserContent | null }
  | { readonly kind: "stale"; readonly revision: Revision }
  | { readonly kind: "busy"; readonly run: RunId }
  | { readonly kind: "pending-input"; readonly messages: readonly MessageId[] }
  | { readonly kind: "missing-target" }
  | { readonly kind: "summary-failed"; readonly reason: string };
/**
 * Describes what a move does about a live run and the path it leaves.
 *
 * @category heads
 * @since 0.1.0
 */
interface MoveOptions {
  /** Default refuse. */
  readonly running?: "refuse" | "stop";
  /** Default keep; summarize writes a branch summary of the abandoned path. */
  readonly abandoned?: "keep" | { readonly summarize: { readonly instructions?: string } };
  /** The tree revision the client showed; stale if it moved. */
  readonly expect?: Revision;
}

/**
 * Describes how a send is delivered, and whether it replaces an earlier
 * message.
 *
 * @see {@link Head.send}
 * @category heads
 * @since 0.1.0
 */
interface SendOptions {
  /** Default steer. */
  readonly delivery?: Delivery;
  /** A user message in any status. See Editing on {@link Head.send}. */
  readonly replace?: MessageId;
  /** With replace on a landed message while a run is live. Default stop: the edit is the user's intent. */
  readonly running?: "refuse" | "stop";
  /** With replace; default keep. */
  readonly abandoned?: "keep" | { readonly summarize: { readonly instructions?: string } };
  /** With replace; stale if another client moved first. */
  readonly expect?: Revision;
  /** With replace on a pending message: reorder the queue. */
  readonly position?: { readonly kind: "last" } | { readonly kind: "before"; readonly message: MessageId };
  /** Default user. */
  readonly source?: MessageSource;
  /** Default: capture the head's selection at admission. */
  readonly configuration?: Configuration | ConfigurationPatch;
  /** Only to retry across your own restart; same id + same content replays the receipt. */
  readonly id?: ReceiptId;
}
/**
 * Names when an admitted input runs.
 *
 * **Details**
 *
 * - `steer`: join the live run at its next boundary; start one if idle.
 * - `queue`: after the current run; start one if idle.
 * - `attach`: never starts a run; rides with whatever turn comes next.
 *
 * One admission path for users, core, tools and the terminal. Async subagent
 * reports, background job output and `!cmd` output are all attach by
 * default. A child asked to wake its parent sends with queue. Nothing else
 * waits.
 *
 * Core delivers a child's report: when a child's run ends, core attaches the
 * report to the parent head unless a durable wait on that run is parked, in
 * which case the wait wakes instead. Exactly one of the two; no plugin sends
 * it.
 *
 * @category heads
 * @since 0.1.0
 */
type Delivery = "steer" | "queue" | "attach";
/**
 * Returns the result of changing a head's durable selection.
 *
 * **Outcomes**
 *
 * - `configured`: `selected` is the resolved choice now stored; `revision` is current.
 * - `unknown-model`: `model` is not in the catalog.
 * - `unknown-agent`: `agent` is not registered.
 * - `invalid`: a setting failed its schema; `issues` says which.
 *
 * @category heads
 * @since 0.1.0
 */
type ConfigureOutcome =
  | { readonly kind: "configured"; readonly selected: Configuration; readonly revision: Revision }
  | { readonly kind: "unknown-model"; readonly model: ModelRef }
  | { readonly kind: "unknown-agent"; readonly agent: string }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] };
/**
 * Returns what a user sends: a string, or text, files and references.
 *
 * **Details**
 *
 * - `file`: any file: image, audio, video, pdf, source. From
 *   `files.upload`; never a local path.
 * - `reference`: an @mention. The host reads it at request time, so it is
 *   current, not a copy.
 *
 * **Gotchas**
 *
 * The model filters, not the sender. {@link ModelInfo.input} says what it
 * accepts; a file the model cannot take goes in as a text reference (name,
 * size, mime) rather than being refused.
 *
 * @category heads
 * @since 0.1.0
 */
type UserContent =
  | string
  | readonly (
      | { readonly kind: "text"; readonly text: string }
      | { readonly kind: "file"; readonly blob: BlobId; readonly mime: string; readonly name: string }
      | { readonly kind: "reference"; readonly path: string }
    )[];
/**
 * Names a point in a head's history: the start, or a commit.
 *
 * @category heads
 * @since 0.1.0
 */
type Position = { readonly kind: "start" } | { readonly kind: "commit"; readonly id: CommitId };
/**
 * Changes a head's selection one field at a time: omit a field to keep it,
 * pass null where allowed to clear an override.
 *
 * **Details**
 *
 * `configure` takes a patch and changes the head's durable selection. `send`
 * takes a patch or a {@link Configuration} and affects that input only. A
 * patch has no discriminant; a field typed `Configuration | ConfigurationPatch` narrows on `"kind" in value`.
 *
 * @see {@link Configuration} for what admission resolves it to
 * @category heads
 * @since 0.1.0
 */
type ConfigurationPatch = {
  /** Omit = keep. A fast variant is a model ref, not a flag. */
  readonly model?: ModelRef;
  /** Omit = keep; null = clear the override, resolve the default at admission. */
  readonly thinking?: Thinking | null;
  /** Omit = keep; null = clear the override, resolve the default at admission. */
  readonly agent?: string | null;
  /** Session-scope plugin settings; merged per key, validated per schema. */
  readonly settings?: Readonly<Record<string, Json>>;
};
/**
 * Returns a fully resolved selection: what admission resolved, and what a
 * replaced message carries so an edit keeps its setup.
 *
 * @category heads
 * @since 0.1.0
 */
type Configuration = {
  readonly kind: "exact"; // the one discriminant: a patch has none, so a field typed Configuration | ConfigurationPatch narrows on "kind" in value.
  readonly model: ModelRef;
  readonly thinking: Thinking;
  /** Null = the built-in agent, as a value. */
  readonly agent: string | null;
  readonly settings: Readonly<Record<string, Json>>;
  /** Rejected if the host no longer has it; never silently re-resolved. */
  readonly settingsVersion: string;
};
/**
 * Names who sent an input.
 *
 * **Details**
 *
 * - `shell`: `!cmd` run by the client.
 * - `action`: a button sent a prebuilt prompt. The client shows the label,
 *   never the content; not editable.
 *
 * @category heads
 * @since 0.1.0
 */
type MessageSource =
  | { readonly kind: "user" }
  | { readonly kind: "child"; readonly session: SessionId }
  | { readonly kind: "job"; readonly job: JobId }
  | { readonly kind: "shell" }
  | { readonly kind: "action"; readonly label: string; readonly command?: string };

/**
 * Returns a handle on one durable command: its status, its settlement and
 * its stop.
 *
 * **Details**
 *
 * One receipt for every durable command. The rule: if the work continues
 * after the call returns and nothing in the view stands for it, it returns a
 * receipt; otherwise it returns its outcome.
 *
 * - receipts: `send` (the run), `move` (a summary may be written),
 *   `files.batch().apply()` (the batch).
 * - outcomes: `configure`, `heads.create`, `heads.merge`, `heads.remove`,
 *   `update`, git writes, parts, and `compact`, whose work is a part the
 *   view already shows.
 *
 * Withdraw is stop before landing; there is no second verb.
 *
 * **Example** (Reacquiring a receipt after a restart)
 *
 * ```ts
 * declare const session: Session;
 * declare const saved: ReceiptId;
 *
 * const receipt = session.receipt(saved);
 * const status = await receipt.status();
 * if (status.kind === "pending") {
 *   const outcome = await receipt.settled({ signal: AbortSignal.timeout(30_000) });
 * }
 * ```
 *
 * @see {@link SendReceipt}
 * @category receipts
 * @since 0.1.0
 */
interface Receipt<Outcome> {
  /** Minted inside; pass it to retry across your own restart, or to `session.receipt(id)`. */
  readonly id: ReceiptId;
  /**
   * Returns whether the command is pending, settled with its outcome, or
   * unknown to the host.
   *
   * @authority participant
   */
  status(): Promise<{ readonly kind: "pending" } | { readonly kind: "settled"; readonly outcome: Outcome } | { readonly kind: "missing" }>;
  /**
   * Waits for the outcome. Abort stops the wait, never the work.
   *
   * @throws {SdkError} unknown when the host does not have this id.
   * @authority participant
   */
  settled(options?: RequestOptions): Promise<Outcome>;
  /**
   * Requests a durable stop of the work where it can be stopped.
   *
   * @returns {@link StopOutcome}
   * @authority participant
   */
  stop(): Promise<StopOutcome<Outcome>>;
}
/**
 * Returns the result of stopping durable work.
 *
 * **Outcomes**
 *
 * - `requested`: the stop is recorded; the work settles later.
 * - `settled`: the work had already ended; `outcome` is how.
 * - `missing`: the host does not have this work.
 *
 * @category receipts
 * @since 0.1.0
 */
type StopOutcome<O> = { readonly kind: "requested" } | { readonly kind: "settled"; readonly outcome: O } | { readonly kind: "missing" };
/**
 * Returns the receipt for a send: the message id plus a wait for landing.
 *
 * **Details**
 *
 * Settles with how the run ended, `withdrawn`, or the move failure of an
 * edit. Before landing `stop()` withdraws; after landing it equals
 * `run(landed.run).stop()` and so stops a shared steered run too.
 *
 * @category receipts
 * @since 0.1.0
 */
interface SendReceipt extends Receipt<RunEnd | { readonly kind: "withdrawn" } | Exclude<MoveOutcome, { readonly kind: "moved" }>> {
  /** The same id as the receipt. Everything admission decided is on the message: delivery, schedule, status, siblings, configuration. */
  readonly message: MessageId;
  /**
   * Waits until the message lands, is withdrawn, or its edit fails to move.
   *
   * @authority participant
   */
  landed(): Promise<Extract<UserStatus, { readonly kind: "landed" }> | { readonly kind: "withdrawn" } | Exclude<MoveOutcome, { readonly kind: "moved" }>>;
}

/**
 * Returns a handle on one run: stop it, or wait for it to end.
 *
 * **Details**
 *
 * A run's metadata is read from the view: `execution.run`, `turn.run`,
 * `message.status.run`. There is no second read path. Changes a run made are
 * `workspace.changes(run.id)`. There is no restore: snapshots are recorded
 * for diffs, not for putting files back.
 *
 * @category runs
 * @since 0.1.0
 */
interface Run {
  readonly id: RunId;
  /**
   * Stops this run and nothing else; resolves at the fence.
   *
   * **Details**
   *
   * Stop has two halves; the view only depends on the first.
   *
   * - fence: synchronous in core. The run is marked stopping; every token
   *   that arrives for it from now on is dropped; its live parts flip to
   *   `failed { stopped }`; execution reads stopping. `stop()` resolves here,
   *   and the next `watch()` yield already shows it. Two streams never paint
   *   at once.
   * - cleanup: background. Abort the provider stream, let a running tool see
   *   its signal and return, settle the run as stopped. Only `settled()`
   *   waits for this.
   *
   * **Gotchas**
   *
   * Exact: children and jobs keep working. Stopping a child is
   * `session(child).run(id).stop()`; stopping everything is `session.stop()`.
   *
   * @returns {@link StopOutcome}
   * @authority participant
   */
  stop(): Promise<StopOutcome<RunEnd>>;
  /**
   * Waits for the run to end: a wait, not a state.
   *
   * **When to use**
   *
   * Its one caller is print mode: send, await, print, exit. Interactive
   * clients read the view.
   *
   * @authority participant
   */
  settled(options?: RequestOptions): Promise<RunEnd>;
}
/**
 * Returns a run's fixed metadata: head, start, attempt, configuration and
 * origin.
 *
 * **Details**
 *
 * No phase here: {@link Execution} on the view is the one place a run's
 * phase lives.
 *
 * @category runs
 * @since 0.1.0
 */
interface RunView {
  readonly id: RunId;
  readonly head: HeadName;
  readonly startedAt: number;
  /** Provider retries; parts carry it in their ids. */
  readonly attempt: number;
  readonly configuration: Configuration;
  /** What started it. */
  readonly origin: { readonly kind: "input"; readonly message: MessageId } | { readonly kind: "continuation"; readonly from: "child" | "job" | "wake" };
}
/**
 * Returns how a run ended.
 *
 * **Outcomes**
 *
 * - `completed`: the model finished; `usage` is the run's total.
 * - `stopped`: a stop reached it.
 * - `failed`: `failure` says why, after the provider retry policy.
 *
 * @category runs
 * @since 0.1.0
 */
type RunEnd =
  | { readonly kind: "completed"; readonly usage: Usage }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly failure: Failure };


/**
 * Returns a session: its main head plus heads, runs, receipts, parts and
 * session management.
 *
 * **Details**
 *
 * Heads and children are reads: `info().heads`, `view.heads`,
 * `view.background`, `sessions.list({ parents: { kind: "children", session } })`.
 *
 * @category sessions
 * @since 0.1.0
 */
interface Session extends Head {
  readonly id: SessionId;
  /**
   * Returns a handle on a named head; "main" is this session.
   *
   * @handle
   */
  head(name: HeadName): Head;
  /** Creates, merges and removes heads. */
  readonly heads: {
    /**
     * Creates a head; `from` defaults to the parent's tip.
     *
     * @returns {@link CreateHeadOutcome}
     * @authority participant
     */
    create(name: HeadName, input?: { readonly from?: Position }): Promise<CreateHeadOutcome>;
    /**
     * Merges a head into its stack parent.
     *
     * @returns {@link MergeOutcome}
     * @authority participant
     */
    merge(name: HeadName, options?: { readonly expect?: Revision }): Promise<MergeOutcome>;
    /**
     * Removes a head.
     *
     * @returns {@link RemoveHeadOutcome}
     * @authority participant
     */
    remove(name: HeadName, options?: { readonly expect?: Revision }): Promise<RemoveHeadOutcome>;
  };
  /**
   * Returns a handle on an exact run.
   *
   * @handle
   */
  run(id: RunId): Run;
  /**
   * Returns a handle on any durable command by id: a send, a move, a batch.
   *
   * @handle
   */
  receipt(id: ReceiptId): Receipt<unknown>;
  /**
   * Returns the directory row: parent, workspace, heads, activation.
   *
   * @authority participant
   */
  info(): Promise<SessionInfo>;
  /**
   * Renames, pins, archives or relocates the session.
   *
   * @returns {@link UpdateOutcome}
   * @authority participant
   */
  update(patch: {
    /** Null clears. */
    readonly name?: string | null;
    readonly pinned?: boolean;
    readonly archived?: boolean;
    /** Relocate: the idle tree moves; store and history stay. */
    readonly workspace?: WorkspaceId;
  }): Promise<UpdateOutcome>;
  /**
   * Removes the session.
   *
   * @returns {@link RemoveSessionOutcome}
   * @authority participant
   */
  remove(): Promise<RemoveSessionOutcome>;
  /**
   * Stops that agent: the live run on every head, everything queued
   * withdrawn, parked waits woken stopped.
   *
   * **Details**
   *
   * `run(id).stop()` is one run and nothing else; this is all of it.
   *
   * @authority participant
   */
  stop(): Promise<{ readonly stopped: readonly RunId[]; readonly withdrawn: readonly MessageId[] }>;

  /**
   * Runs a core command by name.
   *
   * **Details**
   *
   * What plugins contributed is `view.catalog`: it changes on hot reload,
   * which is not the client's action, so it is watched, not read. Settings
   * are `configure({ settings })`. The one write with no other door is a
   * command. A command that yields a prompt is sent by core with source
   * action; the client never relays it.
   *
   * **Gotchas**
   *
   * A side "client" command answers `unknown`.
   *
   * @returns {@link CommandOutcome}
   * @authority participant
   */
  command(name: string, args?: Json): Promise<CommandOutcome>;

  /** Core-owned UI state in this session; clients draw it. */
  readonly parts: {
    /**
     * Creates a part from a definition with an initial state and a
     * placement.
     *
     * @throws {SdkError} invalid when `state` fails the definition's schema.
     * @authority participant
     */
    create<K extends PartDefinition>(kind: K, input: { readonly state: PartState<K>; readonly placement: Placement; readonly id?: PartId }): Promise<Part<K>>;
  };
  /**
   * Returns a handle on a part by id.
   *
   * @handle
   */
  part(id: PartId): Part<PartDefinition>;
}

/**
 * Returns what plugins contributed to a session: commands, settings, skills,
 * agents and tools.
 *
 * @category sessions
 * @since 0.1.0
 */
interface SessionCatalogView {
  readonly commands: readonly CommandInfo[];
  readonly settings: readonly SettingInfo[];
  readonly skills: readonly SkillInfo[];
  readonly agents: readonly AgentInfo[];
  /** What the model can call, with deferred ones marked. */
  readonly tools: readonly ToolInfo[];
}
/**
 * Describes one command for the palette.
 *
 * @category sessions
 * @since 0.1.0
 */
interface CommandInfo {
  /** Owner-qualified; bare names are the owner's own. */
  readonly name: string;
  readonly owner: string;
  /** Where it runs; the palette merges both. */
  readonly side: "core" | "client";
  readonly title: string;
  readonly description: string;
  /** Null = runs on pick; a schema = the palette collects it. A text command is a string schema. */
  readonly arguments: JsonSchema | null;
  readonly category?: string;
  readonly keywords?: readonly string[];
}
/**
 * Describes one setting with its schema, choices, value and the layer that
 * set it.
 *
 * @category sessions
 * @since 0.1.0
 */
interface SettingInfo {
  readonly id: string;
  readonly owner: string;
  readonly scope: "host" | "session";
  readonly label: string;
  /** The client renders from it: enum → picker, number → field, array → list. */
  readonly schema: JsonSchema;
  /** Labels and status badges for enum schemas. */
  readonly choices: readonly { readonly value: Json; readonly label: string; readonly badge?: string }[] | null;
  readonly value: Json;
  /** The layer that set it. */
  readonly from: "default" | "host" | "session";
}
/**
 * Describes one skill the model can load.
 *
 * @category sessions
 * @since 0.1.0
 */
interface SkillInfo {
  readonly name: string;
  readonly owner: string;
  readonly description: string;
  /** Path or url; the model loads it on demand. */
  readonly location: string;
}
/**
 * Describes one agent preset.
 *
 * @category sessions
 * @since 0.1.0
 */
interface AgentInfo {
  readonly id: string;
  readonly owner: string;
  readonly description: string | null;
  /** Pinned, or null = the head's. */
  readonly model: ModelRef | null;
  /** Subagent presets stay out of the user's picker. */
  readonly mode: "primary" | "subagent" | "all";
}
/**
 * Describes one tool as the session exposes it.
 *
 * @category sessions
 * @since 0.1.0
 */
interface ToolInfo {
  readonly name: string;
  readonly owner: string;
  /** "github", "mcp/linear": groups listings and codemode's search; null when the tool names none (§48d). */
  readonly namespace: string | null;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly output: JsonSchema | null;
  readonly exposure: "model" | "deferred" | "code" | "hidden";
}
/**
 * Returns the result of running a command.
 *
 * **Outcomes**
 *
 * - `ran`: the command ran; `output` is text to show, if any.
 * - `sent`: the command produced a prompt; core sent it with source action as `receipt`.
 * - `invalid`: `args` failed the command's schema.
 * - `unknown`: no core command has this name, including client-side commands.
 * - `failed`: the command threw; `message` says why.
 *
 * @category sessions
 * @since 0.1.0
 */
type CommandOutcome =
  | { readonly kind: "ran"; readonly output: string | null }
  | { readonly kind: "sent"; readonly receipt: ReceiptId }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unknown" }
  | { readonly kind: "failed"; readonly message: string };
/**
 * Returns the result of updating a session's metadata.
 *
 * **Outcomes**
 *
 * - `updated`: the patch applied.
 * - `busy`: relocate while `runs` are live.
 * - `unknown-workspace`: the target workspace is not registered.
 *
 * @category sessions
 * @since 0.1.0
 */
type UpdateOutcome =
  | { readonly kind: "updated" }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "unknown-workspace" };
/**
 * Returns the result of removing a session.
 *
 * **Outcomes**
 *
 * - `removed`: the session is gone.
 * - `busy`: `runs` are live.
 * - `has-children`: remove `children` first, or archive instead.
 *
 * @category sessions
 * @since 0.1.0
 */
type RemoveSessionOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "has-children"; readonly children: readonly SessionId[] };

// 2b. Parts

/**
 * Maps action names to their input and optional output schemas.
 *
 * @category parts
 * @since 0.1.0
 */
type ActionSchemas = Record<string, { readonly input: Schema<unknown>; readonly output?: Schema<unknown> }>;
/**
 * Describes a kind of part: its state schema, its actions, its fallback text
 * and, optionally, the host-side logic its actions run.
 *
 * **Details**
 *
 * A part is the UI primitive: a typed, versioned state created from a
 * definition, stored as `sessions/<id>/parts/<part>`, placed somewhere in the
 * interface. Dialogs, questions, custom messages, panels, status lines and
 * generative UI are all parts with a placement. Clients register renderers
 * per kind; without one they draw the fallback.
 *
 * A definition with no `onAction` needs no owner: any side may create it
 * from the definition. A definition whose actions need host-side logic is
 * contributed by a core plugin through `contribute.parts`.
 *
 * **Example** (A question part)
 *
 * ```ts
 * import { z } from "zod";
 *
 * const question = definePart({
 *   kind: "ask/question",
 *   state: z.object({ title: z.string(), choices: z.array(z.string()) }),
 *   actions: {
 *     answer: { input: z.object({ choice: z.string() }) },
 *     dismiss: { input: z.object({}) },
 *   },
 *   fallback: (state, { id }) => `Question ${id}: ${state.title} (${state.choices.join(", ")})`,
 * });
 * ```
 *
 * @see {@link definePart}
 * @see {@link Part}
 * @category parts
 * @since 0.1.0
 */
interface PartDefinition<State = unknown, Actions extends ActionSchemas = ActionSchemas> {
  /** Namespaced kind, e.g. "maps/places". */
  readonly kind: string;
  /** Validates the part's state; its JSON Schema goes to clients. */
  readonly state: Schema<State>;
  /** The actions a client may call with `act`. */
  readonly actions: Actions;
  /**
   * Returns the text a client without a renderer draws and the model reads.
   *
   * **Details**
   *
   * Re-projected from the current state at every request, so a part updated
   * by an action is seen updated. Put the id in the text so a follow-up tool
   * can address the part. Method syntax so a typed definition is assignable
   * to `PartDefinition`.
   *
   * **Example** (A canvas fallback)
   *
   * ```ts
   * declare const canvas: PartDefinition<{ readonly title: string; readonly error: string | null; readonly selected: string | null }>;
   *
   * const fallback: typeof canvas.fallback = (s, { id }) =>
   *   s.error !== null
   *     ? `Canvas ${id} "${s.title}" failed to render: ${s.error}`
   *     : `Canvas ${id} "${s.title}" is shown to the user (${s.selected ?? "nothing"} selected).`;
   * ```
   */
  fallback(state: State, context: { readonly id: PartId }): string;
  /**
   * Runs an action a client called and returns its value as the `act()`
   * result.
   *
   * **Details**
   *
   * An action is a function the plugin supplies and a client calls. It may
   * open further parts, wait on their answers, update its own state, and
   * return a value. Composition is ordinary code. `onAction` runs as a
   * durable task: a host restart re-runs it with its memos and nested
   * answers replayed, the same rule as a tool.
   *
   * **Gotchas**
   *
   * Without `onAction`, `act` settles `answer()` and returns
   * `{ kind: "ok", output: undefined }`.
   */
  onAction?<A extends keyof Actions>(action: A, input: Infer<Actions[A]["input"]>, context: ActionContext<State, Actions>): Awaitable<ActionOutput<Actions[A]>>;
}
/**
 * Returns an action's output type, or `undefined` when it declares none.
 *
 * @category parts
 * @since 0.1.0
 */
type ActionOutput<S> = S extends { readonly output: Schema<infer O> } ? O : undefined;
/**
 * Returns what an action handler gets: the part, the plugin api, who acted,
 * a signal, and the durable-step primitives.
 *
 * @category parts
 * @since 0.1.0
 */
interface ActionContext<State, Actions extends ActionSchemas> extends Durable {
  /** The part the action was called on. */
  readonly part: Part<PartDefinition<State, Actions>>;
  /** The owning plugin's api. */
  readonly api: PluginApi<"core">;
  /** Who acted. */
  readonly principal: PrincipalId;
  /** Fires when the part closes or the plugin deactivates. */
  readonly signal: AbortSignal;
}
/**
 * Returns the definition unchanged, with its state and action types
 * inferred.
 *
 * @category parts
 * @since 0.1.0
 */
declare function definePart<State, const Actions extends ActionSchemas>(definition: PartDefinition<State, Actions>): PartDefinition<State, Actions>;
/**
 * Returns a definition's state type.
 *
 * @category parts
 * @since 0.1.0
 */
type PartState<K extends PartDefinition> = Infer<K["state"]>;
/**
 * Returns a definition's actions as input and output types.
 *
 * @category parts
 * @since 0.1.0
 */
type PartActions<K extends PartDefinition> = { readonly [A in keyof K["actions"]]: { readonly input: Infer<K["actions"][A]["input"]>; readonly output: ActionOutput<K["actions"][A]> } };

/**
 * Names where a part is shown.
 *
 * **Details**
 *
 * Placement is open on purpose. Core types only what it acts on:
 *
 * - `transcript`: core makes it a message; the commit references the part,
 *   so it stays live.
 * - `modal`: core blocks `answer()` and `wait({ kind: "part" })` until an
 *   action settles it.
 * - anything else: core stores it, lists it in `view.parts`, and has no
 *   opinion. "panel", "status", "sidebar/weather", an org's own kind. The
 *   client that knows it draws it; one that doesn't ignores it.
 *
 * @category parts
 * @since 0.1.0
 */
type Placement =
  | { readonly kind: "transcript"; readonly role: "step" | "answer" | "note" }
  | { readonly kind: "modal" }
  | { readonly kind: string; readonly [detail: string]: Json };

/**
 * Returns a handle on one part: update its state, act on it, wait for its
 * answer, close it.
 *
 * **Details**
 *
 * Reads are the view. A tool result embeds parts as `{ text: fallback,
 * parts: [id] }`; the model sees `fallback(state)` as it is at each request,
 * clients see the renderer. When the owning plugin unloads, its parts stay
 * readable and lose actions.
 *
 * Act is a human pressing something on a part. The model has tools; a plugin
 * that wants the model to drive its part registers a tool that calls `act`.
 *
 * **When to use**
 *
 * Core declares no modal kind. A plugin that wants to ask declares one,
 * creates it with placement modal, then waits with
 * `invocation.wait({ kind: "part" })` inside a run, or `part.answer()`
 * outside one. The harness, desktop and tui may each ship such a plugin with
 * its renderer; they are plugins, not core.
 *
 * **Example** (Asking outside a run)
 *
 * ```ts
 * declare const session: Session;
 * declare const question: PartDefinition<
 *   { readonly title: string; readonly choices: readonly string[] },
 *   { readonly answer: { readonly input: Schema<{ readonly choice: string }> }; readonly dismiss: { readonly input: Schema<{}> } }
 * >;
 *
 * const part = await session.parts.create(question, {
 *   state: { title: "Deploy to staging?", choices: ["yes", "no"] },
 *   placement: { kind: "modal" },
 * });
 * const answer = await part.answer();
 * if (answer?.action === "answer") {
 *   console.log(answer.input.choice);
 * }
 * ```
 *
 * @see {@link PartDefinition}
 * @category parts
 * @since 0.1.0
 */
interface Part<K extends PartDefinition> {
  readonly id: PartId;
  /**
   * Replaces the state, or derives it from the current one; bumps version so
   * watchers redraw.
   *
   * **Outcomes**
   *
   * - `updated`: `version` is the new version.
   * - `invalid`: the state failed the definition's schema.
   * - `closed`: the part was closed.
   * - `missing`: no part has this id.
   *
   * @authority participant
   */
  update(next: PartState<K> | ((current: PartState<K>) => PartState<K>)): Promise<{ readonly kind: "updated"; readonly version: number } | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] } | { readonly kind: "closed" } | { readonly kind: "missing" }>;
  /**
   * Calls an action: runs the definition's `onAction` if it has one and
   * returns its value; a definition without one settles `answer()` and
   * returns ok.
   *
   * @returns {@link ActOutcome}
   * @authority participant
   */
  act<A extends keyof PartActions<K>>(action: A, input: PartActions<K>[A]["input"]): Promise<ActOutcome<PartActions<K>[A]["output"]>>;
  /**
   * Waits for the first action, or null when dismissed.
   *
   * **Gotchas**
   *
   * On a modal part the first act settles it. On a non-modal part it
   * resolves only at close.
   *
   * @authority participant
   */
  answer(): Promise<{ readonly [A in keyof PartActions<K>]: { readonly action: A; readonly input: PartActions<K>[A]["input"] } }[keyof PartActions<K>] | null>;
  /**
   * Closes the part: a pending act resolves closed; `answer()` resolves null.
   *
   * @authority participant
   */
  close(): Promise<void>;
}

// 2c. SessionView

/**
 * Returns the result of calling a part action.
 *
 * **Outcomes**
 *
 * - `ok`: `output` is the action's return value.
 * - `rejected`: `onAction` threw a domain refusal; `reason` says why.
 * - `unknown-action`: the definition has no such action.
 * - `closed`: the part was closed first.
 * - `no-owner`: the definition has an `onAction` but the plugin that supplied it unloaded; the part stays readable.
 * - `failed`: `onAction` threw; `message` says what.
 *
 * @category parts
 * @since 0.1.0
 */
type ActOutcome<Output> =
  | { readonly kind: "ok"; readonly output: Output }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "unknown-action" }
  | { readonly kind: "closed" }
  | { readonly kind: "no-owner" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Returns everything a client draws for one head: one list of messages, the
 * turns over it, execution, background work, configuration, context, heads,
 * changes and the catalog.
 *
 * **Details**
 *
 * A message is a user input or a part; a part is the one UI primitive, so a
 * thought, a tool call, the model's prose and a plugin's map are the same
 * thing to the client: kind, state, status, a renderer. The sdk folds the
 * client journal, host admission and the live stream into this list; core
 * computes everything that needs a loop. A client buckets by turn in one
 * pass and draws.
 *
 * **Example** (Reading the latest view once)
 *
 * ```ts
 * declare const session: Session;
 *
 * const view = await session.view();
 * const busy = view.execution.kind !== "idle";
 * const unread = view.heads.filter((head) => head.unread).length;
 * ```
 *
 * @see {@link Head.watch}
 * @category views
 * @since 0.1.0
 */
interface SessionView {
  /** The head revision this view reflects; pass as `expect`. */
  readonly revision: Revision;
  /** The seq of the last durable event this view folded (§54g). */
  readonly seq: Seq;
  
  readonly activation: Activation;
  /** Conversation order, including this client's unsent and the live tail. */
  readonly messages: readonly Message[];
  /** Every part not in the transcript, with its placement as given. A client picks the kinds it knows. */
  readonly parts: readonly PartView[];
  /** Same order as messages; computed by the fold, never by the client. */
  readonly turns: readonly TurnInfo[];
  /** The head's run phase: the one place it lives. */
  readonly execution: Execution;
  /** Children, jobs and pages working for this head. */
  readonly background: readonly BackgroundItem[];
  /** The head's stored selection and what admission would resolve now. */
  readonly configuration: { readonly selected: Configuration | null; readonly effective: Configuration | null };
  readonly context: ContextView;
  readonly heads: readonly HeadInfo[];
  /** Files this session changed, latest state per path, first-seen order. A field, not a derivation. */
  readonly changes: readonly FileChange[];
  /** Commands, settings, skills, agents, tools. A new object only when a plugin, skill or MCP server reloads. */
  readonly catalog: SessionCatalogView;
}
/**
 * Returns one transcript row: a user input or a part. Nothing else.
 *
 * **Details**
 *
 * Every message has one id from the moment it exists until it is committed,
 * minted once and reused at every stage:
 *
 * - user: the submission key. `send()` mints it before the network, the
 *   journal stores it, admission echoes it, the commit carries it.
 * - part: the part id. For text and thinking `${run}:${attempt}:${index}`,
 *   for tool the call id, for compaction and branchSummary the part id,
 *   minted when the part is created; a commit's id is its object's content
 *   hash, so it cannot be the id of a part its body names.
 *   The same id live and committed.
 *
 * A withdrawn user message leaves the list. A failed attempt's parts stay
 * with status failed until the next attempt's parts replace them; the retry
 * reason is on execution.
 *
 * **Example** (Narrowing a part message)
 *
 * ```ts
 * declare const view: SessionView;
 *
 * for (const message of view.messages) {
 *   if (message.kind === "user") continue;
 *   if (isPart(message, tool)) {
 *     console.log(message.state.name, message.status.kind);
 *   }
 * }
 * ```
 *
 * @category views
 * @since 0.1.0
 */
type Message = { readonly id: MessageId; readonly turn: TurnId; readonly at: number } & (
  | {
      readonly kind: "user";
      readonly content: UserContent;
      readonly source: MessageSource;
      readonly delivery: Delivery;
      readonly status: UserStatus;
      /** Alternatives sharing this message's parent; count 1 = never edited. */
      readonly siblings: { readonly index: number; readonly count: number; readonly ids: readonly CommitId[] };
    }
  | {
      readonly kind: "part";
      readonly part: PartId;
      /** "text" | "thinking" | "tool" | "ask/question" | "maps/places" ... */
      readonly partKind: string;
      /** Step/answer sit in the turn's work and reply; note is a system record between turns. Built-ins fix it; a plugin part chooses in its placement. */
      readonly role: "step" | "answer" | "note";
      /** Narrow with `isPart(message, kind)`. */
      readonly state: unknown;
      readonly version: number;
      readonly status: PartStatus;
    }
);
/**
 * Returns where a user message is between the client and the commit.
 *
 * **Details**
 *
 * - `unsent`: in this client's journal only; `retrying` says when and why.
 * - `pending`: admitted, not yet placed. `covered` false means no host will
 *   run it yet.
 * - `landed`: committed; `replaced` says which message it edited and which
 *   run that stopped.
 *
 * @category views
 * @since 0.1.0
 */
type UserStatus =
  | { readonly kind: "unsent"; readonly attempts: number; readonly retrying: { readonly at: number; readonly reason: string } | null }
  | { readonly kind: "pending"; readonly schedule: Schedule; readonly covered: boolean }
  | { readonly kind: "landed"; readonly commit: CommitId; readonly run: RunId | null; readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null };
/**
 * Returns when a pending input will run.
 *
 * **Details**
 *
 * - `joined`: steer joined a live run at its next boundary.
 * - `next-turn`: waits for the next turn, for `reason`.
 * - `attached`: starts nothing; rides with the next turn.
 *
 * @category views
 * @since 0.1.0
 */
type Schedule =
  | { readonly kind: "joined"; readonly run: RunId }
  | { readonly kind: "next-turn"; readonly reason: "requested" | "idle" | "run-ended" | "configuration" }
  | { readonly kind: "attached" };
/**
 * Returns a part message's lifecycle.
 *
 * **Details**
 *
 * - `live`: being written: streaming text, a running tool, an open modal.
 *   `run` is null for a part created outside a run (a modal a client opened).
 *   `waiting` is the durable step parked on a modal's answer, which `act`
 *   writes the answer to; `answer` is an answer that came before any step
 *   parked, which the first step to wait on the part takes (§48i).
 * - `waiting`: parked on a durable wait.
 * - `settled`: committed.
 * - `failed`: its run failed or was stopped; `run` null when closed by a
 *   failure outside a run.
 *
 * @category views
 * @since 0.1.0
 */
type PartStatus =
  | { readonly kind: "live"; readonly run: RunId | null; readonly waiting?: CallId; readonly answer?: { readonly action: string; readonly input: Json } }
  | { readonly kind: "waiting"; readonly run: RunId; readonly on: WaitTarget }
  | { readonly kind: "settled"; readonly commit: CommitId; readonly endedAt: number }
  | { readonly kind: "failed"; readonly run: RunId | null; readonly failure: Failure };
/**
 * Returns true when a message is a part of the given kind, narrowing its
 * state.
 *
 * @category views
 * @since 0.1.0
 */
declare function isPart<K extends PartDefinition>(message: Message, kind: K): message is Extract<Message, { readonly kind: "part" }> & { readonly state: PartState<K> };

/**
 * Returns the built-in text part: the model's prose. Role answer; streaming
 * appends and bumps version. `signature` is opaque provider continuity data
 * (a response id) the next request replays; never shown.
 *
 * **Details**
 *
 * Built-in kinds are exported with their schemas so clients narrow them like
 * any plugin's. Default renderers ship on each side; a client plugin may
 * replace one. Whether a client shows thinking, compaction or any kind is
 * the client's choice: skip the kind in its one pass. Core never hides a
 * part.
 *
 * @category parts
 * @since 0.1.0
 */
declare const text: PartDefinition<{ readonly markdown: string; readonly signature: Json | null }, {}>;
/**
 * Returns the built-in thinking part. Role step; adjacent thoughts are one
 * part, `merged` counts them, and the first id wins. `signature` is opaque
 * provider continuity data (a thinking signature, a redacted marker) the
 * next request replays; never shown.
 *
 * @category parts
 * @since 0.1.0
 */
declare const thinking: PartDefinition<{ readonly markdown: string; readonly merged: number; readonly signature: Json | null }, {}>;
/**
 * Returns the state of a tool part: the call, its class, progress, outcome
 * and file changes.
 *
 * @category parts
 * @since 0.1.0
 */
type ToolPartState = {
  readonly call: CallId;
  readonly name: string;
  readonly args: Json;
  readonly class: ToolClass;
} & (
  | { readonly phase: "calling" }
  | { readonly phase: "running"; readonly progress: ToolProgress | null }
  | { readonly phase: "settled"; readonly outcome: ToolOutcome; readonly changes: { readonly added: number; readonly removed: number; readonly paths: readonly string[] } | null }
);
/**
 * Returns the built-in tool part. Role step; its one action stops the call.
 *
 * @category parts
 * @since 0.1.0
 */
declare const tool: PartDefinition<ToolPartState, { readonly stop: { readonly input: Schema<Record<string, never>> } }>;
/**
 * Returns the built-in compaction part. Role note: context was summarised
 * here; projection to the model resumes from it.
 *
 * @category parts
 * @since 0.1.0
 */
declare const compaction: PartDefinition<{ readonly summary: string | null; readonly material: { readonly provider: string; readonly api: string; readonly model: string; readonly data: Json } | null; readonly tokensBefore: number; readonly usage: Usage | null }, {}>;
/**
 * Returns the built-in branch summary part. Role note: what an abandoned
 * path was about, written by `move({ abandoned: summarize })`.
 *
 * @category parts
 * @since 0.1.0
 */
declare const branchSummary: PartDefinition<{ readonly markdown: string }, {}>;
/**
 * Returns what a tool call does, declared by `ToolDefinition.class`, not
 * guessed from the name.
 *
 * **Details**
 *
 * - `shell`: `description` is what a wrapper plugin had the model say it does.
 * - `delegate`: a subagent call; `role` is which adapter.
 *
 * @category parts
 * @since 0.1.0
 */
type ToolClass =
  | { readonly kind: "read"; readonly path: string }
  | { readonly kind: "list"; readonly path: string }
  | { readonly kind: "edit"; readonly path: string }
  | { readonly kind: "shell"; readonly command: string; readonly description?: string }
  | { readonly kind: "delegate"; readonly child: SessionId | null; readonly role: "task" | "create" | "send" | "await" | "read" | "stop"; readonly title: string | null }
  | { readonly kind: "custom"; readonly label: string };

/**
 * Returns one turn: its run, prompt, state, step count and summary, computed
 * by the fold.
 *
 * **Details**
 *
 * Follow-on-scroll, pause on reader input and resume after a quiet spell
 * stay in the client; they are about the scrollport. Every row is
 * `renderers[partKind]` or the fallback; the user row is the one non-part
 * renderer.
 *
 * **Example** (The client's whole transcript build, O(n))
 *
 * ```ts
 * declare const view: SessionView;
 * declare function draw(turn: TurnInfo, messages: readonly Message[]): void;
 *
 * const byTurn = new Map<TurnId, Message[]>();
 * for (const message of view.messages) {
 *   const bucket = byTurn.get(message.turn) ?? [];
 *   bucket.push(message);
 *   byTurn.set(message.turn, bucket);
 * }
 * for (const turn of view.turns) draw(turn, byTurn.get(turn.id) ?? []);
 * ```
 *
 * **Example** (Compact step window)
 *
 * ```ts
 * declare const turn: TurnInfo;
 * declare const opened: boolean | undefined;
 * declare const density: "compact" | "detailed";
 *
 * const content =
 *   opened === true ? "open"
 *   : turn.state.kind === "working" && turn.steps > 0 ? "preview"
 *   : opened === false ? "closed"
 *   : density === "detailed" && !turn.thinkingOnly ? "open"
 *   : "closed";
 * ```
 *
 * @category views
 * @since 0.1.0
 */
interface TurnInfo {
  readonly id: TurnId;
  readonly run: RunId | null;
  /** Null = a continuation a background report opened. */
  readonly prompt: MessageId | null;
  /**
   * `working` carries an activity from the newest live tool's class:
   * "Exploring" | "Editing" | "Running".
   */
  readonly state:
    | { readonly kind: "working"; readonly activity: string | null }
    | { readonly kind: "waiting"; readonly on: WaitTarget }
    | { readonly kind: "ended"; readonly end: RunEnd };
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** Count of role step parts; the window is "preview" when working && steps > 0. */
  readonly steps: number;
  /** The turn's steps are all thinking. */
  readonly thinkingOnly: boolean;
  /** What the turn did, maintained incrementally as tools settle. */
  readonly summary: {
    /** Per tool class: how many calls settled ok and the paths they touched. Adding a class adds a key, never a field. */
    readonly byClass: Readonly<Record<ToolClass["kind"], { readonly count: number; readonly paths: readonly string[] }>>;
    readonly failed: number;
    readonly stopped: number;
    readonly added: number;
    readonly removed: number;
  };
}

/**
 * Returns a head's run phase: the one place it lives.
 *
 * **Details**
 *
 * - `idle`: nothing running; `lastRun` says how the last run ended, so a
 *   sidebar row says finished, stopped or failed without opening the
 *   session.
 * - `live`: responding or executing; `stopping` once the fence is passed.
 * - `waiting`: parked on a durable wait.
 * - `retrying`: a provider retry is scheduled `at`.
 *
 * @category views
 * @since 0.1.0
 */
type Execution =
  | { readonly kind: "idle"; readonly lastRun: { readonly id: RunId; readonly end: RunEnd; readonly endedAt: number } | null }
  | { readonly kind: "live"; readonly run: RunView; readonly phase: "responding" | "executing"; readonly stopping: boolean }
  | { readonly kind: "waiting"; readonly run: RunView; readonly on: WaitTarget }
  | { readonly kind: "retrying"; readonly run: RunView; readonly until: number; readonly reason: string };
/**
 * Returns one child, job or page working in the background for a head.
 *
 * @category views
 * @since 0.1.0
 */
interface BackgroundItem {
  readonly kind: "child" | "job" | "page";
  readonly id: string;
  readonly title: string;
  readonly state: "working" | "waiting" | "done" | "failed";
  /** The tool call that started it, if any. */
  readonly startedBy: CallId | null;
}


// 3. Workspace

/**
 * Returns a handle on one workspace: its info, its jobs, the changes runs
 * made, and its capabilities.
 *
 * **Details**
 *
 * Processes and files belong to the environment, not the session. Each
 * capability method returns a `Capability` that reports provision:
 * unsupported (no driver), denied (this principal), unavailable (driver down,
 * retry allowed or not), or available. Asking for one starts nothing. Every
 * write under a capability takes `expect?` and answers stale when the thing
 * moved; there is no guarded sub-handle and no `at(revision)`.
 *
 * @category workspaces
 * @since 0.1.0
 */
interface Workspace {
  readonly id: WorkspaceId;
  /**
   * Returns the workspace record.
   *
   * @authority participant
   */
  info(): Promise<WorkspaceInfo>;
  /**
   * Yields the workspace record as it changes: availability, writers,
   * sessions.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<WorkspaceInfo>;
  /**
   * Turns project resources on or off.
   *
   * **Details**
   *
   * `false` loads user plugins only, from the next activation; the current
   * run finishes.
   *
   * @authority owner
   */
  update(patch: { readonly projectResources?: boolean }): Promise<{ readonly kind: "updated" } | { readonly kind: "missing" }>;
  /**
   * Re-reads project resources; sessions on this workspace re-activate. The
   * retry after `Activation` failed.
   *
   * @authority owner
   */
  reload(): Promise<{ readonly kind: "updated" } | { readonly kind: "missing" }>;
  /** Background processes in this workspace. */
  readonly jobs: Jobs;
  /**
   * Returns a handle on a job by id.
   *
   * @handle
   */
  job(id: JobId): Job;
  /**
   * Returns what a run changed, from the environment's recorded snapshots.
   *
   * **Details**
   *
   * Run snapshots are an environment capability, separate from git. A
   * provider that serves files records a content-addressed tree before and
   * after each run, across every mutation path: edit tools, write tools,
   * shell, jobs. Git-backed via hidden refs where a repository exists;
   * filesystem-hashed where not. So `changes(run)` is honest everywhere files
   * are, and works with or without a repository. It is what `view.changes`,
   * `turn.summary` and tool `state.changes` read from. Recording edit-tool
   * patches alone is not tracking.
   *
   * @authority participant
   */
  changes(run: RunId): Promise<ChangeSet>;
  /**
   * Yields parsed patches for what a run changed, with the same batching,
   * cache and `PatchEntry` as `git.patches`.
   *
   * @see {@link GitApi.patches}
   * @stream frames
   * @authority participant
   */
  patches(run: RunId, paths: readonly string[], options?: DiffOptions): AsyncIterable<PatchSet>;
  /**
   * Returns the files capability.
   *
   * @authority participant
   */
  files(): Promise<Capability<FilesApi>>;
  /**
   * Returns the git capability.
   *
   * @authority participant
   */
  git(): Promise<Capability<GitApi>>;
  /**
   * Returns the browser capability.
   *
   * @authority participant
   */
  browser(): Promise<Capability<BrowserApi>>;
}
/**
 * Returns a registered workspace's record.
 *
 * @category workspaces
 * @since 0.1.0
 */
interface WorkspaceInfo {
  readonly id: WorkspaceId;
  readonly target: WorkspaceTarget;
  readonly identity: EnvironmentIdentity;
  readonly availability: Availability;
  /**
   * Whether the workspace's own code runs too.
   *
   * **Details**
   *
   * There is no trust state. Core loads project plugins and skills for a
   * workspace with project resources through its environment provider; the host
   * supplies no loader closure and no trust store.
   */
  readonly projectResources: boolean;
  /** What project resources would load. */
  readonly projectSources: readonly string[];
  readonly addedBy: PrincipalId;
  /** How many sessions use it. */
  readonly sessions: number;
  /** Runs editing the tree now; what git writes answer busy with. */
  readonly writers: readonly RunId[];
}

/**
 * Returns whether this host serves a session's workspace.
 *
 * **Details**
 *
 * - `active`: served.
 * - `inactive`: this host does not serve the workspace; history is readable.
 * - `unavailable`: the provider cannot reach `workspace`.
 * - `failed`: activation threw; `workspace.reload()` retries.
 *
 * @category workspaces
 * @since 0.1.0
 */
type Activation =
  | { readonly kind: "active" }
  | { readonly kind: "inactive" }
  | ({ readonly workspace: WorkspaceId } & Extract<Availability, { readonly kind: "unavailable" }>)
  | { readonly kind: "failed"; readonly message: string };


// 3b. Resources

/**
 * Returns one job as a row: command, owner session, terminal, state and tail.
 *
 * @category jobs
 * @since 0.1.0
 */
interface JobView {
  readonly id: JobId;
  readonly command: string;
  readonly title: string;
  readonly session: SessionId | null;
  /** Present when the job runs in a pty: a workbench tab attaches to it like any terminal. */
  readonly pty: { readonly columns: number; readonly rows: number; readonly shell: string } | null;
  readonly state: JobState;
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** The last lines, bounded; a panel shows this without opening `output()`. */
  readonly tail: string;
}
/**
 * How a job stands: running, exited with a code, or lost with the host.
 *
 * @category jobs
 * @since 0.1.0
 */
type JobState = { readonly kind: "running" } | { readonly kind: "exited"; readonly code: number | null; readonly reason: EndReason } | { readonly kind: "lost" };
/**
 * How a job ended. The same record `settled()` resolves and `JobView.state` holds once it is final.
 *
 * @category jobs
 * @since 0.1.0
 */
type JobEnd = Extract<JobState, { readonly kind: "exited" | "lost" }>;
/**
 * Why a process ended: on its own, killed, its lease expired, or the host went away.
 *
 * @category jobs
 * @since 0.1.0
 */
type EndReason = "exited" | "terminated" | "expired" | "host-lost";

/**
 * Starts, lists and watches a workspace's background processes.
 *
 * @category jobs
 * @since 0.1.0
 */
interface Jobs {
  /**
   * Starts a process that outlives the caller: a background command, or an
   * interactive shell when `pty` is given.
   *
   * **Details**
   *
   * `session` is the session whose head the exit report attaches to; omit it
   * for a job nothing waits on (the terminal panel's dev server). Started
   * from an invocation, the report goes to the starting run's head;
   * otherwise to main.
   *
   * With `pty`, the job is a terminal: omitted `command` runs the configured
   * login shell, and the returned `Job` carries `key` for `recover`. No
   * arbitrary host cwd: a job runs in its workspace. Pass `id` only to retry
   * across your own restart; same id + same input returns the existing job.
   *
   * **Example** (Starting a dev server for a session)
   *
   * ```ts
   * declare const workspace: Workspace;
   * declare const session: Session;
   *
   * const job = await workspace.jobs.start({
   *   command: "pnpm dev",
   *   session: session.id,
   *   title: "Dev server",
   * });
   * for await (const frame of job.output()) {
   *   if (frame.kind === "exit") break;
   * }
   * ```
   *
   * @authority participant
   */
  start(input: { readonly command?: string; readonly session?: SessionId; readonly title?: string; readonly pty?: { readonly columns: number; readonly rows: number }; readonly id?: JobId }): Promise<Job>;
  /**
   * Reclaims a pty job by the key its handle carried, never a second shell;
   * or says it ended or is missing.
   *
   * @authority participant
   */
  recover(key: JobKey): Promise<Job | { readonly kind: "ended"; readonly end: JobEnd } | { readonly kind: "missing" }>;
  /**
   * Returns every job in the workspace.
   *
   * @authority participant
   */
  list(): Promise<readonly JobView[]>;
  /**
   * Yields the job list as it changes.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<readonly JobView[]>;
}
/**
 * Returns a handle on one job: stdin, output, stop and settlement.
 *
 * **Details**
 *
 * A job belongs to the workspace, not to a chat. It outlives the session
 * that started it, the tab that showed it and the client that asked: an
 * agent told to run a local server leaves a server running. Only `stop()`,
 * the process exiting or the host going away end it. On exit, if it has a
 * session, a bounded report (command, code, tail) attaches to that head; a
 * long-lived job streams nothing into the chat while it runs. A job is
 * background the moment nobody waits on it; a tool that waits uses
 * `wait({ kind: "job" })`.
 *
 * @category jobs
 * @since 0.1.0
 */
interface Job {
  readonly id: JobId;
  /** Pass to `recover` to reclaim a pty job after a reconnect. Null for a pipe job. */
  readonly key: JobKey | null;
  /**
   * Writes stdin, for a pipe or a pty job. An MCP stdio server is a job; a
   * terminal's keystrokes are this. Volatile, never replayed.
   *
   * @authority participant
   */
  write(bytes: Uint8Array): Promise<void>;
  /**
   * Yields bytes, gaps and the exit.
   *
   * **Gotchas**
   *
   * A slow reader gets `gap`, never stalls the process.
   *
   * @stream frames
   * @authority participant
   */
  output(): AsyncIterable<OutputFrame>;
  /**
   * Resizes a pty job; answers `not-pty` for a pipe job.
   *
   * @authority participant
   */
  resize(size: { readonly columns: number; readonly rows: number }): Promise<{ readonly kind: "resized" } | { readonly kind: "not-pty" } | { readonly kind: "missing" }>;
  /**
   * Returns whether a pty job's shell is at a prompt, so stop needs no
   * confirmation. Answered by the pty driver (prompt markers), never by core.
   * False for a pipe job.
   *
   * @authority participant
   */
  idle(): Promise<boolean>;
  /**
   * Stops the process and awaits cleanup.
   *
   * @authority participant
   */
  stop(): Promise<StopOutcome<JobEnd>>;
  /**
   * Waits for the process to end.
   *
   * @authority participant
   */
  settled(options?: RequestOptions): Promise<JobEnd>;
  /**
   * Detaches this handle's output stream; the process keeps running.
   *
   * @authority participant
   */
  close(): Promise<void>;
  /** Detaches; for `await using`. */
  [Symbol.asyncDispose](): Promise<void>;
}
// A job is the one process primitive. A pipe job is a background command;
// a pty job is a terminal. Attaching a workbench tab is job(id).output().
/**
 * Returns one frame of process output: bytes, a gap where a slow reader
 * missed some, or the exit code.
 *
 * @category jobs
 * @since 0.1.0
 */
type OutputFrame = { readonly kind: "bytes"; readonly data: Uint8Array } | { readonly kind: "gap" } | { readonly kind: "exit"; readonly code: number | null };

/**
 * Reads, writes, scans, searches and watches files in a workspace.
 *
 * **Details**
 *
 * A version is a content fingerprint the driver can check, not an mtime.
 * External editors are external: a write with `expect` answers stale rather
 * than overwriting; a write without `expect` overwrites and says so.
 *
 * @category files
 * @since 0.1.0
 */
interface FilesApi {
  /**
   * Returns a file as text, binary, large or missing, each with its version.
   *
   * @authority participant
   */
  read(path: string): Promise<FileDocument>;
  /**
   * Returns an owned byte stream for binary and large files, carrying the
   * version it read.
   *
   * @stream frames
   * @authority participant
   */
  bytes(path: string): Promise<ByteReader>;
  /**
   * Returns kind, size and version, or null when nothing is there.
   *
   * @authority participant
   */
  stat(path: string): Promise<{ readonly kind: "file" | "directory" | "symlink"; readonly size: number; readonly version: FileVersion; readonly target?: string } | null>;
  /**
   * Writes a file; `missing-parent` unless `parents`.
   *
   * @returns {@link WriteOutcome}
   * @authority participant
   */
  write(path: string, contents: string | Uint8Array, options?: { readonly expect?: FileVersion | "absent"; readonly parents?: boolean }): Promise<WriteOutcome>;
  /**
   * Removes a file.
   *
   * @returns {@link WriteOutcome}
   * @authority participant
   */
  remove(path: string, options?: { readonly expect?: FileVersion }): Promise<WriteOutcome>;
  /**
   * Returns an empty immutable plan; only `apply()` writes.
   *
   * **Details**
   *
   * One reviewed intent, not cross-file ACID.
   *
   * @handle
   */
  batch(): FileBatch;
  /**
   * Formats contents with the workspace's formatter. Never writes.
   *
   * **Outcomes**
   *
   * - `formatted`: `contents` is the formatted text.
   * - `unchanged`: already formatted.
   * - `unavailable`: no formatter for this path.
   *
   * @authority participant
   */
  format(path: string, contents: string): Promise<FormatOutcome>;
  /**
   * Yields pages of entries, then `complete` or `incomplete { reason }`.
   *
   * @stream frames
   * @authority participant
   */
  scan(input?: { readonly directory?: string; readonly ignored?: "exclude" | "include" }): AsyncIterable<ScanFrame>;
  /**
   * Returns name matches, host-narrowed and host-capped: the @ mention list.
   *
   * **Details**
   *
   * A phone asks for ten rows, never the tree.
   *
   * @authority participant
   */
  find(input: { readonly query: string; readonly limit?: number }): Promise<readonly FileEntryView[]>;
  /**
   * Yields content matches, then `complete` or `truncated`.
   *
   * @stream frames
   * @authority participant
   */
  search(input: { readonly query: string; readonly limit?: number }): AsyncIterable<SearchFrame>;
  /**
   * Yields created, modified and removed events with versions, coalesced.
   *
   * @stream watch
   * @authority participant
   */
  watch(input?: { readonly paths?: readonly string[] }): AsyncIterable<readonly FileEvent[]>;
  /**
   * Stores a byte stream as a blob for `UserContent` files; replayable.
   *
   * @authority participant
   */
  upload(source: AsyncIterable<Uint8Array>): Promise<BlobId>;
}
/**
 * Returns an immutable plan of file writes and removals applied as one
 * durable command.
 *
 * **Example** (Applying a reviewed edit)
 *
 * ```ts
 * declare const files: FilesApi;
 * declare const version: FileVersion;
 *
 * const receipt = await files
 *   .batch()
 *   .put({ path: "src/parser.ts", contents: "export {};\n", expect: version })
 *   .put({ path: "src/parser.test.ts", contents: "", expect: "absent" })
 *   .remove({ path: "src/legacy-parser.ts" })
 *   .apply();
 * const outcome = await receipt.settled();
 * if (outcome.kind === "stale") console.log(outcome.paths);
 * ```
 *
 * @category files
 * @since 0.1.0
 */
interface FileBatch {
  /** Returns a new plan with one more write. */
  put(input: { readonly path: string; readonly contents: string | Uint8Array | BlobId; readonly expect?: FileVersion | "absent" }): FileBatch;
  /** Returns a new plan with one more removal. */
  remove(input: { readonly path: string; readonly expect?: FileVersion }): FileBatch;
  /**
   * Applies the plan as a durable command.
   *
   * @returns {@link BatchOutcome}, through the receipt.
   * @authority participant
   */
  apply(): Promise<Receipt<BatchOutcome>>;
}
/**
 * Returns the result of writing or removing one file.
 *
 * **Outcomes**
 *
 * - `saved`: written; `version` is the new version.
 * - `stale`: the file moved since `expect`; `current` is its version, or null if gone.
 * - `missing-parent`: the directory does not exist and `parents` was not set.
 *
 * @category files
 * @since 0.1.0
 */
type WriteOutcome =
  | { readonly kind: "saved"; readonly version: FileVersion }
  | { readonly kind: "stale"; readonly current: FileVersion | null }
  | { readonly kind: "missing-parent" };
/**
 * Returns the result of applying a file batch.
 *
 * **Outcomes**
 *
 * - `applied`: every entry written; `snapshot` records the tree after.
 * - `stale`: `paths` moved since their `expect`; nothing was written.
 * - `partial`: `applied` were written, `remaining` were not, for `reason`.
 * - `stopped`: the receipt was stopped after `applied` were written.
 *
 * @category files
 * @since 0.1.0
 */
type BatchOutcome =
  | { readonly kind: "applied"; readonly snapshot: SnapshotId; readonly paths: readonly string[] }
  | { readonly kind: "stale"; readonly paths: readonly string[] }
  | { readonly kind: "partial"; readonly applied: readonly string[]; readonly remaining: readonly string[]; readonly reason: string }
  | { readonly kind: "stopped"; readonly applied: readonly string[] };
/**
 * Returns a file read: text with contents, binary or large with a size, or
 * missing.
 *
 * @category files
 * @since 0.1.0
 */
type FileDocument =
  | { readonly kind: "text"; readonly path: string; readonly contents: string; readonly version: FileVersion }
  | { readonly kind: "binary" | "large"; readonly path: string; readonly size: number; readonly version: FileVersion }
  | { readonly kind: "missing"; readonly path: string };

/**
 * Reads repository status, comparisons and history, and writes the index,
 * commits, branches and pushes.
 *
 * **Details**
 *
 * Git belongs to the environment, not the host. The kernel may run with no
 * filesystem at all (a durable object) and still own sessions, runs and
 * parts; git exists wherever the environment provider is. `Capability<GitApi>`
 * answers unsupported for an environment with no filesystem, and status
 * `"none"` for a folder with no repository. The local and sandbox providers
 * supply git, CLI where there is one and in-process where there is not; a
 * chat-only provider supplies none. Hunks are produced by the provider; no
 * client parses text.
 *
 * Git is the one VCS capability; another VCS is another capability with its
 * own shape, not a second `GitApi` implementation.
 *
 * Writes take `expect`, the status revision the client showed. Branch,
 * commit and push are three calls with three outcomes; report each.
 *
 * @category git
 * @since 0.1.0
 */
interface GitApi {
  /**
   * Returns the repository status, or `{ kind: "none" }` when there is no
   * repository.
   *
   * **Details**
   *
   * A repository status carries root, head, branch, upstream, revision,
   * staged index files and unstaged worktree files. `head` null means an
   * unborn repository. `"none"` means no repository, not unsupported git.
   *
   * @authority participant
   */
  status(): Promise<GitStatus>;
  /**
   * Yields the status as it changes.
   *
   * **Details**
   *
   * Core rescans after a write-class tool settles and on fs events; the
   * client never asks.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<GitStatus>;

  /**
   * Returns the files a scope changes, with names and line stats.
   *
   * **Details**
   *
   * A scope names what is compared; the returned revision names the state it
   * was read at. Reads are cheap (names and line stats); patches are on
   * demand.
   *
   * @authority participant
   */
  changes(scope: GitScope, options?: DiffOptions): Promise<ChangeSet>;
  /**
   * Yields the changed files as the revision moves.
   *
   * @stream watch
   * @authority participant
   */
  watchChanges(scope: GitScope, options?: DiffOptions): AsyncIterable<ChangeSet>;
  /**
   * Yields parsed patches for the requested paths: the Changes panel's whole
   * data need.
   *
   * **Details**
   *
   * The sdk:
   *
   * - batches concurrent and newly requested paths into host reads of at
   *   most `PATCH_READ_MAX` paths, with bounded concurrency, so expanding
   *   every file is a few rounds, not a read per file;
   * - caches by (scope, revision, path), structurally shared, so a path read
   *   once is never read again at that revision;
   * - holds the previous revision's entry for a path while the fresh one is
   *   in flight, marked `fresh: false`, so the panel never blanks when the
   *   tree moves; a path the new revision no longer reports leaves;
   * - parses once, on the host, into hunks. No client parses unified text.
   *
   * Each yield is the full map for the requested paths; unchanged entries
   * keep identity. Changing paths (scroll, expand all) is a new call; the
   * cache is shared across calls on the same connection.
   *
   * **Example** (Feeding the Changes panel)
   *
   * ```ts
   * declare const git: GitApi;
   * declare function render(entries: PatchSet["entries"]): void;
   *
   * const changes = await git.changes({ kind: "worktree" });
   * const paths = changes.files.map((file) => file.path);
   * for await (const set of git.patches({ kind: "worktree" }, paths, { ignoreWhitespace: true })) {
   *   render(set.entries);
   * }
   * ```
   *
   * @stream frames
   * @authority participant
   */
  patches(scope: GitScope, paths: readonly string[], options?: DiffOptions): AsyncIterable<PatchSet>;
  /**
   * Returns a file's old and new sides under a scope: each absent, text,
   * truncated `{ head }` or binary.
   *
   * @authority participant
   */
  contents(path: string, scope: GitScope): Promise<GitFileSides>;

  /**
   * Returns one page of commit history.
   *
   * @authority participant
   */
  log(input?: { readonly cursor?: Cursor; readonly limit?: number }): Promise<Paged<GitCommitView>>;
  /**
   * Returns branches, tags and remotes.
   *
   * @authority participant
   */
  refs(): Promise<GitRefsView>;
  /**
   * Returns per-line authorship for a file.
   *
   * @authority participant
   */
  blame(path: string): Promise<BlameView>;

  /**
   * Stages paths; proceeds while a run is writing.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  stage(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  /**
   * Unstages paths; proceeds while a run is writing.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  unstage(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  /**
   * Discards worktree changes to paths; answers busy while a run is writing.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  discard(paths: readonly string[], options?: GitWrite): Promise<GitOutcome>;
  /**
   * Commits staged, all, or the listed files; answers busy while a run is
   * writing.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  commit(input: { readonly message: string; readonly files: "staged" | "all" | readonly string[] }, options?: GitWrite): Promise<GitOutcome>;
  /**
   * Creates a branch, and checks it out if asked.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  branch(input: { readonly name: string; readonly checkout: boolean }, options?: GitWrite): Promise<GitOutcome>;
  /**
   * Pushes the current branch.
   *
   * @returns {@link GitOutcome}
   * @authority owner
   */
  push(input?: { readonly setUpstream?: boolean }, options?: GitWrite): Promise<GitOutcome>;
}
/**
 * Names what a git comparison compares.
 *
 * **Details**
 *
 * - `worktree`: HEAD vs working tree: everything uncommitted.
 * - `staged`: HEAD vs index.
 * - `unstaged`: index vs working tree.
 * - `commit`: a commit vs its parent.
 * - `branch`: merge-base(base, HEAD) vs HEAD: the PR view.
 *
 * @category git
 * @since 0.1.0
 */
type GitScope =
  | { readonly kind: "worktree" }
  | { readonly kind: "staged" }
  | { readonly kind: "unstaged" }
  | { readonly kind: "commit"; readonly commit: GitCommitId }
  | { readonly kind: "branch"; readonly base: string };
/**
 * Describes how a diff is computed.
 *
 * @category git
 * @since 0.1.0
 */
type DiffOptions = { readonly ignoreWhitespace?: boolean };
/**
 * Returns the files a comparison or a run changed, with line stats, at one
 * revision.
 *
 * @category git
 * @since 0.1.0
 */
interface ChangeSet {
  /** A git revision, or a snapshot for run changes. */
  readonly revision: GitRevision | SnapshotId;
  /** One row per path; `from` is the source path of a rename. */
  readonly files: readonly { readonly path: string; readonly status: FileStatus; readonly stat: LineStat; readonly from?: string }[];
}
/**
 * Returns the full patch map for the requested paths at one revision.
 *
 * @category git
 * @since 0.1.0
 */
interface PatchSet {
  readonly revision: GitRevision | SnapshotId;
  /** `fresh` false = the previous revision's entry, held while the new one loads. */
  readonly entries: ReadonlyMap<string, PatchEntry & { readonly fresh: boolean }>;
}
/**
 * Returns one path's parsed patch.
 *
 * **Details**
 *
 * `digest` is content identity for "viewed" marks: the same content after a
 * re-read stays viewed.
 *
 * - `text`: hunks with line counts.
 * - `binary`: no textual patch.
 * - `empty`: reported by the scope, no textual change, as under `ignoreWhitespace`.
 * - `too-large`: the host stopped reading at `limit`; `contents()` still works.
 * - `failed`: this path failed; the others in the set are fine.
 *
 * @category git
 * @since 0.1.0
 */
type PatchEntry = { readonly path: string; readonly status: FileStatus; readonly digest: string } & (
  | { readonly kind: "text"; readonly added: number; readonly removed: number; readonly hunks: readonly Hunk[] }
  | { readonly kind: "binary" }
  | { readonly kind: "empty" }
  | { readonly kind: "too-large"; readonly limit: number }
  | { readonly kind: "failed"; readonly reason: string }
);
/**
 * Returns one parsed hunk.
 *
 * **Details**
 *
 * A client maps `Hunk[]` to its renderer's shape (desktop: @pierre/diffs
 * FileDiffMetadata) in O(lines) with no parser and no worker. Viewed marks
 * (path + digest) stay in the client; they are a reader's note, not repo
 * state.
 *
 * @category git
 * @since 0.1.0
 */
interface Hunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly header: string | null;
  readonly lines: readonly { readonly kind: "context" | "add" | "remove"; readonly text: string; readonly noNewline?: true }[];
}
/**
 * Names how a path changed.
 *
 * @category git
 * @since 0.1.0
 */
type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
/**
 * Returns a path's added and removed line counts, or why there are none.
 *
 * @category git
 * @since 0.1.0
 */
type LineStat = { readonly kind: "text"; readonly added: number; readonly removed: number } | { readonly kind: "binary" } | { readonly kind: "unknown" };
/**
 * Describes a git write's guard: the status revision the client showed.
 *
 * @category git
 * @since 0.1.0
 */
type GitWrite = { readonly expect?: GitRevision };
/**
 * Returns the result of a git write.
 *
 * **Outcomes**
 *
 * - `applied`: done; `revision` is the new status revision.
 * - `unchanged`: nothing to do.
 * - `stale`: the repository moved since `expect`; `revision` is current.
 * - `busy`: `runs` are writing this tree; discard and commit refuse, stage and unstage proceed.
 * - `rejected`: git refused; `reason` says why.
 *
 * @category git
 * @since 0.1.0
 */
type GitOutcome =
  | { readonly kind: "applied"; readonly revision: GitRevision }
  | { readonly kind: "unchanged" }
  | { readonly kind: "stale"; readonly revision: GitRevision }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "rejected"; readonly reason: string };

/**
 * Opens, adopts, lists and watches browser pages in a workspace.
 *
 * @category browser
 * @since 0.1.0
 */
interface BrowserApi {
  /**
   * Opens a new page and returns an owned hold on it.
   *
   * @authority participant
   */
  open(input: { readonly url: string }): Promise<Page>;
  /**
   * Returns a hold on an existing page: same page, not URL matching.
   *
   * @throws {SdkError} unknown when no page has this id.
   * @authority participant
   */
  adopt(id: PageId): Promise<Page>;
  /**
   * Returns every open page.
   *
   * @authority participant
   */
  list(): Promise<readonly PageInfo[]>;
  /**
   * Yields the page list as it changes.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<readonly PageInfo[]>;
}
/**
 * Returns a hold on one browser page: read it, snapshot it, drive it.
 *
 * **Details**
 *
 * A ref names a node in a snapshot revision; `expect` pins that revision.
 * The viewport that shows the page is a driver adapter; it alone owns
 * bounds, occlusion, focus and screenshot fallback. A page is a workspace
 * resource held by whoever opened it; a tool's hold shows in
 * `view.background`.
 *
 * @category browser
 * @since 0.1.0
 */
interface Page {
  readonly id: PageId;
  /**
   * Returns url, title, loading and revision.
   *
   * @authority participant
   */
  view(): Promise<PageView>;
  /**
   * Yields the page view as it loads and changes.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<PageView>;
  /**
   * Returns the accessibility nodes at a revision: ref, role, name,
   * editable. `ref` narrows to a subtree.
   *
   * @authority participant
   */
  snapshot(input?: { readonly ref?: string }): Promise<PageSnapshot>;
  /**
   * Navigates to a url.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  navigate(url: string): Promise<PageOutcome>;
  /**
   * Goes back in history.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  back(): Promise<PageOutcome>;
  /**
   * Goes forward in history.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  forward(): Promise<PageOutcome>;
  /**
   * Reloads the page.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  reload(): Promise<PageOutcome>;
  /**
   * Stops a load in progress.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  stopLoading(): Promise<PageOutcome>;
  /**
   * Clicks a node by ref; volatile, never replayed.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  click(input: { readonly ref: string; readonly button?: "left" | "right" | "middle"; readonly double?: boolean; readonly expect?: DocumentRevision }): Promise<PageOutcome>;
  /**
   * Types into a node by ref.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  type(input: { readonly ref: string; readonly text: string; readonly clear?: boolean; readonly submit?: boolean; readonly expect?: DocumentRevision }): Promise<PageOutcome>;
  /**
   * Presses a key or chord, on a node or the page.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  press(input: { readonly key: string; readonly ref?: string }): Promise<PageOutcome>;
  /**
   * Scrolls the page or a node.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  scroll(input: { readonly direction: "up" | "down" | "top" | "bottom"; readonly ref?: string; readonly pages?: number }): Promise<PageOutcome>;
  /**
   * Waits for load, for text to appear or disappear, or for a delay.
   *
   * @returns {@link PageOutcome}
   * @authority participant
   */
  wait(condition: { readonly kind: "loaded" } | { readonly kind: "text"; readonly text: string; readonly present: boolean } | { readonly kind: "delay"; readonly ms: number }): Promise<PageOutcome>;
  /**
   * Returns console entries, newest first; `clear` empties the buffer.
   *
   * @authority participant
   */
  console(input?: { readonly limit?: number; readonly clear?: boolean }): Promise<readonly ConsoleEntry[]>;
  /**
   * Returns an owned encoded image stream of the page.
   *
   * @stream frames
   * @authority participant
   */
  capture(): Promise<ByteReader>;
  /**
   * Evaluates an expression in the page; with `ref`, the node is `this`.
   *
   * **Gotchas**
   *
   * Gated by the plugin that exposes it, not by a second principal flag.
   *
   * @authority participant
   */
  evaluate(expression: string, options?: { readonly ref?: string }): Promise<{ readonly kind: "value"; readonly value: Json } | { readonly kind: "threw"; readonly message: string }>;
  /**
   * Releases this hold. The page lives while any hold does; policy may
   * reclaim hidden pages.
   *
   * @authority participant
   */
  close(): Promise<void>;
  /** Releases this hold; for `await using`. */
  [Symbol.asyncDispose](): Promise<void>;
}
/**
 * Returns the result of a page action.
 *
 * **Outcomes**
 *
 * - `applied`: done; `snapshot` is the page after.
 * - `stale`: `expect` lost; `revision` is current; snapshot again.
 * - `refused`: the ref is unknown, occluded or not visible, or policy said no.
 * - `closed`: the page is gone: released, reclaimed or crashed.
 *
 * @category browser
 * @since 0.1.0
 */
type PageOutcome =
  | { readonly kind: "applied"; readonly snapshot: PageSnapshot }
  | { readonly kind: "stale"; readonly revision: DocumentRevision }
  | { readonly kind: "refused"; readonly reason: "unknown-ref" | "occluded" | "not-visible" | "policy" }
  | { readonly kind: "closed"; readonly reason: "released" | "reclaimed" | "crashed" };


// 4. Tools

/**
 * Returns what a tool's `execute` receives: the same connection a client
 * gets, bound to where the call runs, plus the durable-step primitives.
 *
 * **Details**
 *
 * The invocation's sdk has no owner authority, so a run cannot register a
 * folder. `sessions.create({ parent })` through it records the run and call
 * that spawned the child; a client's sdk records only the session.
 *
 * @category tools
 * @since 0.1.0
 */
interface ToolInvocation extends Durable {
  readonly run: RunId;
  readonly call: CallId;
  /** The head this run is on; a side-head run targets itself. */
  readonly head: HeadName;
  /** Fires when the call is stopped. */
  readonly signal: AbortSignal;
  /** Full handle; children via `sdk.sessions.create({ parent: session.id })`. */
  readonly session: Session;
  /** The run's connection, with participant authority. */
  readonly sdk: Connection;
  /** The session's workspace. */
  readonly workspace: Workspace;
  /** Files and exec, resolved; no Capability unwrapping inside a tool. */
  readonly env: ExecutionEnv;
  /** Writes the tool part's progress; the client draws it. */
  progress(update: ToolProgress): void;
  /** Nested calls and deferred tools. */
  readonly tools: {
    /**
     * Calls another tool under `before_tool` policy.
     *
     * **Gotchas**
     *
     * Keyed so a re-run finds the one it already made. The default key is
     * call order, so concurrent calls need explicit keys.
     */
    execute(name: string, args: Json, options?: { readonly key?: string; readonly signal?: AbortSignal }): Promise<ToolOutcome>;
    /** Brings deferred tools into the declared set for the rest of this run. */
    activate(names: readonly string[]): Promise<void>;
    /** Returns the session's tools with output schemas and exposure, so codemode can type its sandbox. */
    list(): readonly ToolInfo[];
  };
}
/**
 * Returns what a durable step can do: park, memoise and read a recorded
 * clock.
 *
 * **Details**
 *
 * Tools, part actions and core decide hooks are all durable steps; a host
 * restart re-runs them with everything below replayed. Acquisitions made
 * through a durable step are recorded like nested calls:
 * `sessions.create`, `parts.create`, `jobs.start` and `browser.open`, keyed
 * by call order or an explicit key, return the same thing on a re-run. No
 * memo needed.
 *
 * Write a step so that everything before its first `wait()` is either cheap
 * and repeatable or already recorded.
 *
 * @see {@link ToolDefinition.replay}
 * @category durability
 * @since 0.1.0
 */
interface Durable {
  /**
   * Parks the step durably until a target settles; a wake re-runs the step
   * and this call resolves at once.
   *
   * **Details**
   *
   * Wait is the only blocking primitive. The delegate adapters task, create,
   * send, await, read and stop are built on `sessions.create`, `send`,
   * `receipt.settled` and `wait`. `any`/`all` combine targets; `deadline`
   * bounds the whole wait; `untilInput` also wakes when the user sends to
   * this head.
   *
   * **Example** (A synchronous subagent)
   *
   * ```ts
   * const execute: ToolDefinition<{ task: string }>["execute"] = async (args, invocation) => {
   *   const child = await invocation.sdk.sessions.create({ parent: invocation.session.id });
   *   const receipt = await child.send(args.task);
   *   const landed = await receipt.landed();
   *   if (landed.kind !== "landed" || landed.run === null) return { content: [{ kind: "text", text: "Not started." }] };
   *   const outcome = await invocation.wait({ kind: "run", session: child.id, run: landed.run });
   *   const text = outcome.kind === "run" ? `Child ended: ${outcome.end.kind}` : outcome.kind;
   *   return { content: [{ kind: "text", text }] };
   * };
   * ```
   *
   * @returns {@link WaitOutcome}
   */
  wait(target: WaitTarget | { readonly kind: "any" | "all"; readonly targets: readonly WaitTarget[]; readonly deadline?: number; readonly untilInput?: boolean }): Promise<WaitOutcome>;
  /**
   * Stores a computed value under a name unless one exists, and returns the
   * durable winner.
   *
   * **Details**
   *
   * The re-run gets the recorded value. A tool that fetches, then writes,
   * memoises the fetch and is safe to replay.
   *
   * **Example** (Memoising a fetch before a write)
   *
   * ```ts
   * declare const invocation: ToolInvocation;
   *
   * const issue = await invocation.memo("issue", async () => {
   *   const response = await fetch("https://api.example.com/issues/42");
   *   return { title: String((await response.json()).title) };
   * });
   * await invocation.env.files.write("ISSUE.md", `# ${issue.title}\n`);
   * ```
   */
  memo<T extends Json>(name: string, compute: () => Awaitable<T>): Promise<T>;
  /** Returns the recorded clock: the same value on a re-run. */
  now(): number;
}
/**
 * Describes a tool: its name, schemas, exposure, class, replay policy and
 * execute function.
 *
 * **Example** (A replay-safe read tool)
 *
 * ```ts
 * import { z } from "zod";
 *
 * const readFile = {
 *   name: "read",
 *   description: "Read a file in the workspace.",
 *   parameters: z.object({ path: z.string() }),
 *   class: (args) => ({ kind: "read", path: args.path }),
 *   replay: "safe",
 *   execute: async (args, invocation) => {
 *     const file = await invocation.env.files.read(args.path);
 *     const text = file.kind === "text" ? file.contents : `${args.path}: ${file.kind}`;
 *     return { content: [{ kind: "text", text }] };
 *   },
 * } satisfies ToolDefinition<{ path: string }>;
 * ```
 *
 * @see {@link ToolInvocation}
 * @category tools
 * @since 0.1.0
 */
interface ToolDefinition<Args = unknown, Output = unknown> {
  readonly name: string;
  /** "github", "mcp/linear": grouped in listings and codemode's ALL_TOOLS. */
  readonly namespace?: string;
  readonly description: string;
  /** Validates the call; its JSON Schema goes to the model. */
  readonly parameters: Schema<Args>;
  /** Validates `ToolResult.output`; what clients and codemode read. */
  readonly output?: Schema<Output>;
  /** Default model. deferred: listed by name until `activate()`. code: callable from codemode only. hidden: callable by plugins only. */
  readonly exposure?: "model" | "deferred" | "code" | "hidden";
  /** Constrained sampling of the arguments, for providers that support it (OpenAI Lark). Ignored elsewhere; parameters still validate the call. */
  readonly grammar?: { readonly kind: "lark"; readonly source: string } | { readonly kind: "regex"; readonly pattern: string };
  /** Returns what the call does; method syntax on purpose, so a typed tool stays assignable to `ToolDefinition<unknown>`. */
  class(args: Args, context: { readonly call: CallId }): ToolClass;
  /**
   * Says whether `execute` may run again after a host died mid-call. No
   * default.
   *
   * **Details**
   *
   * Core records a call's intent before `execute` and its result after. A
   * host that dies between them resumes with an intent and no result:
   *
   * - `safe`: `execute` runs again from the top. Recorded `wait()` outcomes
   *   and nested `tools.execute()` results replay instantly in order, so the
   *   code is deterministic up to its first unrecorded effect. This is also
   *   how a parked tool wakes: no continuation, a re-run whose `wait()`
   *   resolves at once.
   * - `never`: `execute` does not run again. The call settles as
   *   `interrupted`; the model sees it and decides.
   *
   * **When to use**
   *
   * `memo()` records an intermediate result under a name; a tool that
   * fetches, then writes, memoises the fetch and is safe. A tool whose effect
   * cannot be recorded, or that must not repeat, is never.
   */
  readonly replay: "safe" | "never";
  /** Runs the call. */
  execute(args: Args, invocation: ToolInvocation): Promise<ToolResult<Output>>;
}
/**
 * Holds one contribution kind: add items, derive them at reload, list the
 * materialised set.
 *
 * **Details**
 *
 * Reload order within one pass: tools → agents → prompt → the rest; a derive
 * reads siblings materialised earlier in the pass. Writes schedule a reload;
 * external state (an MCP server reconnected) calls `api.reload()`.
 *
 * @category plugins
 * @since 0.1.0
 */
interface Registry<T, S extends Side = Side, Handle = Disposer> {
  /** Adds a static item; the handle removes it. */
  add(item: T): Handle & Disposer;
  /**
   * Adds a derivation run at each reload: a server's catalog, or wrapping
   * another plugin's item. `siblings` are the other registries as of this
   * reload, so prompt can read tools in the same pass.
   */
  add(derive: (draft: RegistryDraft<T>, siblings: Registries<S>) => void): Disposer;
  /** Returns the items materialised after the last reload; the system prompt names the real set. */
  list(): readonly T[];
}
/**
 * Returns the mutable set a derivation edits during one reload.
 *
 * @category plugins
 * @since 0.1.0
 */
interface RegistryDraft<T> {
  /** Adds or replaces an item. */
  set(id: string, item: T): void;
  /** Returns an item, or undefined. */
  get(id: string): T | undefined;
  /** Removes an item. */
  delete(id: string): void;
  /** Returns every id in the draft. */
  ids(): readonly string[];
  /** Replaces one item's behaviour, keeping its identity. */
  wrap(id: string, wrap: (inner: T) => T): void;
}
/**
 * Describes a setting a plugin contributes.
 *
 * @category plugins
 * @since 0.1.0
 */
interface SettingDefinition<T = unknown> {
  readonly id: string;
  readonly label: string;
  /** Choices, numbers, text, lists: the client renders from the JSON Schema. */
  readonly schema: Schema<T>;
  /** For enum schemas: labels and a badge shown while current. */
  readonly choices?: readonly { readonly value: T; readonly label: string; readonly badge?: string }[];
  readonly default: T;
  readonly scope: "host" | "session";
}
/**
 * Returns a plugin's handle on its own setting, from `contribute.settings.add`.
 *
 * @category plugins
 * @since 0.1.0
 */
interface Setting<T = unknown> {
  /** Returns the current value. */
  get(): Promise<T>;
  /** Stores a value. */
  set(value: T): Promise<void>;
  /**
   * Yields the value as any host or client changes it, until deactivation.
   *
   * @stream watch
   */
  watch(): AsyncIterable<T>;
}
/**
 * Describes a palette command and what it runs.
 *
 * @category plugins
 * @since 0.1.0
 */
interface Command<Args = unknown, S extends Side = Side> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Absent = runs on pick. */
  readonly arguments?: Schema<Args>;
  readonly category?: string;
  readonly keywords?: readonly string[];
  /** Runs the command: text shows; a prompt is sent by core with source action `{ label: title, command: name }`. */
  run(args: Args, context: { readonly signal: AbortSignal; readonly api: PluginApi<S> }): Awaitable<string | { readonly prompt: UserContent } | void>;
}
/**
 * Describes an agent preset: model, prompt and tools.
 *
 * @category plugins
 * @since 0.1.0
 */
interface Agent {
  readonly id: string;
  readonly description?: string;
  /** Default all. */
  readonly mode?: "primary" | "subagent" | "all";
  readonly model?: ModelRef;
  /**
   * The agent's prompt section, layered or replacing.
   *
   * **Details**
   *
   * The system prompt is sections: builtins (system-prompt 0, tools, rules,
   * cwd, skills, project-context), `Resources.prompt` from SYSTEM.md /
   * APPEND_SYSTEM.md, and plugins'. `layer` adds one more at an order.
   * `replace` makes the whole prompt this text, every section suppressed,
   * byte for byte: what a cached reviewer role needs. Tools are declared
   * through the API, not the prompt, so replace hides guidance, never a tool.
   * When several replace: `sessions.create({ prompt })` › `Agent.prompt` ›
   * project SYSTEM.md › user SYSTEM.md.
   */
  readonly prompt?: PromptOverride;
  /** By name; omitted = every tool the session has. */
  readonly tools?: readonly string[];
}
/**
 * Returns a prompt change: one more section at an order, or the whole prompt
 * replaced.
 *
 * @see {@link Agent.prompt}
 * @category plugins
 * @since 0.1.0
 */
type PromptOverride = { readonly kind: "layer"; readonly text: string; readonly order?: number } | { readonly kind: "replace"; readonly text: string };
/**
 * Describes one system prompt section.
 *
 * **Details**
 *
 * Order is 0..9999, default 100; declared as `<order>-<id>` so the model is
 * told when one changes. Ids are global: a later source overrides
 * "system-prompt" on purpose.
 *
 * @category plugins
 * @since 0.1.0
 */
interface PromptSection { readonly id: string; readonly text: string; readonly order?: number }
/**
 * Describes one model's context limits; folded into `ModelInfo` for that
 * model.
 *
 * @category plugins
 * @since 0.1.0
 */
interface ModelContextPolicy { readonly model: ModelRef; readonly contextWindow: number; readonly compactAt: number }
/**
 * Describes a skill the model can load on demand.
 *
 * @category plugins
 * @since 0.1.0
 */
interface Skill { readonly name: string; readonly description: string; readonly location: string; readonly modelInvocable?: boolean; load(): Promise<string> }
/**
 * Binds a key to a command, optionally under a context.
 *
 * @category plugins
 * @since 0.1.0
 */
interface Keybinding { readonly key: string; readonly command: string; readonly when?: string }
/**
 * Returns what woke a durable wait.
 *
 * **Outcomes**
 *
 * - `run`: the awaited run ended; `end` is how.
 * - `job`: the awaited job ended.
 * - `part`: the modal part was answered; `answer` null = dismissed or closed.
 * - `timer`: the timer fired.
 * - `deadline`: the deadline passed first.
 * - `input`: `untilInput` and the user sent `message`.
 * - `all`: every target settled; `outcomes` in target order.
 * - `stopped`: this run was stopped while parked; return promptly.
 *
 * @category durability
 * @since 0.1.0
 */
type WaitOutcome =
  | { readonly kind: "run"; readonly session: SessionId; readonly run: RunId; readonly end: RunEnd }
  | { readonly kind: "job"; readonly job: JobId; readonly end: JobEnd }
  | { readonly kind: "part"; readonly part: PartId; readonly answer: { readonly action: string; readonly input: Json } | null }
  | { readonly kind: "timer" }
  | { readonly kind: "deadline" }
  | { readonly kind: "input"; readonly message: MessageId }
  | { readonly kind: "all"; readonly outcomes: readonly WaitOutcome[] }
  | { readonly kind: "stopped" };
/**
 * Returns what a tool call produced: content for the model, typed output for
 * clients, and parts to show.
 *
 * @category tools
 * @since 0.1.0
 */
interface ToolResult<Output> {
  /** What the model reads: text, files (an image a read returned, a screenshot). One shape; text is `{ kind: "text" }`. */
  readonly content: readonly ToolContent[];
  /** Validated against `ToolDefinition.output`; what clients and codemode read. */
  readonly output?: Output;
  /** Parts this call created and wants shown with it. */
  readonly parts?: readonly PartId[];
}
/**
 * Returns one piece of tool content: text or a file.
 *
 * **Details**
 *
 * The model filters files by `ModelInfo.input`, as for `UserContent`.
 *
 * @category tools
 * @since 0.1.0
 */
type ToolContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly blob: BlobId; readonly mime: string; readonly name?: string };
/**
 * Returns how a tool call settled.
 *
 * **Outcomes**
 *
 * - `ok`: the call returned; `content` is what the model reads.
 * - `failed`: the tool threw or returned invalid output; the model sees `message`.
 * - `interrupted`: replay never and the host died mid-call; it may have partially run. The model is told exactly that.
 * - `rejected`: `before_tool` said no; it never ran.
 * - `stopped`: the run was stopped during the call.
 *
 * @category tools
 * @since 0.1.0
 */
type ToolOutcome =
  | { readonly kind: "ok"; readonly content: readonly ToolContent[]; readonly output: Json | null; readonly parts: readonly PartId[] }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "interrupted" }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "stopped" };
/**
 * Returns a tool's progress report, drawn on its part.
 *
 * @category tools
 * @since 0.1.0
 */
interface ToolProgress {
  /** One line, replaces the previous. Sent as a patch; never logged. */
  readonly text?: string;
  /** 0..1 when known. */
  readonly fraction?: number;
  /** For a renderer that knows the tool. */
  readonly detail?: Json;
}

/**
 * Names what a durable wait parks on, with an optional deadline.
 *
 * **Details**
 *
 * - `run`: a sync subagent's run.
 * - `job`: a job's exit.
 * - `part`: a modal part; an action settles it.
 * - `timer`: a point in time.
 *
 * @category durability
 * @since 0.1.0
 */
type WaitTarget = { readonly deadline?: number } & (
  | { readonly kind: "run"; readonly session: SessionId; readonly run: RunId }
  | { readonly kind: "job"; readonly job: JobId }
  | { readonly kind: "part"; readonly part: PartId }
  | { readonly kind: "timer"; readonly until: number }
);

// 4b. Environment provider

/**
 * Names what an environment sees: equal identities see the same files at
 * the same paths.
 *
 * **Details**
 *
 * Local: a stable id for the folder, not its path.
 *
 * @category environment
 * @since 0.1.0
 */
type EnvironmentIdentity = string & { readonly __brand: "environment-identity" };
/**
 * Returns what tools run against: files and exec, from the provider. Core
 * never reaches a filesystem except through it.
 *
 * @category environment
 * @since 0.1.0
 */
interface ExecutionEnv {
  readonly identity: EnvironmentIdentity;
  readonly cwd: string;
  readonly files: FilesApi;
  /**
   * Starts a process as a job tied to the caller's signal; every process is
   * a job.
   *
   * **When to use**
   *
   * For a process the caller waits on. `jobs.start` is the background path,
   * with a report.
   */
  exec(command: string | readonly string[], options?: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>>; readonly signal?: AbortSignal; readonly pty?: { readonly columns: number; readonly rows: number } }): Promise<Job>;
  /** Detaches from the environment. */
  close(): Promise<void>;
}
/**
 * Layers behaviour on files and exec for one session, or adds a browser or
 * a browser; identity and cwd pass through.
 *
 * @category environment
 * @since 0.1.0
 */
type EnvironmentWrap = (inner: ExecutionEnv) => ExecutionEnv & { readonly browser?: BrowserApi };
/**
 * Takes and compares content-addressed snapshots of an environment's tree:
 * before and after each run, the changes between two, and their patches.
 *
 * @category environment
 * @since 0.1.0
 */
interface SnapshotsApi { before(run: RunId): Promise<SnapshotId>; after(run: RunId): Promise<SnapshotId>; diff(from: SnapshotId, to: SnapshotId): Promise<ChangeSet>; patches(from: SnapshotId, to: SnapshotId, paths: readonly string[], options?: DiffOptions): Promise<readonly PatchEntry[]> }
/**
 * Describes what a core plugin supplies to serve a workspace kind.
 *
 * **Details**
 *
 * `Capability<T>` on the workspace is derived from which of these the
 * provider supplies and which the principal may use.
 *
 * **Example** (A chat-only provider)
 *
 * ```ts
 * declare const emptyEnv: ExecutionEnv;
 *
 * const chatOnly = {
 *   kind: "chat-only",
 *   inspect: async () => ({
 *     identity: emptyEnv.identity,
 *     availability: { kind: "available" },
 *     projectSources: [],
 *   }),
 *   attach: async () => emptyEnv,
 * } satisfies EnvironmentProvider;
 *
 * export default { id: "chat-only", environment: chatOnly } satisfies Plugin<"core">;
 * ```
 *
 * @category environment
 * @since 0.1.0
 */
interface EnvironmentProvider {
  /** "local", "sandbox", "chat-only"... */
  readonly kind: string;
  /** Resolves identity, availability and project sources; opens nothing. */
  inspect(target: WorkspaceTarget): Promise<{ readonly identity: EnvironmentIdentity; readonly availability: Availability; readonly projectSources: readonly string[] }>;
  /** Binds a folder, boots or joins a VM, connects a sandbox: the tools' hands. `close()` detaches; `destroy()` tears down. */
  attach(target: WorkspaceTarget): Promise<ExecutionEnv>;
  /** Required for local and sandbox; `undefined` for an environment that serves no git (a sandbox without it), which the workspace answers as `unsupported`. */
  readonly git?: (env: ExecutionEnv) => GitApi | undefined;
  /** Required wherever files are served: content-addressed trees before and after each run; `undefined` for an environment that keeps none. */
  readonly snapshots?: (env: ExecutionEnv) => SnapshotsApi | undefined;
  /** Supplies a browser capability. */
  readonly browser?: (env: ExecutionEnv) => BrowserApi;
  /** Tears down remote sandboxes; local providers reject. */
  destroy?(target: WorkspaceTarget): Promise<void>;
}

// 4c. Driver and maintenance leaves

/**
 * Names which sessions a host runs.
 *
 * **Details**
 *
 * `sessions` includes future heads and children.
 *
 * @category host
 * @since 0.1.0
 */
type ExecutionCoverage =
  | { readonly kind: "all" }
  | { readonly kind: "workspace"; readonly workspace: WorkspaceId }
  | { readonly kind: "sessions"; readonly sessions: readonly SessionId[] };
/**
 * Returns what one leased kernel step did; the driver schedules the next.
 *
 * **Outcomes**
 *
 * - `continue`: more work is ready; advance again.
 * - `idle`: nothing to do.
 * - `waiting`: parked until `until`; null = a durable wait with no timer, whose wake obligation remains.
 * - `retry`: a provider retry is due `until`.
 * - `busy`: another host holds the lease until `until`.
 * - `fenced`: this host's lease was taken; stop driving.
 *
 * @category host
 * @since 0.1.0
 */
type AdvanceReport =
  | { readonly kind: "continue" }
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly until: number | null }
  | { readonly kind: "retry"; readonly until: number }
  | { readonly kind: "busy"; readonly until: number }
  | { readonly kind: "fenced" };
/**
 * Returns one page of heads owed a step that no wake reached.
 *
 * @category host
 * @since 0.1.0
 */
interface RepairPage { readonly runnable: readonly { readonly session: SessionId; readonly head: HeadName }[]; readonly next: Cursor | null }
/**
 * Returns what `prune` collected: unreachable history; `retained` = pinned
 * by a ref.
 *
 * @category host
 * @since 0.1.0
 */
interface PruneReport { readonly objects: number; readonly bytes: number; readonly retained: number }
/**
 * Returns one paired principal and its authority.
 *
 * @category host
 * @since 0.1.0
 */
interface PrincipalView { readonly id: PrincipalId; readonly label: string; readonly authority: ReadonlySet<Authority>; readonly pairedAt: number }
/**
 * Returns the preflight `open` runs: per-plugin outcomes and collisions;
 * touches nothing.
 *
 * @category host
 * @since 0.1.0
 */
interface PluginCheckReport { readonly plugins: readonly PluginLoadOutcome[]; readonly collisions: readonly ValidationIssue[] }
/**
 * Returns the new catalog generation and per-plugin outcomes of a
 * replacement.
 *
 * @category host
 * @since 0.1.0
 */
interface PluginReplacementReport { readonly generation: CatalogGeneration; readonly plugins: readonly PluginLoadOutcome[] }
/**
 * Returns how one plugin loaded.
 *
 * **Outcomes**
 *
 * - `activated`: loaded; `issues` are warnings.
 * - `rejected`: could not parse; on replace, the previous stays as `kept-previous`.
 * - `kept-previous`: the replacement failed; the previous version still runs.
 *
 * @category host
 * @since 0.1.0
 */
type PluginLoadOutcome =
  | { readonly kind: "activated"; readonly id: string; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "rejected"; readonly id: string; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "kept-previous"; readonly id: string; readonly issues: readonly ValidationIssue[] };
/**
 * Returns one stored object, decoded, for maintenance reads.
 *
 * @category host
 * @since 0.1.0
 */
interface DecodedObjectView { readonly id: ObjectId; readonly kind: string; readonly parent: CommitId | null; readonly body: Json; readonly at: number }
/**
 * Returns whether a session's refs and objects are consistent, and what is
 * not.
 *
 * @category host
 * @since 0.1.0
 */
interface IntegrityReport { readonly ok: boolean; readonly issues: readonly { readonly ref: string | null; readonly object: CommitId | null; readonly message: string }[] }
/**
 * Returns one problem found while validating input or loading a plugin.
 *
 * @category errors
 * @since 0.1.0
 */
interface ValidationIssue { readonly severity: "error" | "warning"; readonly path: readonly (string | number)[]; readonly message: string; readonly source?: { readonly plugin: string; readonly file?: string; readonly line?: number } }

// 4c-bis. Resources

/**
 * Returns what core scanned for a session: user and project files, skills,
 * context files, prompt files and prompt templates.
 *
 * **Details**
 *
 * After pi's resource loader, under `.nyte`, plus the agentskills.io
 * convention (`.agents/skills`) shared with other tools:
 *
 * - user: `~/.nyte/{skills,prompts,plugins}`, `~/.nyte/SYSTEM.md`,
 *   `~/.nyte/APPEND_SYSTEM.md`, `~/.nyte/AGENTS.md`, `~/.agents/skills`.
 * - project: `.nyte/{skills,prompts,plugins}`, `.nyte/SYSTEM.md`,
 *   `.nyte/APPEND_SYSTEM.md`, `.agents/skills`, and AGENTS.override.md ›
 *   AGENTS.md › CLAUDE.md in the workspace root and every ancestor up to /,
 *   root first; a git worktree's file shadows the main repository's by real
 *   path. Hidden entirely when `projectResources` is false.
 * - extra: skill paths from the host setting "skills.paths": a directory or
 *   a .md.
 *
 * Plugins consume the result and may add sources of their own: a plugin that
 * knows another source (a company registry) adds through
 * `contribute.skills`; nothing in core is the last word on where skills live.
 *
 * @category resources
 * @since 0.1.0
 */
interface Resources {
  /** The local provider attached at the host home (its `.nyte` and `.agents` are under it); null when no local provider is registered (a durable object). The host machine is just another target of the local provider. */
  readonly user: FilesApi | null;
  /** Rooted at the workspace root (its `.nyte` and `.agents` are under it); null when projectResources is false or absent. */
  readonly project: FilesApi | null;
  /** Deduplicated by name, project wins; collisions reported on `HostView.plugins[].issues`. */
  readonly skills: readonly { readonly name: string; readonly location: string; readonly scope: "user" | "project" | "path"; readonly description: string }[];
  /** In prompt order: user, ancestors root-first, project. */
  readonly contextFiles: readonly { readonly path: string; readonly scope: "user" | "ancestor" | "project"; readonly content: string }[];
  /** SYSTEM.md replaces, APPEND_SYSTEM.md appends; project wins over user. */
  readonly prompt: { readonly system: string | null; readonly append: string | null; readonly scope: "user" | "project" | null };
  /** Reusable prompt templates, for commands. */
  readonly prompts: readonly { readonly name: string; readonly location: string; readonly scope: "user" | "project" }[];
}

// 4d. A plugin's own model request

/**
 * Describes a plugin's own model request: not a run, so no tools, no
 * transcript and no parts.
 *
 * **Details**
 *
 * Charged to the session and reported on `after_request` with step
 * "plugin".
 *
 * **Example** (The rename plugin)
 *
 * ```ts
 * import { z } from "zod";
 *
 * declare const api: PluginApi<"core">;
 * declare const transcriptText: string;
 *
 * const { configuration } = await api.session.view();
 * if (configuration.effective !== null) {
 *   const title = await api.request({
 *     model: configuration.effective.model,
 *     system: "Name this chat in five words.",
 *     messages: [{ role: "user", content: transcriptText }],
 *     output: z.object({ title: z.string().max(60) }),
 *   });
 *   if (title.kind === "ok") await api.session.update({ name: title.value.title });
 * }
 * ```
 *
 * @category plugins
 * @since 0.1.0
 */
interface ModelRequestInput<T = string> {
  /** Any catalog model; the session's effective one is `api.session.view().configuration.effective.model`. */
  readonly model: ModelRef;
  readonly system?: string;
  /** Provider-facing messages: build from `view.messages`, or hand-write a user turn. */
  readonly messages: readonly ModelMessage[];
  /** Default off. */
  readonly thinking?: Thinking;
  /** Structured output: the provider is asked for JSON matching it; the result is validated. */
  readonly output?: Schema<T>;
  readonly maxOutput?: number;
  readonly signal?: AbortSignal;
}
/**
 * Returns the result of a plugin's model request.
 *
 * **Outcomes**
 *
 * - `ok`: `value` is text, or the parsed structured output; `stop` says whether it ran out of length.
 * - `refused`: the provider refused; no retry.
 * - `failed`: `failure` after the provider retry policy.
 *
 * @category plugins
 * @since 0.1.0
 */
type ModelRequestOutcome<T = string> =
  | { readonly kind: "ok"; readonly value: T; readonly usage: Usage; readonly stop: "end" | "length" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly failure: Failure };

// 5. Plugins

/**
 * Returns `T` or a promise of `T`.
 *
 * @category schemas
 * @since 0.1.0
 */
type Awaitable<T> = T | Promise<T>;

/**
 * Maps each side to what it adds to the plugin api and to the plugin object.
 * Table 1 of three; every other plugin type is derived.
 *
 * @category plugins
 * @since 0.1.0
 */
type SideTable = {
  core: {
    api: {
      /** Activated once per session; the real handle. */
      readonly session: Session;
      /** The session's environment. */
      readonly env: ExecutionEnv;
      /** Layers on the environment; may add a browser to one that lacks it: the desktop adds its viewport browser to local. */
      wrapEnv(wrap: EnvironmentWrap): Disposer;
      /** What core scanned for this session; gated by projectResources. Skills and context files read this, never the raw tree. */
      readonly inputs: Resources;
      /** Sends one non-turn request, charged to the session. Nothing streams; nothing is a run. */
      request<T = string>(input: ModelRequestInput<T>): Promise<ModelRequestOutcome<T>>;
    };
    plugin: { readonly environment?: EnvironmentProvider };
  };
  client: { api: ClientApi; plugin: {} };
};
/**
 * Names a plugin side: core or client.
 *
 * **Details**
 *
 * There is no desktop, tui or web side. A client plugin cannot know which
 * app hosts it, as a tool cannot know which environment runs it. It declares
 * what it renders for; the client mounts what it can.
 *
 * @category plugins
 * @since 0.1.0
 */
type Side = keyof SideTable;

/**
 * Returns what a client plugin's api adds: the client, the session on
 * screen, and notifications.
 *
 * **Details**
 *
 * Asking is a part some plugin declared, rendered by that plugin's renderer.
 * A client plugin that wants a dialog creates that part on its own
 * connection. There is no dialog API on any side.
 *
 * **Example** (A client plugin that asks once at startup, with a part it declares)
 *
 * ```tsx
 * import type { Plugin } from "@nyte-ai/plugin/client";
 * import { z } from "zod";
 *
 * const consent = definePart({
 *   kind: "welcome/consent",
 *   state: z.object({}),
 *   actions: { yes: { input: z.object({}) }, no: { input: z.object({}) } },
 *   fallback: () => "Enable telemetry?",
 * });
 *
 * export default {
 *   id: "welcome",
 *   contribute: {
 *     renderers: [
 *       {
 *         kind: consent,
 *         framework: "react",
 *         render: (_part, act) => <Dialog onYes={() => act("yes", {})} onNo={() => act("no", {})} />,
 *       },
 *     ],
 *   },
 *   hooks: {
 *     app_ready: async (_event, { api }) => {
 *       if (api.session === null) return;
 *       const part = await api.session.parts.create(consent, { state: {}, placement: { kind: "modal" } });
 *       const answer = await part.answer();
 *       if (answer !== null) await api.storage.set("telemetry", answer.action === "yes");
 *     },
 *   },
 * } satisfies Plugin;
 * ```
 *
 * @category plugins
 * @since 0.1.0
 */
interface ClientApi {
  /** "desktop", "tui", "web", "acme-portal": informational. Branch on frameworks, never on name. */
  readonly client: { readonly name: string; readonly frameworks: readonly string[] };
  /** The one on screen. */
  readonly session: Session | null;
  readonly ui: {
    /** Shows a notification. */
    notify(input: { readonly title?: string; readonly message: string; readonly level?: "info" | "warning" | "error"; readonly sound?: boolean }): void;
  };
}

/**
 * Describes how a client plugin draws one part kind in one framework.
 *
 * @category plugins
 * @since 0.1.0
 */
interface Renderer<K extends PartDefinition = PartDefinition, View = unknown> {
  /** Import type from the core plugin for typed state; unknown otherwise. */
  readonly kind: K;
  /** What render returns; a client mounts renderers for its framework and draws fallback for the rest. A plugin may ship one per framework. */
  readonly framework: "react" | "tui" | string;
  /** Which placement kinds this renderer draws; omitted = any. */
  readonly placements?: readonly string[];
  /** Returns the framework's view for a part's state. */
  render(part: { readonly state: PartState<K>; readonly version: number; readonly placement: Placement }, act: Part<K>["act"]): View;
}

/**
 * Returns one contribution row: item type, owning sides, and what `add`
 * returns.
 *
 * @category plugins
 * @since 0.1.0
 */
type Row<Item, S extends Side, Handle = Disposer> = { readonly item: Item; readonly sides: S; readonly handle: Handle };
/**
 * Maps each contribution kind to its item type and the sides that may own
 * it. Table 2 of three; adding a contribution is one row.
 *
 * **Details**
 *
 * Status, panels, dialogs and decorations are not contribution kinds: they
 * are parts with a placement. `settings.add()` returns the `Setting` handle,
 * so the plugin reads and watches its own value.
 *
 * @category plugins
 * @since 0.1.0
 */
type ContributionTable = {
  tools: Row<ToolDefinition, "core">;
  prompt: Row<PromptSection, "core">;
  agents: Row<Agent, "core">;
  modelContext: Row<ModelContextPolicy, "core">;
  skills: Row<Skill, "core">;
  parts: Row<PartDefinition, "core">;
  commands: Row<Command, Side>;
  settings: Row<SettingDefinition, Side, Setting<unknown>>;
  renderers: Row<Renderer, "client">;
  keybindings: Row<Keybinding, "client">;
};

/**
 * Returns the rows of a table whose sides overlap `S`.
 *
 * @category plugins
 * @since 0.1.0
 */
type Available<Table, S extends Side> = {
  [K in keyof Table as Table[K] extends { readonly sides: infer Owners }
    ? [Extract<S, Owners>] extends [never] ? never : K
    : never]: Table[K];
};
/**
 * Returns one registry per contribution kind available to a side.
 *
 * @category plugins
 * @since 0.1.0
 */
type Registries<S extends Side> = {
  readonly [K in keyof Available<ContributionTable, S>]: K extends "settings"
    ? SettingsRegistry<S>
    : Registry<ContributionTable[K & keyof ContributionTable]["item"], S, ContributionTable[K & keyof ContributionTable]["handle"]>;
};

/**
 * Returns the settings registry: a registry that also reads the settings
 * this plugin declared, statically in `contribute.settings` or through
 * `add`, so no plugin declares a setting twice to hold its handle (§48b).
 *
 * @category plugins
 * @since 0.1.0
 */
interface SettingsRegistry<S extends Side = Side> extends Registry<SettingDefinition, S, Setting<unknown>> {
  /**
   * Returns the current value of a setting this plugin declared: the
   * session layer, else the host value, else the default.
   *
   * @throws {SdkError} unknown when this plugin declares no setting with this id.
   */
  value(id: string): Promise<unknown>;
  /**
   * Yields the value of a setting this plugin declared, then each change,
   * until the plugin deactivates.
   *
   * @stream watch
   * @throws {SdkError} unknown when this plugin declares no setting with this id.
   */
  watch(id: string): AsyncIterable<unknown>;
}
/**
 * Returns the static contribution arrays a plugin may declare for a side.
 *
 * @category plugins
 * @since 0.1.0
 */
type Declared<S extends Side> = {
  readonly [K in keyof Available<ContributionTable, S>]?: readonly ContributionTable[K & keyof ContributionTable]["item"][];
};

/**
 * Returns the `before_send` payload; modify replaces the whole value.
 *
 * @category hooks
 * @since 0.1.0
 */
interface Submission {
  readonly content: UserContent;
  readonly source: MessageSource;
  readonly delivery: Delivery;
  readonly configuration: Configuration | ConfigurationPatch | null;
  readonly replace: MessageId | null;
}
/**
 * Returns the `transform_context` payload: what the kernel assembled for
 * this request, before the system frame.
 *
 * @category hooks
 * @since 0.1.0
 */
interface ModelContext {
  /** The rendered prompt sections. */
  readonly system: string;
  /** The conversation as the model will read it, without system messages. */
  readonly messages: readonly ModelMessage[];
}
/**
 * Returns the `transform_transcript` payload: after every
 * `transform_context`, the exact request body. The handler owns it.
 *
 * @category hooks
 * @since 0.1.0
 */
interface Transcript {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolInfo[];
}
/**
 * Returns the `before_compaction` payload: a plugin may change what is
 * summarised, or supply the summary and skip the model.
 *
 * @category hooks
 * @since 0.1.0
 */
interface CompactionPlan {
  readonly model: ModelRef;
  readonly reason: "manual" | "threshold" | "overflow";
  readonly instructions: string | null;
  readonly tokensBefore: number;
  readonly summarise: readonly ModelMessage[];
  /** The retained tail. */
  readonly keep: readonly ModelMessage[];
  /** Set it and core writes the compaction part without a request; material is provider-opaque (encrypted Responses compaction). */
  readonly result: { readonly kind: "summary"; readonly text: string } | { readonly kind: "material"; readonly provider: string; readonly api: string; readonly model: string; readonly data: Json; readonly usage: Usage | null } | null;
}
/**
 * Returns the `before_request` payload, per provider request.
 *
 * @category hooks
 * @since 0.1.0
 */
interface ModelRequest {
  readonly model: ModelRef;
  readonly thinking: Thinking;
  readonly step: "assistant" | "compaction" | "summary";
  readonly attempt: number;
  readonly options: { readonly sampling: Readonly<Record<string, Json>>; readonly headers: Readonly<Record<string, string>> };
}
/**
 * Returns the `before_tool` payload; modify replaces args and later handlers
 * see the change.
 *
 * @category hooks
 * @since 0.1.0
 */
interface ToolCall {
  readonly call: CallId;
  readonly name: string;
  readonly args: Json;
  readonly class: ToolClass;
}
/**
 * Returns the client-side `before_submit` payload: the composer's content on
 * Enter.
 *
 * @category hooks
 * @since 0.1.0
 */
interface SubmitDraft {
  readonly content: UserContent;
  readonly delivery: Delivery;
  readonly session: SessionId;
}

/**
 * Returns a decide hook's verdict.
 *
 * **Outcomes**
 *
 * - `continue`: no opinion; the next handler decides.
 * - `modify`: replace the value; later handlers see `value`.
 * - `reject`: short-circuit; the operation is refused with `reason`.
 * - `error`: fail the operation with `message`.
 *
 * @category hooks
 * @since 0.1.0
 */
type Decision<Value> =
  | { readonly action: "continue" }
  | { readonly action: "modify"; readonly value: Value }
  | { readonly action: "reject"; readonly reason: string }
  | { readonly action: "error"; readonly message: string };
/**
 * Returns an observe row: the result is ignored and awaited by the
 * dispatcher, never by the operation.
 *
 * @category hooks
 * @since 0.1.0
 */
type Observe<Event, S extends Side> = { event: Event; result: void; sides: S; phase: "observe" };
/**
 * Returns a transform row: handlers chain, each seeing the previous result.
 *
 * @category hooks
 * @since 0.1.0
 */
type Transform<Value, S extends Side> = { event: Value; result: Value; sides: S; phase: "transform" };
/**
 * Returns a decide row: handlers return a {@link Decision}; reject
 * short-circuits, error fails the operation.
 *
 * @category hooks
 * @since 0.1.0
 */
type Decide<Value, S extends Side> = { event: Value; result: Decision<Value>; sides: S; phase: "decide" };
/**
 * Maps each hook to its event, result, sides and phase. Table 3 of three;
 * adding a hook is one row.
 *
 * **Details**
 *
 * Phases:
 *
 * - observe: result ignored; awaited by the dispatcher, never by the operation.
 * - transform: handlers chain; each sees the previous result.
 * - decide: continue | modify | reject | error; reject short-circuits, error
 *   fails the operation.
 *
 * Lifecycle, core, per session: create instance → install declared
 * contribute/hooks → await activate, in host registration order →
 * `session_activated`. Activation failure rolls back. A turn: send →
 * `before_send` → admission → `run_started` → `transform_context` →
 * `transform_transcript` → [`before_compaction` → compact]? →
 * `before_request` → model → [`before_tool` → execute → `after_tool`]* →
 * (another model request, from `transform_context`)* → `run_ended`.
 * Teardown: abort signal → remove contributions.
 *
 * Lifecycle, client, per app: mount → install declared → await activate →
 * `app_ready` (sends admitted after this) → `session_opened` →
 * `before_submit` per Enter → `session_closed` on switch → `app_closing`.
 * Parts are usable from `app_ready` on; their answers never gate the app.
 *
 * Handlers run by ascending order, then registration sequence. Declared
 * hooks register before that plugin's activate.
 *
 * **Example** (A consent gate on before_tool)
 *
 * ```ts
 * import type { Plugin } from "@nyte-ai/plugin/core";
 *
 * declare const approve: PartDefinition<{ readonly command: string }>;
 *
 * export default {
 *   id: "shell-gate",
 *   hooks: {
 *     before_tool: async (call, { api, wait }) => {
 *       if (call.class.kind !== "shell") return { action: "continue" };
 *       const part = await api.session.parts.create(approve, {
 *         state: { command: call.class.command },
 *         placement: { kind: "modal" },
 *       });
 *       const outcome = await wait({ kind: "part", part: part.id });
 *       return outcome.kind === "part" && outcome.answer?.action === "allow"
 *         ? { action: "continue" }
 *         : { action: "reject", reason: "The user declined." };
 *     },
 *   },
 * } satisfies Plugin;
 * ```
 *
 * @category hooks
 * @since 0.1.0
 */
type HookTable = {
  // core, per session
  /** After a session's plugins activate. */
  session_activated: Observe<{ readonly session: Session }, "core">;
  /** Every caller: user, tool, child, job. */
  before_send: Decide<Submission, "core">;
  /** When a run starts. */
  run_started: Observe<RunView, "core">;
  /** Rewrites what the kernel assembled for a request. */
  transform_context: Transform<ModelContext, "core">;
  /** Rewrites the exact request body. */
  transform_transcript: Transform<Transcript, "core">;
  /** Changes what is summarised, or supplies the summary. */
  before_compaction: Transform<CompactionPlan, "core">;
  /** Changes model, thinking or options per provider request. */
  before_request: Transform<ModelRequest, "core">;
  /** Allows, rewrites or rejects a tool call. */
  before_tool: Decide<ToolCall, "core">;
  /** Redaction and truncation rewrite what the model sees. */
  after_tool: Transform<ToolOutcome, "core">;
  /** What a telemetry plugin reads. */
  after_request: Observe<{ readonly model: ModelRef; readonly thinking: Thinking; readonly usage: Usage; readonly durationMs: number; readonly step: "assistant" | "compaction" | "summary" | "plugin" }, "core">;
  /** When a run ends. */
  run_ended: Observe<RunEnd, "core">;
  // client, per app
  /** Any session this client can see; the notifier's hook. */
  run_ended_anywhere: Observe<{ readonly session: SessionId; readonly run: RunId; readonly end: RunEnd }, "client">;
  /** After client plugins activate; sends are admitted from here on. */
  app_ready: Observe<{ readonly restored: boolean }, "client">;
  /** When a session comes on screen. */
  session_opened: Observe<{ readonly session: Session }, "client">;
  /** UI sends only; calling `Head.send` directly bypasses it. */
  before_submit: Decide<SubmitDraft, "client">;
  /** When a session leaves the screen. */
  session_closed: Observe<{ readonly session: Session }, "client">;
  /** Before the app closes. */
  app_closing: Observe<void, "client">;
};
/**
 * Returns the hook names available to a side.
 *
 * @category hooks
 * @since 0.1.0
 */
type HookName<S extends Side> = keyof Available<HookTable, S>;
/**
 * Returns a hook handler's signature, inferred from {@link HookTable}.
 *
 * **Details**
 *
 * A core decide hook is a durable step: its context includes {@link Durable},
 * so it may park on a modal part. The budget covers compute, not the park.
 * This is how a consent gate lives on `before_tool`.
 *
 * @category hooks
 * @since 0.1.0
 */
type HookHandler<S extends Side, N extends HookName<S>> = (
  event: Readonly<HookTable[N & keyof HookTable]["event"]>,
  context: {
    readonly api: PluginApi<S>;
    /** This invocation's budget; before_compaction gets 300 s, others 5 s. Deactivation also fires it. */
    readonly signal: AbortSignal;
    readonly session: SessionId | null;
    readonly head: HeadName | null;
    readonly run: RunId | null;
  } & (HookTable[N & keyof HookTable]["phase"] extends "decide" ? (S extends "core" ? Durable : {}) : {}),
) => Awaitable<HookTable[N & keyof HookTable]["result"]>;
/**
 * Returns a hook entry: a handler, or a handler with an order.
 *
 * @category hooks
 * @since 0.1.0
 */
type HookEntry<S extends Side, N extends HookName<S>> =
  | HookHandler<S, N>
  | { readonly order?: number; readonly run: HookHandler<S, N> };

/**
 * Returns what a plugin's `activate` and handlers receive on a side.
 *
 * @category plugins
 * @since 0.1.0
 */
type PluginApi<S extends Side> = S extends Side
  ? {
      readonly side: S;
      /** Core: the host; client: the app's own connection. */
      readonly sdk: Connection;
      /** One registry per contribution kind on this side. */
      readonly contribute: Registries<S>;
      /** This plugin's storage. */
      readonly storage: PluginStorage;
      /** Deactivation: reload, removal, session or app closing. */
      readonly signal: AbortSignal;
      /** Registers a hook handler; the disposer removes it. */
      hook<N extends HookName<S>>(name: N, entry: HookEntry<S, N>): Disposer;
      /** Reports an issue at any time; shown live on `HostView.plugins[].issues`. An MCP server failing later reports here. */
      report(issue: ValidationIssue): void;
      /**
       * Re-derives this plugin's contributions against external state that
       * changed (an MCP server reconnected).
       *
       * **Details**
       *
       * A hot reload of what it offers, not of the plugin: that is
       * `host.plugins.replace`. A registry write already schedules one.
       */
      reload(): void;
    } & SideTable[S]["api"]
  : never;

/**
 * Returns a plugin for one side: an id, static contributions, hooks and an
 * activate function.
 *
 * **Details**
 *
 * One `Plugin<Side>`; three tables ({@link SideTable},
 * {@link ContributionTable}, {@link HookTable}) are the source of truth.
 * Composition is plain code: spread another plugin's contribute arrays into
 * yours and call its activate from your activate. No API.
 *
 * The subpath fixes the side, and authoring is `satisfies Plugin`; no
 * factory. Hook parameters are inferred from `HookTable`; the payload names
 * exist for hover and for anyone factoring a helper. No plugin imports them.
 *
 * **Example** (Authoring a core plugin)
 *
 * ```ts
 * import type { Plugin } from "@nyte-ai/plugin/core";
 *
 * export default {
 *   id: "hello",
 *   hooks: {
 *     before_compaction: (plan) => ({ ...plan, result: { kind: "summary", text: "hello world" } }),
 *   },
 * } satisfies Plugin;
 * ```
 *
 * @see {@link PluginApi}
 * @category plugins
 * @since 0.1.0
 */
type Plugin<S extends Side> = {
  readonly id: string;
  /** Static items; registries for derived ones. */
  readonly contribute?: Declared<S>;
  /** Hook handlers by name, installed before activate. */
  readonly hooks?: { readonly [N in HookName<S>]?: HookEntry<S, N> };
  /** Runs once per session on core, once per app on a client. */
  readonly activate?: (api: PluginApi<S>) => Awaitable<void>;
} & ([S] extends ["core"] ? SideTable["core"]["plugin"] : {});

/**
 * Maps each `@nyte-ai/plugin` subpath to its side-fixed `Plugin` type:
 * `@nyte-ai/plugin/core` is `Plugin<"core">`, `@nyte-ai/plugin/client` is
 * `Plugin<"client">`.
 *
 * @category packages
 * @since 0.1.0
 */
type SubpathExports = {
  [K in keyof { core: "core"; client: "client" } as `@nyte-ai/plugin/${K}`]: {
    readonly Plugin: Plugin<{ core: "core"; client: "client" }[K]>;
  };
};

// 6. Packages

/**
 * Names the kind of failure an {@link SdkError} carries.
 *
 * @category errors
 * @since 0.1.0
 */
type SdkErrorCode = "unauthenticated" | "denied" | "unknown" | "invalid" | "stale" | "unavailable" | "internal";
/**
 * Throws for acquisition failures and defects; domain results are outcomes,
 * never this.
 *
 * **Details**
 *
 * One error: core throws it, protocol serialises it, and the sdk rethrows the
 * same class.
 *
 * @category errors
 * @since 0.1.0
 */
declare class SdkError extends Error {
  readonly code: SdkErrorCode;
  /** The host that answered, when known. */
  readonly hostId: HostId | null;
  /** Set for `invalid`. */
  readonly issues: readonly ValidationIssue[];
  /** For `internal`; matches the host's logs. */
  readonly correlation: string | null;
}

// 7. Store

/**
 * Returns an open store: the objects and refs tables.
 *
 * **Details**
 *
 * Objects are immutable and content-addressed; they are written before any
 * publish, idempotently, outside anything atomic. Refs are the only mutable
 * thing; a publish is one `refs.set` batch, all or nothing, each entry with
 * its own expect. The log is the reflog: a set appends its events to the
 * session's log in the same write, and seq is the session's update counter.
 *
 * @category store
 * @since 0.1.0
 */
interface StoreConnection {
  readonly objects: ObjectStore;
  readonly refs: RefStore;
  /** Releases the connection. */
  close(): Promise<void>;
}
/**
 * Stores immutable, content-addressed objects and blobs.
 *
 * @category store
 * @since 0.1.0
 */
interface ObjectStore {
  /** Stores an object; id = hash(content), so a second put is a no-op. */
  put(object: Json): Promise<ObjectId>;
  /** Returns an object, or null. */
  get(id: ObjectId): Promise<Json | null>;
  /** Stores a large blob, streamed; still content-addressed. */
  putBlob(bytes: AsyncIterable<Uint8Array>): Promise<BlobId>;
  /** Returns a blob reader, or null. */
  blob(id: BlobId): Promise<ByteReader | null>;
}
/**
 * Reads and publishes refs, the only mutable state, and reads the log.
 *
 * **Details**
 *
 * Ref names, by prefix. Everything durable is one of these:
 *
 * - `sessions/<id>`: session record.
 * - `sessions/<id>/heads/<name>`: head tip (commit object).
 * - `sessions/<id>/inbox/<name>`: admitted inputs, in order (object: list of message ids).
 * - `sessions/<id>/seen/<principal>/<head>`: seen mark.
 * - `sessions/<id>/runs/<run>`: run record; the ref exists while the run is live.
 * - `sessions/<id>/parts/<part>`: part's current state version.
 * - `sessions/<id>/receipts/<receipt>`: `{ kind, digest, outcome | null }`.
 * - `sessions/<id>/calls/<call>`: a durable step: intent, memos, recorded acquisitions, wait.
 * - `sessions/<id>/journal/<principal>`: client-side only; the sdk's RequestJournal over the same interface.
 * - `workspaces/<id>`: workspace record.
 * - `kv/<scope>/<owner>/<key>`: settings, plugin storage, secrets (encrypted object).
 * - `sessions/<id>/leases/<head>`: `{ holder: HostId, instance, expiresAt }`; what an advance holds while a turn runs, renewed while it runs (`execution.cover` takes none). `holder` is the host, `instance` the kernel within it; `busy` and `fenced` compare both. `fenced` is this CAS answering stale.
 * - `host/identity`: `{ id: HostId, createdAt }`, written once, never moved.
 * - `host/settings`, `host/principals`, `host/catalog`.
 *
 * Receipts, memos and kv are refs, not tables: put-unless-exists is
 * `expect: "absent"`; settle and update are `expect: revision`.
 *
 * What each operation costs, as store calls: O(objects it writes) + one set.
 *
 * - send: put(message) · set([inbox/<head> +message, receipts/<id> pending]).
 * - landing: put(commit) · set([heads/<head> → commit, inbox/<head> −message, receipts/<id> settled]).
 * - token: no store call; a transient patch on the stream.
 * - part.update: put(state) · set([parts/<part> → state]).
 * - tool settled: put(outcome) · set([calls/<call> settled, parts/<part> → state, heads/<head> → commit]).
 * - run.stop: set([runs/<run> stopping]); the fence; the cleanup's set comes later.
 * - edit (replace): put(commit, message) · set([runs/<run> stopped, heads/<head> → parent, inbox +message, receipts/<id>]); one batch, one expect per entry.
 * - move: put(summary?) · set([heads/<head> → target, ...]).
 * - configure: put(choice) · set([sessions/<id> → record]).
 * - memo: put(value) · set([calls/<call>/memos/<name> expect absent]); stale = read the winner.
 * - watch: refs.log(after) then the live stream; no writes.
 *
 * Nothing reads more than it needs: a view is the fold of the log, cached in
 * memory per session; a cold start folds once.
 *
 * @category store
 * @since 0.1.0
 */
interface RefStore {
  /** Returns a ref, or null. */
  get(name: string): Promise<Ref | null>;
  /** Returns every ref under a prefix. */
  list(prefix: string): Promise<readonly Ref[]>;
  /**
   * Publishes a batch of ref updates: the one CAS. All or nothing; appends
   * the session's events in the same write.
   *
   * **Example** (Landing an input)
   *
   * ```ts
   * declare const refs: RefStore;
   * declare const commit: ObjectId;
   * declare const inbox: ObjectId;
   * declare const tip: Revision;
   * declare const event: DurableEvent;
   *
   * const outcome = await refs.set([
   *   { name: "sessions/s1/heads/main", target: commit, expect: tip, event },
   *   { name: "sessions/s1/inbox/main", target: inbox },
   * ]);
   * if (outcome.kind === "stale") console.log(outcome.name, outcome.revision);
   * ```
   *
   * @returns {@link SetOutcome}
   */
  set(updates: readonly RefUpdate[]): Promise<SetOutcome>;
  /** Returns the reflog after a seq, typed. */
  log(session: SessionId, after: Seq, limit: number): Promise<readonly SessionEvent[]>;
  /** Returns the session's latest seq. */
  tail(session: SessionId): Promise<Seq>;
}
/**
 * Returns a ref: its name, the object it points at, and its revision.
 *
 * @category store
 * @since 0.1.0
 */
interface Ref { readonly name: string; readonly target: ObjectId | null; readonly revision: Revision }
/**
 * Describes one entry of a ref publish.
 *
 * @category store
 * @since 0.1.0
 */
interface RefUpdate {
  readonly name: string;
  /** Null deletes. */
  readonly target: ObjectId | null;
  /** Omitted = unconditional. */
  readonly expect?: Revision | "absent";
  /** What this update means, for the log and the fold. */
  readonly event?: DurableEvent;
}
/**
 * Returns the result of a ref publish.
 *
 * **Outcomes**
 *
 * - `set`: every entry applied; `seq` is the log position, `revisions` in entry order.
 * - `stale`: `name` is the first entry whose expect failed; `revision` is current; nothing was written.
 *
 * @category store
 * @since 0.1.0
 */
type SetOutcome =
  | { readonly kind: "set"; readonly seq: Seq; readonly revisions: readonly Revision[] }
  | { readonly kind: "stale"; readonly name: string; readonly revision: Revision | null };

// 8. Events

/**
 * Returns one logged event with its seq and time.
 *
 * **Details**
 *
 * The log is the sequence of these. `watch()` on the host folds the log plus
 * the live stream; over the wire the same events travel and the sdk runs the
 * same fold. A reconnecting watch asks for the log after its last seq and
 * rejoins the live stream. `inspect().events()` reads the log raw.
 *
 * @category events
 * @since 0.1.0
 */
type SessionEvent = { readonly seq: Seq; readonly at: number } & DurableEvent;
/**
 * Returns what one ref update means: the durable events the fold consumes.
 *
 * **Details**
 *
 * Every ref update carries one. Each carries what the fold consumes inline;
 * objects stay content-addressed for storage.
 *
 * - `commit`: the head advanced to this commit.
 * - `head`: a move that wrote no commit.
 * - `part` `created`: `state` is the initial state; `owner` is the plugin
 *   that contributed the definition, null for an ownerless part.
 * - `input` `scheduled`: `position` is the message's index in the head's
 *   inbox after the change, so a reorder is a scheduled event.
 * - `request`: a provider request settled.
 * - `changes`: the session's changed files after a write-class call; the
 *   whole list, latest per path.
 * - `session`: name, pinned, archived, workspace.
 *
 * Ordering within one set: the entries' events are logged in entry order, so
 * a landing is [input landed, commit] and an edit is [run stopping, head
 * moved, input admitted]. The fold never sees a commit before the input it
 * lands.
 *
 * The fold is one function, `(view, event) → view`, structurally shared,
 * the same code in core and in the sdk. The log is the source of truth; the
 * view is a cache of folding it. A host that loses its in-memory view
 * rebuilds it from the log; a client that loses its socket resumes from seq.
 *
 * **Example** (Folding a run's end)
 *
 * ```ts
 * declare const events: readonly SessionEvent[];
 *
 * for (const event of events) {
 *   if (event.kind === "run" && event.change === "ended") {
 *     console.log(event.seq, event.run, event.end.kind);
 *   }
 * }
 * ```
 *
 * @see {@link PatchEvent}
 * @category events
 * @since 0.1.0
 */
type DurableEvent = { readonly head: HeadName | null } & (
  | { readonly kind: "commit"; readonly id: CommitId; readonly parent: CommitId | null; readonly run: RunId | null; readonly body: CommitBody }
  | { readonly kind: "head"; readonly from: CommitId | null; readonly to: CommitId | null; readonly reason: "moved" | "merged" | "created" | "removed" }
  | { readonly kind: "seen"; readonly principal: PrincipalId; readonly commit: CommitId | null }
  | { readonly kind: "input"; readonly message: MessageId } & (
      | { readonly change: "admitted"; readonly content: UserContent; readonly source: MessageSource; readonly delivery: Delivery; readonly schedule: Schedule; readonly covered: boolean; readonly configuration: Configuration; readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null }
      | { readonly change: "scheduled"; readonly schedule: Schedule; readonly position: number }
      | { readonly change: "landed"; readonly commit: CommitId; readonly run: RunId | null }
      | { readonly change: "withdrawn" }
      | { readonly change: "superseded"; readonly by: MessageId }
    )
  | { readonly kind: "run"; readonly run: RunId } & (
      | { readonly change: "started"; readonly view: RunView }
      | { readonly change: "phase"; readonly phase: "responding" | "executing" }
      | { readonly change: "waiting"; readonly on: WaitTarget }
      | { readonly change: "retrying"; readonly attempt: number; readonly until: number; readonly reason: string }
      | { readonly change: "stopping" }
      | { readonly change: "ended"; readonly end: RunEnd }
    )
  | { readonly kind: "part"; readonly part: PartId } & (
      | { readonly change: "created"; readonly partKind: string; readonly placement: Placement; readonly state: Json; readonly version: number; readonly run: RunId | null; readonly owner: string | null }
      | { readonly change: "updated"; readonly state: Json; readonly version: number }
      | { readonly change: "waiting"; readonly call: CallId }
      | { readonly change: "settled"; readonly commit: CommitId; readonly endedAt: number }
      | { readonly change: "failed"; readonly failure: Failure }
      | { readonly change: "closed" }
    )
  | { readonly kind: "call"; readonly call: CallId; readonly part: PartId } & (
      | { readonly change: "intent"; readonly name: string; readonly args: Json; readonly class: ToolClass }
      | { readonly change: "waiting"; readonly on: WaitTarget }
      | { readonly change: "settled"; readonly outcome: ToolOutcome; readonly changes: { readonly added: number; readonly removed: number; readonly paths: readonly string[] } | null }
    )
  | { readonly kind: "background"; readonly item: BackgroundItem }
  | { readonly kind: "configured"; readonly selected: Configuration | null; readonly effective: Configuration | null }
  | { readonly kind: "request"; readonly usage: Usage; readonly context: ContextView; readonly step: "assistant" | "compaction" | "summary" | "plugin" }
  | { readonly kind: "changes"; readonly files: readonly FileChange[] }
  | { readonly kind: "session"; readonly info: SessionInfo }
  | { readonly kind: "activation"; readonly activation: Activation }
  | { readonly kind: "catalog"; readonly catalog: SessionCatalogView }
);
/**
 * Returns the one event that is never logged: a transient patch to a live
 * part.
 *
 * **Details**
 *
 * `append` is a token for text or thinking; `markdown` is a text or thinking
 * part's whole text so far, replacing it; `progress` is a tool saying what it
 * is doing, replacing the last. Coalesced by the fold. The durable
 * `part.settled` carries the final state once.
 *
 * **Gotchas**
 *
 * A watch that starts or resumes mid-stream gets each streaming part's text
 * as one `markdown` patch, then new patches from there; old ones are gone.
 *
 * @category events
 * @since 0.1.0
 */
type PatchEvent = { readonly kind: "patch"; readonly part: PartId } & ({ readonly append: string } | { readonly markdown: string } | { readonly progress: ToolProgress });
/**
 * Returns what a commit holds: a user message, or a reference to a part's
 * settled version.
 *
 * **Details**
 *
 * A part commit carries only the id; its state travelled in part events.
 * Compaction and branch summary commits name the commits they replace.
 *
 * @category events
 * @since 0.1.0
 */
type CommitBody =
  | { readonly kind: "user"; readonly message: MessageId; readonly content: UserContent; readonly source: MessageSource; readonly delivery: Delivery; /** The parent's earlier user commits, in creation order; the fold appends this commit, whose id is its own content hash. */ readonly siblings: readonly CommitId[] }
  | { readonly kind: "part"; readonly part: PartId }
  | { readonly kind: "compaction"; readonly part: PartId; readonly replaces: readonly CommitId[] }
  | { readonly kind: "branchSummary"; readonly part: PartId; readonly replaces: readonly CommitId[] };
