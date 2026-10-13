import { asId } from "@nyte-ai/schema";
import type {
  CallId,
  Disposer,
  HeadName,
  JobEnd,
  JobId,
  Json,
  MessageId,
  PartId,
  Ref,
  RefUpdate,
  RequestOptions,
  RunEnd,
  RunId,
  SessionId,
  WaitOutcome,
  WaitTarget,
} from "@nyte-ai/schema";
import { lapsed } from "./durable.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { rerunAction } from "./part-handle.ts";
import { storedAnswer } from "./parts.ts";
import { decodeCallRecord, decodePartRecord, decodeRunRecord } from "./records.ts";
import type { CallRecord, RunRecord } from "./records.ts";
import { callRef, partRef, runRef } from "./refs.ts";
import { endOf } from "./runs.ts";
import { changeCall, load, put, readCall } from "./session-state.ts";
import type { CallChange } from "./session-state.ts";

/** Returns one parked durable wait as its call record holds it: where the step runs, the target, the outcome per target so far, and the index of the wait in the step's `waits`. */
export interface ParkedWait {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly call: CallId;
  readonly target: NonNullable<CallRecord["waiting"]>;
  readonly partial: CallRecord["partial"];
  readonly index: number;
}

/**
 * Holds the durable waits parked in this process, by what wakes them. A wake records the outcome
 * in the step's call record, clearing `waiting`, and moves its run to `executing` unless another of
 * the run's calls is parked in the store; then the head is notified so `advance` re-runs the step.
 */
export interface WaitRegistry {
  /** Parks a step, or judges again the one held here at the same wait; a target that already has its outcome settles at once, a job this instance does not hold as `lost`. */
  park(entry: ParkedWait): Promise<void>;
  /** Wakes the waits on a run that ended and resolves whether one consumed the end; each call in `waitedBy` not parked here is offered only the run's outcome, as `partAnswered` offers its call. */
  runEnded(
    session: SessionId,
    run: RunId,
    end: RunEnd,
    waitedBy: RunRecord["waitedBy"],
  ): Promise<boolean>;
  /** Wakes the waits on a job that ended and resolves whether one consumed the end or still holds it: a wait whose write the store refused stays parked here and takes the end when `repair` or the poll judges it again. */
  jobEnded(job: JobId, end: JobEnd): Promise<boolean>;
  /** Wakes the waits on an answered part; `call`, the step its live status names, is offered the part's outcome from its stored wait. */
  partAnswered(
    session: SessionId,
    part: PartId,
    answer: { readonly action: string; readonly input: Json },
    call: CallId | null,
  ): Promise<void>;
  /** Wakes the waits on a closed part with no answer; `call`, the step its status named, from its stored wait. */
  partClosed(session: SessionId, part: PartId, call: CallId | null): Promise<void>;
  /** Wakes with `input` each `untilInput` wait on the head, read from the store: those of `parked`, its live run's parked calls as admission read them, and those parked here. */
  inputAdmitted(
    session: SessionId,
    head: HeadName,
    message: MessageId,
    parked: readonly CallId[],
  ): Promise<void>;
  runStopped(session: SessionId, run: RunId): Promise<void>;
  /** Wakes the wait one call, and each call nested under it, has stored with `stopped`, wherever it was parked. */
  callStopped(session: SessionId, call: CallId): Promise<void>;
  /** Fires the timers and deadlines due at `now`. */
  tick(now: number): Promise<void>;
  /** Returns the earliest timer or deadline among a head's parked waits, or null. */
  nextDeadline(session: SessionId, head: HeadName): number | null;
  /** Judges every wait held here again from its stored call record, dropping those another instance settled, and resumes each act here whose step another runner settled. */
  settleFromStore(): Promise<void>;
  /** Runs a head-less step again once its wake is recorded: the act here waiting on it resumes, else the action re-runs here. */
  rerun(session: SessionId, call: CallId): void;
  /** Calls `resume` when a wake records an outcome for a head-less step, so the act running it runs it again; with none, a wake written here re-runs the action. */
  onWoken(session: SessionId, call: CallId, resume: () => void): Disposer;
}

/** Returns one parked wait with its targets and the outcome each has had so far. */
interface Slot {
  readonly entry: ParkedWait;
  readonly targets: readonly WaitTarget[];
  outcomes: readonly (WaitOutcome | null)[];
}

/** How a job this instance does not hold ends for a wait on it. */
const LOST: JobEnd = { kind: "lost" };

/** Returns an empty wait registry over a kernel: what `kernel.waits` holds. */
export function createWaitRegistry(kernel: Kernel): WaitRegistry {
  const slots = new Map<string, Slot>();

  const resumers = new Map<
    string,
    { readonly session: SessionId; readonly call: CallId; readonly resume: () => void }
  >();

  const resumed = async (entry: ParkedWait): Promise<readonly RefUpdate[]> =>
    entry.run === null
      ? []
      : runWait(kernel, entry.session, entry.run, async (record) => {
          if (!record.parked.includes(entry.call) && record.waiting === null) return null;

          const others = await Promise.all(
            record.parked
              .filter((call) => call !== entry.call)
              .map((call) => readCall(kernel, entry.session, call)),
          );

          const still = others.flatMap((found) => {
            const waited = found?.record;

            return waited === undefined || waited.result !== null || waited.waiting === null
              ? []
              : [{ call: waited.id, on: waitingOn(waited.waiting, waited.partial) }];
          });

          return {
            parked: still.map((other) => other.call),
            waiting: still.find((other) => other.on !== null)?.on ?? null,
          };
        });

  const completion = async (
    current: CallRecord,
    entry: ParkedWait,
    outcome: WaitOutcome,
  ): Promise<CallChange> => ({
    record: { ...current, waits: [...current.waits, outcome], waiting: null, partial: [] },
    updates: await resumed(entry),
  });

  const open = (current: CallRecord, entry: ParkedWait): boolean =>
    current.result === null && current.waiting !== null && current.waits.length === entry.index;

  const woken = (slot: Slot): void => {
    const { entry } = slot;
    const key = keyOf(entry.session, entry.call);
    dev("waits", "wake", { session: entry.session, call: entry.call });

    if (slots.get(key) === slot) slots.delete(key);

    if (entry.head !== null) kernel.wakes.notify(entry.session, entry.head);
    else registry.rerun(entry.session, entry.call);
  };

  const settle = async (slot: Slot, outcome: WaitOutcome): Promise<boolean> => {
    const { entry } = slot;

    const written = await changeCall(kernel, entry.session, entry.call, async (current) =>
      current !== null && open(current, entry) ? completion(current, entry, outcome) : null,
    );

    if (!written.wrote) return false;
    woken(slot);

    return true;
  };

  const offer = async (slot: Slot, index: number, outcome: WaitOutcome): Promise<boolean> => {
    const { entry } = slot;

    if (entry.target.kind !== "all") return settle(slot, outcome);

    const written = await changeCall(kernel, entry.session, entry.call, async (current) => {
      if (current === null || !open(current, entry) || (current.partial.at(index) ?? null) !== null)
        return null;

      const partial = slot.targets.map((_target, at) =>
        at === index ? outcome : (current.partial.at(at) ?? null),
      );

      const outcomes = partial.flatMap((found) => (found === null ? [] : [found]));

      if (outcomes.length === slot.targets.length)
        return completion(current, entry, { kind: "all", outcomes });

      const on = waitingOn(entry.target, partial);

      return {
        record: { ...current, partial },
        event:
          on === null || current.part === null
            ? undefined
            : {
                head: current.head,
                kind: "call",
                call: current.id,
                part: current.part,
                change: "waiting",
                on,
              },
        updates:
          on === null || entry.run === null
            ? []
            : await runWait(kernel, entry.session, entry.run, async (record) => ({
                parked: record.parked,
                waiting: on,
              })),
      };
    });

    const record = written.record;

    if (!written.wrote || record === null) return false;

    if (record.waiting !== null) slot.outcomes = record.partial;
    else woken(slot);

    return true;
  };

  const offers = (
    match: (target: WaitTarget) => boolean,
    outcome: WaitOutcome,
  ): readonly Promise<boolean>[] =>
    [...slots.values()].flatMap((slot) =>
      slot.targets.flatMap((target, index) =>
        (slot.outcomes.at(index) ?? null) === null && match(target)
          ? [offer(slot, index, outcome)]
          : [],
      ),
    );

  const expire = async (slot: Slot, now: number): Promise<void> => {
    const deadline = deadlineOf(slot.entry.target);

    if (deadline !== null && deadline <= now) {
      await settle(slot, { kind: "deadline" });

      return;
    }

    await Promise.all(
      slot.targets.flatMap((target, index) =>
        target.kind === "timer" && target.until <= now && (slot.outcomes.at(index) ?? null) === null
          ? [offer(slot, index, { kind: "timer" })]
          : [],
      ),
    );
  };

  const settled = async (session: SessionId, target: WaitTarget): Promise<WaitOutcome | null> => {
    switch (target.kind) {
      case "run": {
        const end = await endOf(kernel, target.session, target.run);

        return end === null ? null : { kind: "run", session: target.session, run: target.run, end };
      }

      case "part": {
        const found = await load(
          kernel,
          await kernel.store.refs.get(partRef(session, target.part)),
          decodePartRecord,
        );

        if (found === null) return { kind: "part", part: target.part, answer: null };
        const answer = await storedAnswer(kernel, session, found.record);

        return answer === null ? null : { kind: "part", part: target.part, answer };
      }

      case "job": {
        const state = kernel.jobs.get(target.job)?.view.state ?? LOST;

        return state.kind === "running" ? null : { kind: "job", job: target.job, end: state };
      }

      case "timer":
        return null;
    }
  };

  const stop = async (match: (entry: ParkedWait) => boolean): Promise<void> => {
    await Promise.all(
      [...slots.values()].flatMap((slot) =>
        match(slot.entry) ? [settle(slot, { kind: "stopped" })] : [],
      ),
    );
  };

  const slotOf = (entry: ParkedWait): Slot => {
    const target = entry.target;
    const targets = "targets" in target ? target.targets : [target];

    return {
      entry,
      targets,
      outcomes: targets.map((_target, index) => entry.partial.at(index) ?? null),
    };
  };

  const slotFor = (entry: ParkedWait): Slot => {
    const held = slots.get(keyOf(entry.session, entry.call));

    return held?.entry.index === entry.index ? held : slotOf(entry);
  };

  const storedWait = async (session: SessionId, call: CallId): Promise<ParkedWait | null> =>
    parkedOf(session, (await readCall(kernel, session, call))?.record ?? null);

  const offerCold = async (
    session: SessionId,
    call: CallId,
    on: (target: WaitTarget) => boolean,
    outcome: WaitOutcome,
  ): Promise<readonly boolean[]> => {
    const entry = await storedWait(session, call);

    if (entry === null) return [];
    const slot = slotFor(entry);

    return Promise.all(
      slot.targets.flatMap((target, index) =>
        on(target) && (slot.outcomes.at(index) ?? null) === null
          ? [offer(slot, index, outcome)]
          : [],
      ),
    );
  };

  const offerPart = async (
    session: SessionId,
    part: PartId,
    answer: { readonly action: string; readonly input: Json } | null,
    call: CallId | null,
  ): Promise<void> => {
    const on = (target: WaitTarget): boolean => target.kind === "part" && target.part === part;
    const outcome: WaitOutcome = { kind: "part", part, answer };

    if (call !== null) await offerCold(session, call, on, outcome);
    await Promise.all(offers(on, outcome));
  };

  const park = async (entry: ParkedWait): Promise<void> => {
    const key = keyOf(entry.session, entry.call);
    const slot = slotFor(entry);
    slot.outcomes = slot.targets.map((_target, index) => entry.partial.at(index) ?? null);
    slots.set(key, slot);
    dev("waits", "park", {
      session: entry.session,
      call: entry.call,
      targets: slot.targets.length,
    });

    if (entry.target.kind === "all" && slot.targets.length === 0) {
      await settle(slot, { kind: "all", outcomes: [] });

      return;
    }

    await expire(slot, Date.now());

    for (const [index, waited] of slot.targets.entries()) {
      if (slots.get(key) !== slot) return;

      if ((slot.outcomes.at(index) ?? null) !== null) continue;
      const outcome = await settled(entry.session, waited);

      if (outcome !== null) await offer(slot, index, outcome);
    }
  };

  const registry: WaitRegistry = {
    park,
    async runEnded(session, run, end, waitedBy) {
      const on = (target: WaitTarget): boolean =>
        target.kind === "run" && target.session === session && target.run === run;
      const outcome: WaitOutcome = { kind: "run", session, run, end };

      const cold = await Promise.all(
        waitedBy.map((waiter) => offerCold(waiter.session, waiter.call, on, outcome)),
      );

      const taken = await Promise.all(offers(on, outcome));

      return [...cold.flat(), ...taken].some(Boolean);
    },
    async jobEnded(job, end) {
      const results = await Promise.allSettled(
        offers((target) => target.kind === "job" && target.job === job, { kind: "job", job, end }),
      );

      if (results.some((found) => found.status === "rejected"))
        dev("waits", "job end refused", { job });

      return results.some((found) => found.status === "rejected" || found.value);
    },
    partAnswered: offerPart,
    partClosed: (session, part, call) => offerPart(session, part, null, call),
    async inputAdmitted(session, head, message, parked) {
      const calls = new Set([
        ...parked,
        ...[...slots.values()].flatMap((slot) =>
          slot.entry.session === session && slot.entry.head === head ? [slot.entry.call] : [],
        ),
      ]);

      await Promise.all(
        [...calls].map(async (call) => {
          const entry = await storedWait(session, call);

          if (entry !== null && "targets" in entry.target && entry.target.untilInput === true)
            await settle(slotFor(entry), { kind: "input", message });
        }),
      );
    },
    runStopped: (session, run) => stop((entry) => entry.session === session && entry.run === run),
    async callStopped(session, call) {
      const nested = await kernel.store.refs.list(`${callRef(session, call)}:`);

      const records = await Promise.all([
        readCall(kernel, session, call),
        ...nested.map((ref) => load(kernel, ref, decodeCallRecord)),
      ]);

      await Promise.all(
        records.flatMap((found) => {
          const entry = parkedOf(session, found?.record ?? null);

          return entry === null ? [] : [settle(slotFor(entry), { kind: "stopped" })];
        }),
      );
    },
    async tick(now) {
      dev("waits", "tick", { parked: slots.size });
      await Promise.all([...slots.values()].map((slot) => expire(slot, now)));
    },
    async settleFromStore() {
      await Promise.all(
        [...slots.values()].map(async (slot) => {
          const { entry } = slot;
          const key = keyOf(entry.session, entry.call);
          const record = (await readCall(kernel, entry.session, entry.call))?.record ?? null;
          const stored = parkedOf(entry.session, record);

          if (stored !== null) {
            await park(stored);

            return;
          }

          if (slots.get(key) !== slot) return;
          slots.delete(key);

          if (record === null || record.result !== null) return;

          if (entry.head !== null) kernel.wakes.notify(entry.session, entry.head);
          else resumers.get(key)?.resume();
        }),
      );

      await Promise.all(
        [...resumers].map(async ([key, resumer]) => {
          if (slots.has(key)) return;
          const found = await readCall(kernel, resumer.session, resumer.call);

          if (found !== null && (found.record.result !== null || lapsed(kernel, found.record)))
            resumer.resume();
        }),
      );
    },
    nextDeadline(session, head) {
      const due = [...slots.values()].flatMap((slot) => {
        if (slot.entry.session !== session || slot.entry.head !== head) return [];
        const deadline = deadlineOf(slot.entry.target);

        return [
          ...(deadline === null ? [] : [deadline]),
          ...slot.targets.flatMap((target, index) =>
            target.kind === "timer" && (slot.outcomes.at(index) ?? null) === null
              ? [target.until]
              : [],
          ),
        ];
      });

      return due.length === 0 ? null : Math.min(...due);
    },
    rerun(session, call) {
      const resumer = resumers.get(keyOf(session, call));

      if (resumer !== undefined) resumer.resume();
      else
        void rerunAction(kernel, session, call).catch((error: unknown) =>
          dev("waits", "rerun failed", { call, error: String(error) }),
        );
    },
    onWoken(session, call, resume) {
      const key = keyOf(session, call);
      const resumer = { session, call, resume };
      resumers.set(key, resumer);

      return () => {
        if (resumers.get(key) === resumer) resumers.delete(key);
      };
    },
  };

  return registry;
}

/** Rebuilds `kernel.waits` from every `calls/*` record whose `waiting` is set: every session's, or only the listed sessions'; `cover` and `repair` call it. A woken step whose re-run claim lapsed is re-run. */
export async function loadWaits(kernel: Kernel, sessions?: readonly SessionId[]): Promise<void> {
  const refs: readonly Ref[] =
    sessions === undefined
      ? await kernel.store.refs.list("sessions/")
      : (
          await Promise.all(
            sessions.map((session) => kernel.store.refs.list(`sessions/${session}/calls/`)),
          )
        ).flat();

  for (const ref of refs) {
    const [root, session, kind] = ref.name.split("/");

    if (root !== "sessions" || session === undefined || kind !== "calls") continue;
    const found = await load(kernel, ref, decodeCallRecord);
    const entry = parkedOf(asId<"session">(session), found?.record ?? null);

    if (entry !== null) await kernel.waits.park(entry);
    else if (found !== null && lapsed(kernel, found.record))
      kernel.waits.rerun(asId<"session">(session), found.record.id);
  }
}

/** Calls the listener whenever a receipt is settled in this process; the disposer stops it. */
export function onReceipt(
  kernel: Kernel,
  session: SessionId,
  id: string,
  listener: () => void,
): Disposer {
  const key = `${session}/${id}`;
  const listeners = kernel.receipts.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  kernel.receipts.set(key, listeners);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0 && kernel.receipts.get(key) === listeners) kernel.receipts.delete(key);
  };
}

/** Wakes every in-process wait on a receipt. */
export function notifyReceipt(kernel: Kernel, session: SessionId, id: string): void {
  for (const listener of kernel.receipts.get(`${session}/${id}`) ?? []) listener();
}

/** Resolves with the first value `check` finds, checking once now and again on every trigger; abort rejects `unavailable` and stops the wait, never the work. */
export function waitFor<T>(input: {
  readonly options?: RequestOptions;
  readonly check: () => Promise<{ readonly value: T } | null>;
  readonly subscribe: (trigger: () => void) => Disposer;
}): Promise<T> {
  const signal = input.options?.signal;

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new SdkError("unavailable", "aborted"));

      return;
    }

    let done = false;
    let checking = false;
    let again = false;
    let dispose: Disposer = () => {};

    const finish = (): void => {
      done = true;
      dispose();
      signal?.removeEventListener("abort", abort);
    };

    const abort = (): void => {
      if (done) return;
      finish();
      reject(new SdkError("unavailable", "aborted"));
    };

    const check = (): void => {
      if (done) return;

      if (checking) {
        again = true;

        return;
      }

      checking = true;
      input.check().then(
        (found) => {
          checking = false;

          if (done) return;

          if (found !== null) {
            finish();
            resolve(found.value);

            return;
          }

          if (!again) return;
          again = false;
          check();
        },
        (error: unknown) => {
          checking = false;

          if (done) return;
          finish();
          reject(error);
        },
      );
    };

    signal?.addEventListener("abort", abort, { once: true });
    dispose = input.subscribe(check);
    check();
  });
}

/** Returns the update writing a live run's parked calls and wait with `run waiting`, or `run phase executing` once it waits on nothing; none once the run has ended or `change` keeps it. */
export async function runWait(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  change: (record: RunRecord) => Promise<Pick<RunRecord, "parked" | "waiting"> | null>,
): Promise<readonly RefUpdate[]> {
  const name = runRef(session, run);
  const found = await load(kernel, await kernel.store.refs.get(name), decodeRunRecord);
  const next = found === null ? null : await change(found.record);

  if (found === null || next === null) return [];
  const { record } = found;
  const head = record.view.head;
  const resumed = next.waiting === null && record.waiting !== null;

  return [
    {
      name,
      target: await put(kernel, "run", {
        ...record,
        ...next,
        phase: resumed ? "executing" : record.phase,
      }),
      expect: found.ref.revision,
      event:
        next.waiting !== null
          ? { head, kind: "run", run, change: "waiting", on: next.waiting }
          : resumed
            ? { head, kind: "run", run, change: "phase", phase: "executing" }
            : undefined,
    },
  ];
}

/** Returns the parked wait a call record holds, or null when it has a result or waits on nothing. */
export function parkedOf(session: SessionId, record: CallRecord | null): ParkedWait | null {
  if (record === null || record.result !== null || record.waiting === null) return null;

  return {
    session,
    head: record.head,
    run: record.run,
    call: record.id,
    target: record.waiting,
    partial: record.partial,
    index: record.waits.length,
  };
}

/** Returns what a wait shows as waiting on: the target, or a combination's first target with an empty slot. */
export function waitingOn(
  target: NonNullable<CallRecord["waiting"]>,
  partial: readonly (WaitOutcome | null)[],
): WaitTarget | null {
  if (!("targets" in target)) return target;

  return target.targets.find((_waited, index) => (partial.at(index) ?? null) === null) ?? null;
}

/** Returns the earliest deadline bounding a wait, its own or any of its targets', or null. */
function deadlineOf(target: NonNullable<CallRecord["waiting"]>): number | null {
  const bounds = [
    target.deadline,
    ...("targets" in target ? target.targets.map((waited) => waited.deadline) : []),
  ].flatMap((deadline) => (deadline === undefined ? [] : [deadline]));

  return bounds.length === 0 ? null : Math.min(...bounds);
}

function keyOf(session: SessionId, call: CallId): string {
  return `${session}/${call}`;
}
