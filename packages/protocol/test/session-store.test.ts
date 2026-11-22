import { changesSince, readWindow } from "@nyte-ai/core";
import { decodeFoldCheckpoint, emptyFold, encodeFoldCheckpoint, fold } from "@nyte-ai/core/testing";
import { asId, backgroundRowKey, catalogRowKey } from "@nyte-ai/schema";
import type {
  HeadName,
  HeadWindow,
  Resume,
  SessionEvent,
  SessionId,
  WindowSpec,
} from "@nyte-ai/schema";
import { beforeAll, describe, expect, it } from "vitest";
import { openDirectoryStore, openSessionStore } from "../src/index.ts";
import type { DirectoryWindow, SessionSnapshot, SessionStore } from "../src/index.ts";
import { fakeModels, open } from "./fake-models.ts";
import type { Composed, FakeModels } from "./fake-models.ts";
import { interleave, MAIN, random, recordLong, recordSessions } from "./sessions.ts";
import type { Recorded } from "./sessions.ts";

type FoldState = ReturnType<typeof emptyFold>;

interface Log {
  readonly recorded: Recorded;
  readonly events: readonly SessionEvent[];
}

const SEED = 20_261_102;

const CLIENTS = 300;

const PRINCIPAL = "local";

interface Schedule {
  readonly id: string;
  readonly head: HeadName;
  readonly spec: "from" | number;
  readonly attach: number;
  readonly check: number;
  readonly emits: ReadonlySet<number>;
  readonly drops: ReadonlyMap<number, number>;
}

interface Client {
  readonly schedule: Schedule;
  readonly trace: string[];
  spec: WindowSpec;
  store: SessionStore | null;
  connected: boolean;
}

let logs: readonly Log[] = [];

let keptResumes = 0;

beforeAll(async () => {
  const recorded = [...(await recordSessions()), await recordLong(80)];
  const next = random(SEED);

  logs = recorded.flatMap((entry) => [
    { recorded: entry, events: interleave(entry, next, PRINCIPAL) },
    { recorded: entry, events: interleave(entry, next, PRINCIPAL) },
  ]);
}, 60_000);

type Kept = "all" | "some" | "none";

interface Away {
  readonly attach: number;
  readonly resume: number;
}

interface HeadCase {
  readonly name: string;
  readonly recording: string;
  readonly tail: number;
  readonly away: (recorded: Recorded) => Away;
  readonly restore?: boolean;
  readonly describes: boolean;
  readonly kept: Kept;
  readonly sends?: number;
}

const HEAD_CASES: readonly HeadCase[] = [
  {
    name: "nothing moved",
    recording: "long",
    tail: 40,
    away: (recorded) => ({
      attach: orderMoves(recorded)[60],
      resume: orderMoves(recorded)[61] - 1,
    }),
    describes: true,
    kept: "all",
    sends: 0,
  },
  {
    name: "one message landed",
    recording: "long",
    tail: 40,
    away: (recorded) => ({ attach: orderMoves(recorded)[60], resume: orderMoves(recorded)[61] }),
    describes: true,
    kept: "some",
    sends: 1,
  },
  {
    name: "a turn landed",
    recording: "long",
    tail: 40,
    away: (recorded) => ({ attach: orderMoves(recorded)[60], resume: orderMoves(recorded)[63] }),
    describes: true,
    kept: "some",
    sends: 3,
  },
  {
    name: "the window's start moved past every id the client held",
    recording: "long",
    tail: 2,
    away: (recorded) => ({ attach: orderMoves(recorded)[60], resume: orderMoves(recorded)[63] }),
    describes: true,
    kept: "none",
  },
  {
    name: "a message was removed",
    recording: "replace",
    tail: 40,
    away: (recorded) => around(headMoves(recorded)[0]),
    describes: true,
    kept: "none",
  },
  {
    name: "the head moved to another branch",
    recording: "replace",
    tail: 40,
    away: (recorded) => around(headMoves(recorded)[1]),
    describes: true,
    kept: "none",
  },
  {
    name: "a compaction",
    recording: "compaction",
    tail: 40,
    away: (recorded) => ({ attach: orderMoves(recorded)[3], resume: recorded.events.length }),
    describes: true,
    kept: "all",
    sends: 4,
  },
  {
    name: "a seq too old to diff",
    recording: "long",
    tail: 40,
    away: (recorded) => ({
      attach: orderMoves(recorded)[60],
      resume: orderMoves(recorded)[61] - 1,
    }),
    restore: true,
    describes: true,
    kept: "all",
    sends: 0,
  },
  {
    name: "a client that sends no held",
    recording: "long",
    tail: 40,
    away: (recorded) => ({
      attach: orderMoves(recorded)[60],
      resume: orderMoves(recorded)[61] - 1,
    }),
    describes: false,
    kept: "none",
  },
];

interface SessionsCase {
  readonly name: string;
  readonly limit: number;
  readonly away: (
    host: Composed,
    fake: FakeModels,
    sessions: readonly SessionId[],
  ) => Promise<void>;
  readonly describes: boolean;
  readonly kept: boolean;
}

const SESSIONS_CASES: readonly SessionsCase[] = [
  { name: "nothing moved", limit: 50, away: async () => undefined, describes: true, kept: true },
  {
    name: "a listed session moved up",
    limit: 50,
    away: (host, fake, sessions) => sendTo(host, fake, sessions[0]),
    describes: true,
    kept: true,
  },
  {
    name: "a session started",
    limit: 50,
    away: async (host, fake) => {
      await startSession(host, fake);
    },
    describes: true,
    kept: false,
  },
  {
    name: "a session was removed",
    limit: 50,
    away: async (host, _fake, sessions) => {
      await host.session(sessions[1] ?? asId("missing")).remove();
    },
    describes: true,
    kept: false,
  },
  {
    name: "a session moved into the window and pushed one out",
    limit: 2,
    away: (host, fake, sessions) => sendTo(host, fake, sessions[0]),
    describes: true,
    kept: false,
  },
  {
    name: "a client that sends no held",
    limit: 50,
    away: async () => undefined,
    describes: false,
    kept: false,
  },
];

describe("a resume that describes what the client holds", () => {
  it.each(HEAD_CASES)("ends with the head's rows and order a fresh read gives: $name", (entry) => {
    const recorded = logs.find((log) => log.recorded.name === entry.recording)?.recorded;

    if (recorded === undefined) throw new Error(`No ${entry.recording} recording.`);
    const away = entry.away(recorded);
    const spec = { tail: entry.tail };
    const attached = foldTo(recorded, away.attach);
    const store = openSessionStore(structuredClone(readWindow(attached, MAIN, spec, null)));
    const held = store.snapshot().order.length;
    const resumed = foldTo(recorded, away.resume);
    const state = entry.restore === true ? restoreCheckpoint(resumed) : resumed;
    const point = store.describe();
    const resume: Resume = entry.describes ? point : { seq: point.seq, from: point.from };
    const answer = structuredClone(readWindow(state, MAIN, spec, resume));

    expect(away.resume).toBeGreaterThan(away.attach);
    expect(state.base > store.seq).toBe(entry.restore === true);
    store.resume(answer);

    expect(differ(store.snapshot(), readWindow(state, MAIN, spec, null), MAIN)).toBeNull();
    expect(store.stale).toBe(false);
    expect(readKept(answer.kept, held)).toBe(entry.kept);

    if (entry.sends !== undefined) expect(answer.order).toHaveLength(entry.sends);
  });

  it.each(SESSIONS_CASES)(
    "ends with the session list's rows and ids a fresh read gives: $name",
    async (entry) => {
      const fake = fakeModels();
      await using host = await open(fake, []);
      const sessions: SessionId[] = [];

      for (let index = 0; index < 3; index += 1) sessions.push(await startSession(host, fake));
      const window: DirectoryWindow = { parents: { kind: "roots" }, limit: entry.limit };
      const store = openDirectoryStore(await host.sessions.read(window), window);
      await entry.away(host, fake, sessions);
      const point = store.describe();

      const answer = await host.sessions.read({
        ...window,
        resume: entry.describes ? point : { seq: point.seq },
      });

      store.resume(answer);
      const fresh = openDirectoryStore(await host.sessions.read(window), window).snapshot();

      expect(store.snapshot()).toEqual(fresh);
      expect(answer.kept !== undefined).toBe(entry.kept);

      if (entry.kept) expect(answer.ids).toEqual([]);
    },
    30_000,
  );
});

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
    expect(logs.length * CLIENTS).toBeGreaterThanOrEqual(2000);
    expect(keptResumes).toBeGreaterThan(500);
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

  it("holds what a fresh read holds when a head moves right after the host restores a checkpoint", () => {
    const log = logs.find((entry) => entry.recorded.name === "replace");

    if (log === undefined) throw new Error("No replace recording.");

    const schedule: Schedule = {
      id: "replace/moved",
      head: MAIN,
      spec: 1,
      attach: 37,
      check: 39,
      emits: new Set([39]),
      drops: new Map([[38, 38]]),
    };

    expect(log.recorded.events[38]).toMatchObject({ kind: "head", reason: "moved" });
    expect(
      simulate(
        { recorded: log.recorded, events: log.recorded.events },
        [schedule],
        38,
        random(SEED),
      ),
    ).toEqual([]);
  });
});

function foldTo(recorded: Recorded, point: number): FoldState {
  return recorded.events
    .slice(0, point)
    .reduce(
      (state, event) => fold(state, event),
      emptyFold({ session: recorded.session, principal: asId(PRINCIPAL) }),
    );
}

function orderMoves(recorded: Recorded): readonly number[] {
  let state = emptyFold({ session: recorded.session, principal: asId(PRINCIPAL) });
  const read = () => JSON.stringify(readWindow(state, MAIN, { tail: 1_000_000 }, null).order);

  const orders = [
    read(),
    ...recorded.events.map((event) => {
      state = fold(state, event);

      return read();
    }),
  ];

  return orders.flatMap((order, point) =>
    point > 0 && order === orders[point - 1] ? [] : [point],
  );
}

function headMoves(recorded: Recorded): readonly number[] {
  return recorded.events.flatMap((event, index) =>
    event.kind === "head" && event.reason === "moved" && event.head === MAIN ? [index + 1] : [],
  );
}

function around(point: number | undefined): Away {
  if (point === undefined) throw new Error("The recording never moves its head.");

  return { attach: point - 1, resume: point };
}

function readKept(kept: number | undefined, held: number): Kept {
  if (kept === undefined) return "none";

  return kept === held ? "all" : "some";
}

async function startSession(host: Composed, fake: FakeModels): Promise<SessionId> {
  fake.reply({ content: [{ type: "text", text: "Hello." }] });
  const started = await host.sessions.start({ content: "Hi." });
  await started.receipt.settled();

  return started.session.id;
}

async function sendTo(host: Composed, fake: FakeModels, session: SessionId | undefined) {
  if (session === undefined) throw new Error("No session to send to.");
  fake.reply({ content: [{ type: "text", text: "Again." }] });
  await (await host.session(session).send("Again.")).settled();
}

function simulate(
  log: Log,
  schedules: readonly Schedule[],
  restore: number | null,
  next: () => number,
): readonly string[] {
  const clients = schedules.map(openClient);
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
    ) {
      settled.push(point);
    }
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

function openClient(schedule: Schedule): Client {
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

  if ([...schedule.drops.values()].includes(point) && !client.connected) {
    resume(client, store, state, point, next);
  }

  if (client.connected && (schedule.emits.has(point) || point === schedule.check)) {
    const change = structuredClone(changesSince(state, store.seq));
    store.apply(change);

    if (next() < 0.1) store.apply(change);
    client.trace.push(`apply@${point}`);

    if (store.stale) resume(client, store, state, point, next);
  }

  if (point !== schedule.check) return null;

  if (!client.connected) resume(client, store, state, point, next);

  return compare(client, store.snapshot(), state);
}

function resume(
  client: Client,
  store: SessionStore,
  state: FoldState,
  point: number,
  next: () => number,
): void {
  const described = store.describe();
  const describes = next() < 0.5;

  const window = readWindow(
    state,
    client.schedule.head,
    client.spec,
    describes ? described : { seq: described.seq, from: described.from },
  );

  store.resume(structuredClone(window));
  keptResumes += window.kept === undefined ? 0 : 1;
  client.connected = true;
  client.trace.push(`resume@${point}${window.kept === undefined ? "" : ` kept ${window.kept}`}`);
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
  if (JSON.stringify(snapshot.order) !== JSON.stringify(expected.order)) {
    return `order ${JSON.stringify(snapshot.order)} != ${JSON.stringify(expected.order)}`;
  }

  if (snapshot.leadingPrompt !== expected.leadingPrompt) {
    return `leadingPrompt ${snapshot.leadingPrompt} != ${expected.leadingPrompt}`;
  }
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

    if (JSON.stringify(have) !== JSON.stringify(row)) {
      return `${table} ${key}: ${JSON.stringify(have)} != ${JSON.stringify(row)}`;
    }
  }

  if (!exact || held.size === expected.length) return null;
  const keys = new Set(expected.map((entry) => entry[0]));

  return `${table} holds ${[...held.keys()].filter((key) => !keys.has(key)).join(", ")}`;
}
