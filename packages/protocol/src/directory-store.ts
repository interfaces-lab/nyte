import { SESSIONS_LIMIT } from "@nyte-ai/schema";
import type {
  ParentFilter,
  SessionId,
  SessionInfo,
  SessionsChange,
  SessionsRead,
} from "@nyte-ai/schema";

export interface DirectorySnapshot {
  readonly ids: readonly SessionId[];
  readonly rows: ReadonlyMap<SessionId, SessionInfo>;
}

export interface DirectoryWindow {
  readonly parents?: ParentFilter;
  readonly limit?: number;
}

export interface DirectoryStore {
  readonly seq: number;
  apply(change: SessionsChange): void;
  resume(read: SessionsRead): void;
  snapshot(): DirectorySnapshot;
}

export function openDirectoryStore(
  read: SessionsRead,
  window: DirectoryWindow = {},
): DirectoryStore {
  const parents = window.parents ?? { kind: "all" };
  const limit = Math.max(1, window.limit ?? SESSIONS_LIMIT);
  const rows = new Map<SessionId, SessionInfo>();
  let ids: readonly SessionId[] = [];
  let seq = 0;

  const order = (): void => {
    ids = [...rows.values()]
      .toSorted(
        (left, right) =>
          right.lastActivityAt - left.lastActivityAt || compareIds(left.id, right.id),
      )
      .slice(0, limit)
      .map((row) => row.id);
  };

  const keep = (row: SessionInfo): void => {
    if (
      parents.kind === "all" ||
      row.parent === (parents.kind === "roots" ? null : parents.session)
    )
      rows.set(row.id, row);
    else rows.delete(row.id);
  };

  const resume = (next: SessionsRead): void => {
    seq = next.seq;

    for (const row of next.rows) keep(row);
    const kept = new Set(next.ids);

    for (const id of rows.keys()) if (!kept.has(id)) rows.delete(id);
    order();
  };

  resume(read);

  return {
    get seq() {
      return seq;
    },
    apply(change) {
      if (change.seq <= seq) return;
      seq = change.seq;
      const table = change.tables.sessions;

      if (table === undefined) return;

      for (const row of table.upsert) keep(row);

      for (const id of table.drop) rows.delete(id);
      order();
    },
    resume,
    snapshot: () => ({ ids, rows }),
  };
}

function compareIds(left: string, right: string): number {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}
