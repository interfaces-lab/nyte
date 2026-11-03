import { backgroundRowKey, catalogRowKey } from "@nyte-ai/schema";
import type {
  BackgroundRow,
  CatalogRow,
  FileChange,
  HeadRow,
  HeadSettingsRow,
  HeadUsageRow,
  HeadWindow,
  Message,
  MessageId,
  PartView,
  PathChange,
  Seq,
  SessionChange,
  TurnInfo,
} from "@nyte-ai/schema";

export interface SessionRows {
  readonly messages: Map<string, Message>;
  readonly turns: Map<string, TurnInfo>;
  readonly parts: Map<string, PartView>;
  readonly changes: Map<string, FileChange>;
  readonly catalog: Map<string, CatalogRow>;
  readonly heads: Map<string, HeadRow>;
  readonly settings: Map<string, HeadSettingsRow>;
  readonly usage: Map<string, HeadUsageRow>;
  readonly background: Map<string, BackgroundRow>;
}

export interface SessionSnapshot {
  readonly order: readonly MessageId[];
  readonly leadingPrompt: MessageId | null;
  readonly rows: SessionRows;
}

export interface SessionStore {
  readonly seq: Seq;
  readonly stale: boolean;
  apply(change: SessionChange): void;
  resume(window: HeadWindow): void;
  snapshot(): SessionSnapshot;
}

export function openSessionStore(window: HeadWindow): SessionStore {
  const head = window.head;

  let rows = emptyRows();
  let seq = window.seq;
  let order: readonly MessageId[] = window.order;
  let leadingPrompt = window.leadingPrompt;
  let stale = false;
  write(rows, window.tables);

  const move = (path: PathChange): void => {
    if (path.after === null) {
      const first = order[0];
      const kept = first === undefined ? -1 : path.ids.indexOf(first);
      order = kept < 0 ? path.ids : path.ids.slice(kept);

      if (kept < 0) leadingPrompt = null;

      return;
    }

    const at = order.indexOf(path.after);

    if (at < 0) {
      stale = true;

      return;
    }

    order = [...order.slice(0, at + 1), ...path.ids];
  };

  return {
    get seq() {
      return seq;
    },
    get stale() {
      return stale;
    },
    apply(change) {
      if (change.seq < seq) return;
      seq = change.seq;
      write(rows, change.tables);

      for (const path of change.paths) if (path.head === head && !stale) move(path);
    },
    resume(next) {
      seq = next.seq;
      order = next.order;
      leadingPrompt = next.leadingPrompt;
      stale = false;

      if (next.complete) rows = emptyRows();
      rows.catalog.clear();

      for (const [key, row] of rows.background) if (row.head === head) rows.background.delete(key);
      write(rows, next.tables);

      const kept = new Set<string>([
        ...order,
        ...(leadingPrompt === null ? [] : [leadingPrompt]),
        ...(rows.heads.get(head)?.queue ?? []),
      ]);

      for (const id of rows.messages.keys()) if (!kept.has(id)) rows.messages.delete(id);
      const turns = new Set<string>(Array.from(rows.messages.values(), (message) => message.turn));

      for (const id of rows.turns.keys()) if (!turns.has(id)) rows.turns.delete(id);
    },
    snapshot: () => ({ order, leadingPrompt, rows }),
  };
}

function emptyRows(): SessionRows {
  return {
    messages: new Map(),
    turns: new Map(),
    parts: new Map(),
    changes: new Map(),
    catalog: new Map(),
    heads: new Map(),
    settings: new Map(),
    usage: new Map(),
    background: new Map(),
  };
}

function write(rows: SessionRows, tables: SessionChange["tables"]): void {
  replace(rows.messages, tables.messages, (row) => row.id);
  replace(rows.turns, tables.turns, (row) => row.id);
  replace(rows.parts, tables.parts, (row) => row.id);
  replace(rows.changes, tables.changes, (row) => row.path);
  replace(rows.catalog, tables.catalog, catalogRowKey);
  replace(rows.heads, tables.heads, (row) => row.name);
  replace(rows.settings, tables.settings, (row) => row.name);
  replace(rows.usage, tables.usage, (row) => row.name);
  replace(rows.background, tables.background, backgroundRowKey);
}

function replace<Row>(
  rows: Map<string, Row>,
  table: { readonly upsert: readonly Row[]; readonly drop: readonly string[] } | undefined,
  key: (row: Row) => string,
): void {
  if (table === undefined) return;

  for (const row of table.upsert) rows.set(key(row), row);

  for (const id of table.drop) rows.delete(id);
}
