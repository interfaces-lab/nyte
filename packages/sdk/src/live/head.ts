import type {
  Activation,
  CatalogId,
  HeadName,
  MessageId,
  SdkError,
  SessionCatalogView,
  SessionChange,
  SessionId,
} from "@nyte-ai/schema";
import { asSdkError, openSessionStore } from "@nyte-ai/protocol";
import type { HostSocket, SessionRows, SessionStore, SocketEvent } from "@nyte-ai/protocol";
import type { Catalogs } from "./catalogs.ts";
import { activations, sessionChanges, sessionsChanges } from "../event-checks.ts";
import { freshnessCell, keepRows, listenerSet, readRetries, request, sameJson } from "./store.ts";
import type { Freshness, Join, Live } from "./store.ts";

type RowIn<T> = T extends ReadonlyMap<string, infer Row> ? Row : never;

export type HeadRows = {
  readonly [K in keyof SessionRows]: ReadonlyMap<string, RowIn<SessionRows[K]>>;
};

export interface HeadSnapshot {
  readonly head: HeadName;
  readonly order: readonly MessageId[];
  readonly leadingPrompt: MessageId | null;
  readonly activation: Activation;
  readonly rows: HeadRows;
  readonly catalog: SessionCatalogView;
}

export interface HeadStore extends Live<HeadSnapshot | null> {
  freshness(): Freshness;
  close(): void;
}

type Held = {
  readonly store: SessionStore;
  activation: Activation;
  built: readonly MessageId[] | null;
};

type Table = keyof SessionRows;

const TABLES: readonly Table[] = [
  "messages",
  "turns",
  "parts",
  "changes",
  "catalog",
  "heads",
  "settings",
  "usage",
  "background",
];

const EVERY_TABLE: ReadonlySet<Table> = new Set(TABLES);

const NO_TABLE: ReadonlySet<Table> = new Set();

const EMPTY_CATALOG: SessionCatalogView = {
  commands: [],
  settings: [],
  skills: [],
  agents: [],
  tools: [],
};

/**
 * Holds one head's window over the session scope and keeps it current. A session scope has no event
 * for its session's removal, so the store also listens to the host scope's `change` events, which
 * the connection's session lists subscribe to: when one drops the store's session, the store reads
 * the head again, and the host's `unknown` answer leaves it stale with that error. A connection
 * that holds no session list hears no drop, and its store learns of the removal at its next read.
 */
export function openHeadStore(
  input: { readonly session: SessionId; readonly head: HeadName; readonly tail: number },
  join: Join,
  catalogs: Catalogs,
): HeadStore {
  const listeners = listenerSet();
  let held: Held | null = null;
  let snapshot: HeadSnapshot | null = null;
  const freshness = freshnessCell();
  const retries = readRetries();
  let socket: HostSocket | null = null;
  let subscribe: () => Promise<void> = async () => undefined;
  let stop: (() => void) | null = null;
  let pending: SessionChange[] = [];
  let reading = false;
  let heard: Activation | null = null;
  let wanted: CatalogId | null = null;

  const stale = (error: SdkError | null): void => {
    if (freshness.stale(error)) listeners.notify();
  };

  const settle = (live: HostSocket, current: Held, touched: ReadonlySet<Table>): void => {
    if (current.store.stale) {
      stale(null);
      void read(live);

      return;
    }

    const next = rebuild(input.head, current, snapshot, resolveCatalog(live, current), touched);
    const moved = freshness.fresh(current.store.seq);

    if (next === snapshot && !moved) return;
    snapshot = next;
    listeners.notify();
  };

  const resolveCatalog = (live: HostSocket, current: Held): SessionCatalogView => {
    const id = Array.from(current.store.snapshot().rows.catalog.values())[0]?.id ?? null;

    if (id === null) return EMPTY_CATALOG;
    const known = catalogs.known(id);

    if (known !== undefined) return known;

    if (wanted !== id) {
      wanted = id;
      catalogs.read(id).then(
        () => {
          if (socket === live && held === current && !reading) settle(live, current, NO_TABLE);
        },
        (error) => {
          if (wanted === id) wanted = null;

          if (socket === live) stale(asSdkError(error));
        },
      );
    }

    return snapshot?.catalog ?? EMPTY_CATALOG;
  };

  const read = async (live: HostSocket): Promise<void> => {
    reading = true;
    heard = null;

    try {
      const subscribing = subscribe();
      const resume = held?.store;

      const window = await request(live, "head.read", {
        session: input.session,
        head: input.head,
        window: { tail: input.tail },
        resume:
          resume === undefined
            ? undefined
            : { seq: resume.seq, from: resume.snapshot().order[0] ?? null },
      });

      await subscribing;

      if (socket !== live) return;

      const activation = heard ?? window.live.activation;

      if (held === null) held = { store: openSessionStore(window), activation, built: null };
      else {
        held.store.resume(window);
        held.activation = activation;
      }

      reading = false;
      retries.reset();

      for (const change of pending.splice(0)) held.store.apply(change);
      settle(live, held, EVERY_TABLE);
    } catch (error) {
      if (socket !== live) return;
      stale(asSdkError(error));
      retries.failed(() => {
        if (socket === live) void read(live);
      });
    }
  };

  const receive = (live: HostSocket, event: SocketEvent): void => {
    if (event.scope === "host") {
      if (
        !reading &&
        event.kind === "change" &&
        sessionsChanges.Check(event) &&
        event.tables.sessions?.drop.includes(input.session) === true
      )
        void read(live);

      return;
    }

    if (event.scope !== `session/${input.session}`) return;

    if (event.kind === "live" && activations.Check(event.activation)) {
      heard = event.activation;

      if (held === null) return;
      held.activation = event.activation;

      if (!reading) settle(live, held, NO_TABLE);

      return;
    }

    if (event.kind !== "change" || !sessionChanges.Check(event)) return;

    if (reading || held === null) {
      pending.push(event);

      return;
    }

    held.store.apply(event);
    settle(live, held, new Set(TABLES.filter((table) => event.tables[table] !== undefined)));
  };

  const leave = join(`session/${input.session}`, {
    attach(live, subscribing) {
      socket = live;
      subscribe = subscribing;
      pending = [];
      stop = live.onEvent((event) => receive(live, event));
      void read(live);
    },
    detach() {
      stop?.();
      stop = null;
      socket = null;
      pending = [];
      reading = false;
      retries.reset();
      stale(null);
    },
  });

  return {
    subscribe: listeners.subscribe,
    snapshot: () => snapshot,
    freshness: freshness.current,
    close() {
      leave();
      retries.reset();
      listeners.clear();
    },
  };
}

function rebuild(
  head: HeadName,
  current: Held,
  previous: HeadSnapshot | null,
  catalog: SessionCatalogView,
  touched: ReadonlySet<Table>,
): HeadSnapshot {
  const source = current.store.snapshot();
  const rows = keepTables(source.rows, previous?.rows, touched);

  const order =
    previous !== null && (current.built === source.order || sameJson(previous.order, source.order))
      ? previous.order
      : source.order;

  current.built = source.order;

  const activation =
    previous !== null && sameJson(previous.activation, current.activation)
      ? previous.activation
      : current.activation;

  if (
    previous !== null &&
    rows === previous.rows &&
    order === previous.order &&
    activation === previous.activation &&
    catalog === previous.catalog &&
    source.leadingPrompt === previous.leadingPrompt
  )
    return previous;

  return { head, order, leadingPrompt: source.leadingPrompt, activation, rows, catalog };
}

/** Keeps the previous table for each table `touched` leaves out, so a table's identity changes only when its rows do. */
function keepTables(
  source: SessionRows,
  previous: HeadRows | undefined,
  touched: ReadonlySet<Table>,
): HeadRows {
  const keep = <Row>(
    table: Table,
    rows: ReadonlyMap<string, Row>,
    held: ReadonlyMap<string, Row> | undefined,
  ): ReadonlyMap<string, Row> =>
    held !== undefined && !touched.has(table) ? held : keepRows(rows, held);

  const next: HeadRows = {
    messages: keep("messages", source.messages, previous?.messages),
    turns: keep("turns", source.turns, previous?.turns),
    parts: keep("parts", source.parts, previous?.parts),
    changes: keep("changes", source.changes, previous?.changes),
    catalog: keep("catalog", source.catalog, previous?.catalog),
    heads: keep("heads", source.heads, previous?.heads),
    settings: keep("settings", source.settings, previous?.settings),
    usage: keep("usage", source.usage, previous?.usage),
    background: keep("background", source.background, previous?.background),
  };

  if (previous === undefined) return next;
  const before = Object.values(previous);

  return Object.values(next).every((table, index) => table === before[index]) ? previous : next;
}
