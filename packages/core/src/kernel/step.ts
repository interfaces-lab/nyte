import { setTimeout } from "node:timers/promises";
import { branchConfig, contextMessages } from "./context.ts";
import { listEffects } from "./effects.ts";
import { branch, contextCommits } from "./graph.ts";
import { hashObject } from "./hash.ts";
import { LeaseLost, withLeaseRenewal } from "./lease.ts";
import {
  DELETED_REF,
  cancelledRef,
  headRef,
  isLaneName,
  newRunId,
  queueBaseRef,
  runRef,
} from "./names.ts";
import { createOutbox } from "./outbox.ts";
import { nextToLand, pendingIn } from "./queue.ts";
import type { PendingChange } from "./queue.ts";
import type { Commit, Lease, Obj, RefUpdate, Run, RunConfig, RunPhase } from "./model.ts";
import type { Session } from "./store.ts";
import type { ToolBatchOutcome, Turn } from "./turn.ts";

const DEFAULT_TTL_MS = 30_000;

/** The landing policy is client-visible (`Nyte.landing`), so its shape lives on the wire. */
export type { Landing, LanePolicy } from "@nyte-ai/protocol";
import type { Landing } from "@nyte-ai/protocol";

export interface StepOptions {
  readonly head: string;
  readonly landing: Landing;
  readonly lease?: Lease;
  readonly ttlMs?: number;
  readonly signal?: AbortSignal;
  /** The response ceiling for a run, fixed or per run (an agent's own limit). */
  readonly steps?: number | ((run: Run) => number | undefined);
  /** Capture host-resolved inputs in the run before a response is attempted. */
  readonly resolveConfig?: (config: RunConfig) => RunConfig;
  readonly now?: () => number;
}

export type StepOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "busy"; readonly holder: Lease }
  | { readonly kind: "continue" }
  | { readonly kind: "waiting"; readonly run: Run }
  | { readonly kind: "retry"; readonly run: Run; readonly at: number }
  | { readonly kind: "finished"; readonly run: Run }
  | { readonly kind: "fenced" };

type PublishOutcome = "ok" | "conflict" | "fenced";

interface StepContext {
  readonly session: Session;
  readonly turn: Turn;
  readonly options: StepOptions;
  readonly lease: Lease;
  readonly tip: string | null;
  readonly runOid: string | null;
  readonly run: Run;
  readonly now: () => number;
}

interface LandedCommits {
  readonly commits: Commit[];
  readonly tip: string;
}

function isRun(object: Obj): object is Run {
  return object.kind === "run";
}

function validateLanding(landing: Landing): void {
  const seen = new Set<string>();
  for (const { lane } of landing.lanes) {
    if (!isLaneName(lane)) throw new TypeError(`Invalid lane name: ${lane}`);
    if (seen.has(lane)) throw new TypeError(`Lane listed twice in the landing policy: ${lane}`);
    seen.add(lane);
  }
}

/** The lanes the policy lets land now, in its order: every lane when idle, boundary lanes mid-run. */
function lanesThatLand(landing: Landing, when: "boundary" | "idle"): readonly string[] {
  return landing.lanes
    .filter((policy) => when === "idle" || policy.lands === "boundary")
    .map((policy) => policy.lane);
}

function isCommit(object: Obj): object is Commit {
  return object.kind === "commit";
}

async function readRun(session: Session, oid: string | null): Promise<Run | undefined> {
  if (oid === null) return undefined;
  const object = await session.objects.get(oid);
  if (object === undefined || !isRun(object)) {
    throw new Error(`Corrupt run ref at ${oid}: missing or non-run object`);
  }
  return object;
}

async function publish(
  session: Session,
  options: {
    readonly lease: Lease;
    readonly updates: readonly RefUpdate[];
    readonly reason: string;
  },
): Promise<PublishOutcome> {
  const outcome = await session.refs.update(
    [...options.updates, { name: DELETED_REF, from: null, to: null }],
    { lease: options.lease, reason: options.reason },
  );
  return outcome.ok ? "ok" : outcome.reason;
}

function withPhase(run: Run, phase: RunPhase, attempts = run.attempts): Run {
  return { ...run, phase, attempts };
}

function commitsFor(
  changes: readonly PendingChange[],
  parent: string | null,
  runId: string,
  now: () => number,
): LandedCommits {
  const commits: Commit[] = [];
  let previous = parent;
  for (const item of changes) {
    const baseCommit: Commit = {
      kind: "commit",
      parent: previous,
      body: item.change.body,
      change: item.oid,
      run: runId,
      at: now(),
    };
    const commit: Commit =
      item.change.author === undefined ? baseCommit : { ...baseCommit, author: item.change.author };
    previous = hashObject(commit);
    commits.push(commit);
  }
  if (previous === null) throw new Error("Landing produced no commit");
  return { commits, tip: previous };
}

function takePending(
  changes: readonly PendingChange[],
  drain: "one" | "all",
): readonly PendingChange[] {
  if (drain === "all") return changes;
  const message = changes.findIndex((item) => item.change.body.kind === "message");
  return message === -1 ? changes : changes.slice(0, message + 1);
}

async function land(
  context: Omit<StepContext, "run"> & { readonly run?: Run },
  lane: string,
): Promise<StepOutcome> {
  const changes = takePending(
    await pendingIn(context.session, { head: context.options.head, lane }),
    context.options.landing.drain,
  );
  if (changes.length === 0) return { kind: "continue" };

  const baseName = queueBaseRef(context.options.head, lane);
  const base = await context.session.refs.read(baseName);
  if (context.run !== undefined) {
    let agent = context.run.config.agent;
    for (const { change } of changes) {
      if (change.body.kind === "message" && change.body.agent !== undefined) {
        agent = change.body.agent;
      }
    }
    if (agent !== context.run.config.agent) {
      // Keep this batch queued. Its selected agent starts a new run after
      // the current run ends, with its own config and response ceiling.
      return storeRun(
        { ...context, run: context.run },
        withPhase(context.run, { kind: "done" }),
        "agent changed",
        [
          { name: headRef(context.options.head), from: context.tip, to: context.tip },
          { name: baseName, from: base, to: base },
          ...changes.map((item) => ({ name: cancelledRef(item.oid), from: null, to: null })),
        ],
      );
    }
  }
  let activeRun = context.run;
  let nextRun: Run;
  let landed: ReturnType<typeof commitsFor>;
  if (activeRun === undefined) {
    const id = newRunId();
    landed = commitsFor(changes, context.tip, id, context.now);
    const prior = await branch(context.session.objects, context.tip);
    const config = branchConfig([...prior.map((entry) => entry.commit), ...landed.commits]);
    nextRun = {
      kind: "run",
      id,
      head: context.options.head,
      phase: changes.some((item) => item.change.body.kind === "message")
        ? { kind: "respond" }
        : { kind: "done" },
      startedAt: context.now(),
      attempts: 0,
      config: context.options.resolveConfig?.(config) ?? config,
    };
    activeRun = nextRun;
  } else {
    landed = commitsFor(changes, context.tip, activeRun.id, context.now);
    nextRun = activeRun;
  }

  await context.session.objects.put([...landed.commits, nextRun]);
  const last = changes[changes.length - 1];
  if (last === undefined) throw new Error("Landing lost its final change");
  const updates: RefUpdate[] = [
    { name: headRef(context.options.head), from: context.tip, to: landed.tip },
    { name: baseName, from: base, to: last.oid },
    {
      name: runRef(context.options.head),
      from: context.runOid,
      to: context.run === undefined ? hashObject(nextRun) : context.runOid,
    },
    ...changes.map((item) => ({ name: cancelledRef(item.oid), from: null, to: null })),
  ];
  const outcome = await publish(context.session, {
    lease: context.lease,
    updates,
    reason: "land",
  });
  if (outcome === "fenced") return { kind: "fenced" };
  return { kind: "continue" };
}

async function landOrIdle(
  context: Omit<StepContext, "run"> & { readonly run?: Run },
  lanes: readonly string[],
): Promise<StepOutcome> {
  const next = await nextToLand(context.session, { head: context.options.head, lanes });
  return next === undefined ? { kind: "idle" } : land(context, next.lane);
}

async function storeRun(
  context: StepContext,
  run: Run,
  reason: string,
  assertions: readonly RefUpdate[] = [],
): Promise<StepOutcome> {
  await context.session.objects.put([run]);
  const outcome = await publish(context.session, {
    lease: context.lease,
    updates: [
      ...assertions,
      { name: runRef(context.options.head), from: context.runOid, to: hashObject(run) },
    ],
    reason,
  });
  if (outcome === "fenced") return { kind: "fenced" };
  return outcome === "ok" ? { kind: "finished", run } : { kind: "continue" };
}

async function callTurn<T>(
  context: StepContext,
  abortRequested: boolean,
  call: (emit: Parameters<Turn["respond"]>[0]["emit"], signal: AbortSignal) => Promise<T>,
): Promise<{ readonly kind: "fenced" } | { readonly kind: "outcome"; readonly outcome: T }> {
  const controller = new AbortController();
  let fenced = false;
  const abort = (): void => controller.abort();
  if (abortRequested || context.options.signal?.aborted === true) abort();
  else context.options.signal?.addEventListener("abort", abort, { once: true });
  const outbox = createOutbox(context.session, {
    lease: context.lease,
    onFenced: () => {
      fenced = true;
      abort();
    },
  });
  try {
    let outcome: T;
    try {
      outcome = await withLeaseRenewal(
        {
          session: context.session,
          lease: context.lease,
          ttlMs: context.options.ttlMs ?? DEFAULT_TTL_MS,
          signal: controller.signal,
        },
        (signal) => call(outbox.emit, signal),
      );
    } finally {
      await outbox.flush();
    }
    return fenced ? { kind: "fenced" } : { kind: "outcome", outcome };
  } catch (cause) {
    if (cause instanceof LeaseLost) return { kind: "fenced" };
    throw cause;
  } finally {
    context.options.signal?.removeEventListener("abort", abort);
  }
}

async function currentRun(
  context: StepContext,
): Promise<{ readonly oid: string | null; readonly run?: Run; readonly tip: string | null }> {
  const [oid, tip] = await Promise.all([
    context.session.refs.read(runRef(context.options.head)),
    context.session.refs.read(headRef(context.options.head)),
  ]);
  return { oid, run: await readRun(context.session, oid), tip };
}

async function afterConflict(
  context: StepContext,
  options: {
    readonly next: Run;
    readonly outputUpdates: readonly RefUpdate[];
  },
): Promise<StepOutcome> {
  const current = await currentRun(context);
  if (current.run !== undefined && current.run.id !== context.run.id) return { kind: "fenced" };

  if (current.run?.id === context.run.id && current.run.abortRequested === true) {
    const aborted = withPhase(current.run, { kind: "aborted" }, options.next.attempts);
    await context.session.objects.put([aborted]);
    const outcome = await publish(context.session, {
      lease: context.lease,
      updates: [
        ...options.outputUpdates,
        {
          name: runRef(context.options.head),
          from: current.oid,
          to: hashObject(aborted),
        },
      ],
      reason: "abort",
    });
    if (outcome === "fenced") return { kind: "fenced" };
    return outcome === "ok" ? { kind: "finished", run: aborted } : { kind: "continue" };
  }

  if (current.tip !== context.tip && current.run?.id === context.run.id) {
    const aborted = withPhase(current.run, { kind: "aborted" }, options.next.attempts);
    await context.session.objects.put([aborted]);
    const outcome = await publish(context.session, {
      lease: context.lease,
      updates: [{ name: runRef(context.options.head), from: current.oid, to: hashObject(aborted) }],
      reason: "superseded",
    });
    if (outcome === "fenced") return { kind: "fenced" };
    return outcome === "ok" ? { kind: "finished", run: aborted } : { kind: "continue" };
  }

  return { kind: "continue" };
}

function responsePhase(
  outcome: Exclude<Awaited<ReturnType<Turn["respond"]>>, { readonly kind: "checkpoint" }>,
): RunPhase {
  switch (outcome.kind) {
    case "complete":
      return { kind: "done" };
    case "tools":
      return { kind: "tools" };
    case "retry":
      return { kind: "retry", at: outcome.at, error: outcome.error };
    case "failed":
      return { kind: "failed", error: outcome.error };
    case "aborted":
      return { kind: "aborted" };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

async function publishCheckpoint(
  context: StepContext,
  body: Extract<Commit["body"], { readonly kind: "checkpoint" }>,
): Promise<StepOutcome> {
  const commit: Commit = {
    kind: "commit",
    parent: context.tip,
    body,
    run: context.run.id,
    at: context.now(),
  };
  const commitOid = hashObject(commit);
  await context.session.objects.put([commit]);
  const outcome = await publish(context.session, {
    lease: context.lease,
    updates: [
      { name: headRef(context.options.head), from: context.tip, to: commitOid },
      { name: runRef(context.options.head), from: context.runOid, to: context.runOid },
    ],
    reason: "checkpoint",
  });
  return outcome === "fenced" ? { kind: "fenced" } : { kind: "continue" };
}

/** Whether the branch tail is a user message no response has followed yet. */
async function awaitingAnswer(context: StepContext): Promise<boolean> {
  if (context.tip === null) return false;
  const tip = await context.session.objects.get(context.tip);
  return tip?.kind === "commit" && tip.body.kind === "message" && tip.body.message.role === "user";
}

function isStepCeilingResolver(
  steps: StepOptions["steps"],
): steps is (run: Run) => number | undefined {
  return typeof steps === "function";
}

async function respond(context: StepContext): Promise<StepOutcome> {
  if (context.run.abortRequested === true) {
    return storeRun(context, withPhase(context.run, { kind: "aborted" }), "abort");
  }

  // A boundary lane lands before the next response. With `drain: "one"` a
  // landed message is answered before the next one lands, so the model reads
  // them one at a time; `"all"` lets every pending message in.
  const boundary = await nextToLand(context.session, {
    head: context.options.head,
    lanes: lanesThatLand(context.options.landing, "boundary"),
  });
  if (
    boundary !== undefined &&
    (context.options.landing.drain === "all" || !(await awaitingAnswer(context)))
  ) {
    return land(context, boundary.lane);
  }

  const ceiling = isStepCeilingResolver(context.options.steps)
    ? context.options.steps(context.run)
    : context.options.steps;
  if (ceiling !== undefined && context.run.attempts >= ceiling) {
    return storeRun(
      context,
      withPhase(context.run, { kind: "failed", error: "step ceiling" }),
      "fail",
    );
  }

  const commits = await contextCommits(context.session.objects, context.tip);
  const messages = contextMessages(commits.map((entry) => entry.commit));
  const last = messages[messages.length - 1];
  if (last === undefined || (last.role !== "user" && last.role !== "toolResult")) {
    return storeRun(context, withPhase(context.run, { kind: "done" }), "done");
  }

  // Older runs have only declared inputs. A successor may also lack the
  // recorded model. Publish the inputs this host will actually use first.
  const config = context.options.resolveConfig?.(context.run.config);
  if (config !== undefined) {
    const resolved = { ...context.run, config };
    if (hashObject(resolved) !== context.runOid) {
      const outcome = await storeRun(context, resolved, "resolve config");
      return outcome.kind === "finished" ? { kind: "continue" } : outcome;
    }
  }

  const called = await callTurn(context, false, (emit, signal) =>
    context.turn.respond({
      session: context.session,
      lease: context.lease,
      run: context.run,
      attempt: context.run.attempts + 1,
      commits,
      emit,
      signal,
    }),
  );
  if (called.kind === "fenced") return { kind: "fenced" };
  const turnOutcome = called.outcome;
  if (turnOutcome.kind === "checkpoint") {
    return publishCheckpoint(context, turnOutcome.body);
  }
  const commit: Commit = {
    kind: "commit",
    parent: context.tip,
    body: { kind: "message", message: turnOutcome.message },
    run: context.run.id,
    at: context.now(),
  };
  const commitOid = hashObject(commit);
  const next = withPhase(context.run, responsePhase(turnOutcome), context.run.attempts + 1);
  await context.session.objects.put([commit, next]);
  const outputUpdates: RefUpdate[] = [
    { name: headRef(context.options.head), from: context.tip, to: commitOid },
  ];
  const outcome = await publish(context.session, {
    lease: context.lease,
    updates: [
      ...outputUpdates,
      { name: runRef(context.options.head), from: context.runOid, to: hashObject(next) },
    ],
    reason: "respond",
  });
  if (outcome === "fenced") return { kind: "fenced" };
  if (outcome === "conflict") {
    return afterConflict(context, { next, outputUpdates });
  }
  switch (next.phase.kind) {
    case "tools":
      return { kind: "continue" };
    case "retry":
      return { kind: "retry", run: next, at: next.phase.at };
    case "done":
    case "failed":
    case "aborted":
      return { kind: "finished", run: next };
    case "respond":
    case "waiting":
      throw new Error(`Respond produced invalid phase ${next.phase.kind}`);
    default: {
      const _exhaustive: never = next.phase;
      return _exhaustive;
    }
  }
}

function toolCommits(
  messages: Extract<ToolBatchOutcome, { readonly kind: "complete" | "failed" }>["messages"],
  parent: string | null,
  runId: string,
  now: () => number,
): Commit[] {
  const commits: Commit[] = [];
  let previous = parent;
  for (const message of messages) {
    const commit: Commit = {
      kind: "commit",
      parent: previous,
      body: { kind: "message", message },
      run: runId,
      at: now(),
    };
    previous = hashObject(commit);
    commits.push(commit);
  }
  return commits;
}

async function publishTools(
  context: StepContext,
  options: {
    readonly outcome: Extract<ToolBatchOutcome, { readonly kind: "complete" | "failed" }>;
    readonly phase: RunPhase;
    readonly reason: "tools" | "fail";
  },
): Promise<StepOutcome> {
  const commits = toolCommits(options.outcome.messages, context.tip, context.run.id, context.now);
  const finalCommit = commits.at(-1);
  const outputTip = finalCommit === undefined ? context.tip : hashObject(finalCommit);
  const next = withPhase(context.run, options.phase);
  const views = await listEffects(context.session, context.run.id);
  await context.session.objects.put([...commits, next]);
  const outputUpdates: RefUpdate[] = [
    { name: headRef(context.options.head), from: context.tip, to: outputTip },
    ...views.map((view) => ({ name: view.ref, from: view.oid, to: null })),
  ];
  const outcome = await publish(context.session, {
    lease: context.lease,
    updates: [
      { name: headRef(context.options.head), from: context.tip, to: outputTip },
      { name: runRef(context.options.head), from: context.runOid, to: hashObject(next) },
      ...views.map((view) => ({ name: view.ref, from: view.oid, to: null })),
    ],
    reason: options.reason,
  });
  if (outcome === "fenced") return { kind: "fenced" };
  if (outcome === "conflict") {
    return afterConflict(context, { next, outputUpdates });
  }
  return next.phase.kind === "aborted"
    ? { kind: "finished", run: next }
    : options.outcome.kind === "failed"
      ? { kind: "finished", run: next }
      : { kind: "continue" };
}

async function tools(context: StepContext): Promise<StepOutcome> {
  if (context.tip === null) {
    return storeRun(
      context,
      withPhase(context.run, { kind: "failed", error: "tools phase has no assistant message" }),
      "fail",
    );
  }
  const object = await context.session.objects.get(context.tip);
  if (
    object === undefined ||
    !isCommit(object) ||
    object.body.kind !== "message" ||
    object.body.message.role !== "assistant"
  ) {
    return storeRun(
      context,
      withPhase(context.run, { kind: "failed", error: "tools phase has no assistant message" }),
      "fail",
    );
  }
  const assistant = object.body.message;
  const commits = await contextCommits(context.session.objects, context.tip);
  const called = await callTurn(context, context.run.abortRequested === true, (emit, signal) =>
    context.turn.tools({
      session: context.session,
      lease: context.lease,
      run: context.run,
      attempt: context.run.attempts,
      commits,
      assistant,
      emit,
      signal,
    }),
  );
  if (called.kind === "fenced") return { kind: "fenced" };
  const outcome = called.outcome;
  switch (outcome.kind) {
    case "complete":
      return publishTools(context, {
        outcome,
        phase: context.run.abortRequested === true ? { kind: "aborted" } : { kind: "respond" },
        reason: "tools",
      });
    case "waiting": {
      const next = withPhase(context.run, { kind: "waiting" });
      await context.session.objects.put([next]);
      const published = await publish(context.session, {
        lease: context.lease,
        updates: [
          { name: runRef(context.options.head), from: context.runOid, to: hashObject(next) },
        ],
        reason: "wait",
      });
      if (published === "fenced") return { kind: "fenced" };
      if (published === "conflict") {
        return afterConflict(context, { next, outputUpdates: [] });
      }
      return { kind: "waiting", run: next };
    }
    case "failed":
      return publishTools(context, {
        outcome,
        phase: { kind: "failed", error: outcome.error },
        reason: "fail",
      });
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

async function runStep(
  session: Session,
  turn: Turn,
  options: StepOptions,
  lease: Lease,
): Promise<StepOutcome> {
  const [tip, runOid, deleted] = await Promise.all([
    session.refs.read(headRef(options.head)),
    session.refs.read(runRef(options.head)),
    session.refs.read(DELETED_REF),
  ]);
  const run = await readRun(session, runOid);
  if (deleted !== null) return { kind: "idle" };
  const base = {
    session,
    turn,
    options,
    lease,
    tip,
    runOid,
    now: options.now ?? Date.now,
  };
  const idleLanes = lanesThatLand(options.landing, "idle");
  if (run === undefined) return landOrIdle(base, idleLanes);
  const context: StepContext = { ...base, run };

  switch (run.phase.kind) {
    case "done":
    case "failed":
    case "aborted":
      return landOrIdle(base, idleLanes);
    case "respond":
      return respond(context);
    case "tools":
      return tools(context);
    case "waiting": {
      const views = await listEffects(session, run.id);
      const wake =
        run.abortRequested === true || views.some((view) => view.effect.state === "signal");
      return wake ? tools(context) : { kind: "waiting", run };
    }
    case "retry":
      return context.now() < run.phase.at
        ? { kind: "retry", run, at: run.phase.at }
        : respond(context);
    default: {
      const _exhaustive: never = run.phase;
      return _exhaustive;
    }
  }
}

export async function step(
  session: Session,
  turn: Turn,
  options: StepOptions,
): Promise<StepOutcome> {
  validateLanding(options.landing);
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  let lease = options.lease;
  let acquiredHere = false;
  if (lease === undefined) {
    const acquired = await session.leases.acquire(headRef(options.head), ttlMs);
    if (!acquired.ok) return { kind: "busy", holder: acquired.holder };
    lease = acquired.lease;
    acquiredHere = true;
  }
  try {
    return await runStep(session, turn, options, lease);
  } finally {
    if (acquiredHere) await session.leases.release(lease);
  }
}

async function waitUntil(
  at: number,
  now: () => number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const delay = at - now();
  if (delay <= 0) return true;
  if (signalAborted(signal)) return false;
  try {
    if (signal === undefined) await setTimeout(delay);
    else await setTimeout(delay, undefined, { signal });
    return true;
  } catch (error) {
    if (signalAborted(signal)) return false;
    throw error;
  }
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export async function drive(
  session: Session,
  turn: Turn,
  options: Omit<StepOptions, "lease">,
): Promise<Exclude<StepOutcome, { readonly kind: "continue" }>> {
  validateLanding(options.landing);
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const acquired = await session.leases.acquire(headRef(options.head), ttlMs);
  if (!acquired.ok) return { kind: "busy", holder: acquired.holder };
  const lease = acquired.lease;
  try {
    for (;;) {
      if (!(await session.leases.renew(lease, ttlMs))) return { kind: "fenced" };
      const outcome = await step(session, turn, { ...options, lease });
      if (outcome.kind === "continue") continue;
      if (outcome.kind === "retry") {
        if (!(await waitUntil(outcome.at, options.now ?? Date.now, options.signal))) return outcome;
        continue;
      }
      return outcome;
    }
  } finally {
    await session.leases.release(lease);
  }
}
