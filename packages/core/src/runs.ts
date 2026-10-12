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
import { decodeRunRecord } from "./records.ts";
import type { RunRecord, SessionRecord } from "./records.ts";
import { inboxRef, runRef, sessionRef } from "./refs.ts";
import type { Run } from "./run.ts";
import {
  MAIN,
  STALE,
  attempt,
  commit,
  expectOf,
  inboxWithout,
  isJsonObject,
  landedIn,
  liveParts,
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

/** Starts a run on a head: writes its record with `run started` alone, then begins it here (§38q). Advance starts a run in the set that lands its inputs instead (§62). */
export async function startRun(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  origin: RunView["origin"],
  configuration: Configuration,
): Promise<RunView> {
  const started = await newRun(kernel, session, head, origin, configuration);

  if ((await commit(kernel, [started.update])).kind === "stale")
    throw new SdkError("internal", `Run ${started.view.id} already exists.`);
  begin(kernel, session, started.view);

  return started.view;
}

/** Returns a new run's view and the update writing its record with `run started`, expecting it absent, for the caller's set. */
export async function newRun(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  origin: RunView["origin"],
  configuration: Configuration,
): Promise<{ readonly view: RunView; readonly update: RefUpdate }> {
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
    lastSnapshot: null,
    usage: null,
    requests: 0,
    waitedBy: [],
    parked: [],
  };

  return {
    view,
    update: {
      name: runRef(session, id),
      target: await put(kernel, "run", record, startedAt),
      expect: "absent",
      event: { head, kind: "run", run: id, change: "started", view },
    },
  };
}

/** Opens a landed run's controller here and observes `run_started`. */
export function begin(kernel: Kernel, session: SessionId, view: RunView): void {
  kernel.runs.start(view.id);
  void kernel.runtimes().get(session)?.hooks.observe("run_started", view, {
    session,
    head: view.head,
    run: view.id,
    principal: LOCAL,
  });
}

/** Stops one run at the fence (§30): a run live here drops its patches from now on; the fence lands, or finds the run stopping or ended; then its signal aborts, its parked waits wake `stopped` and its head wakes. */
export async function stopRun(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<StopOutcome<RunEnd>> {
  const unmark = kernel.runs.get(run) === undefined ? null : kernel.runs.markStopping(run);
  let fenced: Exclude<Fence, { readonly kind: "live" }>;

  try {
    fenced = await attempt(`Stopping run ${run}`, async () => {
      const read = await fence(kernel, session, run);

      if (read.kind !== "live") return read;

      return (await commit(kernel, read.updates)).kind === "set"
        ? { kind: "stopping", head: read.head }
        : STALE;
    });
  } catch (error) {
    unmark?.();

    throw error;
  }

  if (fenced.kind === "ended") {
    const end = await endOf(kernel, session, run);

    return end === null ? { kind: "missing" } : { kind: "settled", outcome: end };
  }

  kernel.runs.abort(run);
  await kernel.waits.runStopped(session, run);
  kernel.wakes.notify(session, fenced.head);

  return { kind: "requested" };
}

/** Returns a run's fence for the caller's one set: `run stopping`, `part failed` for each of the run's live or waiting parts, and the head's inbox rewritten, each expecting the revision it read. A part opened or an input landed into the run expects the run ref (`unfenced`), so either it lands first and this set loses, or it reads `stopping`. */
export async function fence(kernel: Kernel, session: SessionId, run: RunId): Promise<Fence> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  if (found === null) return { kind: "ended" };
  const head = found.record.view.head;

  if (found.record.stopping) return { kind: "stopping", head };

  const [live, inbox] = await Promise.all([
    liveParts(kernel, session, run),
    readInbox(kernel, session, head),
  ]);

  const [stopping, failed, rewritten] = await Promise.all([
    put(kernel, "run", { ...found.record, stopping: true }),
    failedParts(kernel, session, head, live, STOPPED),
    put(kernel, "inbox", inboxWithout(inbox, [])),
  ]);

  return {
    kind: "live",
    head,
    updates: [
      {
        name: runRef(session, run),
        target: stopping,
        expect: found.ref.revision,
        event: { head, kind: "run", run, change: "stopping" },
      },
      ...failed,
      { name: inboxRef(session, head), target: rewritten, expect: expectOf(inbox.ref) },
    ],
  };
}

/** Returns the update that holds a run unfenced in the caller's set: its ref rewritten as read, expecting that revision; null once the run is stopping or ended. */
export async function unfenced(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<RefUpdate | null> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  return found === null || found.record.stopping
    ? null
    : { name: found.ref.name, target: found.ref.target, expect: found.ref.revision };
}

/** Ends a run with `end`, or `stopped` when its record is fenced: deletes its ref, records the head's `lastRun`, rewrites the head's inbox and fails the parts a failed or stopped run left live in one set, so an input admitted against the live run loses its compare-and-set and reads again. Then it settles the receipts of the inputs that landed in the run, parks the waits listed in `waitedBy` here, delivers a child's report when no wait took the end, and wakes the head when input is due (§38n, §42s). */
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
    const final: RunEnd = found.record.stopping ? { kind: "stopped" } : end;
    const inbox = await readInbox(kernel, session, head);
    const endedAt = Date.now();
    const lastRun = { id: run, end: final, endedAt };

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
        event: { head, kind: "run", run, change: "ended", end: final },
      },
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record, endedAt),
        expect: current.ref.revision,
        event: await sessionEvent(kernel, record, rows),
      },
      {
        name: inboxRef(session, head),
        target: await put(kernel, "inbox", inboxWithout(inbox, [])),
        expect: expectOf(inbox.ref),
      },
      ...(final.kind === "completed"
        ? []
        : await failedParts(
            kernel,
            session,
            head,
            await liveParts(kernel, session, run),
            final.kind === "failed" ? final.failure : STOPPED,
          )),
    ]);

    return outcome.kind === "set"
      ? {
          head,
          end: final,
          parent: record.parent,
          waitedBy: found.record.waitedBy,
          pending: inbox.messages,
        }
      : STALE;
  });

  kernel.runs.end(run);
  dropActivations(kernel, run);

  if (ended === null) return;

  void kernel
    .runtimes()
    .get(session)
    ?.hooks.observe("run_ended", ended.end, { session, head: ended.head, run, principal: LOCAL });

  const landed = landedIn(kernel).get(run) ?? [];
  landedIn(kernel).delete(run);

  const { folded, runnable } = await withFold(kernel, session, (state) => ({
    folded: [...state.inputs.values()].flatMap((input) =>
      input.landed?.run === run ? [input.id] : [],
    ),
    runnable: ended.pending.some((id) => state.inputs.get(id)?.delivery !== "attach"),
  }));

  for (const message of new Set([...landed, ...folded]))
    await settleReceipt(kernel, session, asId<"receipt">(message), ended.end);

  const woke = await kernel.waits.runEnded(session, run, ended.end, ended.waitedBy);

  if (!woke && ended.parent !== null) await deliverChildReport(kernel, session, run, ended.end);

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
