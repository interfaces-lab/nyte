/**
 * The `Store` contract served by a `SqliteStore` running in a worker thread.
 * Concurrent calls travel in bounded batches; a watch is one subscription whose
 * events arrive as messages until it is aborted. The calling thread never
 * waits on SQLite, so a client can keep painting while the kernel writes.
 */
import { Worker } from "node:worker_threads";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { FifoQueue } from "@nyte-ai/ai/utils/fifo-queue";
import { CursorExpired } from "@nyte-ai/protocol";
import type {
  Commit,
  Event,
  EventBody,
  Lease,
  Obj,
  Oid,
  RefName,
  RefUpdate,
  Seq,
} from "./model.ts";
import type {
  Events,
  Leases,
  Listing,
  Objects,
  RefUpdateOptions,
  Refs,
  Session,
  SessionInfo,
  Store,
  StoredListing,
} from "./store.ts";
import { CorruptObject, UnknownSession } from "./store.ts";
import { validateLimit } from "./sqlite.ts";
import {
  AppendOutcomeSchema,
  EventSchema,
  LeaseOutcomeSchema,
  LeaseSchema,
  ObjectSchema,
  RefUpdateOutcomeSchema,
  StoreSessionInfoSchema,
  StoredListingSchema,
} from "./store-schemas.ts";
import {
  checkResponses,
  STORE_BATCH_SIZE,
  SessionHandleSchema,
  type StoreMethod,
  type StoreRequest,
  type StoreResponse,
  type WireError,
} from "./store-rpc.ts";

export interface WorkerStoreOptions {
  /** The database file the worker opens. */
  readonly path: string;
  /** The `store-worker` module. A compiled binary embeds it at a build-defined location. */
  readonly worker: string | URL;
  readonly watchPollIntervalMs?: number;
}

const NullableString = Type.Union([Type.String(), Type.Null()]);

const result = {
  null: Compile(Type.Null()),
  number: Compile(Type.Number()),
  boolean: Compile(Type.Boolean()),
  handle: Compile(SessionHandleSchema),
  sessions: Compile(Type.Array(StoreSessionInfoSchema)),
  oids: Compile(Type.Array(Type.String())),
  object: Compile(Type.Union([ObjectSchema, Type.Null()])),
  chain: Compile(Type.Array(Type.Object({ oid: Type.String(), object: ObjectSchema }))),
  objectList: Compile(Type.Array(Type.Object({ oid: Type.String(), at: Type.Number() }))),
  commits: Compile(Type.Array(Type.Object({ oid: Type.String(), commit: ObjectSchema }))),
  nullableString: Compile(NullableString),
  refList: Compile(Type.Array(Type.Object({ name: Type.String(), oid: Type.String() }))),
  refUpdate: Compile(RefUpdateOutcomeSchema),
  leaseOutcome: Compile(LeaseOutcomeSchema),
  lease: Compile(Type.Union([LeaseSchema, Type.Null()])),
  append: Compile(AppendOutcomeSchema),
  events: Compile(Type.Array(EventSchema)),
  listing: Compile(Type.Union([StoredListingSchema, Type.Null()])),
};

interface Validator<T> {
  Check(value: unknown): value is T;
}

type OkResponse = Extract<StoreResponse, { kind: "ok" }>;

interface Pending {
  readonly resolve: (response: OkResponse) => void;
  readonly reject: (cause: Error) => void;
}

interface WatchSubscription {
  readonly session: number;
  readonly push: (events: readonly Event[]) => void;
  readonly end: (cause?: Error) => void;
}

/** Events granted per window; half is granted again once half is consumed. */
const WATCH_WINDOW = 256;

function toError(error: WireError): Error {
  if (error.name === "UnknownSession" && error.id !== undefined)
    return new UnknownSession(error.id);

  if (error.name === "CursorExpired" && error.floor !== undefined)
    return new CursorExpired(error.floor);

  if (error.name === "CorruptObject" && error.oid !== undefined)
    return new CorruptObject(error.oid, error.message.slice(`Stored object ${error.oid} `.length));

  if (error.name === "RangeError") return new RangeError(error.message);

  if (error.name === "TypeError") return new TypeError(error.message);
  const rebuilt = new Error(error.message);
  rebuilt.name = error.name;

  return rebuilt;
}

function commitOf(object: Obj, oid: Oid): Commit {
  if (object.kind !== "commit") throw new TypeError(`Stored object ${oid} is not a commit`);

  return object;
}

class Bridge {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly watches = new Map<number, WatchSubscription>();
  private outgoing: StoreRequest[] = [];
  private nextId = 1;
  private failure: Error | undefined;
  private closing = false;
  readonly ready: Promise<void>;

  constructor(options: WorkerStoreOptions) {
    this.worker = new Worker(options.worker, {
      workerData: {
        path: options.path,
        watchPollIntervalMs: options.watchPollIntervalMs,
      },
    });
    this.ready = new Promise<void>((resolve, reject) => {
      let started = false;

      this.worker.on("message", (message) => {
        if (!checkResponses.Check(message)) {
          if (started) this.fail(new TypeError("Store worker sent a malformed response"));

          return;
        }

        if (started) {
          this.receive(message);

          return;
        }

        if (!message.some((response) => response.kind === "ready")) return;
        started = true;
        resolve();
      });

      this.worker.once("error", (cause: unknown) => {
        const failure = cause instanceof Error ? cause : new Error(String(cause));
        this.fail(failure);
        reject(failure);
      });
      this.worker.once("exit", (code) => {
        this.fail(
          this.closing
            ? new Error("Store is closed")
            : new Error(`Store worker exited with code ${String(code)}`),
        );
        reject(this.failure);
      });
    });
  }

  private fail(cause: Error): void {
    if (this.failure !== undefined) return;
    this.failure = cause;
    this.outgoing.length = 0;

    for (const call of this.pending.values()) call.reject(cause);
    this.pending.clear();

    // A closed store ends its watches; only a crashed worker fails them.
    for (const watch of this.watches.values()) watch.end(this.closing ? undefined : cause);
    this.watches.clear();
  }

  private receive(responses: readonly StoreResponse[]): void {
    for (const response of responses) {
      switch (response.kind) {
        case "ready":
          break;
        case "ok": {
          const call = this.pending.get(response.id);
          this.pending.delete(response.id);
          call?.resolve(response);
          break;
        }

        case "error": {
          const call = this.pending.get(response.id);

          if (call !== undefined) {
            this.pending.delete(response.id);
            call.reject(toError(response.error));
            break;
          }

          const watch = this.watches.get(response.id);
          this.watches.delete(response.id);
          watch?.end(toError(response.error));
          break;
        }

        case "events":
          this.watches.get(response.id)?.push(response.events);
          break;
        case "end": {
          const watch = this.watches.get(response.id);
          this.watches.delete(response.id);
          watch?.end();
          break;
        }

        default: {
          const _exhaustive: never = response;

          return _exhaustive;
        }
      }
    }
  }

  private send(request: StoreRequest): void {
    this.outgoing.push(request);

    if (this.outgoing.length !== 1) return;
    queueMicrotask(() => {
      const requests = this.outgoing;
      this.outgoing = [];

      if (requests.length === 0) return;

      try {
        for (let index = 0; index < requests.length; index += STORE_BATCH_SIZE) {
          this.worker.postMessage(requests.slice(index, index + STORE_BATCH_SIZE));
        }
      } catch (cause) {
        this.fail(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  async call<T>(
    session: number | null,
    method: StoreMethod,
    args: readonly unknown[],
    validate: Validator<T>,
  ): Promise<T> {
    await this.ready;

    if (this.failure !== undefined) throw this.failure;
    const id = this.nextId++;

    const response = await new Promise<OkResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ kind: "call", id, session, method, args: [...args] });
    });

    if (!validate.Check(response.value)) {
      throw new TypeError(`Store worker returned a malformed ${method} result`);
    }

    return response.value;
  }

  async *watch(
    session: number,
    afterSeq: Seq,
    signal: AbortSignal | undefined,
  ): AsyncIterable<Event> {
    await this.ready;

    if (this.failure !== undefined) throw this.failure;

    if (signal?.aborted || this.closing) return;
    const id = this.nextId++;
    const queue = new FifoQueue<Event>();
    let finished: { cause?: Error } | undefined;
    let wake: (() => void) | undefined;

    const notify = (): void => {
      wake?.();
      wake = undefined;
    };

    this.watches.set(id, {
      session,
      push: (events) => {
        for (const event of events) queue.enqueue(event);
        notify();
      },
      // A watch ends only by abort, close, or expiry; what it buffered is dropped with it.
      end: (cause) => {
        finished ??= cause === undefined ? {} : { cause };
        queue.clear();
        notify();
      },
    });

    const abort = (): void => {
      if (this.watches.delete(id)) this.send({ kind: "unwatch", id });
      finished ??= {};
      queue.clear();
      notify();
    };

    signal?.addEventListener("abort", abort, { once: true });
    let consumed = 0;

    try {
      this.send({ kind: "watch", id, session, afterSeq, credit: WATCH_WINDOW });

      for (;;) {
        if (finished !== undefined) {
          if (finished.cause !== undefined) throw finished.cause;

          return;
        }

        const event = queue.dequeue();

        if (event !== undefined) {
          consumed += 1;

          if (consumed === WATCH_WINDOW / 2) {
            consumed = 0;

            if (this.watches.has(id)) this.send({ kind: "credit", id, credit: WATCH_WINDOW / 2 });
          }

          yield event;
          continue;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      abort();
    }
  }

  /** Closing ends watches before the worker answers, as the backend ends its own iterators. */
  endWatches(session: number | undefined): void {
    if (session === undefined) this.closing = true;

    for (const [id, watch] of this.watches) {
      if (session !== undefined && watch.session !== session) continue;
      this.watches.delete(id);
      watch.end();
    }
  }

  get closed(): boolean {
    return this.closing || this.failure !== undefined;
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}

class WorkerSession implements Session {
  readonly id: string;
  readonly objects: Objects;
  readonly refs: Refs;
  readonly leases: Leases;
  readonly events: Events;
  readonly listing: Listing;
  private readonly bridge: Bridge;
  private readonly handle: number;
  private readonly closedController = new AbortController();
  private closing: Promise<void> | undefined;

  constructor(bridge: Bridge, handle: number, id: string) {
    this.bridge = bridge;
    this.handle = handle;
    this.id = id;

    const call = async <T>(
      method: StoreMethod,
      args: readonly unknown[],
      validate: Validator<T>,
    ): Promise<T> => {
      this.assertOpen();

      return bridge.call(handle, method, args, validate);
    };

    this.objects = {
      put: (objects: readonly Obj[]) => call("objects.put", [objects], result.oids),
      get: async (oid: Oid) => (await call("objects.get", [oid], result.object)) ?? undefined,
      chain: (from: Oid, options: { readonly limit: number }) =>
        call("objects.chain", [from, options], result.chain),
      list: () => call("objects.list", [], result.objectList),
      commits: async () =>
        (await call("objects.commits", [], result.commits)).map((item) => ({
          oid: item.oid,
          commit: commitOf(item.commit, item.oid),
        })),
      delete: (oids: readonly Oid[]) => call("objects.delete", [oids], result.number),
    };
    this.refs = {
      read: (name: RefName) => call("refs.read", [name], result.nullableString),
      list: (prefix: string) => call("refs.list", [prefix], result.refList),
      update: (updates: readonly RefUpdate[], options: RefUpdateOptions) =>
        call("refs.update", [updates, options], result.refUpdate),
    };
    this.leases = {
      acquire: (name: string, ttlMs: number) =>
        call("leases.acquire", [name, ttlMs], result.leaseOutcome),
      renew: (lease: Lease, ttlMs: number) => call("leases.renew", [lease, ttlMs], result.boolean),
      release: (lease: Lease) => call("leases.release", [lease], result.boolean),
      read: async (name: string) => (await call("leases.read", [name], result.lease)) ?? undefined,
    };
    this.events = {
      append: (events: readonly EventBody[], options?: { readonly lease?: Lease }) =>
        call("events.append", [events, options], result.append),
      read: async (options: { readonly afterSeq: Seq; readonly limit?: number }) => {
        validateLimit(options.limit);

        return call("events.read", [options], result.events);
      },
      last: () => call("events.last", [], result.number),
      floor: () => call("events.floor", [], result.number),
      trim: async (beforeSeq: Seq) => {
        await call("events.trim", [beforeSeq], result.null);
      },
      watch: (options: { readonly afterSeq: Seq; readonly signal?: AbortSignal }) => {
        this.assertOpen();

        const signal =
          options.signal === undefined
            ? this.closedController.signal
            : AbortSignal.any([options.signal, this.closedController.signal]);

        return bridge.watch(handle, options.afterSeq, signal);
      },
    };
    this.listing = {
      read: async () => (await call("listing.read", [], result.listing)) ?? undefined,
      write: async (listing: StoredListing) => {
        await call("listing.write", [listing], result.null);
      },
    };
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closedController.abort();
    this.bridge.endWatches(this.handle);

    const closing = this.bridge.closed
      ? Promise.resolve()
      : this.bridge.call(this.handle, "session.close", [], result.null).then(() => undefined);

    this.closing = closing;

    return closing;
  }

  private assertOpen(): void {
    if (this.closing !== undefined) throw new Error(`Session is closed: ${this.id}`);
  }
}

export class WorkerStore implements Store {
  private readonly bridge: Bridge;
  private closed = false;

  constructor(options: WorkerStoreOptions) {
    this.bridge = new Bridge(options);
  }

  /** Resolves once the worker opened the database; rejects with the worker's failure. */
  ready(): Promise<void> {
    return this.bridge.ready;
  }

  async create(options?: { readonly id?: string }): Promise<Session> {
    const opened = await this.bridge.call(null, "store.create", [options], result.handle);

    return new WorkerSession(this.bridge, opened.handle, opened.id);
  }

  async open(id: string): Promise<Session> {
    const opened = await this.bridge.call(null, "store.open", [id], result.handle);

    return new WorkerSession(this.bridge, opened.handle, opened.id);
  }

  list(): Promise<readonly SessionInfo[]> {
    return this.bridge.call(null, "store.list", [], result.sessions);
  }

  async delete(id: string): Promise<void> {
    await this.bridge.call(null, "store.delete", [id], result.null);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.bridge.endWatches(undefined);

    try {
      await this.bridge.call(null, "store.close", [], result.null);
    } finally {
      await this.bridge.terminate();
    }
  }
}
