import { isJson, isJsonObject, SdkError } from "@nyte-ai/schema";
import type {
  Awaitable,
  CallId,
  HeadName,
  Json,
  PartId,
  PrincipalId,
  RefUpdate,
  RunId,
  SessionId,
  WaitOutcome,
} from "@nyte-ai/schema";
import type { Kernel, StepEnd, StepOutcome } from "../contract/kernel.ts";
import { decodePartRecord } from "../contract/records.ts";
import type { CallRecord } from "../contract/records.ts";
import type { Durable } from "../contract/tools.ts";
import { changeCall } from "../fold/commit.ts";
import { storedAnswer } from "../store/parts.ts";
import { partRef } from "../store/refs.ts";
import { load, put, readCall } from "../store/session.ts";
import { waitIndex } from "../store/wait-index.ts";
import { dev } from "../util/dev-log.ts";
import { holdLease } from "./lease.ts";
import { lapsed, readParkedWait, runWait, waitingOn } from "./waits.ts";
import type { StoreConnection } from "../contract/store.ts";

export type ActionIntent = {
  readonly part: PartId;
  readonly action: string;
  readonly input: Json;
  readonly principal: PrincipalId;
};

interface Place {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly call: CallId;
  readonly part: PartId | null;
  readonly signal: AbortSignal;
}

const STOPPED: WaitOutcome = { kind: "stopped" };

const parkedExecutions = new WeakSet<Durable>();

class Parked extends Error {
  constructor() {
    super("The durable step parked on a wait.");
  }
}

export function isParked(error: unknown): boolean {
  return error instanceof Parked;
}

export function parkStep(durable: Durable): never {
  parkedExecutions.add(durable);

  throw new Parked();
}

export async function runStep<T>(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName | null;
    readonly run: RunId | null;
    readonly call: CallId;
    readonly kind: CallRecord["kind"];
    readonly replay: CallRecord["replay"];
    readonly intent: Json;
    readonly part: PartId | null;
    readonly signal: AbortSignal;

    /** The writes that open the step with its call record, landing under the step's run: once the run's stop fence is set they land nothing, and the step answers `fenced` as interrupted. */
    readonly opening?: {
      updates(): Promise<readonly RefUpdate[]>;
      readonly fenced: T;
    };
    body(durable: Durable): Promise<T>;

    settle(
      ended: StepEnd<T>,
    ): Promise<{ readonly result: Json; readonly updates: readonly RefUpdate[] }>;

    decode(result: Json): T | null;
  },
): Promise<StepOutcome<T>> {
  const { session, call } = input;
  const created = callRecord(input);
  let record = created;

  const { opening, run } = input;

  const opened = await changeCall(kernel, session, call, async (current) => {
    if (current !== null && current.kind !== "intent") {
      record = current;

      return null;
    }

    record = created;

    return opening === undefined || run === null
      ? { record }
      : { record, updates: await opening.updates(), under: { session, run } };
  });

  if (opened.fenced && opening !== undefined) return { kind: "interrupted", value: opening.fenced };

  const read = (result: Json | null): T => {
    const value = result === null ? null : input.decode(result);

    if (value === null)
      throw new SdkError("internal", `Call ${call} recorded a result its step cannot read.`);

    return value;
  };

  const settle = async (ended: StepEnd<T>) => {
    const written = await changeCall(kernel, session, call, async (current) => {
      if (current === null || current.result !== null) return null;
      const settled = await input.settle(ended);

      return {
        record: { ...current, result: settled.result, waiting: null, partial: [] },
        updates: settled.updates,
      };
    });

    return read(written.record?.result ?? null);
  };

  dev("durable", "step", { session, call, kind: input.kind });

  if (record.result !== null) {
    dev("durable", "replayed", { session, call });

    return { kind: "done", value: read(record.result) };
  }

  if (!opened.wrote && input.replay === "never") {
    return { kind: "interrupted", value: await settle({ kind: "interrupted" }) };
  }

  const writes: Promise<unknown>[] = [];
  const durable = createDurable(kernel, input, record, writes);

  const ran = await input.body(durable).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

  await Promise.all(writes);
  dev("durable", "ran", { session, call, parked: parkedExecutions.has(durable) });

  if (parkedExecutions.has(durable)) return { kind: "parked" };

  if ("error" in ran) {
    if (isParked(ran.error)) return { kind: "parked" };

    throw ran.error;
  }

  const value = await settle({ kind: "done", value: ran.value });
  dev("durable", "settled", { session, call });

  return { kind: "done", value };
}

export async function runAction(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly part: PartId;
    readonly action: string;
    readonly call: CallId;
    readonly signal: AbortSignal;
    body(durable: Durable): Promise<unknown>;
  },
): Promise<StepOutcome<unknown>> {
  let woken = Promise.withResolvers<void>();
  const dispose = kernel.waits.onWoken(input.session, input.call, () => woken.resolve());

  const aborted = new Promise<void>((resolve) =>
    input.signal.addEventListener("abort", () => resolve(), { once: true }),
  );

  try {
    for (let rerun = false; ; rerun = true) {
      if (!rerun || (await reserveRerun(kernel, input.session, input.call))) {
        const thrown: { readonly error: unknown }[] = [];

        const lease = rerun
          ? holdLease(`re-run ${input.call}`, () => renewRerun(kernel, input.session, input.call), {
              every: LEASE_MS / 3,
              lapse: LEASE_MS,
            })
          : null;

        const outcome = await runStep<{ readonly output: unknown; readonly failed: string | null }>(
          kernel,
          {
            session: input.session,
            head: null,
            run: null,
            call: input.call,
            kind: "action",
            replay: "safe",
            intent: { part: input.part, action: input.action },
            part: input.part,
            signal: lease === null ? input.signal : AbortSignal.any([input.signal, lease.signal]),
            body: async (durable) => {
              try {
                return { output: await input.body(durable), failed: null };
              } catch (error) {
                if (isParked(error)) throw error;
                thrown.push({ error });

                return {
                  output: undefined,
                  failed: error instanceof Error ? error.message : String(error),
                };
              }
            },
            async settle(ended) {
              if (ended.kind === "done" && ended.value.failed !== null)
                return { result: { kind: "failed", failed: ended.value.failed }, updates: [] };
              const output = ended.kind === "done" ? ended.value.output : undefined;
              const absent: Json = { kind: ended.kind };

              if (output === undefined) return { result: absent, updates: [] };

              if (!isJson(output))
                throw new SdkError(
                  "invalid",
                  `The ${input.action} action on part ${input.part} returned output that is not JSON.`,
                );

              return { result: { kind: ended.kind, output }, updates: [] };
            },
            decode: (result) =>
              isJsonObject(result)
                ? {
                    output: result.output,
                    failed: typeof result.failed === "string" ? result.failed : null,
                  }
                : null,
          },
        ).finally(() => lease?.stop());

        if (outcome.kind === "done") {
          const [threw] = thrown;

          if (threw !== undefined) throw threw.error;

          if (outcome.value.failed !== null) throw new SdkError("internal", outcome.value.failed);

          return { kind: "done", value: outcome.value.output };
        }

        if (outcome.kind !== "parked" || input.signal.aborted) return outcome;
      }

      await Promise.race([woken.promise, aborted]);
      woken = Promise.withResolvers<void>();

      if (input.signal.aborted) return { kind: "parked" };
    }
  } finally {
    dispose();
  }
}

/** Extends this instance's claim to re-run a call; false once the claim is another's or the call settled. */
async function renewRerun(kernel: Kernel, session: SessionId, call: CallId): Promise<boolean> {
  const renewed = await changeCall(kernel, session, call, async (current) =>
    current === null || current.result !== null || current.reran?.holder !== kernel.instance
      ? null
      : {
          record: { ...current, reran: { ...current.reran, expiresAt: Date.now() + LEASE_MS } },
        },
  );

  return renewed.wrote;
}

export async function reserveRerun(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
): Promise<boolean> {
  const reserved = await changeCall(kernel, session, call, async (current) =>
    current === null ||
    current.result !== null ||
    current.waiting !== null ||
    ((current.reran?.waits ?? 0) === current.waits.length && !lapsed(kernel, current))
      ? null
      : {
          record: {
            ...current,
            reran: {
              waits: current.waits.length,
              holder: kernel.instance,
              expiresAt: Date.now() + LEASE_MS,
            },
          },
        },
  );

  return reserved.wrote || (reserved.record?.result ?? null) !== null;
}

export async function openAction(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly part: PartId;
    readonly call: CallId;
    readonly intent: ActionIntent;
  },
): Promise<void> {
  await changeCall(kernel, input.session, input.call, async (current) =>
    current === null
      ? {
          record: callRecord({
            call: input.call,
            kind: "action",
            run: null,
            head: null,
            part: input.part,
            intent: input.intent,
            replay: "safe",
          }),
        }
      : null,
  );
}

export async function recordAcquisition(
  kernel: Kernel,
  step: { readonly session: SessionId; readonly call: CallId },
  key: string,
  value: Json,
): Promise<Json> {
  const written = await changeCall(kernel, step.session, step.call, async (current) =>
    current === null || Object.hasOwn(current.acquisitions, key)
      ? null
      : { record: { ...current, acquisitions: { ...current.acquisitions, [key]: value } } },
  );

  return readOwnEntry(written.record?.acquisitions, key) ?? value;
}

export async function recordedAcquisition(
  store: StoreConnection,
  step: { readonly session: SessionId; readonly call: CallId },
  key: string,
): Promise<Json | null> {
  return (
    readOwnEntry((await readCall(store, step.session, step.call))?.record.acquisitions, key) ?? null
  );
}

function createDurable(
  kernel: Kernel,
  place: Place,
  record: CallRecord,
  writes: Promise<unknown>[],
): Durable {
  const clock = [...record.clock];
  const memos = new Map(Object.entries(record.memos));
  let waits = 0;
  let readings = 0;

  function memo<V extends Json>(name: string, compute: () => Awaitable<V>): Promise<V>;
  async function memo(name: string, compute: () => Awaitable<Json>): Promise<Json> {
    const known = memos.get(name);
    dev("durable", "memo", { call: place.call, name, hit: known !== undefined });

    if (known !== undefined) return known;
    const value = await compute();

    const written = await changeCall(kernel, place.session, place.call, async (current) =>
      current === null || Object.hasOwn(current.memos, name)
        ? null
        : { record: { ...current, memos: { ...current.memos, [name]: value } } },
    );

    const recorded = readOwnEntry(written.record?.memos, name) ?? value;
    memos.set(name, recorded);

    return recorded;
  }

  const durable: Durable = {
    async wait(target) {
      const index = waits;
      waits += 1;
      const outcome = record.waits.at(index);

      if (outcome !== undefined) return outcome;

      if (place.signal.aborted) {
        await changeCall(kernel, place.session, place.call, async (current) =>
          current === null || current.waits.length !== index || current.waiting !== null
            ? null
            : { record: { ...current, waits: [...current.waits, STOPPED] } },
        );

        return STOPPED;
      }

      const early =
        target.kind === "part" ? await takeAnswer(kernel, place, target.part, index) : null;

      if (early !== null) return early;
      await park(kernel, place, target, index);

      return parkStep(durable);
    },
    memo,
    now() {
      const index = readings;
      readings += 1;
      const known = clock.at(index);

      if (known !== undefined) return known;
      const value = Date.now();
      clock[index] = value;

      writes.push(
        changeCall(kernel, place.session, place.call, async (current) =>
          current === null || current.clock.length !== index
            ? null
            : { record: { ...current, clock: [...current.clock, value] } },
        ),
      );

      return value;
    },
  };

  return durable;
}

async function takeAnswer(
  kernel: Kernel,
  place: Place,
  part: PartId,
  index: number,
): Promise<WaitOutcome | null> {
  const found = await load(
    kernel.store,
    await kernel.store.refs.get(partRef(place.session, part)),
    decodePartRecord,
  );

  const answer =
    found === null ? null : await storedAnswer(kernel.store, place.session, found.record);

  if (answer === null) return null;

  const taken = await changeCall(kernel, place.session, place.call, async (current) =>
    current === null ||
    current.result !== null ||
    current.waiting !== null ||
    current.waits.length !== index
      ? null
      : { record: { ...current, waits: [...current.waits, { kind: "part", part, answer }] } },
  );

  return taken.record?.waits.at(index) ?? null;
}

async function park(
  kernel: Kernel,
  place: Place,
  target: NonNullable<CallRecord["waiting"]>,
  index: number,
): Promise<void> {
  const partial = "targets" in target ? target.targets.map(() => null) : [];
  const on = waitingOn(target, partial);

  const parked = await changeCall(kernel, place.session, place.call, async (current) => {
    if (
      current === null ||
      current.result !== null ||
      current.waiting !== null ||
      current.waits.length !== index
    )
      return null;
    const record = { ...current, waiting: target, partial };

    return {
      record,
      events:
        on === null || place.part === null
          ? []
          : [
              {
                head: place.head,
                kind: "call",
                call: place.call,
                part: place.part,
                change: "waiting",
                on,
              },
            ],
      updates: [
        ...(place.run === null
          ? []
          : await runWait(kernel.store, place.session, place.run, async (run) => ({
              parked: run.parked.includes(place.call) ? run.parked : [...run.parked, place.call],
              waiting: on ?? run.waiting,
            }))),
        ...(await modalsWaiting(kernel.store, place.session, place.call, target)),
      ],
      index: { add: waitIndex(place.session, record), drop: [] },
    };
  });

  const entry = readParkedWait(place.session, parked.record);

  if (entry !== null) await kernel.waits.park(entry);
}

async function modalsWaiting(
  store: StoreConnection,
  session: SessionId,
  call: CallId,
  target: NonNullable<CallRecord["waiting"]>,
): Promise<readonly RefUpdate[]> {
  const parts = ("targets" in target ? target.targets : [target]).flatMap((waited) =>
    waited.kind === "part" ? [waited.part] : [],
  );

  const updates: RefUpdate[] = [];

  for (const part of new Set(parts)) {
    const name = partRef(session, part);
    const found = await load(store, await store.refs.get(name), decodePartRecord);
    const status = found?.record.status;

    if (
      found === null ||
      found.record.placement.kind !== "modal" ||
      status?.kind !== "live" ||
      status.waiting === call
    )
      continue;

    updates.push({
      name,
      target: await put(store, "part", { ...found.record, status: { ...status, waiting: call } }),
      expect: found.ref.revision,
      events: [{ head: null, kind: "part", part, change: "waiting", call }],
    });
  }

  return updates;
}

/** A tool call recorded with the response that asked for it, before its step opens, so a host stop in between still owes it. Its step replaces the intent with a `tool` call as if new; an intent has run nothing, so it replays safely. */
export function intendedCall(input: {
  readonly call: CallId;
  readonly run: RunId;
  readonly head: HeadName;
  readonly intent: Json;
}): CallRecord {
  return callRecord({ ...input, kind: "intent", part: null, replay: "safe" });
}

function callRecord(input: {
  readonly call: CallId;
  readonly kind: CallRecord["kind"];
  readonly run: RunId | null;
  readonly head: HeadName | null;
  readonly part: PartId | null;
  readonly intent: Json;
  readonly replay: CallRecord["replay"];
}): CallRecord {
  return {
    id: input.call,
    kind: input.kind,
    run: input.run,
    head: input.head,
    part: input.part,
    intent: input.intent,
    memos: {},
    clock: [],
    waits: [],
    waiting: null,
    partial: [],
    acquisitions: {},
    result: null,
    replay: input.replay,
    reran: null,
  };
}

function readOwnEntry(
  entries: Readonly<Record<string, Json>> | undefined,
  key: string,
): Json | undefined {
  return entries !== undefined && Object.hasOwn(entries, key) ? entries[key] : undefined;
}

export const LEASE_MS = 30_000;
