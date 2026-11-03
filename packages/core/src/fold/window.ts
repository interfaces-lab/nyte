import { asId } from "@nyte-ai/schema";
import type {
  CatalogRow,
  Execution,
  HeadName,
  HeadRow,
  HeadSettingsRow,
  HeadUsageRow,
  HeadWindow,
  Message,
  MessageId,
  PartView,
  PathChange,
  Resume,
  Seq,
  SessionCatalogView,
  SessionChange,
  SessionView,
  TableChanges,
  ViewOptions,
  WindowSpec,
} from "@nyte-ai/schema";
import { INDEX } from "../contract/fold.ts";
import type { FoldHead, FoldState, Path, Table, Touched } from "../contract/fold.ts";
import { ZERO_USAGE } from "../util/usage.ts";
import {
  backgroundRows,
  belongsInQueue,
  catalogRows,
  emptyHead,
  IDLE,
  newTouched,
  NO_CONTEXT,
  readQueueIds,
  showsTurn,
  UNCONFIGURED,
} from "./draft.ts";
import { findLeadingPrompt, holdsReports, readSeenThrough } from "./project.ts";

const DEFAULT_TAIL = 200;

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

type Placed = { readonly message: Message; readonly position: number };

type Held = { readonly seq: Seq; readonly before: number };

export function readWindow(
  state: FoldState,
  head: HeadName,
  spec: WindowSpec,
  resume: Resume | null,
): HeadWindow {
  const path = state[INDEX].paths.get(head);
  const execution = state.heads.get(head)?.info.execution ?? IDLE;
  const shown = path === undefined ? [] : readShown(path, spec, execution);
  const first = shown[0];

  const leading =
    path === undefined || first === undefined ? null : findLeadingPrompt(path, first.position);

  const held =
    path === undefined || resume === null ? null : readHeld(state, path, resume, execution);

  const row = readHeadRow(state, head);

  const placed = [
    ...(leading === null || path === undefined
      ? []
      : [{ message: leading, position: path.at.get(leading.id) ?? 0 }]),
    ...shown,
    ...row.queue.flatMap((id) => {
      const message = state.messages.get(id);

      return message === undefined ? [] : [{ message, position: path?.at.get(id) ?? 0 }];
    }),
  ];

  const sent = (table: Table, key: string): boolean =>
    held === null || (state[INDEX].stamps[table].get(key) ?? state.base) > held.seq;

  const unheld = (entry: Placed): boolean => held === null || entry.position < held.before;
  const early = new Set(placed.flatMap((entry) => (unheld(entry) ? [entry.message.turn] : [])));
  const since = resume === null || resume.seq < state.base ? null : collect(state, resume.seq);

  const tables = readTables(state, {
    upsert: (held === null || since === null ? everything(state) : since).upsert,
    drop: (since ?? newTouched()).drop,
    paths: new Map(),
  });

  return {
    seq: state.seq,
    head,
    order: shown.map((entry) => entry.message.id),
    leadingPrompt: leading?.id ?? null,
    complete: held === null,
    tables: {
      ...tables,
      messages: {
        upsert: [
          ...new Map(
            placed.flatMap((entry) =>
              unheld(entry) || sent("messages", entry.message.id)
                ? [[entry.message.id, entry.message] as const]
                : [],
            ),
          ).values(),
        ],
        drop: tables.messages.drop,
      },
      turns: {
        upsert: [...new Set(placed.map((entry) => entry.message.turn))].flatMap((id) => {
          const info = state.turns.get(id)?.info;

          return info !== undefined &&
            showsTurn(state.messages, info) &&
            (early.has(id) || sent("turns", id))
            ? [info]
            : [];
        }),
        drop: tables.turns.drop,
      },
      heads: { upsert: sent("heads", head) ? [row] : [], drop: tables.heads.drop },
      settings: {
        upsert: sent("settings", head) ? [readSettingsRow(state, head)] : [],
        drop: tables.settings.drop,
      },
      usage: {
        upsert: sent("usage", head) ? [readUsageRow(state, head)] : [],
        drop: tables.usage.drop,
      },
      background: {
        upsert: Array.from(backgroundRows(head, state.heads.get(head)?.background ?? [])).flatMap(
          ([key, entry]) => (sent("background", key) ? [entry] : []),
        ),
        drop: tables.background.drop,
      },
    },
    live: { activation: state.activation },
  };
}

export function readView(state: FoldState, head: HeadName, options?: ViewOptions): SessionView {
  const window = readWindow(state, head, { tail: options?.tail ?? DEFAULT_TAIL }, null);
  const tables = window.tables;
  const messages = new Map(tables.messages.upsert.map((message) => [message.id, message]));
  const row = tables.heads.upsert.find((entry) => entry.name === head);
  const settings = tables.settings.upsert.find((entry) => entry.name === head);
  const shown = window.order.flatMap((id) => messages.get(id) ?? []);
  const turns = new Set(shown.map((message) => message.turn));
  const prompt = window.leadingPrompt === null ? undefined : messages.get(window.leadingPrompt);
  const execution = row?.execution ?? IDLE;

  return {
    revision: row?.revision ?? null,
    seq: window.seq,
    activation: window.live.activation,
    messages: shown,
    queue: (row?.queue ?? []).flatMap((id) => {
      const message = messages.get(id);

      return message !== undefined && belongsInQueue(message, execution) ? [message] : [];
    }),
    leadingPrompt: prompt?.kind === "user" ? prompt : null,
    parts: tables.parts.upsert,
    turns: tables.turns.upsert.filter((turn) => turns.has(turn.id)),
    usage: tables.usage.upsert.find((entry) => entry.name === head)?.usage ?? ZERO_USAGE,
    execution,
    reportsHeld: row?.reportsHeld ?? false,
    background: tables.background.upsert.flatMap((entry) =>
      entry.head === head ? [entry.item] : [],
    ),
    configuration: settings?.configuration ?? UNCONFIGURED,
    context: settings?.context ?? NO_CONTEXT,
    changes: tables.changes.upsert,
    catalog: groupCatalog(tables.catalog.upsert),
    seenThrough: row?.seenThrough ?? null,
  };
}

export function changesSince(state: FoldState, seq: Seq): SessionChange {
  const touched = collect(state, seq);

  return {
    seq: state.seq,
    tables: omitEmpty(readTables(state, touched)),
    paths: Array.from(touched.paths, ([head, position]) => readPathChange(state, head, position)),
  };
}

function readShown(path: Path, spec: WindowSpec, execution: Execution): readonly Placed[] {
  const start = "from" in spec ? readShownAt(path, spec.from, execution) : undefined;

  if (start !== undefined)
    return path.messages
      .slice(start)
      .flatMap((message, offset) =>
        belongsInQueue(message, execution) ? [] : [{ message, position: start + offset }],
      );
  const tail = "tail" in spec ? spec.tail : DEFAULT_TAIL;
  const shown: Placed[] = [];

  for (
    let position = path.messages.length - 1;
    position >= 0 && shown.length < tail;
    position -= 1
  ) {
    const message = path.messages[position];

    if (!belongsInQueue(message, execution)) shown.push({ message, position });
  }

  return shown.reverse();
}

function readShownAt(path: Path, id: MessageId, execution: Execution): number | undefined {
  const position = path.at.get(id);
  const message = position === undefined ? undefined : path.messages[position];

  return message?.id === id && !belongsInQueue(message, execution) ? position : undefined;
}

function readHeld(state: FoldState, path: Path, resume: Resume, execution: Execution): Held | null {
  if (resume.seq < state.base) return null;

  if (resume.from === null) return { seq: resume.seq, before: Number.POSITIVE_INFINITY };
  const before = readShownAt(path, resume.from, execution);

  return before === undefined ? null : { seq: resume.seq, before };
}

function readHeadRow(state: FoldState, name: HeadName): HeadRow {
  const folded = readHead(state, name);

  return {
    name,
    revision: folded.revision,
    execution: folded.info.execution,
    reportsHeld: holdsReports(folded.info.execution),
    seenThrough: readSeenThrough(state, name),
    queue: readQueueIds(state.messages, folded),
  };
}

function readSettingsRow(state: FoldState, name: HeadName): HeadSettingsRow {
  const folded = readHead(state, name);

  return {
    name,
    configuration: folded.configuration,
    context: folded.context,
  };
}

function readUsageRow(state: FoldState, name: HeadName): HeadUsageRow {
  return { name, usage: state[INDEX].paths.get(name)?.usage.at(-1) ?? ZERO_USAGE };
}

function readHead(state: FoldState, name: HeadName): FoldHead {
  return state.heads.get(name) ?? emptyHead(name, { messages: [], turns: [] });
}

function readPathChange(state: FoldState, head: HeadName, position: number): PathChange {
  const path = state[INDEX].paths.get(head);

  if (path === undefined) return { head, after: null, ids: [] };
  const execution = state.heads.get(head)?.info.execution ?? IDLE;
  const start = Math.min(position, path.messages.length);

  let before = start - 1;

  while (before >= 0 && belongsInQueue(path.messages[before], execution)) before -= 1;

  return {
    head,
    after: path.messages[before]?.id ?? null,
    ids: path.messages
      .slice(start)
      .flatMap((message) => (belongsInQueue(message, execution) ? [] : [message.id])),
  };
}

function collect(state: FoldState, seq: Seq): Touched {
  const index = state[INDEX];
  const touched = newTouched();

  if (seq < index.ring.from) return scan(state, seq);
  const steps = index.ring.steps;
  let first = steps.length;

  while (first > 0 && steps[first - 1].seq > seq) first -= 1;

  for (const step of steps.slice(first)) {
    for (const table of TABLES) {
      for (const key of step.upsert[table]) touched.upsert[table].add(key);

      for (const key of step.drop[table]) touched.drop[table].add(key);
    }

    for (const [head, position] of step.paths)
      touched.paths.set(head, Math.min(position, touched.paths.get(head) ?? position));
  }

  return touched;
}

function scan(state: FoldState, seq: Seq): Touched {
  const index = state[INDEX];
  const touched = newTouched();

  for (const table of TABLES)
    for (const [key, stamp] of index.stamps[table]) if (stamp > seq) touched.upsert[table].add(key);

  for (const [head, path] of index.paths) {
    const edit = path.edits.find((entry) => entry.seq > seq);

    if (edit !== undefined) touched.paths.set(head, edit.position);
  }

  for (const [head, stamp] of index.stamps.heads)
    if (stamp > seq && !index.paths.has(asId<"head">(head)))
      touched.paths.set(asId<"head">(head), 0);

  return touched;
}

function everything(state: FoldState): Touched {
  const touched = newTouched();

  for (const view of state.partViews) touched.upsert.parts.add(view.id);

  for (const file of state.changes) touched.upsert.changes.add(file.path);

  for (const key of catalogRows(state.catalog).keys()) touched.upsert.catalog.add(key);

  return touched;
}

function readTables(state: FoldState, touched: Touched): TableChanges {
  return {
    messages: readTable(
      touched,
      "messages",
      () => (key) => state.messages.get(asId<"message">(key)),
    ),
    turns: readTable(touched, "turns", () => (key) => {
      const info = state.turns.get(asId<"turn">(key))?.info;

      return info !== undefined && showsTurn(state.messages, info) ? info : undefined;
    }),
    parts: readTable(touched, "parts", () => {
      const views = new Map<string, PartView>(state.partViews.map((view) => [view.id, view]));

      return (key) => views.get(key);
    }),
    changes: readTable(touched, "changes", () => {
      const files = new Map(state.changes.map((file) => [file.path, file]));

      return (key) => files.get(key);
    }),
    catalog: readTable(touched, "catalog", () => {
      const rows = catalogRows(state.catalog);

      return (key) => rows.get(key);
    }),
    heads: readTable(touched, "heads", () => (key) => {
      const name = asId<"head">(key);

      return state.heads.has(name) ? readHeadRow(state, name) : undefined;
    }),
    settings: readTable(touched, "settings", () => (key) => {
      const name = asId<"head">(key);

      return state.heads.has(name) ? readSettingsRow(state, name) : undefined;
    }),
    usage: readTable(touched, "usage", () => (key) => {
      const name = asId<"head">(key);

      return state.heads.has(name) ? readUsageRow(state, name) : undefined;
    }),
    background: readTable(touched, "background", () => {
      const rows = new Map(
        Array.from(state.heads, ([name, head]) => [
          ...backgroundRows(name, head.background),
        ]).flat(),
      );

      return (key) => rows.get(key);
    }),
  };
}

function omitEmpty(tables: TableChanges): SessionChange["tables"] {
  const sparse: { -readonly [T in keyof TableChanges]?: TableChanges[T] } = {};

  if (filled(tables.messages)) sparse.messages = tables.messages;

  if (filled(tables.turns)) sparse.turns = tables.turns;

  if (filled(tables.parts)) sparse.parts = tables.parts;

  if (filled(tables.changes)) sparse.changes = tables.changes;

  if (filled(tables.catalog)) sparse.catalog = tables.catalog;

  if (filled(tables.heads)) sparse.heads = tables.heads;

  if (filled(tables.settings)) sparse.settings = tables.settings;

  if (filled(tables.usage)) sparse.usage = tables.usage;

  if (filled(tables.background)) sparse.background = tables.background;

  return sparse;
}

function filled(change: {
  readonly upsert: readonly unknown[];
  readonly drop: readonly string[];
}): boolean {
  return change.upsert.length + change.drop.length > 0;
}

function readTable<Row>(
  touched: Touched,
  table: Table,
  reader: () => (key: string) => Row | undefined,
) {
  const keys = [...new Set([...touched.upsert[table], ...touched.drop[table]])];

  if (keys.length === 0) return { upsert: [], drop: [] };
  const read = reader();
  const rows = keys.map((key) => ({ key, row: read(key) }));

  return {
    upsert: rows.flatMap((entry) => (entry.row === undefined ? [] : [entry.row])),
    drop: rows.flatMap((entry) => (entry.row === undefined ? [entry.key] : [])),
  };
}

function groupCatalog(rows: readonly CatalogRow[]): SessionCatalogView {
  return {
    commands: rows.flatMap((row) => (row.kind === "commands" ? [row.entry] : [])),
    settings: rows.flatMap((row) => (row.kind === "settings" ? [row.entry] : [])),
    skills: rows.flatMap((row) => (row.kind === "skills" ? [row.entry] : [])),
    agents: rows.flatMap((row) => (row.kind === "agents" ? [row.entry] : [])),
    tools: rows.flatMap((row) => (row.kind === "tools" ? [row.entry] : [])),
  };
}
