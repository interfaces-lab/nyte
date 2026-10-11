import type {
  AdvanceReport,
  Authority,
  Awaitable,
  Cursor,
  DecodedObjectView,
  ExecutionCoverage,
  HeadName,
  HostDescription,
  HostId,
  IdentityChallenge,
  IntegrityReport,
  Owned,
  Paged,
  PluginCheckReport,
  PluginReplacementReport,
  PrincipalId,
  PrincipalView,
  PruneReport,
  Ref,
  RepairPage,
  Seq,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import type { Connection } from "./connection.ts";
import type { Plugin } from "./plugin.ts";

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
export interface Host extends Connection {
  /**
   * Serves this host over HTTP or as a fetch handler.
   *
   * @throws {SdkError} invalid when the options are malformed, such as a token shorter than 16 characters.
   * @throws {SdkError} unavailable when the port cannot be bound.
   */
  listen(options: ListenOptions): Promise<Listener>;
  /** Hot plugin replacement and preflight. */
  readonly plugins: {
    /**
     * Replaces the host's plugins, or one session's.
     *
     * **Details**
     *
     * Per plugin: `activated`, `rejected` or `kept-previous`.
     *
     * @authority maintenance
     */
    replace(plugins: readonly Plugin<"core">[], scope?: { readonly session: SessionId }): Promise<PluginReplacementReport>;
    /**
     * Runs the preflight `open` runs; touches nothing.
     *
     * @authority maintenance
     */
    check(plugins: readonly Plugin<"core">[]): Promise<PluginCheckReport>;
  };
  /** Collects unreachable history. The only GC entry point. In-process only. */
  prune(): Promise<PruneReport>;
  /** Who may connect. */
  readonly principals: {
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
  };
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
export interface ListenOptions {
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
export interface Listener {
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
