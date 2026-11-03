import { SdkError } from "@nyte-ai/sdk";
import type { HeadName, SessionId, SessionInfo, SessionView } from "@nyte-ai/sdk";
import type {
  HeadSnapshot,
  HeadStore,
  HostConnection,
  SessionsSnapshot,
  SessionsStore,
} from "@nyte-ai/sdk/client";
import { asId } from "@nyte-ai/schema";
import type { CatalogRow } from "@nyte-ai/schema";

export interface LiveSource<T> {
  readonly latest: () => T | undefined;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface LiveScript {
  readonly views: (session: SessionId) => LiveSource<SessionView> | undefined;
  readonly sessions: LiveSource<readonly SessionInfo[]>;
  readonly children: (parent: SessionId) => readonly SessionInfo[];
}

const OPEN = { kind: "open", since: 0 } as const;

const refuse = async (): Promise<never> => {
  throw new SdkError("unavailable", "Not scripted.");
};

export function scriptedLive(script: LiveScript): HostConnection {
  return {
    address: "http://scripted.test",
    hostId: asId<"host">("scripted"),
    health: { subscribe: () => () => undefined, snapshot: () => OPEN },
    retry: () => undefined,
    wake: () => undefined,
    release: () => undefined,
    call: refuse,
    head: (session, head) => headStore(script.views(session), head),
    directory(window) {
      const parents = window?.parents;

      if (parents?.kind === "children")
        return sessionsStore(constant(script.children(parents.session)));

      return sessionsStore(script.sessions);
    },
    text: () => () => undefined,
    clients: () => ({
      subscribe: () => () => undefined,
      snapshot: () => new Map(),
      close: () => undefined,
    }),
    perform: refuse,
    offer: () => () => undefined,
  };
}

export function constant<T>(value: T): LiveSource<T> {
  return { latest: () => value, subscribe: () => () => undefined };
}

const MISSING = new SdkError("unknown", "No view scripted.");

function headStore(source: LiveSource<SessionView> | undefined, head: HeadName): HeadStore {
  let view: SessionView | undefined;
  let snapshot: HeadSnapshot | null = null;

  const read = (): HeadSnapshot | null => {
    const latest = source?.latest();

    if (latest !== view) {
      view = latest;
      snapshot = latest === undefined ? null : keepSnapshot(viewSnapshot(latest, head), snapshot);
    }

    return snapshot;
  };

  return {
    subscribe: (listener) => source?.subscribe(listener) ?? (() => undefined),
    snapshot: read,
    freshness: () =>
      view === undefined
        ? { kind: "stale", since: 0, error: source === undefined ? MISSING : null }
        : { kind: "fresh", seq: view.seq },
    close: () => undefined,
  };
}

function keepSnapshot(next: HeadSnapshot, previous: HeadSnapshot | null): HeadSnapshot {
  if (previous === null) return next;
  const before = previous.rows;
  const after = next.rows;

  return {
    ...next,
    order: sameJson(next.order, previous.order) ? previous.order : next.order,
    rows: {
      messages: keepTable(after.messages, before.messages),
      turns: keepTable(after.turns, before.turns),
      parts: keepTable(after.parts, before.parts),
      changes: keepTable(after.changes, before.changes),
      catalog: keepTable(after.catalog, before.catalog),
      heads: keepTable(after.heads, before.heads),
      settings: keepTable(after.settings, before.settings),
      usage: keepTable(after.usage, before.usage),
      background: keepTable(after.background, before.background),
    },
  };
}

function keepTable<Row>(
  next: ReadonlyMap<string, Row>,
  previous: ReadonlyMap<string, Row>,
): ReadonlyMap<string, Row> {
  const rows = new Map(
    [...next].map(([key, row]) => {
      const held = previous.get(key);

      return [key, held !== undefined && sameJson(held, row) ? held : row] as const;
    }),
  );

  return rows.size === previous.size && [...rows].every(([key, row]) => previous.get(key) === row)
    ? previous
    : rows;
}

function sameJson<T>(left: T, right: T): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function sessionsStore(source: LiveSource<readonly SessionInfo[]>): SessionsStore {
  let rows: readonly SessionInfo[] | undefined;
  let snapshot: SessionsSnapshot | null = null;

  return {
    subscribe: source.subscribe,
    snapshot() {
      const latest = source.latest();

      if (latest !== rows) {
        rows = latest;
        snapshot =
          latest === undefined
            ? null
            : {
                ids: latest.map((row) => row.id),
                rows: new Map(latest.map((row) => [row.id, row])),
                activations: new Map(),
              };
      }

      return snapshot;
    },
    freshness: () => ({ kind: "fresh", seq: 0 }),
    close: () => undefined,
  };
}

export function viewSnapshot(view: SessionView, head: HeadName): HeadSnapshot {
  const messages = [
    ...(view.leadingPrompt === null ? [] : [view.leadingPrompt]),
    ...view.messages,
    ...view.queue,
  ];

  return {
    head,
    order: view.messages.map((message) => message.id),
    leadingPrompt: view.leadingPrompt?.id ?? null,
    activation: view.activation,
    rows: {
      messages: new Map(messages.map((message) => [message.id, message])),
      turns: new Map(view.turns.map((turn) => [turn.id, turn])),
      parts: new Map(view.parts.map((part) => [part.id, part])),
      changes: new Map(view.changes.map((change) => [change.path, change])),
      catalog: new Map(
        [
          ...view.catalog.commands.map((entry) => ({ kind: "commands" as const, entry })),
          ...view.catalog.settings.map((entry) => ({ kind: "settings" as const, entry })),
          ...view.catalog.skills.map((entry) => ({ kind: "skills" as const, entry })),
          ...view.catalog.agents.map((entry) => ({ kind: "agents" as const, entry })),
          ...view.catalog.tools.map((entry) => ({ kind: "tools" as const, entry })),
        ].map((row, index): [string, CatalogRow] => [`${row.kind}/${String(index)}`, row]),
      ),
      heads: new Map([
        [
          head,
          {
            name: head,
            revision: view.revision,
            execution: view.execution,
            reportsHeld: view.reportsHeld,
            seenThrough: view.seenThrough,
            queue: view.queue.map((message) => message.id),
          },
        ],
      ]),
      settings: new Map([
        [head, { name: head, configuration: view.configuration, context: view.context }],
      ]),
      usage: new Map([[head, { name: head, usage: view.usage }]]),
      background: new Map(
        view.background.map((item) => [`${head}/${item.kind}/${item.id}`, { head, item }]),
      ),
    },
  };
}
