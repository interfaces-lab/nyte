import { asId, SdkError } from "@nyte-ai/schema";
import type {
  CallId,
  Disposer,
  JobEnd,
  Ref,
  RefUpdate,
  RequestOptions,
  RunId,
  SessionId,
  WaitOutcome,
  WaitTarget,
} from "@nyte-ai/schema";
import type { Kernel, ParkedWait, WaitRegistry } from "../contract/kernel.ts";
import { decodeCallRecord, decodePartRecord, decodeRunRecord } from "../contract/records.ts";
import type { CallRecord, RunRecord } from "../contract/records.ts";
import { changeCall, commit } from "../fold/commit.ts";
import type { CallChange } from "../fold/commit.ts";
import { readRunEnd } from "../fold/reads.ts";
import { storedAnswer } from "../store/parts.ts";
import { callRef, partRef, runRef } from "../store/refs.ts";
import { load, put, readCall } from "../store/session.ts";
import {
  findEarliestDeadline,
  readIndexed,
  readWoken,
  TIME,
  TIME_DIGITS,
  waitIndex,
  WAITS,
  WOKEN,
  wokenIndex,
} from "../store/wait-index.ts";
import type { Indexed } from "../store/wait-index.ts";
import { dev } from "../util/dev-log.ts";
import type { StoreConnection } from "../contract/store.ts";

const LOST: JobEnd = { kind: "lost" };

const STOPPED: WaitOutcome = { kind: "stopped" };

/**
 * Returns the wait registry over the store-side wait index: a park writes one `waits/` ref per
 * target the call waits on (by run, part, job and input, and by time for timers and deadlines),
 * each pointing at the parked call record, and the wake that completes the wait deletes them in
 * the same write. Every offer is a compare-and-set on the call record that completes the wait or
 * fills its target of an `all`; an offer that finds the wait already past, or the call gone,
 * drops the index entry that led to it. A completed wait indexes the call as woken until its next
 * park or its settle, which is all a poll for other processes' wakes reads. The registry keeps no
 * copy of what is parked; only this process's live action loops are held, as resumers.
 */
export function createWaitRegistry(
  kernel: Kernel,
  rerunAction: (session: SessionId, call: CallId) => Promise<void>,
): WaitRegistry {
  const resumers = new Map<
    string,
    { readonly session: SessionId; readonly call: CallId; readonly resume: () => void }
  >();

  const receipts = new Map<string, Set<() => void>>();

  const resumed = async (session: SessionId, current: CallRecord): Promise<readonly RefUpdate[]> =>
    current.run === null
      ? []
      : runWait(kernel.store, session, current.run, async (record) => {
          if (!record.parked.includes(current.id) && record.waiting === null) return null;

          const others = await Promise.all(
            record.parked
              .filter((call) => call !== current.id)
              .map((call) => readCall(kernel.store, session, call)),
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
    session: SessionId,
    current: CallRecord,
    outcome: WaitOutcome,
  ): Promise<CallChange> => ({
    record: { ...current, waits: [...current.waits, outcome], waiting: null, partial: [] },
    updates: await resumed(session, current),
    index: { add: [wokenIndex(session, current.id)], drop: waitIndex(session, current) },
  });

  const woken = (session: SessionId, record: CallRecord): void => {
    dev("waits", "wake", { session, call: record.id });

    if (record.head !== null) kernel.wakes.notify(session, record.head);
    else registry.rerun(session, record.id);
  };

  const offer = async (entry: Indexed, outcome: WaitOutcome): Promise<boolean> => {
    const { session, call, occurrence, target: slot } = entry;
    let past = false;

    const written = await changeCall(kernel, session, call, async (current) => {
      if (
        current === null ||
        current.result !== null ||
        current.waiting === null ||
        current.waits.length !== occurrence
      ) {
        past = true;

        return null;
      }

      const target = current.waiting;

      if (slot === null || target.kind !== "all") return completion(session, current, outcome);

      if ((current.partial.at(slot) ?? null) !== null) return null;

      const partial = target.targets.map((_target, at) =>
        at === slot ? outcome : (current.partial.at(at) ?? null),
      );

      const outcomes = partial.flatMap((found) => (found === null ? [] : [found]));

      if (outcomes.length === target.targets.length)
        return completion(session, current, { kind: "all", outcomes });

      const on = waitingOn(target, partial);
      const filled = { ...current, partial };
      const kept = new Set(waitIndex(session, filled));

      return {
        record: filled,
        events:
          on === null || current.part === null
            ? []
            : [
                {
                  head: current.head,
                  kind: "call",
                  call,
                  part: current.part,
                  change: "waiting",
                  on,
                },
              ],
        updates:
          on === null || current.run === null
            ? []
            : await runWait(kernel.store, session, current.run, async (record) => ({
                parked: record.parked,
                waiting: on,
              })),
        index: { add: [], drop: waitIndex(session, current).filter((name) => !kept.has(name)) },
      };
    });

    if (past && entry.name !== null) await commit(kernel, [{ name: entry.name, target: null }]);

    if (!written.wrote || written.record === null) return false;

    if (written.record.waiting === null) woken(session, written.record);

    return true;
  };

  const offerAll = async (prefix: string, outcome: WaitOutcome): Promise<readonly boolean[]> =>
    Promise.all(
      (await kernel.store.refs.list(prefix)).flatMap((ref) => {
        const entry = readIndexed(ref.name);

        return entry === null ? [] : [offer(entry, outcome)];
      }),
    );

  const end = async (session: SessionId, record: CallRecord | null, outcome: WaitOutcome) => {
    const entry = readParkedWait(session, record);

    if (entry === null) return false;

    return offer(
      { name: null, session, call: entry.call, occurrence: entry.index, target: null },
      outcome,
    );
  };

  const settled = async (session: SessionId, target: WaitTarget): Promise<WaitOutcome | null> => {
    switch (target.kind) {
      case "run": {
        const ended = await readRunEnd(kernel, target.session, target.run);

        return ended === null
          ? null
          : { kind: "run", session: target.session, run: target.run, end: ended };
      }

      case "part": {
        const found = await load(
          kernel.store,
          await kernel.store.refs.get(partRef(session, target.part)),
          decodePartRecord,
        );

        if (found === null) return { kind: "part", part: target.part, answer: null };
        const answer = await storedAnswer(kernel.store, session, found.record);

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

  const park = async (entry: ParkedWait): Promise<void> => {
    const { session, call, target, index: occurrence } = entry;

    const at = (slot: number | null): Indexed => ({
      name: null,
      session,
      call,
      occurrence,
      target: slot,
    });

    dev("waits", "park", { session, call });

    if (target.kind === "all" && target.targets.length === 0) {
      await offer(at(null), { kind: "all", outcomes: [] });

      return;
    }

    const now = Date.now();
    const deadline = findEarliestDeadline(target);

    if (deadline !== null && deadline <= now) {
      await offer(at(null), { kind: "deadline" });

      return;
    }

    const targets = "targets" in target ? target.targets : [target];

    for (const [slot, waited] of targets.entries()) {
      if ((entry.partial.at(slot) ?? null) !== null) continue;

      const outcome =
        waited.kind === "timer"
          ? waited.until <= now
            ? { kind: "timer" as const }
            : null
          : await settled(session, waited);

      if (outcome !== null && (await offer(at(slot), outcome)) && target.kind !== "all") return;
    }
  };

  const registry: WaitRegistry = {
    park,
    async runEnded(session, run, ended) {
      return (
        await offerAll(`${WAITS}run/${session}/${run}/`, {
          kind: "run",
          session,
          run,
          end: ended,
        })
      ).some(Boolean);
    },
    async jobEnded(job, ended) {
      try {
        return (await offerAll(`${WAITS}job/${job}/`, { kind: "job", job, end: ended })).some(
          Boolean,
        );
      } catch (error) {
        dev("waits", "job end refused", { job, error: String(error) });

        return true;
      }
    },
    async partAnswered(session, part, answer) {
      await offerAll(`${WAITS}part/${session}/${part}/`, { kind: "part", part, answer });
    },
    async partClosed(session, part) {
      await offerAll(`${WAITS}part/${session}/${part}/`, { kind: "part", part, answer: null });
    },
    async inputAdmitted(session, head, message) {
      await offerAll(`${WAITS}input/${session}/${head}/`, { kind: "input", message });
    },
    async runStopped(session, run) {
      const found = await load(
        kernel.store,
        await kernel.store.refs.get(runRef(session, run)),
        decodeRunRecord,
      );

      await Promise.all(
        (found?.record.parked ?? []).map(async (call) =>
          end(session, (await readCall(kernel.store, session, call))?.record ?? null, STOPPED),
        ),
      );
    },
    async callStopped(session, call) {
      const nested = await kernel.store.refs.list(`${callRef(session, call)}:`);

      const records = await Promise.all([
        readCall(kernel.store, session, call),
        ...nested.map((ref) => load(kernel.store, ref, decodeCallRecord)),
      ]);

      await Promise.all(records.map((found) => end(session, found?.record ?? null, STOPPED)));
    },
    async tick(now) {
      const due: Promise<boolean>[] = [];

      for (const ref of await kernel.store.refs.list(TIME)) {
        const until = Number(ref.name.slice(TIME.length, TIME.length + TIME_DIGITS));

        if (until > now) break;
        const entry = readIndexed(ref.name);

        if (entry !== null)
          due.push(offer(entry, entry.target === null ? { kind: "deadline" } : { kind: "timer" }));
      }

      dev("waits", "tick", { due: due.length });
      await Promise.all(due);
    },
    async refresh() {
      await Promise.all(
        (await kernel.store.refs.list(WOKEN)).map(async (ref) => {
          const woken = readWoken(ref.name);

          if (woken === null) return;
          const record = (await readCall(kernel.store, woken.session, woken.call))?.record ?? null;

          const owed =
            record !== null &&
            record.result === null &&
            (record.run === null ||
              (await kernel.store.refs.get(runRef(woken.session, record.run))) !== null);

          if (!owed) await commit(kernel, [{ name: ref.name, target: null, expect: ref.revision }]);
          else if (record.waiting === null) wake(kernel, woken.session, record);
        }),
      );

      await Promise.all(
        [...resumers.values()].map(async (resumer) => {
          const found = await readCall(kernel.store, resumer.session, resumer.call);

          if (found !== null && (found.record.result !== null || lapsed(kernel, found.record)))
            resumer.resume();
        }),
      );
    },
    rerun(session, call) {
      const resumer = resumers.get(formatWaitKey(session, call));

      if (resumer !== undefined) resumer.resume();
      else
        void rerunAction(session, call).catch((error: unknown) =>
          dev("waits", "rerun failed", { call, error: String(error) }),
        );
    },
    onReceipt(session, id, listener) {
      const key = `${session}/${id}`;
      const listeners = receipts.get(key) ?? new Set<() => void>();
      listeners.add(listener);
      receipts.set(key, listeners);

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0 && receipts.get(key) === listeners) receipts.delete(key);
      };
    },
    receiptSettled(session, id) {
      for (const listener of receipts.get(`${session}/${id}`) ?? []) listener();
    },
    onWoken(session, call, resume) {
      const key = formatWaitKey(session, call);
      const resumer = { session, call, resume };
      resumers.set(key, resumer);

      return () => {
        if (resumers.get(key) === resumer) resumers.delete(key);
      };
    },
  };

  return registry;
}

/** The `waits/` index refs that point at `session`'s calls: what they wait on (by run, part, job, input and time) and the `woken/` ones, which go with the session when it is removed. */
export async function listSessionWaits(
  store: StoreConnection,
  session: SessionId,
): Promise<readonly Ref[]> {
  return (await store.refs.list(WAITS)).filter(
    (ref) => (readWoken(ref.name) ?? readIndexed(ref.name))?.session === session,
  );
}

/** Reads every unsettled call in `sessions` (default all), as recovery does when a process starts covering them: a parked one is checked against what it waits on, and a woken one is stepped or run again (see `wake`). */
export async function loadWaits(kernel: Kernel, sessions?: readonly SessionId[]): Promise<void> {
  for (const { session, record } of await pendingCalls(kernel, sessions)) {
    const entry = readParkedWait(session, record);

    if (entry === null) wake(kernel, session, record);
    else await kernel.waits.park(entry);
  }
}

async function pendingCalls(
  kernel: Kernel,
  sessions?: readonly SessionId[],
): Promise<readonly { readonly session: SessionId; readonly record: CallRecord }[]> {
  const refs = await kernel.store.sessions.pending({ kind: "call", sessions });

  const found = await Promise.all(
    refs.map(async (ref) => {
      const [root, id, kind] = ref.name.split("/");

      if (root !== "sessions" || id === undefined || kind !== "calls") return [];
      const loaded = await load(kernel.store, ref, decodeCallRecord);

      return loaded === null ? [] : [{ session: asId<"session">(id), record: loaded.record }];
    }),
  );

  return found.flat();
}

/** Steps an unparked call another process woke: a head's call by notifying the head, which only a covering process advances, and an action whose re-run claim lapsed by running it again. */
function wake(kernel: Kernel, session: SessionId, record: CallRecord): void {
  if (record.head === null && lapsed(kernel, record)) kernel.waits.rerun(session, record.id);
  else if (record.head !== null && record.waits.length > 0 && record.result === null)
    kernel.wakes.notify(session, record.head);
}

/** The earliest time any of `calls` waits for: a deadline, or a timer it has not had yet. */
export async function earliestWake(
  store: StoreConnection,
  session: SessionId,
  calls: readonly CallId[],
): Promise<number | null> {
  const records = await Promise.all(calls.map((call) => readCall(store, session, call)));

  const due = records.flatMap((found) => {
    const target = found?.record.waiting;

    if (target === undefined || target === null) return [];
    const partial = found?.record.partial ?? [];
    const deadline = findEarliestDeadline(target);

    return [
      ...(deadline === null ? [] : [deadline]),
      ...("targets" in target ? target.targets : [target]).flatMap((waited, slot) =>
        waited.kind === "timer" && (partial.at(slot) ?? null) === null ? [waited.until] : [],
      ),
    ];
  });

  return due.length === 0 ? null : Math.min(...due);
}

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

export async function runWait(
  store: StoreConnection,
  session: SessionId,
  run: RunId,
  change: (record: RunRecord) => Promise<Pick<RunRecord, "parked" | "waiting"> | null>,
): Promise<readonly RefUpdate[]> {
  const name = runRef(session, run);
  const found = await load(store, await store.refs.get(name), decodeRunRecord);
  const next = found === null ? null : await change(found.record);

  if (found === null || next === null) return [];
  const { record } = found;
  const head = record.view.head;
  const resumed = next.waiting === null && record.waiting !== null;

  return [
    {
      name,
      target: await put(store, "run", {
        ...record,
        ...next,
        phase: resumed ? "executing" : record.phase,
      }),
      expect: found.ref.revision,
      events:
        next.waiting !== null
          ? [{ head, kind: "run", run, change: "waiting", on: next.waiting }]
          : resumed
            ? [{ head, kind: "run", run, change: "phase", phase: "executing" }]
            : [],
    },
  ];
}

export function readParkedWait(session: SessionId, record: CallRecord | null): ParkedWait | null {
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

export function waitingOn(
  target: NonNullable<CallRecord["waiting"]>,
  partial: readonly (WaitOutcome | null)[],
): WaitTarget | null {
  if (!("targets" in target)) return target;

  return target.targets.find((_waited, index) => (partial.at(index) ?? null) === null) ?? null;
}

function formatWaitKey(session: SessionId, call: CallId): string {
  return `${session}/${call}`;
}

export function lapsed(kernel: Kernel, record: CallRecord): boolean {
  return (
    record.result === null &&
    record.waiting === null &&
    record.reran !== null &&
    record.reran.waits === record.waits.length &&
    record.reran.holder !== kernel.instance &&
    record.reran.expiresAt <= Date.now()
  );
}
