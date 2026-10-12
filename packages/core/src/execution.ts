import { asId } from "@nyte-ai/schema";
import type {
  AdvanceReport,
  Cursor,
  ExecutionCoverage,
  HeadName,
  Json,
  MessageId,
  Owned,
  RepairPage,
  Revision,
  RunEnd,
  RunId,
  RunView,
  SessionId,
} from "@nyte-ai/schema";
import { landing } from "./admission.ts";
import { dev } from "./dev-log.ts";
import { listSessions } from "./directory.ts";
import type { FoldInput } from "./fold.ts";
import type { Kernel, LandedInput } from "./kernel.ts";
import { LOCAL, PARTICIPANT_AUTHORITY } from "./principals.ts";
import { decodeRunRecord } from "./records.ts";
import type { RunRecord } from "./records.ts";
import { leaseRef, runRef } from "./refs.ts";
import type { Lease } from "./refs.ts";
import { endRun, startRun } from "./runs.ts";
import {
  addDriven,
  commit,
  covers,
  dispatchHead,
  isJsonObject,
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

const LEASE_MS = 30_000;

const RENEW_MS = 10_000;

const PAGE = 100;

/** Returns one lease this kernel holds: its head, the revision it wrote, when it expires, and the open cover handles that own it (none while only the advance that claimed it holds it). */
interface Held {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly revision: Revision;
  readonly expiresAt: number;
  readonly owners: Set<object>;
}

/** Returns one kernel's execution leases: each head it holds, the open cover handles with what each covers, the heads an advance is stepping now, the renew timer, and the queue that keeps claims on one lease in order. */
interface LeaseTable {
  readonly held: Map<string, Held>;
  readonly covers: Map<object, ExecutionCoverage>;
  readonly advancing: Set<string>;
  readonly queue: Map<string, Promise<unknown>>;
  timer: ReturnType<typeof setInterval> | null;
}

const tables = new WeakMap<Kernel, LeaseTable>();

const closings = new WeakMap<Kernel, AbortController>();

/** Registers a coverage without claiming any lease (§42t, §42y) and parks the durable waits the store records for it in `kernel.waits`: every session's, or for `{ kind: "sessions" }` only the named sessions' (`sessions/<id>/calls/`, never a whole-store scan, §42p). A `sessions` coverage covers the named sessions and their descendants (§42ac); a descendant's own parked waits are loaded when a cover names it, as a dispatched child's step does, or live in this process from when they parked. While the handle is open the coverage counts for `isCovered`, through the same registration `driveInProcess` uses (`addDriven`), so on an `admit-only` kernel driven by alarms or workflows admission wakes the covered heads and activation attaches their environments (§42a). The handle owns the leases the advances of its sessions claim (a lease is held only while a turn runs, §42y): every 10 s `renew` touches the leases open handles own, and closing the handle releases each lease it owns that no other open handle owns and no advance is stepping; an advance in flight releases its own lease when its turn ends (§42ac). */
export async function cover(kernel: Kernel, coverage: ExecutionCoverage): Promise<Owned> {
  const table = leasesOf(kernel);
  const handle = {};
  table.covers.set(handle, { ...coverage });
  const unregister = addDriven(kernel, coverage);

  table.timer ??= setInterval(() => {
    renew(kernel).catch(() => undefined);
  }, RENEW_MS);

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      unregister();
      table.covers.delete(handle);

      if (table.covers.size === 0 && table.timer !== null) {
        clearInterval(table.timer);
        table.timer = null;
      }

      const released: Promise<void>[] = [];

      for (const [name, entry] of table.held) {
        if (!entry.owners.delete(handle) || entry.owners.size > 0 || table.advancing.has(name))
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

/** Runs one leased kernel step on a head: awaits the session's activation in this process (its runtime's `ready`, §36c, §44a), claims or renews the lease, re-runs the live run's tool calls whose waits completed or whose host died mid-call, lands due inputs, runs a turn when one is owed, and reports what comes next: `waiting` until the head's next timer or deadline while a call is parked. A head this instance is already stepping answers `busy` until its own lease expires and releases nothing (§42y). The lease it claims is owned by the open covers of its session; the advance releases it in `finally` when its turn ends by abort, a throw or any report but `continue`, and `continue` keeps it for the drive to go on at once, unless no open cover owns it any more, when it is released too (§42ac). */
export async function advance(
  kernel: Kernel,
  input: { readonly session: SessionId; readonly head: HeadName },
): Promise<AdvanceReport> {
  const { session, head } = input;
  const table = leasesOf(kernel);
  const name = leaseRef(session, head);

  if (table.advancing.has(name))
    return { kind: "busy", until: table.held.get(name)?.expiresAt ?? Date.now() + LEASE_MS };
  table.advancing.add(name);
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
    const owners = table.held.get(name)?.owners;

    for (const [handle, coverage] of table.covers)
      if (await covers(kernel, coverage, session)) owners?.add(handle);

    report = await step(kernel, session, head);
    dev("execution", "advance", { session, head, report: report.kind });

    return report;
  } finally {
    table.advancing.delete(name);

    if (claimed && (report?.kind !== "continue" || (table.held.get(name)?.owners.size ?? 0) === 0))
      await release(kernel, session, head);
  }
}

async function step(kernel: Kernel, session: SessionId, head: HeadName): Promise<AdvanceReport> {
  const live = await liveRun(kernel, session, head);
  const report = live === null ? null : await settleLive(kernel, session, head, live);

  if (report !== null) return report;
  const due = await dueInputs(kernel, session, head);

  if (due === null) return { kind: "idle" };

  const run = await startRun(
    kernel,
    session,
    head,
    { kind: "input", message: due.start.id },
    due.start.configuration,
  );

  try {
    await landing(kernel, session, head, due.ids, run.id);
  } catch (error) {
    await endRun(kernel, session, run.id, failed(error));

    throw error;
  }

  await drive(kernel, session, head, run);

  return next(kernel, session, head);
}

/** Returns one page of heads owed a step: a steer or queue input waiting and no live run; a live run with a tool call to re-run (its wait completed, or its host died mid-call); or a live run no turn drives here that waits on nothing, left mid-turn by a host that closed or died (§38y). On a `dispatch` kernel each runnable head is also handed to `dispatchHead` instead of being advanced here (§42s). */
export async function repair(
  kernel: Kernel,
  input: { readonly cursor?: Cursor; readonly limit: number },
): Promise<RepairPage> {
  const page = await listSessions(kernel, LOCAL, { cursor: input.cursor, limit: input.limit });
  const runnable: { readonly session: SessionId; readonly head: HeadName }[] = [];

  for (const info of page.items) {
    for (const head of info.heads) {
      if (await owed(kernel, info.id, head.name))
        runnable.push({ session: info.id, head: head.name });
    }
  }

  for (const entry of runnable) dispatchHead(kernel, entry.session, entry.head);
  dev("execution", "repair", { sessions: page.items.length, runnable: runnable.length });

  return { runnable, next: page.next };
}

/** Returns whether a head is owed a step: a steer or queue input waiting and no live run; a live run with a tool call to re-run; or a live run no turn drives here that waits on nothing (§38y). */
async function owed(kernel: Kernel, session: SessionId, head: HeadName): Promise<boolean> {
  const live = await liveRun(kernel, session, head);

  if (live === null) return (await dueInputs(kernel, session, head)) !== null;

  return (
    !kernel.driving.has(live.record.view.id) &&
    (live.record.waiting === null ||
      (await owedCalls(kernel, session, live.record.view.id)).some((call) => !call.parked))
  );
}

/** Drives covered heads in process, its coverage counted by `isCovered` while it is open (so admission wakes it and activation attaches environments even on an `admit-only` kernel, §41b): on each wake, advances the head until idle, waiting, retry, busy or fenced, one advance in flight per head; a head reported waiting until a time gets a timer that ticks `kernel.waits` then, and one reported `retry` or `busy` is stepped again at its `until` (a lease another instance holds, such as a crashed process's, expires by then, §42y). Closing the handle stops it without waiting on the turns themselves: it aborts them with the kernel's host-closing signal, so each returns at once and its drive leaves the run live in the store for the next open or another host to resume through `advance` (§38y); it waits for those advances to return, each releasing its own lease (§42ac), then closes its cover, so no lease it held is left when close returns. */
export function driveInProcess(kernel: Kernel, coverage: ExecutionCoverage): Owned {
  const undrive = addDriven(kernel, coverage);
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
      const page = await repair(kernel, { cursor, limit: PAGE });

      for (const entry of page.runnable) step(entry.session, entry.head);
      cursor = page.next ?? undefined;
    } while (cursor !== undefined && !closed);
  })().catch(() => undefined);

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      closed = true;
      dispose();
      undrive();

      if (timer !== null) clearTimeout(timer);

      for (const retry of retries) clearTimeout(retry);
      retries.clear();
      const closing = closingOf(kernel);
      closings.delete(kernel);
      closing.abort();
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

/** Claims or renews the execution lease on a head, in order with every other claim and release on that lease: answers `fenced` when the lease this kernel held was taken (its revision moved) or the CAS answers stale, `busy { until }` while a live lease belongs to another kernel — another `holder`, or the same `holder` with another `instance`, both fields compared (§42q) — and null once the lease is this kernel's for 30 s more. */
function claim(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Extract<AdvanceReport, { readonly kind: "busy" | "fenced" }> | null> {
  return inOrder(kernel, leaseRef(session, head), () => claimNow(kernel, session, head));
}

function release(kernel: Kernel, session: SessionId, head: HeadName): Promise<void> {
  return inOrder(kernel, leaseRef(session, head), () => releaseNow(kernel, session, head));
}

/** Renews the leases open cover handles own; a lease only an advance holds is renewed by its drive. */
async function renew(kernel: Kernel): Promise<void> {
  dev("execution", "renew", { held: leasesOf(kernel).held.size });

  for (const entry of Array.from(leasesOf(kernel).held.values()))
    if (entry.owners.size > 0) await claim(kernel, entry.session, entry.head);
}

function inOrder<T>(kernel: Kernel, name: string, task: () => Promise<T>): Promise<T> {
  const queue = leasesOf(kernel).queue;
  const done = (queue.get(name) ?? Promise.resolve()).then(task);

  queue.set(
    name,
    done.catch(() => undefined),
  );

  return done;
}

async function claimNow(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Extract<AdvanceReport, { readonly kind: "busy" | "fenced" }> | null> {
  const name = leaseRef(session, head);
  const held = leasesOf(kernel).held;
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
  const held = leasesOf(kernel).held;
  const mine = held.get(name)?.revision;

  if (mine === undefined) return;
  held.delete(name);
  dev("execution", "release", { session, head });
  await commit(kernel, [{ name, target: null, expect: mine }]);
}

/** Returns what a live run leaves for this step, or null once a stopping run no turn drives here is ended `stopped`, so the step goes on to the next input; stopping wins over waiting and retrying. A retrying run reports `retry` until its `until`; once that passed, a run no turn drives here is driven again (§38o), the turn taking the next attempt. A run no turn drives here first re-runs its tool calls owed a re-run, a stopping one with its signal aborted first (after a restart too), so a stopped step sees `stopped` and returns; it reports `waiting` while a call stays parked. */
async function settleLive(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  live: Found<RunRecord>,
): Promise<AdvanceReport | null> {
  const run = live.record.view.id;
  const driven = kernel.driving.has(run);

  if (!driven && (live.record.stopping || kernel.runs.isStopping(run))) {
    kernel.runs.markStopping(run);
    kernel.runs.abort(run);
    await kernel.waits.runStopped(session, run);
    await resume(kernel, session, head, run);
    await endRun(kernel, session, run, { kind: "stopped" });

    return null;
  }

  const parked = !driven && (await resume(kernel, session, head, run));

  const record = driven
    ? live.record
    : (await load(kernel, await kernel.store.refs.get(runRef(session, run)), decodeRunRecord))
        ?.record;

  if (record === undefined) return null;
  const waiting = record.waiting;

  if (parked || waiting !== null)
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

  if (record.retrying !== null && record.retrying.until > Date.now())
    return { kind: "retry", until: record.retrying.until };

  if (driven) return { kind: "idle" };
  await drive(kernel, session, head, record.view);

  return next(kernel, session, head);
}

/** Re-runs, one at a time, a run's tool calls owed a re-run (their waits completed, or their host died mid-call) with the principal their intent recorded; returns whether a call is parked afterwards. */
async function resume(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId,
): Promise<boolean> {
  const signal = kernel.runs.signal(run) ?? kernel.runs.start(run).signal;

  for (const owed of await owedCalls(kernel, session, run)) {
    if (owed.parked) continue;

    await executeCall(kernel, {
      session,
      head,
      run,
      call: owed.call,
      name: owed.intent.name,
      args: owed.intent.args,
      context: {
        principal: owed.intent.principal,
        authority: PARTICIPANT_AUTHORITY,
        credential: { kind: "token", token: "" },
        origin: null,
      },
      signal,
    });
  }

  return (await owedCalls(kernel, session, run)).some((owed) => owed.parked);
}

async function drive(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunView,
): Promise<void> {
  const driven = kernel.driving;
  driven.set(run.id, session);
  const closing = closingOf(kernel).signal;

  const signal = AbortSignal.any([
    kernel.runs.signal(run.id) ?? kernel.runs.start(run.id).signal,
    closing,
  ]);

  const renewal = setInterval(() => {
    claim(kernel, session, head).catch(() => undefined);
  }, RENEW_MS);

  const unrenew = (): void => clearInterval(renewal);
  closing.addEventListener("abort", unrenew, { once: true });

  const turned = kernel.turn
    .run({
      session,
      head,
      run,
      signal,
      boundary: () => boundary(kernel, session, head, run.id),
    })
    .then(
      (end) => ({ end }),
      (error: unknown) => ({ end: failed(error) }),
    )
    .finally(() => {
      clearInterval(renewal);
      closing.removeEventListener("abort", unrenew);
      driven.delete(run.id);
    });

  const closed = new Promise<null>((resolve) => {
    if (closing.aborted) resolve(null);
    else closing.addEventListener("abort", () => resolve(null), { once: true });
  });

  const ended = await Promise.race([turned, closed]);
  const stopping = kernel.runs.isStopping(run.id);

  if (ended === null || (closing.aborted && !stopping)) return;

  if (ended.end.kind === "parked" && !stopping) {
    kernel.wakes.notify(session, head);

    return;
  }

  await endRun(
    kernel,
    session,
    run.id,
    stopping || ended.end.kind === "parked" ? { kind: "stopped" } : ended.end,
  );
}

async function boundary(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId,
): Promise<readonly LandedInput[]> {
  if (kernel.runs.isStopping(run)) return [];
  const inbox = await readInbox(kernel, session, head);

  const due = await withFold(kernel, session, (state) =>
    inbox.messages.flatMap((id): readonly LandedInput[] => {
      const input = state.inputs.get(id);

      return input !== undefined &&
        (input.delivery === "attach" ||
          (input.schedule.kind === "joined" && input.schedule.run === run))
        ? [{ message: id, delivery: input.delivery }]
        : [];
    }),
  );

  if (due.length === 0) return [];
  await landing(
    kernel,
    session,
    head,
    due.map((input) => input.message),
    run,
  );

  return due;
}

async function dueInputs(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<{ readonly start: FoldInput; readonly ids: readonly MessageId[] } | null> {
  const inbox = await readInbox(kernel, session, head);

  if (inbox.messages.length === 0) return null;

  return withFold(kernel, session, (state) => {
    const inputs = inbox.messages.flatMap((id) => state.inputs.get(id) ?? []);
    const start = inputs.find((input) => input.delivery !== "attach");

    if (start === undefined) return null;

    return {
      start,
      ids: inputs.flatMap((input) =>
        input === start || input.delivery === "attach" ? [input.id] : [],
      ),
    };
  });
}

/** Returns what a head needs after a step drove it: `continue` when an input is due, the live run must be stopped, a call is owed a re-run, or the run waits on nothing; `waiting` until the head's next timer or deadline while a call is parked; `retry` until a retrying run's `until`; `idle` when nothing is live or due, or another drive here holds the run. */
async function next(kernel: Kernel, session: SessionId, head: HeadName): Promise<AdvanceReport> {
  const live = await liveRun(kernel, session, head);

  if (live === null)
    return (await dueInputs(kernel, session, head)) === null
      ? { kind: "idle" }
      : { kind: "continue" };
  const run = live.record.view.id;

  if (kernel.driving.has(run)) return { kind: "idle" };
  const calls = await owedCalls(kernel, session, run);

  if (live.record.stopping || kernel.runs.isStopping(run) || calls.some((call) => !call.parked))
    return { kind: "continue" };
  const waiting = live.record.waiting;

  if (waiting !== null || calls.length > 0)
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

  if (live.record.retrying !== null && live.record.retrying.until > Date.now())
    return { kind: "retry", until: live.record.retrying.until };

  return { kind: "continue" };
}

function failed(error: unknown): RunEnd {
  return {
    kind: "failed",
    failure: { class: "runner", message: error instanceof Error ? error.message : String(error) },
  };
}

function decodeLease(object: Json | null): Lease | null {
  if (!isJsonObject(object) || object.kind !== "lease" || !isJsonObject(object.body)) return null;
  const { holder, instance, expiresAt } = object.body;

  return typeof holder === "string" && typeof expiresAt === "number"
    ? {
        holder: asId<"host">(holder),
        instance: typeof instance === "string" ? instance : "",
        expiresAt,
      }
    : null;
}

function leasesOf(kernel: Kernel): LeaseTable {
  const table: LeaseTable = tables.get(kernel) ?? {
    held: new Map(),
    covers: new Map(),
    advancing: new Set(),
    queue: new Map(),
    timer: null,
  };

  tables.set(kernel, table);

  return table;
}

/** Returns the kernel's host-closing controller, created on first use: the driver's close aborts it and forgets it, so the drives in flight see it aborted and later ones take a fresh one. */
function closingOf(kernel: Kernel): AbortController {
  const known = closings.get(kernel) ?? new AbortController();
  closings.set(kernel, known);

  return known;
}
