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
import { childList, sessionList } from "./directory.ts";

export interface SessionRows {
  readonly rows: ReadonlyMap<SessionId, SessionInfo>;
  /** Each row as the host lists it, before pending actions: what the host still has. */
  readonly hosted: ReadonlyMap<SessionId, SessionInfo>;
  /** The root chats in the host's order; until the host lists them, the copy the last window kept. */
  readonly roots: readonly SessionInfo[] | undefined;
  /** The host's list of every session has arrived, so a row it lacks is read on its own. */
  readonly listed: boolean;
  readonly missing: ReadonlySet<SessionId>;
}

export const sessionRows = (): SessionRows => store.getSnapshot();

export const subscribeSessionRows = (notice: () => void): (() => void) => store.subscribe(notice);

export function findSessionRow(id: SessionId): SessionInfo | undefined {
  return sessionRows().rows.get(id);
}

/** Also reads `id` on its own while the host's lists don't carry it. */
export function subscribeSessionRow(id: SessionId, notice: () => void): () => void {
  return ask(asked, id, notice);
}

/** Also hears every child of `parent`, however many sessions the host's lists carry. */
export function subscribeChildRows(parent: SessionId, notice: () => void): () => void {
  return ask(askedParents, parent, notice);
}

function ask(counts: Map<SessionId, number>, id: SessionId, notice: () => void): () => void {
  const leave = subscribeSessionRows(notice);
  counts.set(id, (counts.get(id) ?? 0) + 1);

  for (const listener of askListeners) listener();

  return () => {
    const count = (counts.get(id) ?? 1) - 1;

    if (count === 0) counts.delete(id);
    else counts.set(id, count);

    for (const listener of askListeners) listener();
    leave();
  };
}

/** Undefined while the row loads, null once it is known missing. */
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

export function useRootRows(): readonly SessionInfo[] | undefined {
  return useSyncExternalStore(
    subscribeSessionRows,
    () => sessionRows().roots,
    () => sessionRows().roots,
  );
}

export const readSession = async (sessionId: SessionId) =>
  (await connected()).session(sessionId).info();

/** For a session the lists don't carry; a missing one reads as null. */
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

const asked = new Map<SessionId, number>();

const askedParents = new Map<SessionId, number>();

const askListeners = new Set<() => void>();

interface Unlisted {
  readonly rows: readonly SessionInfo[];
  readonly missing: ReadonlySet<SessionId>;
}

const NOTHING_UNLISTED: Unlisted = { rows: [], missing: new Set() };

let unlistedReads = NOTHING_UNLISTED;

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
      const all = sessionList("all").value;

      const listed = new Set(
        [...(all ?? []), ...(sessionList("roots").value ?? [])].map((session) => session.id),
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
      sessionList("all").subscribeByFrame(sync),
      sessionList("roots").subscribeByFrame(sync),
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

const NO_CHILD_ROWS: readonly SessionInfo[] = [];

let childRows = NO_CHILD_ROWS;

const children: StoreSource<readonly SessionInfo[]> = {
  read: () => childRows,
  subscribe(notice) {
    const watched = new Map<SessionId, () => void>();

    const collect = (): void => {
      const rows = [...watched.keys()].flatMap((parent) => childList(parent).value ?? []);

      if (rows.length === childRows.length && rows.every((row, index) => row === childRows[index]))
        return;
      childRows = rows.length === 0 ? NO_CHILD_ROWS : rows;
      notice();
    };

    const sync = (): void => {
      for (const [parent, leave] of watched)
        if (!askedParents.has(parent)) {
          leave();
          watched.delete(parent);
        }

      for (const parent of askedParents.keys())
        if (!watched.has(parent)) watched.set(parent, childList(parent).subscribeByFrame(collect));

      collect();
    };

    askListeners.add(sync);
    sync();

    return () => {
      askListeners.delete(sync);

      for (const leave of watched.values()) leave();
      childRows = NO_CHILD_ROWS;
    };
  },
};

const sources = {
  all: {
    read: () => sessionList("all").value,
    subscribe: (notice: () => void) => sessionList("all").subscribeByFrame(notice),
  },
  roots: {
    read: () => sessionList("roots").value,
    subscribe: (notice: () => void) => sessionList("roots").subscribeByFrame(notice),
  },
  recorded: {
    read: () => queryClient.getQueryData<readonly SessionInfo[]>(keys.firstFrameRoots),
    subscribe: (notice: () => void) =>
      new QueryObserver(queryClient, {
        queryKey: keys.firstFrameRoots,
        queryFn: skipToken,
      }).subscribe(notice),
  },
  children,
  unlisted,
  pending: {
    read: () => appSessionActions().getSnapshot(),
    subscribe: (notice: () => void) => appSessionActions().subscribe(notice),
  },
} satisfies Readonly<Record<string, StoreSource<unknown>>>;

const NO_ROWS: SessionRows = {
  rows: new Map(),
  hosted: new Map(),
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
        lists: [read.all.read(), roots, read.children.read(), read.unlisted.read().rows],
        roots,
        project: (session) => appSessionActions().projectSession(session, pending),
      },
      previous,
    );

    const listed = read.all.read() !== undefined;
    const missing = read.unlisted.read().missing;

    return merged.rows === previous.rows &&
      merged.hosted === previous.hosted &&
      merged.roots === previous.roots &&
      listed === previous.listed &&
      missing === previous.missing
      ? previous
      : { ...merged, listed, missing };
  },
  NO_ROWS,
);

export interface RowSources {
  /** Most complete first: a session takes its row from the first list that has it. */
  readonly lists: readonly (readonly SessionInfo[] | undefined)[];
  readonly roots: readonly SessionInfo[] | undefined;
  /** The session as pending renames, pins, archives and deletes leave it; null once deleted. */
  readonly project: (session: SessionInfo) => SessionInfo | null;
}

/** A row equal to one in `previous` keeps its identity, and so do the map and the roots when nothing in them changed. */
export function mergeSessionRows(
  sources: RowSources,
  previous: Pick<SessionRows, "rows" | "hosted" | "roots">,
): Pick<SessionRows, "rows" | "hosted" | "roots"> {
  const merged = new Map<SessionId, SessionInfo>();

  for (const list of sources.lists)
    for (const session of list ?? []) if (!merged.has(session.id)) merged.set(session.id, session);

  const hosted =
    merged.size === previous.hosted.size &&
    [...merged].every(([id, row]) => previous.hosted.get(id) === row)
      ? previous.hosted
      : merged;

  const rows = new Map(
    [...merged.values()].flatMap((listed) => {
      const session = sources.project(listed);

      return session === null
        ? []
        : [[listed.id, replaceEqualDeep(previous.rows.get(listed.id), session)] as const];
    }),
  );

  const roots = sources.roots?.flatMap((session) => rows.get(session.id) ?? []);
  const known = previous.roots;

  return {
    hosted,
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
