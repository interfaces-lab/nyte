import { asId } from "@nyte-ai/schema";
import type {
  Configuration,
  HeadInfo,
  HeadName,
  PartId,
  PatchEvent,
  RefUpdate,
  RunEnd,
  RunId,
  RunView,
  SessionId,
  StopOutcome,
} from "@nyte-ai/schema";
import type { Failure } from "@nyte-ai/schema/model";
import { deliverChildReport } from "./child-report.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { settleReceipt } from "./receipts.ts";
import { decodeRunRecord } from "./records.ts";
import type { RunRecord, SessionRecord } from "./records.ts";
import { partRef, runRef, sessionRef } from "./refs.ts";
import type { Run } from "./run.ts";
import {
  STALE,
  attempt,
  commit,
  landedIn,
  load,
  put,
  readSession,
  sessionEvent,
  withFold,
} from "./session-state.ts";
import { waitFor } from "./waits.ts";

const STOPPED: Failure = { class: "aborted", message: "Stopped." };

/** Starts a run on a head: mints its id, writes its `RunRecord` with `run started`, and opens its controller in `kernel.runs`. */
export async function startRun(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  origin: RunView["origin"],
  configuration: Configuration,
): Promise<RunView> {
  const id = asId<"run">(crypto.randomUUID());
  const startedAt = Date.now();
  const view: RunView = { id, head, startedAt, attempt: 1, configuration, origin };

  const record: RunRecord = {
    view,
    phase: "responding",
    stopping: false,
    waiting: null,
    retrying: null,
  };

  kernel.runs.start(id);

  const outcome = await commit(kernel, [
    {
      name: runRef(session, id),
      target: await put(kernel, "run", record, startedAt),
      expect: "absent",
      event: { head, kind: "run", run: id, change: "started", view },
    },
  ]);

  if (outcome.kind === "stale") {
    kernel.runs.end(id);

    throw new SdkError("internal", `Run ${id} already exists.`);
  }

  return view;
}

/** Stops one run at the fence (§30): marks it stopping in `kernel.runs` before any await, so its patches drop; publishes `run stopping` and fails its live parts in one set; then aborts its signal as cleanup and wakes its head, so the driver ends it. Resolves `requested`, or `settled` when the run ended before its fence. */
export async function stopRun(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<StopOutcome<RunEnd>> {
  const here = kernel.runs.get(run) !== undefined;
  kernel.runs.markStopping(run);

  const stopped = await attempt<{
    readonly head: HeadName | null;
    readonly outcome: StopOutcome<RunEnd>;
  }>(`Stopping run ${run}`, async () => {
    const fence = await fenceUpdates(kernel, session, run);

    if (fence === null) {
      const end = await endOf(kernel, session, run);

      return {
        head: null,
        outcome: end === null ? { kind: "missing" } : { kind: "settled", outcome: end },
      };
    }

    if (fence.updates.length > 0 && (await commit(kernel, fence.updates)).kind === "stale")
      return STALE;

    return { head: fence.head, outcome: { kind: "requested" } };
  });

  if (stopped.head === null) {
    if (!here) kernel.runs.end(run);

    return stopped.outcome;
  }

  kernel.runs.abort(run);
  kernel.wakes.notify(session, stopped.head);

  return stopped.outcome;
}

/** Returns a live run's fence as ref updates, `run stopping` then `part failed` for each live or waiting part it owns, for the caller's one set; empty when the run is already stopping, null when it has ended. */
export async function fenceUpdates(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<{
  readonly head: HeadName;
  readonly updates: readonly RefUpdate[];
  readonly parts: readonly PartId[];
} | null> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  if (found === null) return null;
  const head = found.record.view.head;

  if (found.record.stopping) return { head, updates: [], parts: [] };

  const parts = await withFold(kernel, session, (state) =>
    [...state.parts.values()].filter(
      (part) => part.run === run && (part.status.kind === "live" || part.status.kind === "waiting"),
    ),
  );

  const failed = await Promise.all(
    parts.map(async (part): Promise<RefUpdate> => ({
      name: partRef(session, part.id),
      target: await put(kernel, "part", {
        ...part,
        status: { kind: "failed", run, failure: STOPPED },
      }),
      event: { head, kind: "part", part: part.id, change: "failed", failure: STOPPED },
    })),
  );

  return {
    head,
    updates: [
      {
        name: runRef(session, run),
        target: await put(kernel, "run", { ...found.record, stopping: true }),
        expect: found.ref.revision,
        event: { head, kind: "run", run, change: "stopping" },
      },
      ...failed,
    ],
    parts: parts.map((part) => part.id),
  };
}

/** Ends a run: deletes its ref, records the head's `lastRun`, publishes `run ended`, settles every send receipt whose message landed in this run, delivers a child's report, and wakes the head when input is queued. */
export async function endRun(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  end: RunEnd,
): Promise<void> {
  const ended = await attempt(`Ending run ${run}`, async () => {
    const [found, current] = await Promise.all([
      kernel.store.refs.get(runRef(session, run)).then((ref) => load(kernel, ref, decodeRunRecord)),
      readSession(kernel, session),
    ]);

    if (found === null || current === null) return null;
    const head = found.record.view.head;
    const endedAt = Date.now();
    const lastRun = { id: run, end, endedAt };

    const record: SessionRecord = {
      ...current.record,
      lastActivityAt: endedAt,
      heads: current.record.heads.map((entry) =>
        entry.name === head ? { ...entry, lastRun } : entry,
      ),
    };

    const rows = new Map<HeadName, Partial<HeadInfo>>([
      [head, { execution: { kind: "idle", lastRun } }],
    ]);

    const outcome = await commit(kernel, [
      {
        name: runRef(session, run),
        target: null,
        expect: found.ref.revision,
        event: { head, kind: "run", run, change: "ended", end },
      },
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record, endedAt),
        expect: current.ref.revision,
        event: await sessionEvent(kernel, record, rows),
      },
    ]);

    return outcome.kind === "set" ? { head, parent: record.parent } : STALE;
  });

  kernel.runs.end(run);

  if (ended === null) return;
  const landed = landedIn(kernel).get(run) ?? [];
  landedIn(kernel).delete(run);

  const { folded, runnable } = await withFold(kernel, session, (state) => ({
    folded: [...state.inputs.values()].flatMap((input) =>
      input.landed?.run === run ? [input.id] : [],
    ),
    runnable: (state.heads.get(ended.head)?.pending ?? []).some((id) => {
      const input = state.inputs.get(id);

      return input !== undefined && input.delivery !== "attach";
    }),
  }));

  for (const message of new Set([...landed, ...folded]))
    await settleReceipt(kernel, session, asId<"receipt">(message), end);

  if (ended.parent !== null) await deliverChildReport(kernel, session, run, end);

  if (runnable) kernel.wakes.notify(session, ended.head);
}

/** Returns a handle on one run: `stop()` is the fence; `settled()` waits for `run ended`, or reads the head's `lastRun` after a restart. Binds synchronously; no I/O. */
export function runHandle(kernel: Kernel, session: SessionId, id: RunId): Run {
  return {
    id,
    stop: () => stopRun(kernel, session, id),
    settled: (options) =>
      waitFor<RunEnd>({
        options,
        async check() {
          if ((await kernel.store.refs.get(runRef(session, id))) !== null) return null;
          const end = await endOf(kernel, session, id);

          if (end === null) throw new SdkError("unknown", `No run has the id ${id}.`);

          return { value: end };
        },
        subscribe: (trigger) =>
          kernel.bus.subscribe(session, (event) => {
            if (event.kind === "run" && event.run === id && event.change === "ended") trigger();
          }),
      }),
  };
}

/** Publishes a transient patch to a run's part, or drops it once the run is stopping. */
export function publishPatch(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  patch: PatchEvent,
): void {
  if (kernel.runs.isStopping(run)) return;
  kernel.bus.publish(session, patch);
}

async function endOf(kernel: Kernel, session: SessionId, run: RunId): Promise<RunEnd | null> {
  const found = await readSession(kernel, session);
  const last = found?.record.heads.find((head) => head.lastRun?.id === run)?.lastRun;

  if (last !== undefined && last !== null) return last.end;

  return withFold(kernel, session, (state) => {
    for (const turn of state.turns.values()) {
      if (turn.info.run === run && turn.info.state.kind === "ended") return turn.info.state.end;
    }

    return null;
  });
}
