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
import { decodeRunRecord, isJsonObject } from "./records.ts";
import type { RunRecord, SessionRecord } from "./records.ts";
import { inboxRef, runRef, sessionRef } from "./refs.ts";
import type { Run } from "./run.ts";
import {
  MAIN,
  STALE,
  attempt,
  commit,
  readRefExpectation,
  inboxWithout,
  liveParts,
  load,
  put,
  readInbox,
  readReceipt,
  readSession,
  readTip,
  sessionEvent,
  withFold,
} from "./session-state.ts";
import { failedParts, stoppedParts } from "./transcript.ts";
import { notifyReceipt, waitFor } from "./waits.ts";

export const FENCED: Failure = { class: "aborted", message: "Stopped." };

const REPORT_LIMIT = 4096;

type Fence =
  | { readonly kind: "ended" }
  | { readonly kind: "stopping"; readonly head: HeadName }
  | { readonly kind: "live"; readonly head: HeadName; readonly updates: readonly RefUpdate[] };

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

export function begin(kernel: Kernel, session: SessionId, view: RunView): void {
  kernel.runs.start(view.id);
  void kernel.runtimes().get(session)?.hooks.observe("run_started", view, {
    session,
    head: view.head,
    run: view.id,
    principal: LOCAL,
  });
}

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
    const end = await readRunEnd(kernel, session, run);

    return end === null ? { kind: "missing" } : { kind: "settled", outcome: end };
  }

  kernel.runs.abort(run);
  await kernel.waits.runStopped(session, run);
  kernel.wakes.notify(session, fenced.head);

  return { kind: "requested" };
}

export async function fence(kernel: Kernel, session: SessionId, run: RunId): Promise<Fence> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  if (found === null) return { kind: "ended" };
  const head = found.record.view.head;

  if (found.record.stopping) return { kind: "stopping", head };

  const [live, inbox, tip] = await Promise.all([
    liveParts(kernel, session, run),
    readInbox(kernel, session, head),
    readTip(kernel, session, head),
  ]);

  const [stopping, stopped, rewritten] = await Promise.all([
    put(kernel, "run", { ...found.record, stopping: true }),
    stoppedParts(kernel, session, head, tip, live, FENCED),
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
      ...stopped,
      { name: inboxRef(session, head), target: rewritten, expect: readRefExpectation(inbox.ref) },
    ],
  };
}

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

    const landed = await withFold(kernel, session, (state) =>
      [...state.inputs.values()].flatMap((input) =>
        input.landed?.run === run ? [asId<"receipt">(input.id)] : [],
      ),
    );

    const receipts = await Promise.all(
      landed.map(async (id): Promise<readonly RefUpdate[]> => {
        const receipt = await readReceipt(kernel, session, id);

        if (receipt === null || receipt.record.outcome !== null) return [];

        return [
          {
            name: receipt.ref.name,
            target: await put(kernel, "receipt", { ...receipt.record, outcome: final }),
            expect: receipt.ref.revision,
          },
        ];
      }),
    );

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
        expect: readRefExpectation(inbox.ref),
      },
      ...(final.kind === "completed"
        ? []
        : await failedParts(
            kernel,
            session,
            head,
            await liveParts(kernel, session, run),
            final.kind === "failed" ? final.failure : FENCED,
          )),
      ...receipts.flat(),
    ]);

    return outcome.kind === "set"
      ? {
          head,
          end: final,
          parent: record.parent,
          waitedBy: found.record.waitedBy,
          pending: inbox.messages,
          settled: receipts.flatMap((updates, index) =>
            updates.length > 0 ? [landed[index]] : [],
          ),
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

  for (const id of ended.settled) notifyReceipt(kernel, session, id);

  const woke = await kernel.waits.runEnded(session, run, ended.end, ended.waitedBy);

  if (!woke && ended.parent !== null) await deliverChildReport(kernel, session, run, ended.end);

  if (ended.pending.length > 0) kernel.wakes.notify(session, ended.head);
}

export function runHandle(kernel: Kernel, session: SessionId, id: RunId): Run {
  return {
    id,
    stop: () => stopRun(kernel, session, id),
    settled: (options) =>
      waitFor<RunEnd>({
        options,
        async check() {
          if ((await kernel.store.refs.get(runRef(session, id))) !== null) return null;
          const end = await readRunEnd(kernel, session, id);

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

export function publishPatch(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  patch: PatchEvent,
): void {
  if (kernel.runs.isStopping(run)) return;
  kernel.bus.publish(session, patch);
}

export async function readRunEnd(
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

export function abortHere(kernel: Kernel, run: RunId): void {
  if (kernel.runs.get(run) === undefined) return;
  kernel.runs.markStopping(run);
  kernel.runs.abort(run);
}

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
    (await withFold(kernel, child, (state) => extractRunAnswer(state, run))).trim(),
    REPORT_LIMIT,
  );

  await send(kernel, {
    session: parent,
    head,
    context: CORE_CONTEXT,
    content: answer,
    options: { source: { kind: "child", session: child, end: end.kind }, delivery: "attach" },
  });
}

function extractRunAnswer(state: FoldState, run: RunId): string {
  const messages = state.heads.get(MAIN)?.messages ?? [];
  const turn = state.runs.get(run)?.turn ?? messages.at(-1)?.turn;

  return (
    messages
      .flatMap((message) => {
        if (message.kind !== "part" || message.partKind !== "text" || message.turn !== turn)
          return [];
        const part = state.parts.get(message.part)?.state;

        return isJsonObject(part) && typeof part.markdown === "string" && part.markdown !== ""
          ? [part.markdown]
          : [];
      })
      .at(-1) ?? ""
  );
}

function capped(text: string, limit: number): string {
  const bytes = new TextEncoder().encode(text);

  if (bytes.length <= limit) return text;
  let end = limit;

  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;

  return new TextDecoder().decode(bytes.subarray(0, end));
}
