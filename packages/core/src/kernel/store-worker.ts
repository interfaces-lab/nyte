/**
 * Worker entry: owns one `SqliteStore` so its synchronous SQLite work never
 * blocks the thread that renders. Started only by `WorkerStore`.
 */
import { parentPort, workerData } from "node:worker_threads";
import { schemas } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { CursorExpired } from "./model.ts";
import type { Event } from "./model.ts";
import type { Session } from "./store.ts";
import { UnknownSession } from "./store.ts";
import { SqliteStore } from "./sqlite.ts";
import { EventBodySchema, LeaseSchema, ObjectSchema, RefUpdateSchema } from "./store-schemas.ts";
import {
  checkRequest,
  type StoreRequest,
  type StoreResponse,
  type WireError,
} from "./store-rpc.ts";

const port = parentPort;
if (port === null) throw new Error("store-worker must run as a worker thread");

const WorkerDataSchema = Type.Object({
  path: Type.String(),
  watchPollIntervalMs: Type.Optional(Type.Number()),
});
if (!Compile(WorkerDataSchema).Check(workerData))
  throw new Error("store-worker needs a store path");
const store = new SqliteStore(
  workerData.path,
  workerData.watchPollIntervalMs === undefined
    ? undefined
    : { watchPollIntervalMs: workerData.watchPollIntervalMs },
);

interface Watch {
  readonly session: number;
  readonly controller: AbortController;
  /** Events the consumer has asked for; the store iterator is pulled only against credit. */
  credit: number;
  wake?: () => void;
  /** Sends what this tick yielded so far. */
  flush?: () => void;
}

const sessions = new Map<number, Session>();
const watches = new Map<number, Watch>();
let nextHandle = 1;

/** Closing a session or the store ends its watches at once, as the backend does for its own iterators. */
function endWatches(session: number | undefined): void {
  for (const [id, watch] of watches) {
    if (session !== undefined && watch.session !== session) continue;
    watches.delete(id);
    watch.controller.abort();
    watch.wake?.();
    watch.flush?.();
    send({ kind: "end", id });
  }
}

const check = {
  string: Compile(Type.String()),
  number: Compile(Type.Number()),
  optionalId: Compile(
    Type.Union([Type.Object({ id: Type.Optional(Type.String()) }), Type.Undefined()]),
  ),
  objects: Compile(Type.Array(ObjectSchema)),
  strings: Compile(Type.Array(Type.String())),
  chainOptions: Compile(Type.Object({ limit: Type.Number() })),
  refUpdates: Compile(Type.Array(RefUpdateSchema)),
  refUpdateOptions: Compile(
    Type.Object({
      reason: Type.String(),
      lease: Type.Optional(LeaseSchema),
      actor: Type.Optional(schemas.Actor),
      events: Type.Optional(Type.Array(EventBodySchema)),
    }),
  ),
  lease: Compile(LeaseSchema),
  eventBodies: Compile(Type.Array(EventBodySchema)),
  appendOptions: Compile(
    Type.Union([Type.Object({ lease: Type.Optional(LeaseSchema) }), Type.Undefined()]),
  ),
  readOptions: Compile(
    Type.Object({ afterSeq: Type.Number(), limit: Type.Optional(Type.Number()) }),
  ),
};

function argument<T>(value: unknown, validate: { Check(value: unknown): value is T }): T {
  if (!validate.Check(value)) throw new TypeError("store-worker received a malformed argument");
  return value;
}

function session(handle: number | null): Session {
  if (handle === null) throw new TypeError("store-worker call needs a session handle");
  const open = sessions.get(handle);
  if (open === undefined) throw new Error(`store-worker has no session handle ${String(handle)}`);
  return open;
}

function adopt(open: Session): { handle: number; id: string } {
  const handle = nextHandle++;
  sessions.set(handle, open);
  return { handle, id: open.id };
}

async function call(request: Extract<StoreRequest, { kind: "call" }>): Promise<unknown> {
  const [first, second] = request.args;
  switch (request.method) {
    case "store.create":
      return adopt(await store.create(argument(first, check.optionalId)));
    case "store.open":
      return adopt(await store.open(argument(first, check.string)));
    case "store.list":
      return store.list();
    case "store.delete":
      await store.delete(argument(first, check.string));
      return null;
    case "store.close":
      endWatches(undefined);
      await store.close();
      return null;
    case "session.close": {
      // The closed session stays addressable so later calls fail as the backend's own do.
      const open = session(request.session);
      if (request.session !== null) endWatches(request.session);
      await open.close();
      return null;
    }
    case "objects.put":
      return session(request.session).objects.put(argument(first, check.objects));
    case "objects.get":
      return (await session(request.session).objects.get(argument(first, check.string))) ?? null;
    case "objects.chain":
      return session(request.session).objects.chain(
        argument(first, check.string),
        argument(second, check.chainOptions),
      );
    case "objects.list":
      return session(request.session).objects.list();
    case "objects.commits":
      return session(request.session).objects.commits();
    case "objects.delete":
      return session(request.session).objects.delete(argument(first, check.strings));
    case "refs.read":
      return session(request.session).refs.read(argument(first, check.string));
    case "refs.list":
      return session(request.session).refs.list(argument(first, check.string));
    case "refs.update":
      return session(request.session).refs.update(
        argument(first, check.refUpdates),
        argument(second, check.refUpdateOptions),
      );
    case "leases.acquire":
      return session(request.session).leases.acquire(
        argument(first, check.string),
        argument(second, check.number),
      );
    case "leases.renew":
      return session(request.session).leases.renew(
        argument(first, check.lease),
        argument(second, check.number),
      );
    case "leases.release":
      return session(request.session).leases.release(argument(first, check.lease));
    case "leases.read":
      return (await session(request.session).leases.read(argument(first, check.string))) ?? null;
    case "events.append":
      return session(request.session).events.append(
        argument(first, check.eventBodies),
        argument(second, check.appendOptions),
      );
    case "events.read":
      return session(request.session).events.read(argument(first, check.readOptions));
    case "events.last":
      return session(request.session).events.last();
    case "events.floor":
      return session(request.session).events.floor();
    case "events.trim":
      await session(request.session).events.trim(argument(first, check.number));
      return null;
    default: {
      const _exhaustive: never = request.method;
      return _exhaustive;
    }
  }
}

/** Pulls from the store only when the consumer has credit, so replay stays as lazy as in-process. */
async function* pulled<T>(
  source: AsyncIterable<T>,
  granted: () => Promise<boolean>,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      if (!(await granted())) return;
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await iterator.return?.();
  }
}

function wireError(cause: unknown): WireError {
  if (cause instanceof UnknownSession)
    return { name: cause.name, message: cause.message, id: cause.id };
  if (cause instanceof CursorExpired)
    return { name: cause.name, message: cause.message, floor: cause.floor };
  if (cause instanceof Error) return { name: cause.name, message: cause.message };
  return { name: "Error", message: String(cause) };
}

function send(response: StoreResponse): void {
  port?.postMessage(response);
}

async function watch(request: Extract<StoreRequest, { kind: "watch" }>): Promise<void> {
  const controller = new AbortController();
  const entry: Watch = { session: request.session, controller, credit: request.credit };
  watches.set(request.id, entry);
  // Once the entry is gone, its end or error was already reported.
  const live = (): boolean => watches.get(request.id) === entry;
  const granted = async (): Promise<boolean> => {
    while (entry.credit === 0 && live()) {
      await new Promise<void>((resolve) => {
        entry.wake = resolve;
      });
    }
    return live();
  };
  // Events that arrive in one tick leave in one message, so the consumer folds
  // a published batch without a task boundary between its events.
  let batch: Event[] = [];
  const flush = (): void => {
    if (batch.length === 0) return;
    const events = batch;
    batch = [];
    send({ kind: "events", id: request.id, events });
  };
  entry.flush = flush;
  try {
    const open = session(request.session);
    const events = open.events.watch({ afterSeq: request.afterSeq, signal: controller.signal });
    for await (const event of pulled(events, granted)) {
      if (!live()) return;
      entry.credit -= 1;
      if (batch.length === 0) setImmediate(flush);
      batch.push(event);
    }
    flush();
    if (live()) send({ kind: "end", id: request.id });
  } catch (cause) {
    if (live()) send({ kind: "error", id: request.id, error: wireError(cause) });
  } finally {
    if (live()) watches.delete(request.id);
  }
}

port.on("message", (message: unknown) => {
  if (!checkRequest.Check(message)) {
    throw new TypeError("store-worker received a malformed request");
  }
  switch (message.kind) {
    case "call":
      void call(message).then(
        (value) => send({ kind: "ok", id: message.id, value }),
        (cause: unknown) => send({ kind: "error", id: message.id, error: wireError(cause) }),
      );
      return;
    case "watch":
      void watch(message);
      return;
    case "credit": {
      const entry = watches.get(message.id);
      if (entry === undefined) return;
      entry.credit += message.credit;
      entry.wake?.();
      return;
    }
    case "unwatch": {
      const entry = watches.get(message.id);
      if (entry === undefined) return;
      watches.delete(message.id);
      entry.controller.abort();
      entry.wake?.();
      return;
    }
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
});

send({ kind: "ready" });
