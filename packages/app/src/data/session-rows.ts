import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { SdkError } from "@nyte-ai/sdk";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { QueryObserver, replaceEqualDeep, skipToken } from "@tanstack/react-query";
import { connected } from "./connection.ts";
import { derivedStore } from "./derived-store.ts";
import type { StoreSource } from "./derived-store.ts";
import { keepList, keepMap, keepSet, reconcile } from "./keep.ts";
import { keys, queryClient, queryDataReader } from "./query-client.ts";
import { SessionActions } from "./session-actions.ts";
import { childList, sessionList } from "./directory.ts";

export interface SessionRows {
  readonly rows: ReadonlyMap<SessionId, SessionInfo>;
  readonly hosted: ReadonlyMap<SessionId, SessionInfo>;
  readonly roots: readonly SessionInfo[] | undefined;
  readonly listed: boolean;
  readonly missing: ReadonlySet<SessionId>;
}

export const sessionActions = new SessionActions({
  client: queryClient,
  findRow: findSessionRow,
  hosted: {
    row: (id) => sessionRows().hosted.get(id),
    subscribe: (notice) => subscribeSessionRows(notice),
  },
});

export const sessionRows = (): SessionRows => store.getSnapshot();

export const subscribeSessionRows = (notice: () => void): (() => void) => store.subscribe(notice);

export function findSessionRow(id: SessionId): SessionInfo | undefined {
  return sessionRows().rows.get(id);
}

export function subscribeSessionRow(id: SessionId, notice: () => void): () => void {
  return ask(interest.rows, id, notice);
}

export function subscribeChildRows(parent: SessionId, notice: () => void): () => void {
  return ask(interest.parents, parent, notice);
}

function ask(counts: Map<SessionId, number>, id: SessionId, notice: () => void): () => void {
  const leave = subscribeSessionRows(notice);
  counts.set(id, (counts.get(id) ?? 0) + 1);

  for (const listener of interest.changed) listener();

  return () => {
    const count = (counts.get(id) ?? 1) - 1;

    if (count === 0) counts.delete(id);
    else counts.set(id, count);

    for (const listener of interest.changed) listener();
    leave();
  };
}

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

/** Who reads which session row and which parent's child rows, counted, so a read stays open while anyone still asks. */
const interest = {
  rows: new Map<SessionId, number>(),
  parents: new Map<SessionId, number>(),
  changed: new Set<() => void>(),
};

export interface RowInterest {
  readonly rows: ReadonlyMap<SessionId, number>;
  readonly parents: ReadonlyMap<SessionId, number>;
}

export interface ListedRows {
  readonly all: readonly SessionInfo[] | undefined;
  readonly roots: readonly SessionInfo[] | undefined;
  readonly pinned: readonly SessionInfo[] | undefined;
  readonly children: readonly (readonly SessionInfo[] | undefined)[];
}

export interface RowInputs extends ListedRows {
  readonly recorded: readonly SessionInfo[] | undefined;
  /** Each asked session no list holds: its row, or `null` once the host says it doesn't know it. */
  readonly unlisted: ReadonlyMap<SessionId, SessionInfo | null>;
  readonly project: (session: SessionInfo) => SessionInfo | null;
}

interface AskedRows {
  readonly children: ListedRows["children"];
  readonly unlisted: RowInputs["unlisted"];
}

const NOTHING_ASKED: AskedRows = { children: [], unlisted: new Map() };

/** The child lists and lone sessions that `interest` asks for. Child lists open per asked parent; a session read opens once `all` has arrived and no list holds it. */
function askedRows(): StoreSource<AskedRows> {
  let found = NOTHING_ASKED;

  return {
    read: () => found,
    subscribe(notice) {
      const parents = new Map<SessionId, () => void>();

      const reads = new Map<
        SessionId,
        { readonly session: () => SessionInfo | null | undefined; readonly leave: () => void }
      >();

      const publish = (next: AskedRows): void => {
        if (next.children === found.children && next.unlisted === found.unlisted) return;
        found = next;
        notice();
      };

      const collectChildren = (): void =>
        publish({
          ...found,
          children: keepList(
            found.children,
            [...parents.keys()].map((parent) => childList(parent).value),
          ),
        });

      const collectUnlisted = (): void =>
        publish({
          ...found,
          unlisted: keepMap(
            found.unlisted,
            new Map(
              [...reads].flatMap(([id, read]) => {
                const session = read.session();

                return session === undefined ? [] : [[id, session] as const];
              }),
            ),
          ),
        });

      const wanted = (): WantedReads =>
        wantedReads(interest, {
          all: sessionList("all").value,
          roots: sessionList("roots").value,
          pinned: sessionList("pinned").value,
          children: [...interest.parents.keys()].map((parent) => childList(parent).value),
        });

      const syncUnlisted = (unlisted: ReadonlySet<SessionId>): void => {
        reconcile(
          reads,
          unlisted,
          (id) => {
            const observer = new QueryObserver(queryClient, sessionQuery(id));

            return {
              session: () => observer.getCurrentResult().data,
              leave: observer.subscribe(collectUnlisted),
            };
          },
          (read) => read.leave(),
        );
        collectUnlisted();
      };

      const sync = (): void => {
        const next = wanted();
        reconcile(
          parents,
          next.parents,
          (parent) => childList(parent).subscribeByFrame(collectChildren),
          (leave) => leave(),
        );
        collectChildren();
        syncUnlisted(next.unlisted);
      };

      const relist = (): void => syncUnlisted(wanted().unlisted);

      interest.changed.add(sync);

      const leave = [
        sessionList("all").subscribeByFrame(relist),
        sessionList("roots").subscribeByFrame(relist),
        sessionList("pinned").subscribeByFrame(relist),
      ];

      sync();

      return () => {
        interest.changed.delete(sync);

        for (const unsubscribe of leave) unsubscribe();

        for (const unsubscribe of parents.values()) unsubscribe();

        for (const read of reads.values()) read.leave();
        found = NOTHING_ASKED;
      };
    },
  };
}

export interface WantedReads {
  readonly parents: ReadonlySet<SessionId>;
  readonly unlisted: ReadonlySet<SessionId>;
}

/** Every asked parent's child list, and each asked session no list holds. No session is read alone until `all` has arrived, which holds most of them. */
export function wantedReads(interest: RowInterest, lists: ListedRows): WantedReads {
  const listed = new Set(
    [
      ...(lists.all ?? []),
      ...(lists.roots ?? []),
      ...(lists.pinned ?? []),
      ...lists.children.flatMap((list) => list ?? []),
    ].map((session) => session.id),
  );

  return {
    parents: new Set(interest.parents.keys()),
    unlisted: new Set(
      lists.all === undefined ? [] : [...interest.rows.keys()].filter((id) => !listed.has(id)),
    ),
  };
}

/** Each list's store, held once: a family of three keys keeps every store it made, since it drops only idle stores past its sixteen newest. */
const lists = {
  all: sessionList("all"),
  roots: sessionList("roots"),
  pinned: sessionList("pinned"),
};

const sources = {
  all: { read: lists.all.read, subscribe: lists.all.subscribeByFrame },
  roots: { read: lists.roots.read, subscribe: lists.roots.subscribeByFrame },
  pinned: { read: lists.pinned.read, subscribe: lists.pinned.subscribeByFrame },
  recorded: {
    read: queryDataReader<readonly SessionInfo[]>(keys.firstFrameRoots),
    subscribe: (notice: () => void) =>
      new QueryObserver(queryClient, {
        queryKey: keys.firstFrameRoots,
        queryFn: skipToken,
      }).subscribe(notice),
  },
  asked: askedRows(),
  pending: {
    read: () => sessionActions.getSnapshot(),
    subscribe: (notice: () => void) => sessionActions.subscribe(notice),
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
    const pending = read.pending.read();
    const asked = read.asked.read();

    return deriveSessionRows(
      {
        all: read.all.read(),
        roots: read.roots.read(),
        pinned: read.pinned.read(),
        recorded: read.recorded.read(),
        children: asked.children,
        unlisted: asked.unlisted,
        project: (session) => sessionActions.projectSession(session, pending),
      },
      previous,
    );
  },
  NO_ROWS,
);

/** The rows every list and lone read hold, the first list naming a session winning, each projected through the pending actions. Whatever equals `previous` stays `previous`, the whole value included, so a reader of one row re-renders only when that row changes. */
export function deriveSessionRows(inputs: RowInputs, previous: SessionRows): SessionRows {
  const roots = withPinned(inputs.roots ?? inputs.recorded, inputs.pinned);
  const unlisted = [...inputs.unlisted];

  const merged = mergeSessionRows(
    {
      lists: [
        inputs.all,
        roots,
        ...inputs.children,
        unlisted.flatMap(([, session]) => (session === null ? [] : [session])),
      ],
      roots,
      project: inputs.project,
    },
    previous,
  );

  const listed = inputs.all !== undefined;

  const missing = keepSet(
    previous.missing,
    new Set(unlisted.flatMap(([id, session]) => (session === null ? [id] : []))),
  );

  return merged.rows === previous.rows &&
    merged.hosted === previous.hosted &&
    merged.roots === previous.roots &&
    listed === previous.listed &&
    missing === previous.missing
    ? previous
    : { ...merged, listed, missing };
}

/** The newest roots, then each pinned root they leave out, which is older than all of them, so a pinned chat stays listed however many chats came after it. */
function withPinned(
  roots: readonly SessionInfo[] | undefined,
  pinned: readonly SessionInfo[] | undefined,
): readonly SessionInfo[] | undefined {
  if (roots === undefined || pinned === undefined) return roots;
  const listed = new Set(roots.map((session) => session.id));
  const older = pinned.filter((session) => !listed.has(session.id));

  return older.length === 0 ? roots : [...roots, ...older];
}

export interface RowSources {
  readonly lists: readonly (readonly SessionInfo[] | undefined)[];
  readonly roots: readonly SessionInfo[] | undefined;
  readonly project: (session: SessionInfo) => SessionInfo | null;
}

export function mergeSessionRows(
  sources: RowSources,
  previous: Pick<SessionRows, "rows" | "hosted" | "roots">,
): Pick<SessionRows, "rows" | "hosted" | "roots"> {
  const merged = new Map<SessionId, SessionInfo>();

  for (const list of sources.lists)
    for (const session of list ?? []) if (!merged.has(session.id)) merged.set(session.id, session);

  const rows = new Map(
    [...merged.values()].flatMap((listed) => {
      const session = sources.project(listed);

      return session === null
        ? []
        : [[listed.id, replaceEqualDeep(previous.rows.get(listed.id), session)] as const];
    }),
  );

  const roots = sources.roots?.flatMap((session) => rows.get(session.id) ?? []);

  return {
    hosted: keepMap(previous.hosted, merged),
    rows: keepMap(previous.rows, rows),
    roots:
      roots === undefined || previous.roots === undefined ? roots : keepList(previous.roots, roots),
  };
}
