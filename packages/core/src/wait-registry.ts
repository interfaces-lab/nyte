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
  RunEnd,
  RunId,
  SessionId,
  WaitOutcome,
  WaitTarget,
} from "@nyte-ai/schema";
import { dev } from "./dev-log.ts";
import type { Kernel } from "./kernel.ts";
import { answerOf } from "./part-handle.ts";
import { answeredElsewhere, partAnswers } from "./part-table.ts";
import { decodeCallRecord, decodePartRecord, decodeRunRecord } from "./records.ts";
import type { CallRecord } from "./records.ts";
import { partRef, runRef } from "./refs.ts";
import { endOf } from "./runs.ts";
import { changeCall, load, put, readCall, runWaiting } from "./session-state.ts";
import type { CallChange } from "./session-state.ts";

/** How a job this instance does not hold ends for a wait on it: its process went with another instance or a previous one (§42w, §43k). */
const LOST: JobEnd = { kind: "lost" };

/** Returns one parked durable wait: the step's call, where it runs (`head` null for an action or hook outside a head), and the whole target or combination it waits on. */
export interface ParkedWait {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly call: CallId;
  readonly target: NonNullable<CallRecord["waiting"]>;
}

/** Holds the durable waits parked in this process, by what wakes them. Each wake method finds the parked entries the event settles and records the outcome in their call record. A per-target outcome of a pending `all` fills its slot in `CallRecord.partial` and shows the next unsettled target with `call waiting` and `run waiting`. A step whose wait completes (`all` once every slot is filled, `any` and a single target on the first outcome, or a deadline, an input or a stop) gets its `WaitOutcome` appended to `CallRecord.waits` with `waiting` cleared, and its run leaves `waiting` with `run phase executing` in the same set, unless another of the run's calls is still parked. Then `kernel.wakes.notify(session, head)` runs, so `advance` re-runs the step. Each method resolves whether a step woke, a filled slot alone not being a wake, except `runEnded` and `jobEnded`, which resolve whether a wait consumed the end, a filled slot included. A head-less entry notifies no head; its step re-runs through the act that runs it. */
export interface WaitRegistry {
  /** Parks a step on its target; a target that already has its outcome (a run ended, a part answered in this process or closed, a job this registry saw end, a timer or deadline passed) settles at once. A job this instance's table does not hold settles `lost` (§42w, §43k): after a restart, or on another instance, its process is gone. */
  park(entry: ParkedWait): Promise<void>;
  /** Wakes the waits on a run that ended, with `run { end }`, and resolves whether a wait consumed the end: a step woke or a pending `all` filled its slot. `endRun` hands the answer to the child report, so a consumed end attaches no report. */
  runEnded(session: SessionId, run: RunId, end: RunEnd): Promise<boolean>;
  /** Wakes the waits on a job that ended, with `job { end }`, remembers the end for waits parked later, and resolves whether a wait consumed the end, as `runEnded` does: `endJob` sends the exit report only when none did. */
  jobEnded(job: JobId, end: JobEnd): Promise<boolean>;
  /** Wakes the waits on a part of `session` that was answered, with `part { answer }`, the answer made durable first (§42x, §42z): `call`, the step the part's live status names as waiting on it, is parked here if it is not (read by its id, no listing), so its outcome is written to its call record (`sessions/<id>/calls/<call>`) before any local wake, and an instance that parked it elsewhere settles it from the store on its next `poll` pass (`settleFromStore`). */
  partAnswered(
    session: SessionId,
    part: PartId,
    answer: { readonly action: string; readonly input: Json },
    call: CallId | null,
  ): Promise<boolean>;
  /** Wakes the waits on a part that closed unanswered, with `part { answer: null }`. */
  partClosed(part: PartId): Promise<boolean>;
  /** Wakes the `untilInput` waits on a head that admitted a message, with `input { message }`. */
  inputAdmitted(session: SessionId, head: HeadName, message: MessageId): Promise<boolean>;
  /** Wakes every wait parked by a run that was stopped, with `stopped`. */
  runStopped(session: SessionId, run: RunId): Promise<boolean>;
  /** Wakes the wait parked by one call, and by the calls nested under it, with `stopped`: what the tool part's `stop` does to a call that is not running. */
  callStopped(session: SessionId, call: CallId): Promise<boolean>;
  /** Fires the timers and deadlines due at `now`, with `timer` or `deadline`. */
  tick(now: number): Promise<boolean>;
  /** Returns the earliest timer or deadline among a head's parked waits, or null when none has one: what `advance` reports as `waiting { until }`. */
  nextDeadline(session: SessionId, head: HeadName): number | null;
  /** Settles every parked wait from what the store shows, for waits another instance may have settled (§42h, §42x): a wait whose call another instance completed is dropped here and its head woken here (its step re-runs and reads the recorded outcome; a call whose step already has a result is dropped quietly), a part answer the record shows settles that part's local `answer()` promises (§42z), and each target still open is offered the outcome the store shows (a run that ended, a part closed); resolves whether a step woke. What `pollStore` runs. */
  settleFromStore(): Promise<boolean>;
}

/** Returns what offering one outcome to one target did: woke its step, filled a slot of a pending `all`, or nothing. */
type Taken = "woke" | "filled" | "none";

/** Returns one parked wait with its targets and, mirroring its record, the outcome each target has had so far. */
interface Slot {
  readonly entry: ParkedWait;
  readonly targets: readonly WaitTarget[];
  outcomes: readonly (WaitOutcome | null)[];
}

const resumers = new WeakMap<Kernel, Map<string, () => void>>();

/** Returns an empty wait registry over a kernel: what `kernel.waits` holds, built once the kernel object exists. */
export function createWaitRegistry(kernel: Kernel): WaitRegistry {
  const slots = new Map<string, Slot>();
  const jobs = new Map<JobId, JobEnd>();

  const resumed = async (slot: Slot): Promise<readonly RefUpdate[]> => {
    const { entry } = slot;

    if (entry.run === null) return [];
    const name = runRef(entry.session, entry.run);
    const found = await load(kernel, await kernel.store.refs.get(name), decodeRunRecord);

    if (found === null || found.record.waiting === null) return [];

    const other = [...slots.values()].find(
      (candidate) =>
        candidate !== slot &&
        candidate.entry.session === entry.session &&
        candidate.entry.run === entry.run,
    );

    const on = other === undefined ? null : waitingOn(other.entry.target, other.outcomes);

    if (on !== null) return runWaiting(kernel, entry.session, entry.run, on);

    return [
      {
        name,
        target: await put(kernel, "run", { ...found.record, waiting: null, phase: "executing" }),
        expect: found.ref.revision,
        event: {
          head: found.record.view.head,
          kind: "run",
          run: entry.run,
          change: "phase",
          phase: "executing",
        },
      },
    ];
  };

  const completion = async (
    current: CallRecord,
    slot: Slot,
    outcome: WaitOutcome,
  ): Promise<CallChange> => ({
    record: { ...current, waits: [...current.waits, outcome], waiting: null, partial: [] },
    updates: await resumed(slot),
  });

  const woken = (slot: Slot): void => {
    const { entry } = slot;
    const key = keyOf(entry.session, entry.call);
    dev("waits", "wake", { session: entry.session, call: entry.call });

    if (slots.get(key) === slot) slots.delete(key);

    if (entry.head !== null) kernel.wakes.notify(entry.session, entry.head);
    else resumers.get(kernel)?.get(key)?.();
  };

  const settle = async (slot: Slot, outcome: WaitOutcome): Promise<boolean> => {
    const { entry } = slot;

    if (slots.get(keyOf(entry.session, entry.call)) !== slot) return false;

    const written = await changeCall(kernel, entry.session, entry.call, async (current) =>
      current === null || current.result !== null || current.waiting === null
        ? null
        : completion(current, slot, outcome),
    );

    if (!written.wrote) return false;
    woken(slot);

    return true;
  };

  const offer = async (slot: Slot, index: number, outcome: WaitOutcome): Promise<Taken> => {
    const { entry } = slot;

    if (entry.target.kind !== "all") return (await settle(slot, outcome)) ? "woke" : "none";

    if (slots.get(keyOf(entry.session, entry.call)) !== slot) return "none";

    const written = await changeCall(kernel, entry.session, entry.call, async (current) => {
      if (
        current === null ||
        current.result !== null ||
        current.waiting === null ||
        (current.partial.at(index) ?? null) !== null
      )
        return null;

      const partial = slot.targets.map((_target, at) =>
        at === index ? outcome : (current.partial.at(at) ?? null),
      );

      const outcomes = partial.flatMap((found) => (found === null ? [] : [found]));

      if (outcomes.length === slot.targets.length)
        return completion(current, slot, { kind: "all", outcomes });

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
            : await runWaiting(kernel, entry.session, entry.run, on),
      };
    });

    const record = written.record;

    if (!written.wrote || record === null) return "none";

    if (record.waiting !== null) {
      slot.outcomes = record.partial;

      return "filled";
    }

    woken(slot);

    return "woke";
  };

  const deliver = (
    match: (target: WaitTarget) => boolean,
    outcome: WaitOutcome,
  ): Promise<readonly Taken[]> =>
    Promise.all(
      [...slots.values()].flatMap((slot) =>
        slot.targets.flatMap((target, index) =>
          (slot.outcomes.at(index) ?? null) === null && match(target)
            ? [offer(slot, index, outcome)]
            : [],
        ),
      ),
    );

  const wokeBy = async (
    match: (target: WaitTarget) => boolean,
    outcome: WaitOutcome,
  ): Promise<boolean> => (await deliver(match, outcome)).includes("woke");

  const expire = async (slot: Slot, now: number): Promise<boolean> => {
    const deadline = deadlineOf(slot.entry.target);

    if (deadline !== null && deadline <= now) return settle(slot, { kind: "deadline" });

    const fired = await Promise.all(
      slot.targets.flatMap((target, index) =>
        target.kind === "timer" && target.until <= now && (slot.outcomes.at(index) ?? null) === null
          ? [offer(slot, index, { kind: "timer" })]
          : [],
      ),
    );

    return fired.includes("woke");
  };

  const settled = async (session: SessionId, target: WaitTarget): Promise<WaitOutcome | null> => {
    switch (target.kind) {
      case "run": {
        const end = await endOf(kernel, target.session, target.run);

        return end === null ? null : { kind: "run", session: target.session, run: target.run, end };
      }

      case "part": {
        const ref = await kernel.store.refs.get(partRef(session, target.part));

        if (ref === null) return { kind: "part", part: target.part, answer: null };
        const status = (await load(kernel, ref, decodePartRecord))?.record.status;
        const kept = status?.kind === "live" ? (status.answer ?? null) : null;
        const answer = answerOf(kernel, session, target.part) ?? kept;

        return answer === null ? null : { kind: "part", part: target.part, answer };
      }

      case "job": {
        const state = jobs.get(target.job) ?? kernel.jobs.get(target.job)?.view.state ?? LOST;

        return state.kind === "running" ? null : { kind: "job", job: target.job, end: state };
      }

      case "timer":
        return null;
    }
  };

  const stop = (match: (entry: ParkedWait) => boolean): Promise<boolean> =>
    anyOf(
      [...slots.values()].flatMap((slot) =>
        match(slot.entry) ? [settle(slot, { kind: "stopped" })] : [],
      ),
    );

  const park = async (entry: ParkedWait): Promise<void> => {
    const key = keyOf(entry.session, entry.call);

    if (slots.has(key)) return;
    const target = entry.target;
    const targets = "targets" in target ? target.targets : [target];
    const recorded = (await readCall(kernel, entry.session, entry.call))?.record.partial ?? [];

    if (slots.has(key)) return;

    const slot: Slot = {
      entry,
      targets,
      outcomes: targets.map((_target, index) => recorded.at(index) ?? null),
    };

    slots.set(key, slot);
    dev("waits", "park", { session: entry.session, call: entry.call, targets: targets.length });

    if (target.kind === "all" && targets.length === 0) {
      await settle(slot, { kind: "all", outcomes: [] });

      return;
    }

    await expire(slot, Date.now());

    for (const [index, waited] of targets.entries()) {
      if (slots.get(key) !== slot) return;

      if ((slot.outcomes.at(index) ?? null) !== null) continue;
      const outcome = await settled(entry.session, waited);

      if (outcome !== null) await offer(slot, index, outcome);
    }
  };

  return {
    park,
    runEnded: async (session, run, end) =>
      (
        await deliver(
          (target) => target.kind === "run" && target.session === session && target.run === run,
          { kind: "run", session, run, end },
        )
      ).some((taken) => taken !== "none"),
    async jobEnded(job, end) {
      jobs.set(job, end);

      return (
        await deliver((target) => target.kind === "job" && target.job === job, {
          kind: "job",
          job,
          end,
        })
      ).some((taken) => taken !== "none");
    },
    async partAnswered(session, part, answer, call) {
      const on = (target: WaitTarget): boolean => target.kind === "part" && target.part === part;
      let parked = false;

      if (call !== null && !slots.has(keyOf(session, call))) {
        const record = (await readCall(kernel, session, call))?.record;
        const waiting = record?.result === null ? record.waiting : null;

        if (
          record !== undefined &&
          waiting !== null &&
          ("targets" in waiting ? waiting.targets.some(on) : on(waiting))
        ) {
          await park({ session, head: record.head, run: record.run, call, target: waiting });
          parked = !slots.has(keyOf(session, call));
        }
      }

      return (await wokeBy(on, { kind: "part", part, answer })) || parked;
    },
    partClosed: (part) =>
      wokeBy((target) => target.kind === "part" && target.part === part, {
        kind: "part",
        part,
        answer: null,
      }),
    inputAdmitted: (session, head, message) =>
      anyOf(
        [...slots.values()].flatMap((slot) => {
          const { entry } = slot;

          return entry.session === session &&
            entry.head === head &&
            "targets" in entry.target &&
            entry.target.untilInput === true
            ? [settle(slot, { kind: "input", message })]
            : [];
        }),
      ),
    runStopped: (session, run) => stop((entry) => entry.session === session && entry.run === run),
    callStopped: (session, call) =>
      stop(
        (entry) =>
          entry.session === session && (entry.call === call || entry.call.startsWith(`${call}:`)),
      ),
    tick(now) {
      dev("waits", "tick", { parked: slots.size });

      return anyOf([...slots.values()].map((slot) => expire(slot, now)));
    },
    settleFromStore: () =>
      anyOf(
        [...slots.values()].map(async (slot) => {
          const { entry } = slot;
          const key = keyOf(entry.session, entry.call);
          const record = (await readCall(kernel, entry.session, entry.call))?.record;

          if (record !== undefined)
            for (const answered of partAnswers([...record.waits, ...record.partial]))
              answeredElsewhere(kernel, entry.session, answered.part, answered.answer);

          if (record === undefined || record.result !== null || record.waiting === null) {
            if (slots.get(key) !== slot) return false;
            slots.delete(key);

            if (record === undefined || record.result !== null) return false;
            woken(slot);

            return true;
          }

          slot.outcomes = slot.targets.map(
            (_target, index) => record.partial.at(index) ?? slot.outcomes.at(index) ?? null,
          );

          const offers = await Promise.all(
            slot.targets.map(async (target, index) => {
              if (slots.get(key) !== slot || (slot.outcomes.at(index) ?? null) !== null)
                return "none";
              const outcome = await settled(entry.session, target);

              return outcome === null ? "none" : offer(slot, index, outcome);
            }),
          );

          return offers.includes("woke");
        }),
      ),
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
  };
}

/** Rebuilds `kernel.waits` after a restart from every `calls/*` record whose `waiting` is set, with the partial outcomes it recorded: every session's, or only the listed sessions' (`sessions/<id>/calls/`, never a whole-store scan, §42p); `cover` calls it. Parking an entry the registry already holds changes nothing. */
export async function loadWaits(kernel: Kernel, sessions?: readonly SessionId[]): Promise<void> {
  const refs =
    sessions === undefined
      ? await kernel.store.refs.list("sessions/")
      : (
          await Promise.all(
            sessions.map((session) => kernel.store.refs.list(`sessions/${session}/calls/`)),
          )
        ).flat();

  for (const entry of await waitingCalls(kernel, refs)) await kernel.waits.park(entry);
}

/** Returns the parked waits the `calls/*` records among `refs` hold: each call with no result whose `waiting` is set. */
async function waitingCalls(kernel: Kernel, refs: readonly Ref[]): Promise<readonly ParkedWait[]> {
  const entries: ParkedWait[] = [];

  for (const ref of refs) {
    const [root, session, kind] = ref.name.split("/");

    if (root !== "sessions" || session === undefined || kind !== "calls") continue;
    const found = await load(kernel, ref, decodeCallRecord);
    const record = found?.record;

    if (record === undefined || record.result !== null || record.waiting === null) continue;

    entries.push({
      session: asId<"session">(session),
      head: record.head,
      run: record.run,
      call: record.id,
      target: record.waiting,
    });
  }

  return entries;
}

/** Returns what a wait shows as waiting on: the target itself, or a combination's first target whose outcome slot is empty; null when none is. */
export function waitingOn(
  target: NonNullable<CallRecord["waiting"]>,
  partial: readonly (WaitOutcome | null)[],
): WaitTarget | null {
  if (!("targets" in target)) return target;

  return target.targets.find((_waited, index) => (partial.at(index) ?? null) === null) ?? null;
}

/** Calls `resume` when a wake records an outcome for a head-less step, so the act running it runs it again; the disposer stops it. */
export function onStepWoken(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
  resume: () => void,
): Disposer {
  const byCall = resumers.get(kernel) ?? new Map<string, () => void>();
  const key = keyOf(session, call);
  resumers.set(kernel, byCall);
  byCall.set(key, resume);

  return () => {
    if (byCall.get(key) === resume) byCall.delete(key);
  };
}

/** Returns the earliest deadline bounding a wait, its own or any of its targets', or null when it has none. */
function deadlineOf(target: NonNullable<CallRecord["waiting"]>): number | null {
  const bounds = [
    target.deadline,
    ...("targets" in target ? target.targets.map((waited) => waited.deadline) : []),
  ].flatMap((deadline) => (deadline === undefined ? [] : [deadline]));

  return bounds.length === 0 ? null : Math.min(...bounds);
}

/** Resolves whether any of the wakes woke a step. */
async function anyOf(wakes: readonly Promise<boolean>[]): Promise<boolean> {
  return (await Promise.all(wakes)).includes(true);
}

/** Returns the key a step's wait is held under. */
function keyOf(session: SessionId, call: CallId): string {
  return `${session}/${call}`;
}
