import type { BlobId, ByteReader, Json, ObjectId, Ref, RefUpdate, Seq, SessionEvent, SessionId, SetOutcome } from "@nyte-ai/schema";

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
export interface Store {
  /** Names the backend: "sqlite", "postgres", "durable-object". */
  readonly kind: string;
  /** Opens a connection to the objects and refs tables. */
  open(): Promise<StoreConnection>;
  /** Releases the backend. */
  close(): Promise<void>;
}

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
export interface StoreConnection {
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
export interface ObjectStore {
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
export interface RefStore {
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
