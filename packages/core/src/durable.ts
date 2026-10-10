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
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import type { CallRecord } from "./records.ts";
import { changeCall, readCall, runWaiting } from "./session-state.ts";
import type { Durable } from "./tools.ts";
import { onStepWoken, waitingOn } from "./wait-registry.ts";

/** Returns how a durable step ended: its body's value, parked on a wait not yet recorded, or interrupted because a `never` step may not run again. */
export type StepOutcome<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "parked" }
  | { readonly kind: "interrupted" };

/** Returns where a durable step runs and what stops it: what its `Durable` records against. */
interface Place {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly call: CallId;
  readonly part: PartId | null;
  readonly signal: AbortSignal;
}

const STOPPED: WaitOutcome = { kind: "stopped" };

/** The executions that parked: each step execution's `Durable`, once it wrote or found its wait, or a nested step it awaits parked. */
const parkedExecutions = new WeakSet<Durable>();

/** What a durable step's `wait()` throws on its first wait not yet recorded, so the step unwinds and parks; a wake re-runs it. */
class Parked extends Error {
  constructor() {
    super("The durable step parked on a wait.");
  }
}

/** Returns whether an error is the sentinel a durable step's `wait()` throws to park it; whatever catches it inside a step rethrows it untouched. */
export function isParked(error: unknown): boolean {
  return error instanceof Parked;
}

/** Marks the step execution that `durable` belongs to as parked and throws the parked sentinel: how a step unwinds when it, or a nested step it awaits, parked. */
export function parkStep(durable: Durable): never {
  parkedExecutions.add(durable);

  throw new Parked();
}

/** Runs one durable step (a tool call, a part action or a decide hook) and returns how it ended. Creates the step's `CallRecord` with its intent, or loads it on a re-run. A record with a `result` returns `done` with `decode(result)` without running `body`; a result `decode` rejects throws `SdkError("internal")`. A record without a result under `replay: "never"` (parked, or the host died mid-step) is settled through `settle({ kind: "interrupted" })` and returns `interrupted`. Otherwise `body` runs with a `Durable` whose `wait()` replays recorded outcomes in call order and, on the first unrecorded wait, writes the whole target to `waiting` with `call waiting { on }` (and `run waiting { on }` when `run` is set), where `on` is the target itself or a composite's first unsettled target, parks the entry in `kernel.waits` and throws the parked sentinel; a wait reached once `signal` has aborted records and returns `stopped` instead. `memo(name, compute)` returns the recorded value or computes and records it, expecting the call ref's revision (a lost race re-reads the winner); `now()` returns the clock reading recorded at its call-order index, or records `Date.now()`. A step with no head (an action or hook outside one) parks without a head to notify; its wake re-runs it through the act that runs it. When `body` resolves, the `result` that `settle` returns is recorded in one set with the updates it returns and the step returns `done`. An execution that parked is `parked` however its body ended: a body whose own `catch` swallowed the sentinel and resolved anyway has its value dropped, even when a wake has since cleared `waiting` (§33g). Any other throw is rethrown with nothing recorded. */
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
    body(durable: Durable): Promise<T>;
    /** Returns what the step's `result` records and the ref updates that land in the same set: for a tool, its part settled and the head commit. */
    settle(
      ended: Exclude<StepOutcome<T>, { readonly kind: "parked" }>,
    ): Promise<{ readonly result: Json; readonly updates: readonly RefUpdate[] }>;
    /** Returns the value a recorded `result` holds, or null when it holds another shape. */
    decode(result: Json): T | null;
  },
): Promise<StepOutcome<T>> {
  const { session, call } = input;

  const opened = await changeCall(kernel, session, call, async (current) =>
    current === null
      ? {
          record: {
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
          },
        }
      : null,
  );

  const record = opened.record;

  if (record === null) throw new SdkError("internal", `Call ${call} has no record.`);

  const settle = async (ended: Exclude<StepOutcome<T>, { readonly kind: "parked" }>) =>
    changeCall(kernel, session, call, async (current) => {
      if (current === null || current.result !== null) return null;
      const settled = await input.settle(ended);

      return {
        record: { ...current, result: settled.result, waiting: null, partial: [] },
        updates: settled.updates,
      };
    });

  if (record.result !== null) {
    const value = input.decode(record.result);

    if (value === null)
      throw new SdkError("internal", `Call ${call} recorded a result its step cannot read.`);

    return { kind: "done", value };
  }

  if (!opened.wrote && input.replay === "never") {
    await settle({ kind: "interrupted" });

    return { kind: "interrupted" };
  }

  const writes: Promise<unknown>[] = [];
  const durable = durableOf(kernel, input, record.clock, writes);

  const ran = await input.body(durable).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

  await Promise.all(writes);

  if (parkedExecutions.has(durable)) return { kind: "parked" };

  if ("error" in ran) {
    if (isParked(ran.error)) return { kind: "parked" };

    throw ran.error;
  }

  await settle({ kind: "done", value: ran.value });

  return { kind: "done", value: ran.value };
}

/** Runs a part action as a durable step of kind `action` (replay safe, outside any head or run) and returns how it ended; while it is parked, waits for the registry to wake it and runs it again, until it settles or its signal aborts. Its result records the output when it is JSON; it is never replayed, since every act has a fresh call id. */
export async function runAction<T>(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly part: PartId;
    readonly action: string;
    readonly call: CallId;
    readonly signal: AbortSignal;
    body(durable: Durable): Promise<T>;
  },
): Promise<StepOutcome<T>> {
  let woken = Promise.withResolvers<void>();
  const dispose = onStepWoken(kernel, input.session, input.call, () => woken.resolve());

  const aborted = new Promise<void>((resolve) =>
    input.signal.addEventListener("abort", () => resolve(), { once: true }),
  );

  try {
    for (;;) {
      woken = Promise.withResolvers<void>();

      const outcome = await runStep<T>(kernel, {
        session: input.session,
        head: null,
        run: null,
        call: input.call,
        kind: "action",
        replay: "safe",
        intent: { part: input.part, action: input.action },
        part: input.part,
        signal: input.signal,
        body: (durable) => input.body(durable),
        settle: async (ended) => ({
          result: {
            kind: ended.kind,
            output: ended.kind === "done" && isJson(ended.value) ? ended.value : null,
          },
          updates: [],
        }),
        decode: () => null,
      });

      if (outcome.kind !== "parked" || input.signal.aborted) return outcome;
      await Promise.race([woken.promise, aborted]);

      if (input.signal.aborted) return outcome;
    }
  } finally {
    dispose();
  }
}

/** Records what a durable step acquired under a key (a session, part, job or browser id) unless one is recorded, and returns the recorded winner. `sessions.create`, `parts.create`, `jobs.start` and `browser.open` call it when their connection's `origin` names a step, keyed by `input.id ?? \`acq:${origin.sequence.next()}\``. */
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

  const recorded = entryOf(written.record?.acquisitions, key);

  return recorded === undefined ? value : recorded;
}

/** Returns what a durable step recorded acquiring under a key, or null when it has acquired nothing under it; a re-run returns the recorded id instead of acquiring again. */
export async function recordedAcquisition(
  kernel: Kernel,
  step: { readonly session: SessionId; readonly call: CallId },
  key: string,
): Promise<Json | null> {
  return (
    entryOf((await readCall(kernel, step.session, step.call))?.record.acquisitions, key) ?? null
  );
}

/** Returns the `Durable` one execution of a step runs with: waits, memos and clock readings replay from the record by call order and record what is new; clock writes are queued on `writes` for the step to await. A wait that parks marks this execution parked. */
function durableOf(
  kernel: Kernel,
  place: Place,
  recorded: readonly number[],
  writes: Promise<unknown>[],
): Durable {
  const clock = [...recorded];
  let waits = 0;
  let readings = 0;

  /** The one unchecked widening in core: a replayed memo is stored `Json`, returned as `V` (§34a). */
  function memo<V extends Json>(name: string, compute: () => Awaitable<V>): Promise<V>;
  async function memo(name: string, compute: () => Awaitable<Json>): Promise<Json> {
    const known = entryOf((await readCall(kernel, place.session, place.call))?.record.memos, name);

    if (known !== undefined) return known;
    const value = await compute();

    const written = await changeCall(kernel, place.session, place.call, async (current) =>
      current === null || Object.hasOwn(current.memos, name)
        ? null
        : { record: { ...current, memos: { ...current.memos, [name]: value } } },
    );

    const recorded = entryOf(written.record?.memos, name);

    return recorded === undefined ? value : recorded;
  }

  const durable: Durable = {
    async wait(target) {
      const index = waits;
      waits += 1;
      const found = await readCall(kernel, place.session, place.call);

      if (found === null) throw new SdkError("internal", `Call ${place.call} has no record.`);
      const outcome = found.record.waits.at(index);

      if (outcome !== undefined) return outcome;

      if (place.signal.aborted) {
        await changeCall(kernel, place.session, place.call, async (current) =>
          current === null || current.waits.length !== index || current.waiting !== null
            ? null
            : { record: { ...current, waits: [...current.waits, STOPPED] } },
        );

        return STOPPED;
      }

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

/** Writes a step's wait at `index` to its record, with an empty outcome slot per target of a combination, with `call waiting` and, inside a run, the run's `waiting` with `run waiting`, all in one set; then parks it in the kernel's registry. A record already waiting is parked as it stands. */
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
      updates:
        on === null || place.run === null
          ? []
          : await runWaiting(kernel, place.session, place.run, on),
    };
  });

  const record = parked.record;

  if (record === null || record.result !== null || record.waiting === null) return;

  await kernel.waits.park({
    session: place.session,
    head: place.head,
    run: place.run,
    call: place.call,
    target: record.waiting,
  });
}

/** Returns a record's entry under a key, or undefined when it has none of its own. */
function entryOf(
  entries: Readonly<Record<string, Json>> | undefined,
  key: string,
): Json | undefined {
  return entries !== undefined && Object.hasOwn(entries, key) ? entries[key] : undefined;
}
