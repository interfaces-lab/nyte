import { isJson } from "@nyte-ai/schema";
import type {
  Awaitable,
  CallId,
  HeadName,
  Json,
  PartId,
  RefUpdate,
  RunId,
  SessionId,
  WaitOutcome,
} from "@nyte-ai/schema";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { decodePartRecord, decodeRunRecord } from "./records.ts";
import type { CallRecord } from "./records.ts";
import { partRef, runRef } from "./refs.ts";
import { changeCall, isJsonObject, load, put, readCall } from "./session-state.ts";
import type { Durable } from "./tools.ts";
import { parkedOf, runWait, waitingOn } from "./waits.ts";

/** Returns how a durable step ended: its value as recorded, parked on a wait not yet recorded, or interrupted because a `never` step may not run again. */
export type StepOutcome<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "parked" }
  | { readonly kind: "interrupted" };

/** Returns where a durable step runs and what stops it. */
interface Place {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly call: CallId;
  readonly part: PartId | null;
  readonly signal: AbortSignal;
}

const STOPPED: WaitOutcome = { kind: "stopped" };

/** The step executions that parked, by their `Durable`. */
const parkedExecutions = new WeakSet<Durable>();

/** What a durable step's `wait()` throws on its first wait not yet recorded, so the step unwinds and parks. */
class Parked extends Error {
  constructor() {
    super("The durable step parked on a wait.");
  }
}

/** Returns whether an error is the sentinel a durable step's `wait()` throws to park it. */
export function isParked(error: unknown): boolean {
  return error instanceof Parked;
}

/** Marks the step execution `durable` belongs to as parked and throws the parked sentinel. */
export function parkStep(durable: Durable): never {
  parkedExecutions.add(durable);

  throw new Parked();
}

/**
 * Runs one durable step (a tool call, a part action or a decide hook) from its `CallRecord`, which
 * it creates or loads: a recorded result replays as `done`; a `never` step with no result is
 * settled `interrupted`; otherwise `body` runs with a `Durable` replaying the record by call order.
 * A settled step returns the result its record holds, decoded; an execution that parked is
 * `parked` however its body ended (§33g).
 */
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
    /** The updates landing with the record's creation: a tool's part, so no part exists without its step. */
    readonly opening?: readonly RefUpdate[];
    body(durable: Durable): Promise<T>;
    /** Returns what the step's `result` records and the ref updates landing in the same set. */
    settle(
      ended: Exclude<StepOutcome<T>, { readonly kind: "parked" }>,
    ): Promise<{ readonly result: Json; readonly updates: readonly RefUpdate[] }>;
    /** Returns the value a recorded `result` holds, or null when it holds another shape. */
    decode(result: Json): T | null;
  },
): Promise<StepOutcome<T>> {
  const { session, call } = input;

  const created: CallRecord = {
    id: call,
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
    nested: {},
    acquisitions: {},
    result: null,
    replay: input.replay,
  };

  const opened = await changeCall(kernel, session, call, async (current) =>
    current === null ? { record: created, updates: input.opening } : null,
  );

  const record = opened.record ?? created;

  const read = (result: Json | null): T => {
    const value = result === null ? null : input.decode(result);

    if (value === null)
      throw new SdkError("internal", `Call ${call} recorded a result its step cannot read.`);

    return value;
  };

  const settle = async (ended: Exclude<StepOutcome<T>, { readonly kind: "parked" }>) => {
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
    await settle({ kind: "interrupted" });

    return { kind: "interrupted" };
  }

  const writes: Promise<unknown>[] = [];
  const durable = durableOf(kernel, input, record, writes);

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

/** Runs a part action as a durable step of kind `action` and, while it is parked, runs it again on each wake until it settles or its signal aborts; its result records the output when it is JSON, and decodes back to it. */
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
    for (;;) {
      woken = Promise.withResolvers<void>();

      const outcome = await runStep<{ readonly output: unknown }>(kernel, {
        session: input.session,
        head: null,
        run: null,
        call: input.call,
        kind: "action",
        replay: "safe",
        intent: { part: input.part, action: input.action },
        part: input.part,
        signal: input.signal,
        body: async (durable) => ({ output: await input.body(durable) }),
        async settle(ended) {
          const output = ended.kind === "done" ? ended.value.output : undefined;
          const result: Json = isJson(output) ? { kind: ended.kind, output } : { kind: ended.kind };

          return { result, updates: [] };
        },
        decode: (result) => (isJsonObject(result) ? { output: result.output } : null),
      });

      if (outcome.kind === "done") return { kind: "done", value: outcome.value.output };

      if (outcome.kind !== "parked" || input.signal.aborted) return outcome;
      await Promise.race([woken.promise, aborted]);

      if (input.signal.aborted) return outcome;
    }
  } finally {
    dispose();
  }
}

/** Records what a durable step acquired under a key unless one is recorded, and returns the recorded winner (§33a). */
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

  return entryOf(written.record?.acquisitions, key) ?? value;
}

/** Returns what a durable step recorded acquiring under a key, or null. */
export async function recordedAcquisition(
  kernel: Kernel,
  step: { readonly session: SessionId; readonly call: CallId },
  key: string,
): Promise<Json | null> {
  return (
    entryOf((await readCall(kernel, step.session, step.call))?.record.acquisitions, key) ?? null
  );
}

/** Returns the `Durable` one execution of a step runs with, replaying the opened record's waits, memos and clock by call order. */
function durableOf(
  kernel: Kernel,
  place: Place,
  record: CallRecord,
  writes: Promise<unknown>[],
): Durable {
  const clock = [...record.clock];
  const memos = new Map(Object.entries(record.memos));
  let waits = 0;
  let readings = 0;

  /** The one unchecked widening in core: a replayed memo is stored `Json`, returned as `V` (§34a). */
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

    const recorded = entryOf(written.record?.memos, name) ?? value;
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

/** Settles a wait on one modal part at once when the part already holds an answer that came before any step parked (§48i), clearing it from the part in the same set. */
async function takeAnswer(
  kernel: Kernel,
  place: Place,
  part: PartId,
  index: number,
): Promise<WaitOutcome | null> {
  const name = partRef(place.session, part);

  const taken = await changeCall(kernel, place.session, place.call, async (current) => {
    const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);
    const status = found?.record.status;

    if (
      current === null ||
      current.result !== null ||
      current.waiting !== null ||
      current.waits.length !== index ||
      found === null ||
      status?.kind !== "live" ||
      status.answer === undefined
    )
      return null;

    const { answer, ...kept } = status;

    return {
      record: { ...current, waits: [...current.waits, { kind: "part", part, answer }] },
      updates: [
        {
          name,
          target: await put(kernel, "part", { ...found.record, status: kept }),
          expect: found.ref.revision,
        },
      ],
    };
  });

  return taken.wrote ? (taken.record?.waits.at(index) ?? null) : null;
}

/**
 * Writes a step's wait at `index` in one set: `waiting` with an empty slot per target of a
 * combination, `call waiting`, the run's `run waiting`, the step in the `waitedBy` of each run it
 * waits on, and `waiting: <call>` on each live modal part it waits on (§42z, §42ac); then parks it.
 */
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

    return {
      record: { ...current, waiting: target, partial },
      event:
        on === null || place.part === null
          ? undefined
          : {
              head: place.head,
              kind: "call",
              call: place.call,
              part: place.part,
              change: "waiting",
              on,
            },
      updates: [
        ...(place.run === null
          ? []
          : await runWait(kernel, place.session, place.run, async (record) => ({
              parked: record.parked.includes(place.call)
                ? record.parked
                : [...record.parked, place.call],
              waiting: on ?? record.waiting,
            }))),
        ...(await modalsWaiting(kernel, place.session, place.call, target)),
        ...(await runsWaited(kernel, place, target)),
      ],
    };
  });

  const entry = parkedOf(place.session, parked.record);

  if (entry !== null) await kernel.waits.park(entry);
}

/** Returns the updates adding the step to the `waitedBy` of each live run a wait targets, other than its own. */
async function runsWaited(
  kernel: Kernel,
  place: Place,
  target: NonNullable<CallRecord["waiting"]>,
): Promise<readonly RefUpdate[]> {
  const updates: RefUpdate[] = [];
  const waiter = { session: place.session, call: place.call };

  for (const waited of "targets" in target ? target.targets : [target]) {
    if (waited.kind !== "run" || (waited.session === place.session && waited.run === place.run))
      continue;
    const name = runRef(waited.session, waited.run);
    const found = await load(kernel, await kernel.store.refs.get(name), decodeRunRecord);

    if (found === null || updates.some((update) => update.name === name)) continue;
    const listed = found.record.waitedBy;

    if (listed.some((entry) => entry.session === waiter.session && entry.call === waiter.call))
      continue;

    updates.push({
      name,
      target: await put(kernel, "run", { ...found.record, waitedBy: [...listed, waiter] }),
      expect: found.ref.revision,
    });
  }

  return updates;
}

/** Returns the updates marking each live modal part a wait targets as waited on by `call`. */
async function modalsWaiting(
  kernel: Kernel,
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
    const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);
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
      target: await put(kernel, "part", { ...found.record, status: { ...status, waiting: call } }),
      expect: found.ref.revision,
      event: { head: null, kind: "part", part, change: "waiting", call },
    });
  }

  return updates;
}

function entryOf(
  entries: Readonly<Record<string, Json>> | undefined,
  key: string,
): Json | undefined {
  return entries !== undefined && Object.hasOwn(entries, key) ? entries[key] : undefined;
}
