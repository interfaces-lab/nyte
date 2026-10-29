import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { SdkError } from "@nyte-ai/sdk";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { QueryObserver, replaceEqualDeep, skipToken } from "@tanstack/react-query";
import { connected } from "./connection.ts";
import { derivedStore } from "./derived-store.ts";
import type { StoreSource } from "./derived-store.ts";
import { keys, queryClient } from "./query-client.ts";
import { appSessionActions } from "./session-actions.ts";
import { openViews, sessionsWatch, subscribeOpenViews } from "./watches.ts";
import type { OpenView } from "./watches.ts";

/**
 * Every session row this connection knows, as each surface should show it: the host's lists
 * merged, an open view's heads in place of the listed ones, and pending renames, pins, archives
 * and deletes applied. A row that comes out the same keeps its identity.
 */
export interface SessionRows {
  readonly rows: ReadonlyMap<SessionId, SessionInfo>;
  /** The root chats in the host's order; until the host lists them, the copy the last window kept. */
  readonly roots: readonly SessionInfo[] | undefined;
  /** The host's list of every session has arrived, so a row it lacks is read on its own. */
  readonly listed: boolean;
  /** Asked-for sessions the host says don't exist. */
  readonly missing: ReadonlySet<SessionId>;
}

/** The current rows. */
export const sessionRows = (): SessionRows => store.getSnapshot();

/** Hears every change to the rows; the host's lists are watched while anyone listens. */
export const subscribeSessionRows = (notice: () => void): (() => void) => store.subscribe(notice);

/** One session's row, or undefined while the rows don't hold it. */
export function findSessionRow(id: SessionId): SessionInfo | undefined {
  return sessionRows().rows.get(id);
}

/** Hears the rows, and reads `id` on its own while the host's lists don't carry it. */
export function subscribeSessionRow(id: SessionId, notice: () => void): () => void {
  const leave = subscribeSessionRows(notice);
  asked.set(id, (asked.get(id) ?? 0) + 1);

  for (const listener of askListeners) listener();

  return () => {
    const count = (asked.get(id) ?? 1) - 1;

    if (count === 0) asked.delete(id);
    else asked.set(id, count);

    for (const listener of askListeners) listener();
    leave();
  };
}

/** What `select` makes of one session's row: undefined while it loads, null once it is known missing. Renders only when the selection changes. */
export function useSessionRow<S>(
  id: SessionId | undefined,
  select: (session: SessionInfo) => S,
): S | null | undefined {
  return useSyncExternalStoreWithSelector(
    (notice) => (id === undefined ? subscribeSessionRows(notice) : subscribeSessionRow(id, notice)),
    sessionRows,
    sessionRows,
    (snapshot) => {
      const row = id === undefined ? undefined : snapshot.rows.get(id);

      if (row !== undefined) return select(row);

      return id !== undefined && snapshot.missing.has(id) ? null : undefined;
    },
  );
}

/** The root chats, as `SessionRows.roots`. */
export function useRootRows(): readonly SessionInfo[] | undefined {
  return useSyncExternalStore(
    subscribeSessionRows,
    () => sessionRows().roots,
    () => sessionRows().roots,
  );
}

export const readSession = async (sessionId: SessionId) =>
  (await connected()).session(sessionId).info();

/** One session's own read, for a session the lists don't carry; a missing one reads as null. */
export function sessionQuery(sessionId: SessionId) {
  return {
    queryKey: keys.session(sessionId),
    queryFn: () => readSession(sessionId).catch(missingAsNull),
  };
}

export function missingAsNull(cause: unknown): null {
  if (cause instanceof SdkError && cause.code === "unknown") return null;
  throw cause;
}

/** How many readers ask for each session by id. */
const asked = new Map<SessionId, number>();

const askListeners = new Set<() => void>();

interface Unlisted {
  readonly rows: readonly SessionInfo[];
  readonly missing: ReadonlySet<SessionId>;
}

const NOTHING_UNLISTED: Unlisted = { rows: [], missing: new Set() };

let unlistedReads = NOTHING_UNLISTED;

/** Each asked-for session the lists don't carry, read on its own while the rows are heard. */
const unlisted: StoreSource<Unlisted> = {
  read: () => unlistedReads,
  subscribe(notice) {
    const reads = new Map<
      SessionId,
      { readonly session: () => SessionInfo | null | undefined; readonly leave: () => void }
    >();

    const collect = (): void => {
      const found = [...reads].map(([id, read]) => [id, read.session()] as const);

      const rows = found.flatMap(([, session]) =>
        session === undefined || session === null ? [] : [session],
      );

      const missing = found.flatMap(([id, session]) => (session === null ? [id] : []));
      const known = unlistedReads;

      if (
        rows.length === known.rows.length &&
        rows.every((row, index) => row === known.rows[index]) &&
        missing.length === known.missing.size &&
        missing.every((id) => known.missing.has(id))
      )
        return;
      unlistedReads = { rows, missing: new Set(missing) };
      notice();
    };

    const sync = (): void => {
      const all = sessionsWatch("all").value;

      const listed = new Set(
        [...(all ?? []), ...(sessionsWatch("roots").value ?? [])].map((session) => session.id),
      );

      const wanted = new Set(
        all === undefined ? [] : [...asked.keys()].filter((id) => !listed.has(id)),
      );

      for (const [id, read] of reads)
        if (!wanted.has(id)) {
          read.leave();
          reads.delete(id);
        }

      for (const id of wanted)
        if (!reads.has(id)) {
          const observer = new QueryObserver(queryClient, sessionQuery(id));
          reads.set(id, {
            session: () => observer.getCurrentResult().data,
            leave: observer.subscribe(collect),
          });
        }

      collect();
    };

    askListeners.add(sync);

    const leave = [
      sessionsWatch("all").subscribeByFrame(sync),
      sessionsWatch("roots").subscribeByFrame(sync),
    ];

    sync();

    return () => {
      askListeners.delete(sync);

      for (const unsubscribe of leave) unsubscribe();

      for (const read of reads.values()) read.leave();
      unlistedReads = NOTHING_UNLISTED;
    };
  },
};

const sources = {
  all: {
    read: () => sessionsWatch("all").value,
    subscribe: (notice: () => void) => sessionsWatch("all").subscribeByFrame(notice),
  },
  roots: {
    read: () => sessionsWatch("roots").value,
    subscribe: (notice: () => void) => sessionsWatch("roots").subscribeByFrame(notice),
  },
  recorded: {
    read: () => queryClient.getQueryData<readonly SessionInfo[]>(keys.firstFrameRoots),
    subscribe: (notice: () => void) =>
      new QueryObserver(queryClient, {
        queryKey: keys.firstFrameRoots,
        queryFn: skipToken,
      }).subscribe(notice),
  },
  unlisted,
  views: { read: openViews, subscribe: subscribeOpenViews },
  pending: {
    read: () => appSessionActions().getSnapshot(),
    subscribe: (notice: () => void) => appSessionActions().subscribe(notice),
  },
} satisfies Readonly<Record<string, StoreSource<unknown>>>;

const NO_ROWS: SessionRows = {
  rows: new Map(),
  roots: undefined,
  listed: false,
  missing: new Set(),
};

const store = derivedStore(
  sources,
  (read, previous: SessionRows): SessionRows => {
    const roots = read.roots.read() ?? read.recorded.read();
    const pending = read.pending.read();

    const merged = mergeSessionRows(
      {
        lists: [read.all.read(), roots, read.unlisted.read().rows],
        roots,
        views: read.views.read(),
        project: (session) => appSessionActions().projectSession(session, pending),
      },
      previous,
    );

    const listed = read.all.read() !== undefined;
    const missing = read.unlisted.read().missing;

    return merged.rows === previous.rows &&
      merged.roots === previous.roots &&
      listed === previous.listed &&
      missing === previous.missing
      ? previous
      : { ...merged, listed, missing };
  },
  NO_ROWS,
);

export interface RowSources {
  /** The host's lists, most complete first: a session takes its row from the first list that has it. */
  readonly lists: readonly (readonly SessionInfo[] | undefined)[];
  /** The root chats in the order they list. */
  readonly roots: readonly SessionInfo[] | undefined;
  /** Each session whose view is open; its heads replace the listed ones. */
  readonly views: ReadonlyMap<SessionId, OpenView>;
  /** The session as pending renames, pins, archives and deletes leave it; null once deleted. */
  readonly project: (session: SessionInfo) => SessionInfo | null;
}

/** The rows `sources` make; a row equal to one in `previous` keeps its identity, and so do the map and the roots when nothing in them changed. */
export function mergeSessionRows(
  sources: RowSources,
  previous: Pick<SessionRows, "rows" | "roots">,
): Pick<SessionRows, "rows" | "roots"> {
  const merged = new Map<SessionId, SessionInfo>();

  for (const list of sources.lists)
    for (const session of list ?? []) if (!merged.has(session.id)) merged.set(session.id, session);

  const rows = new Map(
    [...merged.values()].flatMap((listed) => {
      const view = sources.views.get(listed.id);
      const session = sources.project(
        view === undefined ? listed : { ...listed, heads: view.heads },
      );

      return session === null
        ? []
        : [[listed.id, replaceEqualDeep(previous.rows.get(listed.id), session)] as const];
    }),
  );

  const roots = sources.roots?.flatMap((session) => rows.get(session.id) ?? []);
  const known = previous.roots;

  return {
    rows:
      rows.size === previous.rows.size &&
      [...rows].every(([id, row]) => previous.rows.get(id) === row)
        ? previous.rows
        : rows,
    roots:
      roots !== undefined &&
      known !== undefined &&
      roots.length === known.length &&
      roots.every((row, index) => row === known[index])
        ? known
        : roots,
  };
}
