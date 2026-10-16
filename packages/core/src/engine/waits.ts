import { asId } from "@nyte-ai/schema";
import type {
  CallId,
  Disposer,
  JobEnd,
  Json,
  PartId,
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
import { changeCall } from "../fold/commit.ts";
import type { CallChange } from "../fold/commit.ts";
import { readRunEnd } from "../fold/reads.ts";
import { storedAnswer } from "../store/parts.ts";
import { callRef, partRef, runRef } from "../store/refs.ts";
import { load, put, readCall } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { SdkError } from "../util/error.ts";

interface Slot {
  readonly entry: ParkedWait;
  readonly targets: readonly WaitTarget[];
  outcomes: readonly (WaitOutcome | null)[];
}

const LOST: JobEnd = { kind: "lost" };

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

  const drop = (slot: Slot): void => {
    const key = formatWaitKey(slot.entry.session, slot.entry.call);

    if (slots.get(key) === slot) slots.delete(key);
  };

  const woken = (slot: Slot): void => {
    const { entry } = slot;
    dev("waits", "wake", { session: entry.session, call: entry.call });
    drop(slot);

    if (entry.head !== null) kernel.wakes.notify(entry.session, entry.head);
    else registry.rerun(entry.session, entry.call);
  };

  const settle = async (slot: Slot, outcome: WaitOutcome): Promise<boolean> => {
    const { entry } = slot;

    const written = await changeCall(kernel, entry.session, entry.call, async (current) =>
      current !== null && open(current, entry) ? completion(current, entry, outcome) : null,
    );

    if (!written.wrote) {
      if (written.record === null || !open(written.record, entry)) drop(slot);

      return false;
    }

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
        events:
          on === null || current.part === null
            ? []
            : [
                {
                  head: current.head,
                  kind: "call",
                  call: current.id,
                  part: current.part,
                  change: "waiting",
                  on,
                },
              ],
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

    if (record === null || !open(record, entry)) drop(slot);

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
    const deadline = findEarliestDeadline(slot.entry.target);

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
        const end = await readRunEnd(kernel, target.session, target.run);

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

  const slotFor = (entry: ParkedWait): Slot => {
    const held = slots.get(formatWaitKey(entry.session, entry.call));

    if (held?.entry.index === entry.index) return held;
    const target = entry.target;
    const targets = "targets" in target ? target.targets : [target];

    return {
      entry,
      targets,
      outcomes: targets.map((_target, index) => entry.partial.at(index) ?? null),
    };
  };

  const storedWait = async (session: SessionId, call: CallId): Promise<ParkedWait | null> =>
    readParkedWait(session, (await readCall(kernel, session, call))?.record ?? null);

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
    const key = formatWaitKey(entry.session, entry.call);
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
          const entry = readParkedWait(session, found?.record ?? null);

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
          const key = formatWaitKey(entry.session, entry.call);
          const record = (await readCall(kernel, entry.session, entry.call))?.record ?? null;
          const stored = readParkedWait(entry.session, record);

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
        const deadline = findEarliestDeadline(slot.entry.target);

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
      const resumer = resumers.get(formatWaitKey(session, call));

      if (resumer !== undefined) resumer.resume();
      else
        void kernel.parts
          .rerun(session, call)
          .catch((error: unknown) => dev("waits", "rerun failed", { call, error: String(error) }));
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

export async function loadWaits(kernel: Kernel, sessions?: readonly SessionId[]): Promise<void> {
  const refs = await kernel.store.sessions.pending({ kind: "call", sessions });

  for (const ref of refs) {
    const [root, session, kind] = ref.name.split("/");

    if (root !== "sessions" || session === undefined || kind !== "calls") continue;
    const found = await load(kernel, ref, decodeCallRecord);
    const entry = readParkedWait(asId<"session">(session), found?.record ?? null);

    if (entry !== null) await kernel.waits.park(entry);
    else if (found !== null && lapsed(kernel, found.record))
      kernel.waits.rerun(asId<"session">(session), found.record.id);
  }
}

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

export function notifyReceipt(kernel: Kernel, session: SessionId, id: string): void {
  for (const listener of kernel.receipts.get(`${session}/${id}`) ?? []) listener();
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

function findEarliestDeadline(target: NonNullable<CallRecord["waiting"]>): number | null {
  const bounds = [
    target.deadline,
    ...("targets" in target ? target.targets.map((waited) => waited.deadline) : []),
  ].flatMap((deadline) => (deadline === undefined ? [] : [deadline]));

  return bounds.length === 0 ? null : Math.min(...bounds);
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
