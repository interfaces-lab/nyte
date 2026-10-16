import { asId, isJsonObject, SdkError } from "@nyte-ai/schema";
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
} from "@nyte-ai/schema";
import type { FoldState } from "../contract/fold.ts";
import { CORE_CONTEXT, LOCAL } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import { decodeCallRecord, decodeRunRecord } from "../contract/records.ts";
import type { RunRecord, SessionRecord } from "../contract/records.ts";
import type { Run } from "../contract/session.ts";
import { commit } from "../fold/commit.ts";
import { liveParts, readRunEnd, withFold } from "../fold/reads.ts";
import { failedParts } from "../store/parts.ts";
import { inboxRef, liveRef, runRef, sessionRef } from "../store/refs.ts";
import { wokenIndex } from "../store/wait-index.ts";
import {
  attempt,
  inboxWithout,
  load,
  MAIN,
  put,
  readInbox,
  readReceipt,
  readRefExpectation,
  readSession,
  sessionEvent,
  STALE,
} from "../store/session.ts";
import { send } from "./admission.ts";
import { FENCED, stopRun } from "./fence.ts";
import { waitFor } from "./waits.ts";
import type { StoreConnection } from "../contract/store.ts";

const REPORT_LIMIT = 4096;

export async function newRun(
  store: StoreConnection,
  session: SessionId,
  head: HeadName,
  origin: RunView["origin"],
  configuration: Configuration,
): Promise<{ readonly view: RunView; readonly updates: readonly RefUpdate[] }> {
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
    parked: [],
  };

  const target = await put(store, "run", record, startedAt);

  return {
    view,
    updates: [
      {
        name: runRef(session, id),
        target,
        expect: "absent",
        events: [{ head, kind: "run", run: id, change: "started", view }],
      },
      { name: liveRef(session, id), target, expect: "absent" },
    ],
  };
}

export function begin(kernel: Kernel, session: SessionId, view: RunView): void {
  kernel.runs.start(session, view.id);
  void kernel.plugins.runtimes().get(session)?.hooks.observe("run_started", view, {
    session,
    head: view.head,
    run: view.id,
    principal: LOCAL,
  });
}

export async function endRun(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  end: RunEnd,
): Promise<void> {
  const ended = await attempt(`Ending run ${run}`, async () => {
    const [found, current] = await Promise.all([
      kernel.store.refs
        .get(runRef(session, run))
        .then((ref) => load(kernel.store, ref, decodeRunRecord)),
      readSession(kernel.store, session),
    ]);

    if (found === null || current === null) return null;
    const head = found.record.view.head;
    const final: RunEnd = found.record.stopping ? { kind: "stopped" } : end;
    const inbox = await readInbox(kernel.store, session, head);
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
        const receipt = await readReceipt(kernel.store, session, id);

        if (receipt === null || receipt.record.outcome !== null) return [];

        return [
          {
            name: receipt.ref.name,
            target: await put(kernel.store, "receipt", { ...receipt.record, outcome: final }),
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
        events: [{ head, kind: "run", run, change: "ended", end: final }],
      },
      { name: liveRef(session, run), target: null },
      {
        name: sessionRef(session),
        target: await put(kernel.store, "session", record, endedAt),
        expect: current.ref.revision,
        events: [await sessionEvent(kernel, record, rows)],
      },
      {
        name: inboxRef(session, head),
        target: await put(kernel.store, "inbox", inboxWithout(inbox, [])),
        expect: readRefExpectation(inbox.ref),
      },
      ...(final.kind === "completed"
        ? []
        : await failedParts(
            kernel.store,
            session,
            head,
            await liveParts(kernel, session, run),
            final.kind === "failed" ? final.failure : FENCED,
          )),
      ...receipts.flat(),
      ...(await abandonedCalls(kernel.store, session, run)),
    ]);

    return outcome.kind === "set"
      ? {
          head,
          end: final,
          parent: record.parent,
          pending: inbox.messages,
          settled: receipts.flatMap((updates, index) =>
            updates.length > 0 ? [landed[index]] : [],
          ),
        }
      : STALE;
  });

  kernel.runs.end(run);

  if (ended === null) return;

  void kernel.plugins
    .runtimes()
    .get(session)
    ?.hooks.observe("run_ended", ended.end, { session, head: ended.head, run, principal: LOCAL });

  for (const id of ended.settled) kernel.waits.receiptSettled(session, id);

  const woke = await kernel.waits.runEnded(session, run, ended.end);

  if (!woke && ended.parent !== null) await deliverChildReport(kernel, session, run, ended.end);

  if (ended.pending.length > 0) kernel.wakes.notify(session, ended.head);
}

/** Deletes the calls an ended run recorded but never opened, and the woken index of those it woke but never stepped: nothing owes them once the run is over. */
async function abandonedCalls(
  store: StoreConnection,
  session: SessionId,
  run: RunId,
): Promise<readonly RefUpdate[]> {
  const refs = await store.sessions.pending({ kind: "call", sessions: [session] });

  const found = await Promise.all(
    refs.map(async (ref) => ({ ref, call: await load(store, ref, decodeCallRecord) })),
  );

  return found.flatMap(({ ref, call }): readonly RefUpdate[] => {
    if (call === null || call.record.run !== run) return [];

    if (call.record.kind === "intent")
      return [{ name: ref.name, target: null, expect: ref.revision }];

    return call.record.result === null &&
      call.record.waiting === null &&
      call.record.waits.length > 0
      ? [{ name: wokenIndex(session, call.record.id), target: null }]
      : [];
  });
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
  if (kernel.runs.fenced(run)) return;
  kernel.bus.publish(session, patch);
}

async function deliverChildReport(
  kernel: Kernel,
  child: SessionId,
  run: RunId,
  end: RunEnd,
): Promise<void> {
  const found = await readSession(kernel.store, child);
  const parent = found?.record.parent ?? null;

  if (found === null || parent === null) return;
  const target = await readSession(kernel.store, parent);

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
