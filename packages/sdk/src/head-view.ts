import type {
  CatalogRow,
  Execution,
  Message,
  QueuedMessage,
  SessionCatalogView,
  SessionView,
  TurnInfo,
  Usage,
} from "@nyte-ai/schema";
import type { HeadSnapshot } from "./live-head.ts";

export type HeadView = Omit<SessionView, "seq">;

type Built = { readonly snapshot: HeadSnapshot; readonly view: HeadView };

const IDLE: Execution = { kind: "idle", lastRun: null };

const UNCONFIGURED: HeadView["configuration"] = { selected: null, effective: null };

const NO_CONTEXT: HeadView["context"] = { tokens: 0, window: 0, lastRequest: null };

const NO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const built = new WeakMap<object, Built>();

export function headView(snapshot: HeadSnapshot): HeadView {
  const known = built.get(snapshot);

  if (known !== undefined) return known.view;
  const previous = findBuilt(snapshot);
  const view = buildView(snapshot, previous);
  const entry = { snapshot, view };
  built.set(snapshot, entry);
  built.set(snapshot.order, entry);

  for (const table of Object.values(snapshot.rows)) built.set(table, entry);

  return view;
}

function findBuilt(snapshot: HeadSnapshot): Built | undefined {
  const keys: readonly object[] = [snapshot.order, ...Object.values(snapshot.rows)];

  for (const key of keys) {
    const found = built.get(key);

    if (found !== undefined && found.snapshot.head === snapshot.head) return found;
  }

  return undefined;
}

function buildView(snapshot: HeadSnapshot, previous: Built | undefined): HeadView {
  const rows = snapshot.rows;
  const before = previous?.snapshot.rows;
  const last = previous?.view;
  const head = rows.heads.get(snapshot.head);
  const settings = rows.settings.get(snapshot.head);

  const messages =
    last !== undefined &&
    previous?.snapshot.order === snapshot.order &&
    before?.messages === rows.messages
      ? last.messages
      : reuse(
          last?.messages,
          snapshot.order.flatMap((id) => {
            const message = rows.messages.get(id);

            return message === undefined ? [] : [message];
          }),
        );

  const turns =
    last !== undefined && last.messages === messages && before?.turns === rows.turns
      ? last.turns
      : reuse(last?.turns, windowTurns(messages, rows.turns));

  const queue =
    last !== undefined &&
    before?.messages === rows.messages &&
    before.heads.get(snapshot.head) === head
      ? last.queue
      : reuse(
          last?.queue,
          (head?.queue ?? []).flatMap((id) => {
            const message = rows.messages.get(id);

            return message !== undefined && waitsInQueue(message) ? [message] : [];
          }),
        );

  const background =
    last !== undefined && before?.background === rows.background
      ? last.background
      : reuse(
          last?.background,
          Array.from(rows.background.values()).flatMap((row) =>
            row.head === snapshot.head ? [row.item] : [],
          ),
        );

  const parts =
    last !== undefined && before?.parts === rows.parts
      ? last.parts
      : reuse(last?.parts, Array.from(rows.parts.values()));

  const changes =
    last !== undefined && before?.changes === rows.changes
      ? last.changes
      : reuse(last?.changes, Array.from(rows.changes.values()));

  const catalog =
    last !== undefined && before?.catalog === rows.catalog
      ? last.catalog
      : groupCatalog(Array.from(rows.catalog.values()), last?.catalog);

  const prompt =
    snapshot.leadingPrompt === null ? undefined : rows.messages.get(snapshot.leadingPrompt);

  const next: HeadView = {
    revision: head?.revision ?? null,
    activation: snapshot.activation,
    messages,
    queue,
    leadingPrompt: prompt?.kind === "user" ? prompt : null,
    parts,
    turns,
    usage: rows.usage.get(snapshot.head)?.usage ?? NO_USAGE,
    execution: head?.execution ?? IDLE,
    reportsHeld: head?.reportsHeld ?? false,
    background,
    configuration: settings?.configuration ?? UNCONFIGURED,
    context: settings?.context ?? NO_CONTEXT,
    changes,
    catalog,
    seenThrough: head?.seenThrough ?? null,
  };

  return last !== undefined &&
    last.revision === next.revision &&
    last.activation === next.activation &&
    last.messages === next.messages &&
    last.queue === next.queue &&
    last.leadingPrompt === next.leadingPrompt &&
    last.parts === next.parts &&
    last.turns === next.turns &&
    last.usage === next.usage &&
    last.execution === next.execution &&
    last.reportsHeld === next.reportsHeld &&
    last.background === next.background &&
    last.configuration === next.configuration &&
    last.context === next.context &&
    last.changes === next.changes &&
    last.catalog === next.catalog &&
    last.seenThrough === next.seenThrough
    ? last
    : next;
}

function windowTurns(
  messages: readonly Message[],
  turns: ReadonlyMap<string, TurnInfo>,
): readonly TurnInfo[] {
  const ids = new Set(messages.map((message) => message.turn));

  return Array.from(ids).flatMap((id) => {
    const turn = turns.get(id);

    return turn === undefined ? [] : [turn];
  });
}

function waitsInQueue(message: Message): message is QueuedMessage {
  if (message.kind !== "user") return false;

  if (message.status.kind === "unsent") return true;

  return message.status.kind === "pending" && message.status.schedule.kind !== "joined";
}

function groupCatalog(
  rows: readonly CatalogRow[],
  previous: SessionCatalogView | undefined,
): SessionCatalogView {
  const next: SessionCatalogView = {
    commands: reuse(
      previous?.commands,
      rows.flatMap((row) => (row.kind === "commands" ? [row.entry] : [])),
    ),
    settings: reuse(
      previous?.settings,
      rows.flatMap((row) => (row.kind === "settings" ? [row.entry] : [])),
    ),
    skills: reuse(
      previous?.skills,
      rows.flatMap((row) => (row.kind === "skills" ? [row.entry] : [])),
    ),
    agents: reuse(
      previous?.agents,
      rows.flatMap((row) => (row.kind === "agents" ? [row.entry] : [])),
    ),
    tools: reuse(
      previous?.tools,
      rows.flatMap((row) => (row.kind === "tools" ? [row.entry] : [])),
    ),
  };

  return previous !== undefined &&
    next.commands === previous.commands &&
    next.settings === previous.settings &&
    next.skills === previous.skills &&
    next.agents === previous.agents &&
    next.tools === previous.tools
    ? previous
    : next;
}

function reuse<T>(previous: readonly T[] | undefined, next: readonly T[]): readonly T[] {
  return previous !== undefined &&
    previous.length === next.length &&
    previous.every((item, index) => item === next[index])
    ? previous
    : next;
}
