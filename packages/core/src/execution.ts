import type {
  AdvanceReport,
  Cursor,
  ExecutionCoverage,
  HeadName,
  MessageId,
  Owned,
  RepairPage,
  Revision,
  RunEnd,
  RunId,
  RunView,
  SessionId,
  WaitTarget,
} from "@nyte-ai/schema";
import { landing, startOf } from "./admission.ts";
import { objectId } from "./content.ts";
import { dev } from "./dev-log.ts";
import type { FoldInput } from "./fold.ts";
import type { Kernel, LandedInput } from "./kernel.ts";
import { recoverMoves } from "./move.ts";
import { LOCAL, PARTICIPANT_AUTHORITY } from "./principals.ts";
import { decodeLease, decodeRunRecord } from "./records.ts";
import type { RunRecord } from "./records.ts";
import { leaseRef, runRef } from "./refs.ts";
import { begin, endRun, newRun } from "./runs.ts";
import { listSessions } from "./session.ts";
import {
  commit,
  covers,
  liveRun,
  load,
  put,
  readInbox,
  readSession,
  withFold,
} from "./session-state.ts";
import type { Found } from "./session-state.ts";
import { executeCall, owedCalls } from "./tool-runner.ts";
import { loadWaits } from "./waits.ts";

/** How long a lease, and a step's re-run claim, holds unrenewed. */
export const LEASE_MS = 30_000;

const RENEW_MS = 10_000;

const PAGE = 100;

/** What a lease claim refuses with. */
type Refused = Extract<AdvanceReport, { readonly kind: "busy" | "fenced" }>;

/** One lease this kernel holds: its head, the revision it wrote, when it expires, and the open cover handles that own it. */
interface Held {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly revision: Revision;
  readonly expiresAt: number;
  readonly owners: Set<object>;
}

/** What `kernel.executionState` holds: the leases, the open covers, the heads an advance steps now, the claim queue per lease, the pending dispatches (true once a wake arrived meanwhile), the branch summaries this process is writing by receipt, the call queues, the renew timer and the host-closing controller. */
export interface ExecutionState {
  readonly held: Map<string, Held>;
  readonly covers: Map<object, ExecutionCoverage>;
  readonly advancing: Set<string>;
  readonly queue: Map<string, Promise<unknown>>;
  readonly pending: Map<string, boolean>;
  readonly summaries: Set<string>;
  readonly callQueues: Map<string, Promise<unknown>>;
  timer: ReturnType<typeof setInterval> | null;
  closing: AbortController;
}

export function createExecutionState(): ExecutionState {
  return {
    held: new Map(),
    covers: new Map(),
    advancing: new Set(),
    queue: new Map(),
    pending: new Map(),
    summaries: new Set(),
    callQueues: new Map(),
    timer: null,
    closing: new AbortController(),
  };
}

/** Registers a coverage without claiming a lease and parks the durable waits the store records for its sessions. While open it counts for `isCovered`, owns the leases its sessions' advances claim and renews them every 10 s; closing releases each lease no other open cover owns and no advance is stepping. */
export async function cover(kernel: Kernel, coverage: ExecutionCoverage): Promise<Owned> {
  const state = kernel.executionState;
  const handle = {};
  state.covers.set(handle, { ...coverage });

  state.timer ??= setInterval(() => {
    renew(kernel).catch(() => undefined);
  }, RENEW_MS);

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
    await loadWaits(kernel, coverage.kind === "sessions" ? coverage.sessions : undefined);
  } catch (error) {
    await close();

    throw error;
  }

  return { close, [Symbol.asyncDispose]: close };
}

/** Runs one leased kernel step on a head after its activation: claims the lease, re-runs owed tool calls, lands due inputs, runs a turn when one is owed and reports what comes next. A head this instance already steps answers `busy`; the lease is released when the step ends unless it reports `continue` and an open cover still owns it; an `idle` head owed a step by then, its dispatch refused `busy` meanwhile, is woken once. */
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
    const found = await readSession(kernel, session);

    if (found === null || !found.record.heads.some((entry) => entry.name === head))
      return { kind: "idle" };
    await kernel.pluginsFor(session).ready;
    const refused = await claim(kernel, session, head);

    if (refused !== null) return refused;
    claimed = true;
    const owners = state.held.get(name)?.owners;

    for (const [handle, coverage] of state.covers)
      if (await covers(kernel, coverage, session)) owners?.add(handle);

    report = await step(kernel, session, head);
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
  const live = await liveRun(kernel, session, head);
  const report = live === null ? null : await settleLive(kernel, session, head, live);

  if (report !== null) return report;
  const due = await dueInputs(kernel, session, head);

  if (due === null) return { kind: "idle" };

  const run = await newRun(kernel, session, head, due.origin, due.input.configuration);

  if ((await landing(kernel, session, head, due.ids, run.view.id, run.update)).length === 0)
    return next(kernel, session, head);
  begin(kernel, session, run.view);

  return (await drive(kernel, session, head, run.view)) ?? next(kernel, session, head);
}

/** Returns one page of heads owed a step and wakes each. It first parks the page's recorded waits, so a wait whose target settled while no instance held it is settled and its head woken, and settles the moves and branch summaries a crash left pending. */
export async function repair(
  kernel: Kernel,
  input: { readonly cursor?: Cursor; readonly limit: number },
): Promise<RepairPage> {
  const page = await listSessions(kernel, LOCAL, { cursor: input.cursor, limit: input.limit });
  await loadWaits(
    kernel,
    page.items.map((info) => info.id),
  );
  const runnable: { readonly session: SessionId; readonly head: HeadName }[] = [];

  for (const info of page.items) {
    await recoverMoves(kernel, info.id);

    for (const head of info.heads) {
      if (await owed(kernel, info.id, head.name))
        runnable.push({ session: info.id, head: head.name });
    }
  }

  for (const entry of runnable) kernel.wakes.notify(entry.session, entry.head);
  dev("execution", "repair", { sessions: page.items.length, runnable: runnable.length });

  return { runnable, next: page.next };
}

/** Returns whether a head is owed a step: an input due and no live run, or a live run no turn drives here that is stopping, waits on nothing or has a call to re-run, so `repair` re-dispatches a lost stop. */
async function owed(kernel: Kernel, session: SessionId, head: HeadName): Promise<boolean> {
  const live = await liveRun(kernel, session, head);

  if (live === null) return (await dueInputs(kernel, session, head)) !== null;

  return (
    !kernel.driving.has(live.record.view.id) &&
    (live.record.stopping ||
      live.record.waiting === null ||
      (await owedCalls(kernel, session, live.record.view.id)).some((call) => !call.parked))
  );
}

/** Drives covered heads in process: each wake advances its head until it is no longer `continue`, one advance per head at a time, scheduling timers for `waiting`, `retry` and `busy`. Closing aborts the turns with the host-closing signal, leaving their runs live for the next open, waits for the advances to return and closes its cover. */
export function driveInProcess(kernel: Kernel, coverage: ExecutionCoverage): Owned {
  const covering = cover(kernel, coverage);
  const inflight = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const due = new Set<number>();
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

      if (!(await covers(kernel, coverage, session))) return;

      for (;;) {
        if (closed) return;
        const report = await advance(kernel, { session, head });

        if (report.kind === "waiting" && report.until !== null) schedule(report.until);

        if (report.kind === "retry" || report.kind === "busy") stepAt(session, head, report.until);

        if (report.kind !== "continue") return;
      }
    })()
      .catch(() => undefined)
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

  void (async () => {
    await covering;
    let cursor: Cursor | undefined;

    do {
      cursor = (await repair(kernel, { cursor, limit: PAGE })).next ?? undefined;
    } while (cursor !== undefined && !closed);
  })().catch(() => undefined);

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

/** Claims or renews a head's lease in order with every other claim on it: `fenced` when the lease this kernel held was taken or the CAS lost, `busy` while another holder or instance holds a live one, null once it is this kernel's for 30 s more. */
function claim(kernel: Kernel, session: SessionId, head: HeadName): Promise<Refused | null> {
  return inOrder(kernel, leaseRef(session, head), () => claimNow(kernel, session, head));
}

function release(kernel: Kernel, session: SessionId, head: HeadName): Promise<void> {
  return inOrder(kernel, leaseRef(session, head), () => releaseNow(kernel, session, head));
}

/** Renews the leases open covers own; a lease only an advance holds is renewed by its drive. */
async function renew(kernel: Kernel): Promise<void> {
  for (const entry of Array.from(kernel.executionState.held.values()))
    if (entry.owners.size > 0) await claim(kernel, entry.session, entry.head);
}

function inOrder<T>(kernel: Kernel, name: string, task: () => Promise<T>): Promise<T> {
  const queue = kernel.executionState.queue;
  const done = (queue.get(name) ?? Promise.resolve()).then(task);
  const settled = done.then(
    () => undefined,
    () => undefined,
  );

  queue.set(name, settled);
  void settled.then(() => {
    if (queue.get(name) === settled) queue.delete(name);
  });

  return done;
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
        kernel,
        "lease",
        { holder: kernel.hostId, instance: kernel.instance, expiresAt: now + LEASE_MS },
        now,
      ),
      expect: ref === null ? "absent" : ref.revision,
    },
  ]);

  dev("execution", "claim", { session, head, outcome: outcome.kind });

  if (outcome.kind === "stale") {
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

/** Returns what a live run leaves for this step, or null once a stopping run no turn drives here is ended. A run a turn drives here reports what holds it, else `idle`; any other first re-runs its owed tool calls, then reports what holds it or is driven again. */
async function settleLive(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  live: Found<RunRecord>,
): Promise<AdvanceReport | null> {
  const run = live.record.view.id;

  if (kernel.driving.has(run))
    return (await holding(kernel, session, head, live.record)) ?? { kind: "idle" };

  if (live.record.stopping || kernel.runs.isStopping(run)) {
    kernel.runs.markStopping(run);
    kernel.runs.abort(run);
    await kernel.waits.runStopped(session, run);
    const refused = await resume(kernel, session, head, run);

    if (refused !== null) return refused;
    await endRun(kernel, session, run, { kind: "stopped" });

    return null;
  }

  const refused = await resume(kernel, session, head, run);

  if (refused !== null) return refused;

  const record = (
    await load(kernel, await kernel.store.refs.get(runRef(session, run)), decodeRunRecord)
  )?.record;

  if (record === undefined) return null;

  return (
    (await holding(kernel, session, head, record)) ??
    (await drive(kernel, session, head, record.view)) ??
    next(kernel, session, head)
  );
}

/** Returns what holds a live run's turn: `waiting` while a call is parked, `retry` until its `until`; null when nothing does. */
async function holding(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  record: RunRecord,
): Promise<AdvanceReport | null> {
  if (record.parked.length > 0 || record.waiting !== null)
    return waitingOn(kernel, session, head, record.waiting);

  return record.retrying !== null && record.retrying.until > Date.now()
    ? { kind: "retry", until: record.retrying.until }
    : null;
}

/** Re-runs, one at a time, a run's tool calls owed a re-run with the principal their intent recorded, on the session's runtime held from here and ready, renewing the head's lease as `drive` does. A refused renewal aborts the calls, leaves the run live for its new holder and is returned. */
async function resume(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId,
): Promise<Refused | null> {
  const renewal = renewing(kernel, session, head);
  const signal = AbortSignal.any([
    kernel.runs.signal(run) ?? kernel.runs.start(run).signal,
    renewal.signal,
  ]);
  const runtime = kernel.pluginsFor(session);
  const release = runtime.hold();

  try {
    await runtime.ready;

    for (const owed of await owedCalls(kernel, session, run)) {
      if (renewal.signal.aborted) break;

      if (owed.parked) continue;

      await executeCall(kernel, {
        session,
        head,
        run,
        call: owed.call,
        name: owed.intent.name,
        args: owed.intent.args,
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
    renewal.stop();
    release();
  }

  const refused = renewal.refused();

  if (refused !== null) kernel.runs.end(run);

  return refused;
}

/** Renews a head's lease every 10 s until stopped; a refused renewal aborts `signal` and is what `refused()` returns. */
function renewing(kernel: Kernel, session: SessionId, head: HeadName) {
  const fenced = new AbortController();
  let refused: Refused | null = null;

  const timer = setInterval(() => {
    claim(kernel, session, head).then(
      (report) => {
        if (report === null) return;
        refused = report;
        fenced.abort();
      },
      () => undefined,
    );
  }, RENEW_MS);

  return { signal: fenced.signal, refused: () => refused, stop: () => clearInterval(timer) };
}

/** Runs a run's turn here and ends the run with its end; a parked turn leaves its run live. The turn is abandoned, its run left live, when the host closes or when a lease renewal is refused, which it returns for `advance` to report. */
async function drive(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunView,
): Promise<Refused | null> {
  kernel.driving.set(run.id, session);
  const closing = kernel.executionState.closing.signal;
  const renewal = renewing(kernel, session, head);

  const signal = AbortSignal.any([
    kernel.runs.signal(run.id) ?? kernel.runs.start(run.id).signal,
    closing,
    renewal.signal,
  ]);

  const unrenew = (): void => renewal.stop();
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
      (error: unknown) => ({ end: failed(error) }),
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
  const stopping = kernel.runs.isStopping(run.id);
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

/** Lands, in inbox order, what a live run takes at a boundary: attached inputs, steers joined to it, and steers admitted with its configuration while no run was live to join. */
async function boundary(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunView,
): Promise<readonly LandedInput[]> {
  const inbox = await readInbox(kernel, session, head);

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

/** Returns what starts a run on an idle head: `startOf`'s origin and prompt, and the inputs that land with it in inbox order: the prompt, attached inputs, and every steer admitted with the prompt's configuration, so no earlier steer waits behind a later one. */
async function dueInputs(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<{
  readonly origin: RunView["origin"];
  readonly input: FoldInput;
  readonly ids: readonly MessageId[];
} | null> {
  const inbox = await readInbox(kernel, session, head);

  if (inbox.messages.length === 0) return null;

  const read = await withFold(kernel, session, (state) => {
    const inputs = inbox.messages.flatMap((id) => state.inputs.get(id) ?? []);

    return { inputs, start: startOf(state, head, inputs) };
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

/** Returns what a head needs after a step drove it: `continue` when an input is due, a stop or a call re-run is owed, or the run waits on nothing; `waiting` while a call is parked; `retry` until a retrying run's `until`; `idle` when nothing is live or due, or another drive here holds the run. */
async function next(kernel: Kernel, session: SessionId, head: HeadName): Promise<AdvanceReport> {
  const live = await liveRun(kernel, session, head);

  if (live === null)
    return (await dueInputs(kernel, session, head)) === null
      ? { kind: "idle" }
      : { kind: "continue" };
  const { record } = live;
  const run = record.view.id;

  if (kernel.driving.has(run)) return { kind: "idle" };
  const calls = await owedCalls(kernel, session, run);

  if (record.stopping || kernel.runs.isStopping(run) || calls.some((call) => !call.parked))
    return { kind: "continue" };

  if (record.waiting !== null || calls.length > 0)
    return waitingOn(kernel, session, head, record.waiting);

  if (record.retrying !== null && record.retrying.until > Date.now())
    return { kind: "retry", until: record.retrying.until };

  return { kind: "continue" };
}

/** Returns `waiting` until the head's next timer or deadline, else the run's own wait's. */
function waitingOn(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  waiting: WaitTarget | null,
): AdvanceReport {
  return {
    kind: "waiting",
    until:
      kernel.waits.nextDeadline(session, head) ??
      (waiting === null
        ? null
        : waiting.kind === "timer"
          ? waiting.until
          : (waiting.deadline ?? null)),
  };
}

function failed(error: unknown): RunEnd {
  return {
    kind: "failed",
    failure: { class: "runner", message: error instanceof Error ? error.message : String(error) },
  };
}
