import { asId, SdkError } from "@nyte-ai/schema";
import type {
  AdvanceReport,
  Cursor,
  ExecutionCoverage,
  HeadName,
  MessageId,
  Owned,
  RepairPage,
  RunEnd,
  RunId,
  RunView,
  SessionId,
} from "@nyte-ai/schema";
import { retryDelayMs } from "@nyte-ai/ai/utils/retry";
import { executeCall, owedCalls } from "../agent/tool-runner.ts";
import type { FoldInput } from "../contract/fold.ts";
import { PARTICIPANT_AUTHORITY } from "../contract/host.ts";
import type { ExecutionState, Kernel, LandedInput } from "../contract/kernel.ts";
import { decodeLease, decodeRunRecord } from "../contract/records.ts";
import type { RunRecord } from "../contract/records.ts";
import { landing, selectRunStart } from "../engine/admission.ts";
import { LEASE_MS } from "../engine/durable.ts";
import { stopRequested } from "../engine/fence.ts";
import { holdLease } from "../engine/lease.ts";
import { recoverMoves } from "../engine/move.ts";
import { begin, endRun, newRun } from "../engine/runs.ts";
import { earliestWake, loadWaits } from "../engine/waits.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { leaseRef, runRef } from "../store/refs.ts";
import {
  coveredSessions,
  covers,
  coveredHere,
  liveRun,
  load,
  put,
  readInbox,
  readSession,
} from "../store/session.ts";
import type { Found } from "../store/session.ts";
import { objectId } from "../util/content.ts";
import { dev } from "../util/dev-log.ts";
import { keyedSerial } from "../util/serial.ts";
import type { StoreConnection } from "../contract/store.ts";

const RENEW_MS = 10_000;

const PAGE = 100;

const ADVANCE_RETRY = { baseDelayMs: 1_000, maxAgentDelayMs: 60_000 } as const;

type Refused = Extract<AdvanceReport, { readonly kind: "busy" | "fenced" }>;

const FENCED: Refused = { kind: "fenced" };

export function createExecutionState(): ExecutionState {
  return {
    held: new Map(),
    covers: new Map(),
    advancing: new Set(),
    leaseQueue: keyedSerial(),
    pending: new Map(),
    summaries: new Set(),
    callQueue: keyedSerial(),
    timer: null,
    closing: new AbortController(),
  };
}

export async function cover(kernel: Kernel, coverage: ExecutionCoverage): Promise<Owned> {
  const state = kernel.executionState;
  const handle = {};
  state.covers.set(handle, { ...coverage });

  state.timer ??= setInterval(() => void renewIdle(kernel), RENEW_MS);

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      state.covers.delete(handle);

      if (state.covers.size === 0 && state.timer !== null) {
        clearInterval(state.timer);
        state.timer = null;
      }

      const released: Promise<void>[] = [];

      for (const [name, entry] of state.held) {
        if (!entry.owners.delete(handle) || entry.owners.size > 0 || state.advancing.has(name))
          continue;
        released.push(release(kernel, entry.session, entry.head));
      }

      await Promise.all(released);
    })();

    return closing;
  };

  try {
    const records = coverage.kind === "all" ? null : await coveredSessions(kernel.store, coverage);
    await loadWaits(
      kernel,
      records?.map((record) => record.id),
    );

    const covered = records === null ? null : new Set(records.map((record) => record.id));

    const unresolved = [...kernel.plugins.runtimes()].flatMap(([session, runtime]) =>
      runtime.resolvedUncovered() && (covered === null || covered.has(session)) ? [session] : [],
    );

    await Promise.allSettled(unresolved.map((session) => kernel.plugins.reload(session)));

    if (records !== null && kernel.execution.kind === "run")
      for (const record of records)
        for (const head of await recover(kernel, record.id, record.heads))
          kernel.wakes.notify(record.id, head);
  } catch (error) {
    await close();

    throw error;
  }

  return { close, [Symbol.asyncDispose]: close };
}

export async function advance(
  kernel: Kernel,
  input: { readonly session: SessionId; readonly head: HeadName },
): Promise<AdvanceReport> {
  const { session, head } = input;
  const state = kernel.executionState;
  const name = leaseRef(session, head);

  if (state.advancing.has(name))
    return { kind: "busy", until: state.held.get(name)?.expiresAt ?? Date.now() + LEASE_MS };
  state.advancing.add(name);
  let claimed = false;
  let report: AdvanceReport | null = null;

  try {
    const found = await readSession(kernel.store, session);

    if (found === null || !found.record.heads.some((entry) => entry.name === head))
      return { kind: "idle" };
    await kernel.plugins.runtime(session).ready;
    const refused = await claim(kernel, session, head);

    if (refused !== null) return refused;
    claimed = true;
    const owners = state.held.get(name)?.owners;

    for (const [handle, coverage] of state.covers)
      if (await covers(kernel.store, coverage, session)) owners?.add(handle);

    report = await step(kernel, session, head).catch((error) =>
      failStep(kernel, session, head, error),
    );
    dev("execution", "advance", { session, head, report: report.kind });

    return report;
  } finally {
    state.advancing.delete(name);

    if (
      claimed &&
      (report?.kind !== "continue" || (state.held.get(name)?.owners.size ?? 0) === 0)
    ) {
      await release(kernel, session, head);

      if (report?.kind === "idle" && (await owed(kernel, session, head)))
        kernel.wakes.notify(session, head);
    }
  }
}

async function step(kernel: Kernel, session: SessionId, head: HeadName): Promise<AdvanceReport> {
  const live = await liveRun(kernel.store, session, head);
  const report = live === null ? null : await settleLive(kernel, session, head, live);

  if (report !== null) return report;
  const due = await dueInputs(kernel, session, head);

  if (due === null) return { kind: "idle" };

  const run = await newRun(kernel.store, session, head, due.origin, due.input.configuration);

  if ((await landing(kernel, session, head, due.ids, run.view.id, run.updates)).length === 0)
    return next(kernel, session, head);
  begin(kernel, session, run.view);

  return (await drive(kernel, session, head, run.view)) ?? next(kernel, session, head);
}

/** A step that throws leaves its run live with nothing driving it, so the head would show working forever: the run ends failed with the error instead. */
async function failStep(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  cause: unknown,
): Promise<AdvanceReport> {
  dev("execution", "step failed", { session, head, error: formatError(cause) });
  const live = await liveRun(kernel.store, session, head);

  if (live === null || kernel.driving.has(live.record.view.id)) throw cause;
  await endRun(kernel, session, live.record.view.id, failed(cause));

  return next(kernel, session, head);
}

export async function repair(
  kernel: Kernel,
  input: { readonly cursor?: Cursor; readonly limit: number },
): Promise<RepairPage> {
  if (input.cursor !== undefined && !input.cursor.startsWith("work:"))
    throw new SdkError("invalid", `${input.cursor} is not a recovery cursor`);
  const limit = Math.max(1, input.limit);

  const refs = await kernel.store.sessions.work({
    after:
      input.cursor === undefined ? undefined : asId<"session">(input.cursor.slice("work:".length)),
    limit: limit + 1,
  });

  const sessions = refs
    .slice(0, limit)
    .map((ref) => asId<"session">(ref.name.slice("sessions/".length)));

  await loadWaits(kernel, sessions);
  const runnable: { readonly session: SessionId; readonly head: HeadName }[] = [];

  for (const session of sessions) {
    const found = await readSession(kernel.store, session);

    if (found !== null)
      for (const head of await recover(kernel, session, found.record.heads))
        runnable.push({ session, head });
  }

  for (const entry of runnable) kernel.wakes.notify(entry.session, entry.head);
  dev("execution", "repair", { sessions: sessions.length, runnable: runnable.length });

  const last = sessions.at(-1);

  return {
    runnable,
    next: refs.length > limit && last !== undefined ? asId<"cursor">(`work:${last}`) : null,
  };
}

async function recover(
  kernel: Kernel,
  session: SessionId,
  heads: readonly { readonly name: HeadName }[],
): Promise<readonly HeadName[]> {
  await recoverMoves(kernel, session);
  const runnable: HeadName[] = [];

  for (const head of heads) if (await owed(kernel, session, head.name)) runnable.push(head.name);

  return runnable;
}

async function owed(kernel: Kernel, session: SessionId, head: HeadName): Promise<boolean> {
  const live = await liveRun(kernel.store, session, head);

  if (live === null) return (await dueInputs(kernel, session, head)) !== null;

  return (
    !kernel.driving.has(live.record.view.id) &&
    (live.record.stopping ||
      live.record.waiting === null ||
      (await owedCalls(kernel.store, session, live.record.view.id)).some((call) => !call.parked))
  );
}

export function driveInProcess(kernel: Kernel, coverage: ExecutionCoverage): Owned {
  const covering = cover(kernel, coverage);
  const inflight = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const due = new Set<number>();
  const failures = new Map<string, number>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const schedule = (until: number): void => {
    if (closed) return;
    due.add(until);
    const next = Math.min(...due);

    if (timer !== null) clearTimeout(timer);

    timer = setTimeout(
      () => {
        timer = null;
        const now = Date.now();

        for (const at of due) if (at <= now) due.delete(at);
        kernel.waits.tick(now).catch(() => undefined);

        if (due.size > 0) schedule(Math.min(...due));
      },
      Math.max(0, next - Date.now()),
    );
  };

  const step = (session: SessionId, head: HeadName): void => {
    const key = JSON.stringify([session, head]);

    if (closed) return;

    if (inflight.has(key)) {
      again.add(key);

      return;
    }

    const task = (async () => {
      await covering;

      if (!(await coveredHere(kernel, session))) return;

      for (;;) {
        if (closed) return;
        const report = await advance(kernel, { session, head });

        if (report.kind === "waiting" && report.until !== null) schedule(report.until);

        if (report.kind === "retry" || report.kind === "busy") stepAt(session, head, report.until);

        if (report.kind !== "continue") break;
      }

      failures.delete(key);
    })()
      .catch((error) => {
        const failed = (failures.get(key) ?? 0) + 1;
        failures.set(key, failed);
        dev("execution", "advance failed", { session, head, error: formatError(error) });
        stepAt(session, head, Date.now() + retryDelayMs(ADVANCE_RETRY, failed));
      })
      .finally(() => {
        inflight.delete(key);

        if (again.delete(key)) step(session, head);
      });

    inflight.set(key, task);
  };

  const stepAt = (session: SessionId, head: HeadName, until: number): void => {
    if (closed) return;

    const retry = setTimeout(
      () => {
        retries.delete(retry);
        step(session, head);
      },
      Math.max(0, until - Date.now()),
    );

    retries.add(retry);
  };

  const dispose = kernel.wakes.subscribe(step);

  if (coverage.kind === "all")
    void (async () => {
      await covering;
      let cursor: Cursor | undefined;

      do {
        cursor = (await repair(kernel, { cursor, limit: PAGE })).next ?? undefined;
      } while (cursor !== undefined && !closed);
    })().catch((error) => dev("execution", "repair failed", { error: formatError(error) }));

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      closed = true;
      dispose();

      if (timer !== null) clearTimeout(timer);

      for (const retry of retries) clearTimeout(retry);
      retries.clear();
      const state = kernel.executionState;
      const aborted = state.closing;
      state.closing = new AbortController();
      aborted.abort();
      await Promise.all(inflight.values());
      await covering.then(
        (owned) => owned.close(),
        () => undefined,
      );
    })();

    return closing;
  };

  return { close, [Symbol.asyncDispose]: close };
}

function claim(kernel: Kernel, session: SessionId, head: HeadName): Promise<Refused | null> {
  return kernel.executionState.leaseQueue.run(leaseRef(session, head), () =>
    claimNow(kernel, session, head),
  );
}

function release(kernel: Kernel, session: SessionId, head: HeadName): Promise<void> {
  return kernel.executionState.leaseQueue.run(leaseRef(session, head), () =>
    releaseNow(kernel, session, head),
  );
}

/** Renews the leases a cover holds between steps. Nothing runs under them, so a refusal only drops the entry (claimNow does); a step in flight renews its own lease. */
async function renewIdle(kernel: Kernel): Promise<void> {
  const { held, advancing } = kernel.executionState;

  for (const name of Array.from(held.keys()))
    await kernel.executionState.leaseQueue
      .run(name, async () => {
        const entry = held.get(name);

        return entry === undefined || entry.owners.size === 0 || advancing.has(name)
          ? null
          : claimNow(kernel, entry.session, entry.head);
      })
      .catch((error) => dev("execution", "renewal failed", { name, error: formatError(error) }));
}

async function claimNow(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Refused | null> {
  const name = leaseRef(session, head);
  const held = kernel.executionState.held;
  const mine = held.get(name)?.revision;
  const ref = await kernel.store.refs.get(name);

  if (mine !== undefined && ref?.revision !== mine) {
    held.delete(name);

    return { kind: "fenced" };
  }

  const lease = ref?.target ? decodeLease(await kernel.store.objects.get(ref.target)) : null;
  const now = Date.now();

  if (
    mine === undefined &&
    lease !== null &&
    (lease.holder !== kernel.hostId || lease.instance !== kernel.instance) &&
    lease.expiresAt > now
  )
    return { kind: "busy", until: lease.expiresAt };

  const outcome = await commit(kernel, [
    {
      name,
      target: await put(
        kernel.store,
        "lease",
        { holder: kernel.hostId, instance: kernel.instance, expiresAt: now + LEASE_MS },
        now,
      ),
      expect: ref === null ? "absent" : ref.revision,
    },
  ]);

  dev("execution", "claim", { session, head, outcome: outcome.kind });

  if (outcome.kind !== "set") {
    held.delete(name);

    return { kind: "fenced" };
  }

  held.set(name, {
    session,
    head,
    revision: outcome.revisions[0],
    expiresAt: now + LEASE_MS,
    owners: held.get(name)?.owners ?? new Set(),
  });

  return null;
}

async function releaseNow(kernel: Kernel, session: SessionId, head: HeadName): Promise<void> {
  const name = leaseRef(session, head);
  const held = kernel.executionState.held;
  const mine = held.get(name)?.revision;

  if (mine === undefined) return;
  held.delete(name);
  dev("execution", "release", { session, head });
  await commit(kernel, [{ name, target: null, expect: mine }]);
}

async function settleLive(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  live: Found<RunRecord>,
): Promise<AdvanceReport | null> {
  const run = live.record.view.id;

  if (kernel.driving.has(run))
    return (await holding(kernel.store, session, live.record)) ?? { kind: "idle" };

  if (live.record.stopping) {
    kernel.runs.start(session, run).abort();
    await kernel.waits.runStopped(session, run);
    const refused = await resume(kernel, session, head, run);

    if (refused !== null) return refused;
    await endRun(kernel, session, run, { kind: "stopped" });

    return null;
  }

  const refused = await resume(kernel, session, head, run);

  if (refused !== null) return refused;

  const record = (
    await load(kernel.store, await kernel.store.refs.get(runRef(session, run)), decodeRunRecord)
  )?.record;

  if (record === undefined) return null;

  return (
    (await holding(kernel.store, session, record)) ??
    (await drive(kernel, session, head, record.view)) ??
    next(kernel, session, head)
  );
}

async function holding(
  store: StoreConnection,
  session: SessionId,
  record: RunRecord,
): Promise<AdvanceReport | null> {
  if (record.parked.length > 0 || record.waiting !== null) return waitingOn(store, session, record);

  return record.retrying !== null && record.retrying.until > Date.now()
    ? { kind: "retry", until: record.retrying.until }
    : null;
}

async function resume(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId,
): Promise<Refused | null> {
  const renewal = holdHead(kernel, session, head);
  const signal = AbortSignal.any([kernel.runs.start(session, run).signal, renewal.lease.signal]);
  const runtime = kernel.plugins.runtime(session);
  const release = runtime.hold();

  try {
    await runtime.ready;

    for (const owed of await owedCalls(kernel.store, session, run)) {
      if (renewal.lease.signal.aborted) break;

      if (owed.parked) continue;

      await executeCall(kernel, {
        session,
        head,
        run,
        call: owed.call,
        name: owed.intent.name,
        args: owed.intent.args,
        argumentsError: owed.intent.argumentsError,
        runtime,
        context: {
          principal: owed.intent.principal,
          authority: PARTICIPANT_AUTHORITY,
          credential: { kind: "token", token: "" },
          origin: null,
        },
        signal,
      });
    }
  } finally {
    renewal.lease.stop();
    release();
  }

  const refused = renewal.refused();

  if (refused !== null) kernel.runs.end(run);

  return refused;
}

/** Holds a head's lease while a run is resumed or driven; `refused` says why it was lost. */
function holdHead(kernel: Kernel, session: SessionId, head: HeadName) {
  let refused: Refused | null = null;

  const lease = holdLease(
    leaseRef(session, head),
    async () => {
      refused = await claim(kernel, session, head);

      return refused === null;
    },
    { every: RENEW_MS, lapse: LEASE_MS },
  );

  return {
    lease,
    refused: (): Refused | null => refused ?? (lease.signal.aborted ? FENCED : null),
  };
}

async function drive(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunView,
): Promise<Refused | null> {
  kernel.driving.set(run.id, session);
  const closing = kernel.executionState.closing.signal;
  const renewal = holdHead(kernel, session, head);

  const signal = AbortSignal.any([
    kernel.runs.start(session, run.id).signal,
    closing,
    renewal.lease.signal,
  ]);

  const unrenew = (): void => renewal.lease.stop();
  closing.addEventListener("abort", unrenew, { once: true });

  const turned = kernel.turn
    .run({
      session,
      head,
      run,
      signal,
      boundary: () => boundary(kernel, session, head, run),
    })
    .then(
      (end) => ({ end }),
      (error) => ({ end: failed(error) }),
    )
    .finally(() => {
      unrenew();
      closing.removeEventListener("abort", unrenew);
      kernel.driving.delete(run.id);
    });

  const closed = new Promise<null>((resolve) => {
    if (closing.aborted) resolve(null);
    else closing.addEventListener("abort", () => resolve(null), { once: true });
  });

  const ended = await Promise.race([turned, closed]);
  const stopping = await stopRequested(kernel.store, session, run.id);
  const refused = renewal.refused();

  if (refused !== null) {
    kernel.runs.end(run.id);

    return refused;
  }

  if (ended === null || (closing.aborted && !stopping)) return null;

  if (ended.end.kind === "parked" && !stopping) return null;

  await endRun(
    kernel,
    session,
    run.id,
    ended.end.kind === "parked" ? { kind: "stopped" } : ended.end,
  );

  return null;
}

async function boundary(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunView,
): Promise<readonly LandedInput[]> {
  const inbox = await readInbox(kernel.store, session, head);

  const inputs = await withFold(kernel, session, (state) =>
    inbox.messages.flatMap((id) => state.inputs.get(id) ?? []),
  );

  const key = await objectId(run.configuration);
  const due: LandedInput[] = [];

  for (const input of inputs)
    if (
      input.delivery === "attach" ||
      (input.schedule.kind === "joined" && input.schedule.run === run.id) ||
      (input.delivery === "steer" && (await objectId(input.configuration)) === key)
    )
      due.push({ message: input.id, delivery: input.delivery, source: input.source });

  if (due.length === 0) return [];

  const landed = await landing(
    kernel,
    session,
    head,
    due.map((input) => input.message),
    run.id,
  );

  return due.filter((input) => landed.includes(input.message));
}

async function dueInputs(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<{
  readonly origin: RunView["origin"];
  readonly input: FoldInput;
  readonly ids: readonly MessageId[];
} | null> {
  const inbox = await readInbox(kernel.store, session, head);

  if (inbox.messages.length === 0) return null;

  const read = await withFold(kernel, session, (state) => {
    const inputs = inbox.messages.flatMap((id) => state.inputs.get(id) ?? []);

    return { inputs, start: selectRunStart(state, head, inputs) };
  });

  const { inputs, start } = read;

  if (start === null) return null;
  const key = await objectId(start.input.configuration);
  const ids: MessageId[] = [];

  for (const input of inputs)
    if (
      input === start.input ||
      input.delivery === "attach" ||
      (input.delivery === "steer" && (await objectId(input.configuration)) === key)
    )
      ids.push(input.id);

  return { ...start, ids };
}

async function next(kernel: Kernel, session: SessionId, head: HeadName): Promise<AdvanceReport> {
  const live = await liveRun(kernel.store, session, head);

  if (live === null)
    return (await dueInputs(kernel, session, head)) === null
      ? { kind: "idle" }
      : { kind: "continue" };
  const { record } = live;
  const run = record.view.id;

  if (kernel.driving.has(run)) return { kind: "idle" };
  const calls = await owedCalls(kernel.store, session, run);

  if (record.stopping || calls.some((call) => !call.parked)) return { kind: "continue" };

  if (record.waiting !== null || calls.length > 0) return waitingOn(kernel.store, session, record);

  if (record.retrying !== null && record.retrying.until > Date.now())
    return { kind: "retry", until: record.retrying.until };

  return { kind: "continue" };
}

async function waitingOn(
  store: StoreConnection,
  session: SessionId,
  record: RunRecord,
): Promise<AdvanceReport> {
  const { waiting } = record;

  return {
    kind: "waiting",
    until:
      (await earliestWake(store, session, record.parked)) ??
      (waiting === null
        ? null
        : waiting.kind === "timer"
          ? waiting.until
          : (waiting.deadline ?? null)),
  };
}

function failed(cause: unknown): RunEnd {
  return { kind: "failed", failure: { class: "runner", message: formatError(cause) } };
}

function formatError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const DISPATCH_RETRIES = 3;

const DISPATCH_BACKOFF_MS = 50;

export function dispatchHead(
  kernel: Kernel,
  execution: Extract<Kernel["execution"], { readonly kind: "dispatch" }>,
  session: SessionId,
  head: HeadName,
): void {
  const pending = kernel.executionState.pending;
  const key = JSON.stringify([session, head]);

  if (pending.has(key)) {
    pending.set(key, true);

    return;
  }

  pending.set(key, false);

  void (async () => {
    for (let tries = 0; tries <= DISPATCH_RETRIES; tries += 1) {
      if (tries > 0)
        await new Promise((resolve) => setTimeout(resolve, DISPATCH_BACKOFF_MS * 2 ** tries));
      dev("execution", "dispatch", { session, head, tries });

      const dispatched = await Promise.resolve()
        .then(() => execution.dispatch({ session, head }))
        .then(
          () => true,
          () => false,
        );

      if (dispatched) break;
    }

    const again = pending.get(key) === true;
    pending.delete(key);

    if (again) dispatchHead(kernel, execution, session, head);
  })();
}
