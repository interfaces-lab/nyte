import { changesSince, readWindow } from "@nyte-ai/core";
import { decodeFoldCheckpoint, emptyFold, encodeFoldCheckpoint, fold } from "@nyte-ai/core/testing";
import { asId, backgroundRowKey, catalogRowKey } from "@nyte-ai/schema";
import type { HeadName, HeadWindow, SessionEvent, WindowSpec } from "@nyte-ai/schema";
import { beforeAll, describe, expect, it } from "vitest";
import { openSessionStore } from "../src/index.ts";
import type { SessionSnapshot, SessionStore } from "../src/index.ts";
import { interleave, random, recordLong, recordSessions } from "./sessions.ts";
import type { Recorded } from "./sessions.ts";

type FoldState = ReturnType<typeof emptyFold>;

type Log = { readonly recorded: Recorded; readonly events: readonly SessionEvent[] };

const SEED = 20_261_102;

const CLIENTS = 300;

const PRINCIPAL = "local";

type Schedule = {
  readonly id: string;
  readonly head: HeadName;
  readonly spec: "from" | number;
  readonly attach: number;
  readonly check: number;
  readonly emits: ReadonlySet<number>;
  readonly drops: ReadonlyMap<number, number>;
};

type Client = {
  readonly schedule: Schedule;
  readonly trace: string[];
  spec: WindowSpec;
  store: SessionStore | null;
  connected: boolean;
};

let logs: readonly Log[] = [];

beforeAll(async () => {
  const recorded = [...(await recordSessions()), await recordLong(80)];
  const next = random(SEED);

  logs = recorded.flatMap((entry) => [
    { recorded: entry, events: interleave(entry, next, PRINCIPAL) },
    { recorded: entry, events: interleave(entry, next, PRINCIPAL) },
  ]);
}, 60_000);

describe("session store", () => {
  it("holds what a fresh read holds after any attach, changes, drop and resume", () => {
    const next = random(SEED + 1);

    const failures = logs.flatMap((log, index) =>
      simulate(
        log,
        Array.from({ length: CLIENTS }, (_, client) =>
          plan(`${log.recorded.name}#${index}/${client}`, log, next),
        ),
        null,
        next,
      ),
    );

    expect(failures.slice(0, 3)).toEqual([]);
    expect(logs.length * CLIENTS).toBeGreaterThanOrEqual(2_000);
  });

  it("holds what a fresh read holds after the host restores a checkpoint newer than the store", () => {
    const next = random(SEED + 2);

    const failures = logs.flatMap((log, index) => {
      const restore = pickRestore(log, next);

      return simulate(
        log,
        Array.from({ length: CLIENTS }, (_, client) =>
          restarted(
            plan(`${log.recorded.name}#${index}/${client}@${restore}`, log, next),
            restore,
            next,
          ),
        ),
        restore,
        next,
      );
    });

    expect(failures.slice(0, 3)).toEqual([]);
  });
});

function simulate(
  log: Log,
  schedules: readonly Schedule[],
  restore: number | null,
  next: () => number,
): readonly string[] {
  const clients = schedules.map(open);
  const failures: string[] = [];
  let state = emptyFold({ session: log.recorded.session, principal: asId(PRINCIPAL) });

  for (let point = 0; point <= log.events.length; point += 1) {
    if (point > 0) state = fold(state, log.events[point - 1]);

    if (point === restore) state = restoreCheckpoint(state);

    for (const client of clients) {
      const failure = step(client, state, point, next);

      if (failure !== null) failures.push(failure);
    }
  }

  return failures;
}

function restoreCheckpoint(state: FoldState): FoldState {
  const body = encodeFoldCheckpoint(state);

  const restored =
    body === null ? null : decodeFoldCheckpoint(body, state.session, state.principal);

  if (restored === null) throw new Error(`The fold at seq ${state.seq} does not round-trip.`);

  return restored;
}

function pickRestore(log: Log, next: () => number): number {
  const length = log.events.length;
  const settled: number[] = [];
  let state = emptyFold({ session: log.recorded.session, principal: asId(PRINCIPAL) });

  for (const [index, event] of log.events.entries()) {
    state = fold(state, event);
    const point = index + 1;

    if (
      point > 1 &&
      point < length &&
      [...state.heads.values()].every(
        (head) => head.info.execution.kind === "idle" && head.live.length === 0,
      )
    )
      settled.push(point);
  }

  const point = settled[Math.floor(next() * settled.length)];

  if (point === undefined) throw new Error(`${log.recorded.name} never settles.`);

  return point;
}

function restarted(schedule: Schedule, restore: number, next: () => number): Schedule {
  const attach = Math.floor(next() * restore);
  const check = Math.max(schedule.check, restore + 1);
  const dropped = attach + 1 + Math.floor(next() * (restore - attach));
  const resumed = restore + 1 + Math.floor(next() * (check - restore));

  return {
    ...schedule,
    attach,
    check,
    emits: new Set([...schedule.emits].filter((point) => point > attach && point <= check)),
    drops: new Map([[dropped, resumed]]),
  };
}

function plan(id: string, log: Log, next: () => number): Schedule {
  const length = log.events.length;
  const attach = Math.floor(next() * length);
  const check = attach + 1 + Math.floor(next() * (length - attach));
  const rate = next() < 0.1 ? 0 : 0.02 + next() * 0.5;

  const emits = new Set(
    Array.from({ length: check - attach }, (_, offset) => attach + 1 + offset).filter(
      () => next() < rate,
    ),
  );

  const drops = new Map<number, number>();

  for (let count = Math.floor(next() * 3); count > 0 && check - attach > 2; count -= 1) {
    const from = attach + 1 + Math.floor(next() * (check - attach - 1));
    drops.set(from, from + 1 + Math.floor(next() * (check - from)));
  }

  const heads = log.recorded.heads;
  const choice = next();

  return {
    id,
    head: heads[Math.floor(next() * heads.length)],
    spec: choice < 0.25 ? "from" : choice < 0.5 ? 200 : 1 + Math.floor(next() * 12),
    attach,
    check,
    emits,
    drops,
  };
}

function open(schedule: Schedule): Client {
  return { schedule, trace: [], spec: { tail: 200 }, store: null, connected: false };
}

function step(client: Client, state: FoldState, point: number, next: () => number): string | null {
  const schedule = client.schedule;

  if (point === schedule.attach) {
    client.spec = pickSpec(state, schedule, next);
    client.store = openSessionStore(
      structuredClone(readWindow(state, schedule.head, client.spec, null)),
    );
    client.connected = true;
    client.trace.push(`attach@${point} ${JSON.stringify(client.spec)}`);

    return null;
  }

  const store = client.store;

  if (store === null || point <= schedule.attach || point > schedule.check) return null;

  if ([...schedule.drops.keys()].includes(point) && client.connected) {
    client.connected = false;
    client.trace.push(`drop@${point}`);
  }

  if ([...schedule.drops.values()].includes(point) && !client.connected)
    resume(client, store, state, point);

  if (client.connected && (schedule.emits.has(point) || point === schedule.check)) {
    const change = structuredClone(changesSince(state, store.seq));
    store.apply(change);

    if (next() < 0.1) store.apply(change);
    client.trace.push(`apply@${point}`);

    if (store.stale) resume(client, store, state, point);
  }

  if (point !== schedule.check) return null;

  if (!client.connected) resume(client, store, state, point);

  return compare(client, store.snapshot(), state);
}

function resume(client: Client, store: SessionStore, state: FoldState, point: number): void {
  const snapshot = store.snapshot();

  const window = readWindow(state, client.schedule.head, client.spec, {
    seq: store.seq,
    from: snapshot.order[0] ?? null,
  });

  store.resume(structuredClone(window));
  client.connected = true;
  client.trace.push(`resume@${point}`);
}

function pickSpec(state: FoldState, schedule: Schedule, next: () => number): WindowSpec {
  if (schedule.spec !== "from") return { tail: schedule.spec };
  const order = readWindow(state, schedule.head, { tail: 1_000_000 }, null).order;
  const from = order[Math.floor(next() * order.length)];

  return from === undefined ? { tail: 200 } : { from };
}

function compare(client: Client, snapshot: SessionSnapshot, state: FoldState): string | null {
  const head = client.schedule.head;
  const first = snapshot.order[0];

  const expected = readWindow(
    state,
    head,
    first === undefined ? client.spec : { from: first },
    null,
  );

  const failure = differ(snapshot, expected, head);

  return failure === null
    ? null
    : `${client.schedule.id} at seq ${state.seq}: ${failure} [${client.trace.join(" ")}]`;
}

function differ(snapshot: SessionSnapshot, expected: HeadWindow, head: HeadName): string | null {
  if (JSON.stringify(snapshot.order) !== JSON.stringify(expected.order))
    return `order ${JSON.stringify(snapshot.order)} != ${JSON.stringify(expected.order)}`;

  if (snapshot.leadingPrompt !== expected.leadingPrompt)
    return `leadingPrompt ${snapshot.leadingPrompt} != ${expected.leadingPrompt}`;
  const rows = snapshot.rows;
  const tables = expected.tables;

  return (
    rowsDiffer(
      "messages",
      rows.messages,
      tables.messages.upsert.map((row) => [row.id, row]),
      false,
    ) ??
    rowsDiffer(
      "turns",
      rows.turns,
      tables.turns.upsert.map((row) => [row.id, row]),
      false,
    ) ??
    rowsDiffer(
      "parts",
      rows.parts,
      tables.parts.upsert.map((row) => [row.id, row]),
      true,
    ) ??
    rowsDiffer(
      "changes",
      rows.changes,
      tables.changes.upsert.map((row) => [row.path, row]),
      true,
    ) ??
    rowsDiffer(
      "catalog",
      rows.catalog,
      tables.catalog.upsert.map((row) => [catalogRowKey(row), row]),
      true,
    ) ??
    rowsDiffer(
      "heads",
      new Map([...rows.heads].filter(([key]) => key === head)),
      tables.heads.upsert.map((row) => [row.name, row]),
      true,
    ) ??
    rowsDiffer(
      "settings",
      new Map([...rows.settings].filter(([key]) => key === head)),
      tables.settings.upsert.map((row) => [row.name, row]),
      true,
    ) ??
    rowsDiffer(
      "usage",
      new Map([...rows.usage].filter(([key]) => key === head)),
      tables.usage.upsert.map((row) => [row.name, row]),
      true,
    ) ??
    rowsDiffer(
      "background",
      new Map([...rows.background].filter(([key]) => key.startsWith(`${head}/`))),
      tables.background.upsert.map((row) => [backgroundRowKey(row), row]),
      true,
    )
  );
}

function rowsDiffer(
  table: string,
  held: ReadonlyMap<string, unknown>,
  expected: readonly (readonly [string, unknown])[],
  exact: boolean,
): string | null {
  for (const [key, row] of expected) {
    const have = held.get(key);

    if (JSON.stringify(have) !== JSON.stringify(row))
      return `${table} ${key}: ${JSON.stringify(have)} != ${JSON.stringify(row)}`;
  }

  if (!exact || held.size === expected.length) return null;
  const keys = new Set(expected.map((entry) => entry[0]));

  return `${table} holds ${[...held.keys()].filter((key) => !keys.has(key)).join(", ")}`;
}
