import { asId } from "@nyte-ai/schema";
import type {
  Configuration,
  HeadInfo,
  HeadName,
  PatchEvent,
  RefUpdate,
  RunEnd,
  RunId,
  RunView,
  SessionId,
  StopOutcome,
} from "@nyte-ai/schema";
import type { Failure } from "@nyte-ai/schema/model";
import { send } from "./admission.ts";
import { dropActivations } from "./registry.ts";
import { SdkError } from "./error.ts";
import type { FoldState } from "./fold.ts";
import type { Kernel } from "./kernel.ts";
import { CORE_CONTEXT, LOCAL } from "./principals.ts";
import { settleReceipt } from "./receipts.ts";
import { decodePartRecord, decodeRunRecord } from "./records.ts";
import type { RunRecord, SessionRecord } from "./records.ts";
import { inboxRef, runRef, sessionRef } from "./refs.ts";
import type { Run } from "./run.ts";
import {
  MAIN,
  STALE,
  attempt,
  commit,
  expectOf,
  isJsonObject,
  landedIn,
  load,
  put,
  readInbox,
  readSession,
  sessionEvent,
  withFold,
} from "./session-state.ts";
import { failedParts } from "./transcript.ts";
import { waitFor } from "./waits.ts";

const STOPPED: Failure = { class: "aborted", message: "Stopped." };

const REPORT_LIMIT = 4096;

/** A run's stop fence as its record reads: ended, already stopping, or live with the updates that fence it. */
type Fence =
  | { readonly kind: "ended" }
  | { readonly kind: "stopping"; readonly head: HeadName }
  | { readonly kind: "live"; readonly head: HeadName; readonly updates: readonly RefUpdate[] };

/** Starts a run on a head: writes its record with `run started`, opens its controller in `kernel.runs` and observes `run_started` (§38q). */
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
    snapshot: null,
    usage: null,
    requests: 0,
    waitedBy: [],
    parked: [],
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

  void kernel
    .runtimes()
    .get(session)
    ?.hooks.observe("run_started", view, { session, head, run: id, principal: LOCAL });

  return view;
}

/** Stops one run at the fence (§30): a run live here drops its patches from now on; `run stopping` and its live parts' failures land in one set; then its signal aborts, its parked waits wake `stopped` and its head wakes. */
export async function stopRun(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<StopOutcome<RunEnd>> {
  if (kernel.runs.get(run) !== undefined) kernel.runs.markStopping(run);

  const stopped = await attempt<
    | Exclude<StopOutcome<RunEnd>, { readonly kind: "requested" }>
    | { readonly kind: "requested"; readonly head: HeadName }
  >(`Stopping run ${run}`, async () => {
    const fenced = await fence(kernel, session, run);

    if (fenced.kind === "ended") {
      const end = await endOf(kernel, session, run);

      return end === null ? { kind: "missing" } : { kind: "settled", outcome: end };
    }

    if (fenced.kind === "live" && (await commit(kernel, fenced.updates)).kind === "stale")
      return STALE;

    return { kind: "requested", head: fenced.head };
  });

  if (stopped.kind !== "requested") return stopped;
  kernel.runs.abort(run);
  await kernel.waits.runStopped(session, run);
  kernel.wakes.notify(session, stopped.head);

  return { kind: "requested" };
}

/** Returns a run's fence for the caller's one set: `run stopping`, then `part failed` for each part of the run the store holds live, each expecting the revision it read. */
export async function fence(kernel: Kernel, session: SessionId, run: RunId): Promise<Fence> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  if (found === null) return { kind: "ended" };
  const head = found.record.view.head;

  if (found.record.stopping) return { kind: "stopping", head };

  const parts = await Promise.all(
    (await kernel.store.refs.list(`${sessionRef(session)}/parts/`)).map((ref) =>
      load(kernel, ref, decodePartRecord),
    ),
  );

  const live = parts.flatMap((part) =>
    part !== null && part.record.run === run && part.record.status.kind === "live"
      ? [part.record.id]
      : [],
  );

  return {
    kind: "live",
    head,
    updates: [
      {
        name: runRef(session, run),
        target: await put(kernel, "run", { ...found.record, stopping: true }),
        expect: found.ref.revision,
        event: { head, kind: "run", run, change: "stopping" },
      },
      ...(await failedParts(kernel, session, head, live, STOPPED)),
    ],
  };
}

/** Ends a run: deletes its ref, records the head's `lastRun` and rewrites the head's inbox in one set, so an input admitted against the live run loses its compare-and-set and reads again. Then it settles the receipts of the inputs that landed in the run, parks the waits listed in `waitedBy` here, delivers a child's report when no wait took the end, and wakes the head when input is due (§38n, §42s). */
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
    const inbox = await readInbox(kernel, session, head);
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
      {
        name: inboxRef(session, head),
        target: await put(kernel, "inbox", { messages: inbox.messages }),
        expect: expectOf(inbox.ref),
      },
    ]);

    return outcome.kind === "set"
      ? { head, parent: record.parent, waitedBy: found.record.waitedBy, pending: inbox.messages }
      : STALE;
  });

  kernel.runs.end(run);
  dropActivations(kernel, run);

  if (ended === null) return;

  void kernel
    .runtimes()
    .get(session)
    ?.hooks.observe("run_ended", end, { session, head: ended.head, run, principal: LOCAL });

  const landed = landedIn(kernel).get(run) ?? [];
  landedIn(kernel).delete(run);

  const { folded, runnable } = await withFold(kernel, session, (state) => ({
    folded: [...state.inputs.values()].flatMap((input) =>
      input.landed?.run === run ? [input.id] : [],
    ),
    runnable: ended.pending.some((id) => state.inputs.get(id)?.delivery !== "attach"),
  }));

  for (const message of new Set([...landed, ...folded]))
    await settleReceipt(kernel, session, asId<"receipt">(message), end);

  const woke = await kernel.waits.runEnded(session, run, end, ended.waitedBy);

  if (!woke && ended.parent !== null) await deliverChildReport(kernel, session, run, end);

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

/** Returns how a run ended: its head's `lastRun`, else the ended turn the fold holds; null while it is live or when no run has the id. */
export async function endOf(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<RunEnd | null> {
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

/** Marks a run stopping and aborts its signal when it is live here; another instance driving it reads its fence from the store. */
export function abortHere(kernel: Kernel, run: RunId): void {
  if (kernel.runs.get(run) === undefined) return;
  kernel.runs.markStopping(run);
  kernel.runs.abort(run);
}

/** Attaches a bounded report of a child's run to the parent's originating head. */
async function deliverChildReport(
  kernel: Kernel,
  child: SessionId,
  run: RunId,
  end: RunEnd,
): Promise<void> {
  const found = await readSession(kernel, child);
  const parent = found?.record.parent ?? null;

  if (found === null || parent === null) return;
  const target = await readSession(kernel, parent);

  if (target === null) return;
  const origin = found.record.origin?.head ?? MAIN;
  const head = target.record.heads.some((entry) => entry.name === origin) ? origin : MAIN;

  const answer = capped(
    (await withFold(kernel, child, (state) => answerOf(state, run))).trim(),
    REPORT_LIMIT,
  );

  const title = `Child ${child} ${end.kind}:`;

  await send(kernel, {
    session: parent,
    head,
    context: CORE_CONTEXT,
    content: answer === "" ? title : `${title}\n\n${answer}`,
    options: { source: { kind: "child", session: child }, delivery: "attach" },
  });
}

function answerOf(state: FoldState, run: RunId): string {
  const messages = state.heads.get(MAIN)?.messages ?? [];
  const turn = state.runs.get(run)?.turn ?? messages.at(-1)?.turn;

  return messages
    .flatMap((message) => {
      if (message.kind !== "part" || message.partKind !== "text" || message.turn !== turn)
        return [];
      const part = state.parts.get(message.part)?.state;

      return isJsonObject(part) && typeof part.markdown === "string" && part.markdown !== ""
        ? [part.markdown]
        : [];
    })
    .join("\n\n");
}

function capped(text: string, limit: number): string {
  const bytes = new TextEncoder().encode(text);

  if (bytes.length <= limit) return text;
  let end = limit;

  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;

  return new TextDecoder().decode(bytes.subarray(0, end));
}
