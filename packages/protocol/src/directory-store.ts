import type { SessionId, SessionInfo, SessionsChange, SessionsRead } from "@nyte-ai/schema";

export interface DirectorySnapshot {
  readonly ids: readonly SessionId[];
  readonly rows: ReadonlyMap<SessionId, SessionInfo>;
}

export interface DirectoryStore {
  readonly seq: number;
  apply(change: SessionsChange): void;
  resume(read: SessionsRead): void;
  snapshot(): DirectorySnapshot;
}

export function openDirectoryStore(read: SessionsRead): DirectoryStore {
  const rows = new Map<SessionId, SessionInfo>();
  let ids: readonly SessionId[] = [];
  let seq = 0;

  const resume = (next: SessionsRead): void => {
    seq = next.seq;
    ids = next.ids;

    for (const row of next.rows) rows.set(row.id, row);
    const kept = new Set(ids);

    for (const id of rows.keys()) if (!kept.has(id)) rows.delete(id);
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

      for (const row of table.upsert) rows.set(row.id, row);

      for (const id of table.drop) rows.delete(id);
      const dropped = new Set(table.drop);
      ids = ids.filter((id) => !dropped.has(id));
    },
    resume,
    snapshot: () => ({ ids, rows }),
  };
}
