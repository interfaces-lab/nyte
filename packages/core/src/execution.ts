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
import { listSessions } from "./directory.ts";
import type { FoldInput } from "./fold.ts";
import type { Kernel } from "./kernel.ts";
import { LOCAL } from "./principals.ts";
import type { RunRecord } from "./records.ts";
import { leaseRef } from "./refs.ts";
import type { Lease } from "./refs.ts";
import { endRun, startRun } from "./runs.ts";
import {
  commit,
  covers,
  isJsonObject,
  liveRun,
  put,
  readInbox,
  readSession,
  withFold,
} from "./session-state.ts";
import type { Found } from "./session-state.ts";

const LEASE_MS = 30_000;

const RENEW_MS = 10_000;

const PAGE = 100;

/** Returns one kernel's execution leases: each head it holds with the revision it wrote, how many coverages are open, their renew timer, and the queue that keeps claims on one lease in order. */
interface LeaseTable {
  readonly held: Map<
    string,
    { readonly session: SessionId; readonly head: HeadName; readonly revision: Revision }
  >;
  readonly queue: Map<string, Promise<unknown>>;
  coverages: number;
  timer: ReturnType<typeof setInterval> | null;
}

const tables = new WeakMap<Kernel, LeaseTable>();

const driving = new WeakMap<Kernel, Set<RunId>>();

/** Takes the execution lease on every head the coverage names into the kernel's lease table and renews every lease in the table every 10 s; closing the last open coverage releases every lease in it. */
export async function cover(kernel: Kernel, coverage: ExecutionCoverage): Promise<Owned> {
  const table = leasesOf(kernel);
  table.coverages += 1;

  table.timer ??= setInterval(() => {
    renew(kernel).catch(() => undefined);
  }, RENEW_MS);

  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    closing ??= (async () => {
      table.coverages -= 1;

      if (table.coverages > 0) return;

      if (table.timer !== null) clearInterval(table.timer);
      table.timer = null;

      await Promise.all(
        Array.from(table.held.values(), (entry) => release(kernel, entry.session, entry.head)),
      );
    })();

    return closing;
  };

  try {
    for (const entry of await coveredHeads(kernel, coverage))
      await claim(kernel, entry.session, entry.head);
  } catch (error) {
    await close();

    throw error;
  }

  return { close, [Symbol.asyncDispose]: close };
}

/** Runs one leased kernel step on a head: renews the lease, lands due inputs, runs a turn when one is owed, and reports what comes next. Under an open coverage the lease stays in the kernel's table; without one it is released when the step returns. */
export async function advance(
  kernel: Kernel,
  input: { readonly session: SessionId; readonly head: HeadName },
): Promise<AdvanceReport> {
  const { session, head } = input;
  const found = await readSession(kernel, session);

  if (found === null || !found.record.heads.some((entry) => entry.name === head))
    return { kind: "idle" };
  const refused = await claim(kernel, session, head);

  if (refused !== null) return refused;

  try {
    return await step(kernel, session, head);
  } finally {
    if (leasesOf(kernel).coverages === 0) await release(kernel, session, head);
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

/** Returns one page of heads with a steer or queue input waiting and no live run. */
export async function repair(
  kernel: Kernel,
  input: { readonly cursor?: Cursor; readonly limit: number },
): Promise<RepairPage> {
  const page = await listSessions(kernel, LOCAL, { cursor: input.cursor, limit: input.limit });
  const runnable: { readonly session: SessionId; readonly head: HeadName }[] = [];

  for (const info of page.items) {
    for (const head of info.heads) {
      if (head.execution.kind === "idle" && (await dueInputs(kernel, info.id, head.name)) !== null)
        runnable.push({ session: info.id, head: head.name });
    }
  }

  return { runnable, next: page.next };
}

/** Drives covered heads in process: on each wake, advances the head until idle, waiting, retry, busy or fenced, one advance in flight per head; closing the handle stops it. */
export function driveInProcess(kernel: Kernel, coverage: ExecutionCoverage): Owned {
  const covering = cover(kernel, coverage);
  const inflight = new Map<string, Promise<void>>();
  const again = new Set<string>();
  let closed = false;

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

async function renew(kernel: Kernel): Promise<void> {
  for (const entry of leasesOf(kernel).held.values())
    await claim(kernel, entry.session, entry.head);
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
    lease.holder !== kernel.hostId &&
    lease.expiresAt > now
  )
    return { kind: "busy", until: lease.expiresAt };

  const outcome = await commit(kernel, [
    {
      name,
      target: await put(kernel, "lease", { holder: kernel.hostId, expiresAt: now + LEASE_MS }, now),
      expect: ref === null ? "absent" : ref.revision,
    },
  ]);

  if (outcome.kind === "stale") {
    held.delete(name);

    return { kind: "fenced" };
  }

  held.set(name, { session, head, revision: outcome.revisions[0] });

  return null;
}

async function releaseNow(kernel: Kernel, session: SessionId, head: HeadName): Promise<void> {
  const name = leaseRef(session, head);
  const held = leasesOf(kernel).held;
  const mine = held.get(name)?.revision;

  if (mine === undefined) return;
  held.delete(name);
  await commit(kernel, [{ name, target: null, expect: mine }]);
}

async function coveredHeads(
  kernel: Kernel,
  coverage: ExecutionCoverage,
): Promise<readonly { readonly session: SessionId; readonly head: HeadName }[]> {
  const heads: { readonly session: SessionId; readonly head: HeadName }[] = [];
  let cursor: Cursor | undefined;

  do {
    const page = await listSessions(kernel, LOCAL, { cursor, limit: PAGE });

    for (const info of page.items) {
      if (!(await covers(kernel, coverage, info.id))) continue;

      for (const head of info.heads) heads.push({ session: info.id, head: head.name });
    }

    cursor = page.next ?? undefined;
  } while (cursor !== undefined);

  return heads;
}

/** Returns what a live run leaves for this step, or null once a stopping run no turn drives here is ended `stopped`, so the step goes on to the next input; stopping wins over waiting and retrying. */
async function settleLive(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  live: Found<RunRecord>,
): Promise<AdvanceReport | null> {
  const record = live.record;
  const run = record.view.id;
  const driven = drivenBy(kernel).has(run);

  if (!driven && (record.stopping || kernel.runs.isStopping(run))) {
    await endRun(kernel, session, run, { kind: "stopped" });

    return null;
  }

  if (record.waiting !== null)
    return {
      kind: "waiting",
      until:
        record.waiting.kind === "timer" ? record.waiting.until : (record.waiting.deadline ?? null),
    };

  if (record.retrying !== null) return { kind: "retry", until: record.retrying.until };

  if (driven) return { kind: "idle" };
  await drive(kernel, session, head, record.view);

  return next(kernel, session, head);
}

async function drive(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunView,
): Promise<void> {
  const driven = drivenBy(kernel);
  driven.add(run.id);
  const signal = kernel.runs.signal(run.id) ?? kernel.runs.start(run.id).signal;

  const renewal = setInterval(() => {
    claim(kernel, session, head).catch(() => undefined);
  }, RENEW_MS);

  let end: RunEnd;

  try {
    end = await kernel.turn.run({
      session,
      head,
      run,
      signal,
      boundary: () => boundary(kernel, session, head, run.id),
    });
  } catch (error) {
    end = failed(error);
  } finally {
    clearInterval(renewal);
    driven.delete(run.id);
  }

  await endRun(kernel, session, run.id, kernel.runs.isStopping(run.id) ? { kind: "stopped" } : end);
}

async function boundary(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId,
): Promise<readonly MessageId[]> {
  if (kernel.runs.isStopping(run)) return [];
  const inbox = await readInbox(kernel, session, head);

  const ids = await withFold(kernel, session, (state) =>
    inbox.messages.filter((id) => {
      const input = state.inputs.get(id);

      return (
        input !== undefined &&
        (input.delivery === "attach" ||
          (input.schedule.kind === "joined" && input.schedule.run === run))
      );
    }),
  );

  if (ids.length === 0) return [];
  await landing(kernel, session, head, ids, run);

  return ids;
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

async function next(kernel: Kernel, session: SessionId, head: HeadName): Promise<AdvanceReport> {
  return (await dueInputs(kernel, session, head)) === null
    ? { kind: "idle" }
    : { kind: "continue" };
}

function failed(error: unknown): RunEnd {
  return {
    kind: "failed",
    failure: { class: "runner", message: error instanceof Error ? error.message : String(error) },
  };
}

function decodeLease(object: Json | null): Lease | null {
  if (!isJsonObject(object) || object.kind !== "lease" || !isJsonObject(object.body)) return null;
  const { holder, expiresAt } = object.body;

  return typeof holder === "string" && typeof expiresAt === "number"
    ? { holder: asId<"host">(holder), expiresAt }
    : null;
}

function leasesOf(kernel: Kernel): LeaseTable {
  const table = tables.get(kernel) ?? {
    held: new Map(),
    queue: new Map(),
    coverages: 0,
    timer: null,
  };

  tables.set(kernel, table);

  return table;
}

function drivenBy(kernel: Kernel): Set<RunId> {
  const driven = driving.get(kernel) ?? new Set<RunId>();
  driving.set(kernel, driven);

  return driven;
}
