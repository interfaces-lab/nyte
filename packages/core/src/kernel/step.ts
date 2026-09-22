import { setTimeout } from "node:timers/promises";
import {
  isTerminalPhase,
  type CommitStart,
  type Delivery,
  type TreeId,
  type TreeOutcome,
} from "@nyte-ai/protocol";
import { NOOP_TELEMETRY_CONTEXT, type TelemetryContext } from "@nyte-ai/telemetry";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { agentChanged, boundaryBatch, decide, headFor, leadFor, nextBatch } from "./admission.ts";
import { revokeDelegations } from "./delegation-record.ts";
import { compactionClearUpdates, finishCompaction } from "./compaction.ts";
import { branchConfig, contextMessages } from "@nyte-ai/client";
import { listEffects, waitingBatchReady } from "./effects.ts";
import { branch, contextCommits } from "./graph.ts";
import { hashObject } from "./hash.ts";
import { LeaseLost, withLeaseRenewal } from "./lease.ts";
import {
  DELETED_REF,
  cancelledRef,
  chainRef,
  headRef,
  newRunId,
  inboxBaseRef,
  runRef,
} from "./names.ts";
import { createOutbox } from "./outbox.ts";
import { pendingIn } from "./queue.ts";
import type { PendingChange } from "./queue.ts";
import type { Commit, Failure, Lease, Obj, RefUpdate, Run, RunConfig, RunPhase } from "./model.ts";
import type { Session } from "./store.ts";
import type { RespondOutcome, ToolBatchOutcome, Turn } from "./turn.ts";
import { startSpan } from "./telemetry.ts";

const DEFAULT_TTL_MS = 30_000;

export interface StepOptions {
  readonly head: string;
  readonly drain: "one" | "all";
  readonly lease?: Lease;
  readonly ttlMs?: number;
  readonly signal?: AbortSignal;
  readonly telemetry?: TelemetryContext;
  /** The response ceiling for a run, fixed or per run (an agent's own limit). */
  readonly steps?: number | ((run: Run) => number | undefined);
  /** Capture host-resolved inputs in the run before a response is attempted. */
  readonly resolveConfig?: (config: RunConfig) => RunConfig;
  readonly now?: () => number;
  /** Validate host execution authority under the head lease, before landing or executing. */
  readonly beforeStep?: () => Promise<void>;
  /** The workspace tree, stamped on a run's first commit and its tool results. Absent without a VCS backend. */
  readonly tree?: () => Promise<TreeOutcome>;
}

export type StepOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "busy"; readonly holder: Lease }
  | { readonly kind: "continue" }
  /** `until`: the nearest deadline among the parked calls; a host steps again at it. */
  | { readonly kind: "waiting"; readonly run: Run; readonly until?: number }
  | { readonly kind: "retry"; readonly run: Run; readonly at: number }
  | { readonly kind: "finished"; readonly run: Run }
  | { readonly kind: "fenced" };

export type PublishOutcome = "ok" | "conflict" | "fenced";

interface StepContext {
  readonly session: Session;
  readonly telemetry: TelemetryContext;
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

/** A failure of the run itself, not of the provider. */
function runnerFailure(message: string): Failure {
  return { class: "runner", message };
}

function isCommit(object: Obj): object is Commit {
  return object.kind === "commit";
}

/** The tree to stamp, or none: a host without a backend, or one that cannot answer, stamps nothing. */
async function currentTree(options: StepOptions): Promise<TreeId | undefined> {
  const outcome = await options.tree?.();

  return outcome?.kind === "tree" ? outcome.id : undefined;
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
  return { ...run, phase: endingPhase(run, phase), attempts };
}

/**
 * A stop is one-way: a flagged run can end only `aborted`, whatever its last
 * step found, so the queue never reads a stopped run as open. Every phase a
 * step publishes passes through here.
 */
function endingPhase(run: Run, phase: RunPhase): RunPhase {
  return run.abortRequested === true && isTerminalPhase(phase) ? { kind: "aborted" } : phase;
}

/** The failure a stop overrides is still worth reading; it is kept as a diagnostic, not as the phase. */
async function noteOverriddenFailure(context: StepContext, phase: RunPhase): Promise<void> {
  if (phase.kind !== "failed" || endingPhase(context.run, phase).kind === "failed") return;
  await context.session.events.append(
    [
      {
        kind: "notice",
        level: "error",
        owner: "runner",
        message: `Run ${context.run.id} was stopped while failing: ${phase.failure.message}`,
      },
    ],
    { lease: context.lease },
  );
}

/** Land submitted bodies, stamping the body that starts a new run. */
function commitsFor(
  changes: readonly PendingChange[],
  parent: string | null,
  runId: string,
  now: () => number,
  runStart?: Extract<CommitStart, { readonly kind: "run" }>,
): LandedCommits {
  const commits: Commit[] = [];
  let previous = parent;
  let started = false;

  for (const item of changes) {
    const body = item.change.body;

    const common = {
      kind: "commit" as const,
      parent: previous,
      change: item.oid,
      run: runId,
      at: now(),
      key: item.change.key,
      author: item.change.author,
    };

    const start =
      !started && runStart !== undefined && (body.kind === "message" || body.kind === "completion")
        ? runStart
        : { kind: "none" as const };

    let commit: Commit;

    switch (body.kind) {
      case "message":
        commit = { ...common, body, start };
        break;
      case "completion":
        commit = { ...common, body, start };
        break;
      case "config":
        commit = { ...common, body };
        break;
      default: {
        const _exhaustive: never = body;
        commit = _exhaustive;
      }
    }

    if (start.kind === "run") started = true;
    previous = hashObject(commit);
    commits.push(commit);
  }

  if (previous === null) throw new Error("Landing produced no commit");

  return { commits, tip: previous };
}

interface ChainCounter {
  readonly oid: string;
  readonly attempts: number;
}

const ChainCounterValue = Type.Object({ attempts: Type.Integer({ minimum: 0 }) });

async function readChain(session: Session, root: string): Promise<ChainCounter> {
  const oid = await session.refs.read(chainRef(root));

  if (oid === null) throw new Error(`Missing chain counter for ${root}`);
  const object = await session.objects.get(oid);

  if (object?.kind !== "blob" || !Value.Check(ChainCounterValue, object.value)) {
    throw new Error(`Corrupt chain counter for ${root}`);
  }

  return { oid, attempts: object.value.attempts };
}

async function revocationUpdates(session: Session, run: Run): Promise<readonly RefUpdate[]> {
  return run.phase.kind === "failed" ? revokeDelegations(session, run.id) : [];
}

interface LandingRequest {
  readonly delivery: Delivery;
  readonly run: Run | undefined;
  readonly boundary: { readonly awaitingAnswer: boolean } | { readonly kind: "idle" };
}

interface LandingPlan {
  readonly landed: LandedCommits;
  readonly run: Run;
  readonly updates: readonly RefUpdate[];
}

async function land(
  context: Omit<StepContext, "run">,
  request: LandingRequest,
): Promise<StepOutcome> {
  const queued = await pendingIn(context.session, {
    head: context.options.head,
    delivery: request.delivery,
  });

  const changes =
    "awaitingAnswer" in request.boundary
      ? boundaryBatch(queued, context.options.drain, request.boundary.awaitingAnswer)
      : nextBatch(queued, context.options.drain);

  const decision = decide(
    headFor(request.run),
    await leadFor(context.session, changes),
    agentChanged(request.run, changes),
  );

  const baseName = inboxBaseRef(context.options.head, request.delivery);
  const base = await context.session.refs.read(baseName);

  if (decision.kind === "wait") return { kind: "idle" };

  if (decision.kind === "handoff") {
    return storeRun(
      { ...context, run: decision.run },
      withPhase(decision.run, { kind: "done" }),
      "agent changed",
      [
        { name: headRef(context.options.head), from: context.tip, to: context.tip },
        { name: baseName, from: base, to: base },
      ],
    );
  }

  let plan: LandingPlan;

  switch (decision.kind) {
    case "join":
    case "settle":
      plan = {
        landed: commitsFor(changes, context.tip, decision.run.id, context.now),
        run: decision.run,
        updates: [],
      };
      break;
    case "start": {
      const id = newRunId();

      const landed = commitsFor(changes, context.tip, id, context.now, {
        kind: "run",
        tree: (await currentTree(context.options)) ?? null,
      });

      const prior = await branch(context.session.objects, context.tip);
      const config = branchConfig([...prior.map((entry) => entry.commit), ...landed.commits]);
      let root: string;
      let updates: readonly RefUpdate[];

      switch (decision.chain.kind) {
        case "new": {
          root = id;

          const [counter] = await context.session.objects.put([
            { kind: "blob", value: { attempts: 0 } },
          ]);

          if (counter === undefined) throw new Error("Chain counter write returned no object");
          updates = [{ name: chainRef(root), from: null, to: counter }];
          break;
        }

        case "inherit":
          root = decision.chain.root;
          updates = [decision.chain.consume];
          break;
        default: {
          const _exhaustive: never = decision.chain;
          root = _exhaustive;
          updates = _exhaustive;
        }
      }

      plan = {
        landed,
        run: {
          kind: "run",
          id,
          head: context.options.head,
          origin: decision.origin,
          root,
          phase: { kind: "respond" },
          startedAt: context.now(),
          attempts: 0,
          config: context.options.resolveConfig?.(config) ?? config,
        },
        updates,
      };
      break;
    }

    default: {
      const _exhaustive: never = decision;

      return _exhaustive;
    }
  }

  await context.session.objects.put([...plan.landed.commits, plan.run]);
  const last = changes.at(-1);

  if (last === undefined) throw new Error("Landing lost its final change");

  const outcome = await publish(context.session, {
    lease: context.lease,
    updates: [
      { name: headRef(context.options.head), from: context.tip, to: plan.landed.tip },
      { name: baseName, from: base, to: last.oid },
      { name: runRef(context.options.head), from: context.runOid, to: hashObject(plan.run) },
      ...plan.updates,
      ...changes.map((item) => ({ name: cancelledRef(item.oid), from: null, to: null })),
    ],
    reason: "land",
  });

  return outcome === "fenced" ? { kind: "fenced" } : { kind: "continue" };
}

async function landOrIdle(
  context: Omit<StepContext, "run">,
  run: Run | undefined,
): Promise<StepOutcome> {
  for (const delivery of ["steer", "next"] as const) {
    const outcome = await land(context, { delivery, run, boundary: { kind: "idle" } });

    if (outcome.kind !== "idle") return outcome;
  }

  return { kind: "idle" };
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
      ...(await revocationUpdates(context.session, run)),
      { name: runRef(context.options.head), from: context.runOid, to: hashObject(run) },
    ],
    reason,
  });

  if (outcome === "fenced") return { kind: "fenced" };

  return outcome === "ok" ? { kind: "finished", run } : { kind: "continue" };
}

/** Publish the run's terminal phase with no other output. */
async function endRun(context: StepContext, phase: RunPhase, reason: string): Promise<StepOutcome> {
  await noteOverriddenFailure(context, phase);

  return storeRun(context, withPhase(context.run, phase), reason);
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
    // The abort raced this step. Keep its output; a tool batch settles its
    // calls first, anything else ends the run `aborted` in the same publish.
    if (options.next.phase.kind !== "tools" && options.next.phase.kind !== "waiting") {
      const stopped = { ...context, run: current.run, runOid: current.oid };
      await noteOverriddenFailure(stopped, options.next.phase);

      return storeRun(
        stopped,
        withPhase(current.run, { kind: "aborted" }, options.next.attempts),
        "abort",
        options.outputUpdates,
      );
    }

    const interrupted = withPhase(current.run, options.next.phase, options.next.attempts);
    await context.session.objects.put([interrupted]);

    const outcome = await publish(context.session, {
      lease: context.lease,
      updates: [
        ...options.outputUpdates,
        { name: runRef(context.options.head), from: current.oid, to: hashObject(interrupted) },
      ],
      reason: "interrupt",
    });

    return outcome === "fenced" ? { kind: "fenced" } : { kind: "continue" };
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
      return {
        kind: "retry",
        at: outcome.at,
        retries: outcome.retries,
        failure: outcome.failure,
      };
    case "failed":
      return { kind: "failed", failure: outcome.failure };
    case "aborted":
      return { kind: "aborted" };
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

/** What the response's commit records beside its message. */
function responseProvenance(
  outcome: Exclude<RespondOutcome, { readonly kind: "checkpoint" }>,
): Pick<Extract<Commit, { readonly calls: unknown }>, "calls" | "outcome"> {
  switch (outcome.kind) {
    case "complete":
      return { calls: {}, outcome: { kind: "ok" } };
    case "tools":
      return { calls: outcome.calls, outcome: { kind: "ok" } };
    case "retry":
    case "failed":
    case "aborted":
      return {
        calls: Object.fromEntries(
          outcome.message.content.flatMap((part) =>
            part.type === "toolCall"
              ? [[part.id, { kind: "custom", label: part.name } as const]]
              : [],
          ),
        ),
        outcome: { kind: "failed", failure: outcome.failure },
      };
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

  const updates: RefUpdate[] = [
    { name: headRef(context.options.head), from: context.tip, to: commitOid },
    { name: runRef(context.options.head), from: context.runOid, to: context.runOid },
    ...(await compactionClearUpdates(context.session, context.options.head)),
  ];

  const outcome = await startSpan(
    context.telemetry,
    "nyte.compaction.publish",
    {
      "nyte.session.id": context.session.id,
      "nyte.head": context.options.head,
      "nyte.run.id": context.run.id,
    },
    async (span) => {
      const published = await publish(context.session, {
        lease: context.lease,
        updates,
        reason: "checkpoint",
      });

      span.setAttributes({
        "nyte.compaction.publication": published === "ok" ? "published" : published,
      });

      return published;
    },
  );

  return outcome === "fenced" ? { kind: "fenced" } : { kind: "continue" };
}

/** A user input or completion at the branch tail still needs a response. */
async function awaitingAnswer(context: StepContext): Promise<boolean> {
  if (context.tip === null) return false;
  const tip = await context.session.objects.get(context.tip);

  return (
    tip?.kind === "commit" &&
    (tip.body.kind === "completion" ||
      (tip.body.kind === "message" && tip.body.message.role === "user"))
  );
}

function isStepCeilingResolver(
  steps: StepOptions["steps"],
): steps is (run: Run) => number | undefined {
  return steps instanceof Function;
}

async function respond(context: StepContext): Promise<StepOutcome> {
  const answering = context.options.drain === "one" && (await awaitingAnswer(context));

  const landed = await land(context, {
    delivery: "steer",
    run: context.run,
    boundary: { awaitingAnswer: answering },
  });

  if (landed.kind !== "idle") return landed;

  if (context.run.abortRequested === true) {
    return endRun(context, { kind: "aborted" }, "abort");
  }

  const commits = await contextCommits(context.session.objects, context.tip);
  const messages = contextMessages(commits.map((entry) => entry.commit));
  const last = messages[messages.length - 1];

  if (last === undefined || (last.role !== "user" && last.role !== "toolResult")) {
    return endRun(context, { kind: "done" }, "done");
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

  const chain = await readChain(context.session, context.run.root);

  const ceiling = isStepCeilingResolver(context.options.steps)
    ? context.options.steps(context.run)
    : context.options.steps;

  if (ceiling !== undefined && chain.attempts >= ceiling) {
    return endRun(context, { kind: "failed", failure: runnerFailure("step ceiling") }, "fail");
  }

  const [counter] = await context.session.objects.put([
    { kind: "blob", value: { attempts: chain.attempts + 1 } },
  ]);

  if (counter === undefined) throw new Error("Chain counter write returned no object");

  const reservation = await publish(context.session, {
    lease: context.lease,
    updates: [{ name: chainRef(context.run.root), from: chain.oid, to: counter }],
    reason: "reserve response",
  });

  if (reservation === "fenced") return { kind: "fenced" };

  if (reservation === "conflict") {
    return endRun(context, { kind: "failed", failure: runnerFailure("step ceiling") }, "fail");
  }

  const called = await callTurn(context, false, (emit, signal) =>
    context.turn.respond({
      session: context.session,
      telemetry: context.telemetry,
      lease: context.lease,
      run: context.run,
      now: context.now(),
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
    ...responseProvenance(turnOutcome),
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
      ...(await revocationUpdates(context.session, next)),
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
  results: Extract<ToolBatchOutcome, { readonly kind: "complete" | "failed" }>,
  parent: string | null,
  runId: string,
  now: () => number,
  tree: TreeId | undefined,
): Commit[] {
  const commits: Commit[] = [];
  let previous = parent;

  for (const message of results.messages) {
    const settled = results.calls[message.toolCallId];

    const commit: Commit = {
      kind: "commit",
      parent: previous,
      body: { kind: "message", message },
      run: runId,
      at: now(),
      call: settled ?? { kind: "custom", label: message.toolName },
      tree: tree ?? null,
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
  const commits = toolCommits(
    options.outcome,
    context.tip,
    context.run.id,
    context.now,
    await currentTree(context.options),
  );

  const finalCommit = commits.at(-1);
  const outputTip = finalCommit === undefined ? context.tip : hashObject(finalCommit);
  await noteOverriddenFailure(context, options.phase);
  const next = withPhase(context.run, options.phase);
  const views = await listEffects(context.session, context.run.id);
  await context.session.objects.put([...commits, next]);

  const headUpdate: RefUpdate = {
    name: headRef(context.options.head),
    from: context.tip,
    to: outputTip,
  };

  const effectClears = views.map((view) => ({ name: view.ref, from: view.oid, to: null }));
  const outputUpdates: RefUpdate[] = [headUpdate, ...effectClears];

  const outcome = await publish(context.session, {
    lease: context.lease,
    updates: [
      headUpdate,
      ...(await revocationUpdates(context.session, next)),
      { name: runRef(context.options.head), from: context.runOid, to: hashObject(next) },
      ...effectClears,
    ],
    reason: options.reason,
  });

  if (outcome === "fenced") return { kind: "fenced" };

  if (outcome === "conflict") {
    return afterConflict(context, { next, outputUpdates });
  }

  return options.outcome.kind === "failed" ? { kind: "finished", run: next } : { kind: "continue" };
}

async function tools(context: StepContext): Promise<StepOutcome> {
  if (context.tip === null) {
    return endRun(
      context,
      { kind: "failed", failure: runnerFailure("tools phase has no assistant message") },
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
    return endRun(
      context,
      { kind: "failed", failure: runnerFailure("tools phase has no assistant message") },
      "fail",
    );
  }

  const assistant = object.body.message;
  const commits = await contextCommits(context.session.objects, context.tip);

  const called = await callTurn(context, context.run.abortRequested === true, (emit, signal) =>
    context.turn.tools({
      session: context.session,
      telemetry: context.telemetry,
      lease: context.lease,
      run: context.run,
      now: context.now(),
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
    case "fenced":
      return { kind: "fenced" };
    case "conflict":
      return { kind: "continue" };
    case "complete":
      return publishTools(context, { outcome, phase: { kind: "respond" }, reason: "tools" });
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
        phase: { kind: "failed", failure: runnerFailure(outcome.error) },
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
  await options.beforeStep?.();

  if (!(await finishCompaction(session, { head: options.head, lease }))) return { kind: "fenced" };

  const [tip, runOid, deleted] = await Promise.all([
    session.refs.read(headRef(options.head)),
    session.refs.read(runRef(options.head)),
    session.refs.read(DELETED_REF),
  ]);

  const run = await readRun(session, runOid);

  if (deleted !== null) return { kind: "idle" };

  return startSpan(
    options.telemetry ?? NOOP_TELEMETRY_CONTEXT,
    "nyte.step",
    {
      "nyte.session.id": session.id,
      "nyte.head": options.head,
      "nyte.run.id": run?.id,
      "nyte.run.phase": run?.phase.kind,
    },
    async (telemetry) => {
      const outcome = await advance(
        { session, telemetry, turn, options, lease, tip, runOid, now: options.now ?? Date.now },
        run,
      );

      telemetry.setAttributes({ "nyte.step.outcome": outcome.kind });

      return outcome;
    },
  );
}

async function advance(base: Omit<StepContext, "run">, run: Run | undefined): Promise<StepOutcome> {
  if (run === undefined) return landOrIdle(base, run);
  const context: StepContext = { ...base, run };

  switch (run.phase.kind) {
    case "done":
    case "failed":
    case "aborted":
      return landOrIdle(base, run);
    case "respond":
      return respond(context);
    case "tools":
      return tools(context);
    case "waiting": {
      const views = await listEffects(context.session, run.id);
      const now = context.now();

      const deadlines = views.flatMap((view) =>
        view.effect.state === "waiting" && view.effect.until !== undefined
          ? [view.effect.until]
          : [],
      );

      const wake =
        run.abortRequested === true ||
        waitingBatchReady(views) ||
        deadlines.some((until) => until <= now);

      if (wake) return tools(context);

      return deadlines.length === 0
        ? { kind: "waiting", run }
        : { kind: "waiting", run, until: Math.min(...deadlines) };
    }

    case "retry":
      // A stop does not wait out the backoff; the boundary ends the run at once.
      return run.abortRequested !== true && context.now() < run.phase.at
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
    try {
      await finishCompaction(session, { head: options.head, lease });
    } finally {
      if (acquiredHere) await session.leases.release(lease);
    }
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

/**
 * Steps until the head rests. A cancelled drive answers `continue` as soon as
 * its step does: the signal that cancelled one call must not cancel the calls
 * of the work that follows, so the runner drives again with a fresh one.
 */
export async function drive(
  session: Session,
  turn: Turn,
  options: Omit<StepOptions, "lease">,
): Promise<StepOutcome> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const acquired = await session.leases.acquire(headRef(options.head), ttlMs);

  if (!acquired.ok) return { kind: "busy", holder: acquired.holder };
  const lease = acquired.lease;

  try {
    for (;;) {
      if (!(await session.leases.renew(lease, ttlMs))) return { kind: "fenced" };
      const outcome = await step(session, turn, { ...options, lease });

      if (outcome.kind === "continue") {
        if (options.signal?.aborted === true) return outcome;
        continue;
      }

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
