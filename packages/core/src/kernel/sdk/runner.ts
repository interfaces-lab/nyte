/**
 * The event-driven runner a host volunteers for a session: one drive loop per
 * head, woken by ref events, stopped and restarted by `reconcileRunner`.
 * Participants abort a run through `requestAbortAtRef`, which also cancels the
 * local drive when this host owns it.
 */
import { isTerminalPhase, validateHeadName } from "@nyte-ai/protocol";
import type { Api, Model } from "@nyte-ai/schema";
import type { Event, Oid, RefName, Run, RunConfig } from "../model.ts";
import { TASK_TOOL, taskModelParameters } from "../../plugins/builtin/subagents.ts";
import { failedAssistant } from "./requests.ts";
import { parseHeadRef, isHeadName, parseQueueRef, runRef } from "../names.ts";
import type { Session } from "../store.ts";
import { drive, type StepOptions } from "../step.ts";
import { advanceStep } from "./advance.ts";
import { turnFor, type Activation } from "./activation.ts";
import { JOB_PREFIX, JOBS_CANCELLED_REF, type createJobs } from "./jobs.ts";
import {
  RUN_PREFIX,
  attributed,
  type DriveState,
  type Pooled,
  type SessionPool,
} from "./session-pool.ts";
import {
  MAIN,
  type Disposer,
  type HeadName,
  type Landing,
  type Nyte,
  type NyteOptions,
  type SessionId,
} from "./types.ts";

const EFFECT_PREFIX = "refs/effects/";
const RUNNER_RESTART_DELAY_MS = 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface ActiveAdvance {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function headFromRunRef(name: RefName): HeadName | undefined {
  if (!name.startsWith(RUN_PREFIX)) return undefined;
  const head = name.slice(RUN_PREFIX.length);
  return isHeadName(head) ? head : undefined;
}

function queueHead(name: RefName): HeadName | undefined {
  return parseQueueRef(name)?.head;
}

function effectRunId(name: RefName): string | undefined {
  if (!name.startsWith(EFFECT_PREFIX)) return undefined;
  const value = name.slice(EFFECT_PREFIX.length);
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1 ? value.slice(0, separator) : undefined;
}

export async function runAtRef(session: Session, oid: Oid | null): Promise<Run | undefined> {
  if (oid === null) return undefined;
  const object = await session.objects.get(oid);
  if (object?.kind !== "run") throw new Error(`Corrupt run object at ${oid}`);
  return object;
}

async function headForRun(session: Session, runId: string): Promise<HeadName | undefined> {
  const refs = await session.refs.list(RUN_PREFIX);
  const runs = await Promise.all(refs.map((ref) => runAtRef(session, ref.oid)));
  const index = runs.findIndex((run) => run?.id === runId);
  const ref = refs[index];
  return ref === undefined ? undefined : headFromRunRef(ref.name);
}

export function createRunners(input: {
  readonly options: NyteOptions;
  readonly pool: SessionPool;
  /** The landing policy a runner drives with: the host's lanes plus the private `background` lane. */
  readonly landing: Landing;
  readonly resolveModel: (ref: {
    readonly provider?: string;
    readonly id: string;
  }) => Model<Api> | undefined;
  readonly jobsFor: (id: SessionId, pooled: Pooled) => ReturnType<typeof createJobs>;
  /** What a runner tells delegation: a child's run moved, a run parked, or input arrived on a head. */
  readonly delegation: {
    readonly childRunChanged: (id: SessionId, pooled: Pooled) => Promise<void>;
    readonly recheck: (id: SessionId, pooled: Pooled, runId: string) => Promise<void>;
    readonly yieldToInput: (id: SessionId, pooled: Pooled, head: HeadName) => Promise<void>;
  };
  /** Whether an attachment currently volunteers this host for the session. */
  readonly covered: (id: SessionId, pooled: Pooled) => boolean;
  /** Failures of detached work, surfaced by `close`. */
  readonly reportBackground: (cause: unknown) => void;
}) {
  const { options, pool } = input;
  const runnerDone = new WeakMap<Disposer, Promise<void>>();
  /** Every loop still running, including those of retired sessions; `settle` waits for all. */
  const runnerLoops = new Set<Promise<void>>();
  const stopAdvances = new AbortController();
  const advances = new WeakMap<Pooled, Set<ActiveAdvance>>();

  async function emitRunnerDiagnostic(session: Session, cause: unknown): Promise<void> {
    await session.events
      .append([
        {
          kind: "notice",
          level: "error",
          owner: "runner",
          message: errorMessage(cause),
        },
      ])
      .catch(() => undefined);
  }

  const handleSessionRef = async (
    id: SessionId,
    pooled: Pooled,
    event: Extract<Event, { readonly kind: "ref" }>,
  ): Promise<boolean> => {
    if (event.name.startsWith(JOB_PREFIX)) {
      await input.jobsFor(id, pooled).sync(event.name.slice(JOB_PREFIX.length));
      return true;
    }
    return false;
  };

  const prepareExecution = (id: SessionId, pooled: Pooled, activation: Activation) => {
    const bound = turnFor(
      {
        ...activation,
        // A child works unattended: nothing marked for a present participant is offered to it.
        tools: () =>
          activation
            .tools()
            .filter((tool) => tool.availability !== "foreground" || pooled.parent === undefined),
      },
      {
        streamFn: async (model, context, streamOptions) => {
          if (
            pooled.parent !== undefined ||
            !context.tools?.some((tool) => tool.name === TASK_TOOL)
          ) {
            return options.streamFn(model, context, streamOptions);
          }
          const available = await options.models.getAvailable(undefined, {
            signal: streamOptions?.signal,
          });
          return options.streamFn(
            model,
            {
              ...context,
              tools: context.tools.flatMap((tool) =>
                tool.name !== TASK_TOOL
                  ? [tool]
                  : available.length === 0
                    ? []
                    : [{ ...tool, parameters: taskModelParameters(available) }],
              ),
            },
            streamOptions,
          );
        },
        model: options.model,
        resolveModel: input.resolveModel,
        thinkingLevel: options.thinkingLevel,
        streamOptions: options.streamOptions,
        compaction: options.compaction,
      },
    );
    const cwd =
      pooled.activationState?.kind === "active" ? pooled.activationState.env.cwd : undefined;
    const requireRunnerLocation = async (): Promise<void> => {
      const saved = await pool.storedCwd(pooled.session);
      if (saved !== undefined && saved !== cwd) {
        await pool.resolveSessionActivation(id, pooled);
        throw new Error(
          "Session directory changed; reactivate it in the trusted workspace before running.",
        );
      }
    };
    const modelLabel = (model: NonNullable<RunConfig["model"]>): string =>
      model.provider === undefined ? model.id : `${model.provider}/${model.id}`;
    // A resumed child must keep its admitted model even if this host's catalog lost it.
    // Preserve the reference while landing; fail inside the turn so failure settles durably.
    const missingChildModel = (config: RunConfig): string | undefined => {
      if (pooled.parent === undefined) return undefined;
      if (config.model === undefined) return "Subagent requires an exact model.";
      if (input.resolveModel(config.model) !== undefined) return undefined;
      return `Subagent model is unavailable: ${modelLabel(config.model)}. No replacement was used.`;
    };
    // A selected model is a choice, not a hint: a response never arrives from the
    // host default under the selection's name. Tools are not gated by this, since
    // they carry out calls a resolvable model already made; dropping them would
    // leave those calls without results.
    const unavailableModel = (config: RunConfig): string | undefined => {
      const child = missingChildModel(config);
      if (child !== undefined) return child;
      if (config.model === undefined || input.resolveModel(config.model) !== undefined) {
        return undefined;
      }
      return `Selected model is unavailable: ${modelLabel(config.model)}. Choose an available model or connect its provider.`;
    };
    const turn: typeof bound.turn = {
      async respond(input) {
        await pool.pluginsSettled();
        await requireRunnerLocation();
        const error = unavailableModel(input.run.config);
        if (error !== undefined) {
          const selected = input.run.config.model;
          return {
            kind: "failed",
            failure: { class: "runner", message: error },
            message: failedAssistant(
              {
                api: options.model.api,
                provider: selected?.provider ?? options.model.provider,
                id: selected?.id ?? options.model.id,
              },
              error,
              "error",
            ),
          };
        }
        return bound.turn.respond(input);
      },
      async tools(input) {
        await pool.pluginsSettled();
        await requireRunnerLocation();
        const error = missingChildModel(input.run.config);
        if (error !== undefined) return { kind: "failed", messages: [], calls: {}, error };
        return bound.turn.tools(input);
      },
    };

    const optionsFor = (head: HeadName, signal: AbortSignal): StepOptions => {
      const executionLanding = { ...input.landing };
      const vcs = options.workspace?.vcs;
      return {
        head,
        landing: executionLanding,
        telemetry: options.telemetry,
        signal,
        ...(vcs === undefined ? {} : { tree: () => vcs.tree() }),
        steps: (run) =>
          unavailableModel(run.config) === undefined ? bound.stepsFor(run) : undefined,
        resolveConfig: (config) =>
          unavailableModel(config) === undefined ? bound.resolveConfig(config) : config,
        beforeStep: async () => {
          if (pooled.retired || pooled.relocating)
            throw new Error("Session is unavailable for execution");
          await requireRunnerLocation();
          if ((await pooled.session.refs.read(JOBS_CANCELLED_REF)) !== null) {
            // A cancelled child may still have a completion in flight.
            // Settle its active run, but never land more delegated work.
            executionLanding.lanes = [];
            await requestAbortAtRef(pooled, runRef(head));
          }
        },
      };
    };
    return { turn, optionsFor };
  };

  const advance: Nyte["advance"] = async (request) => {
    pool.alive();
    const head = request.head ?? MAIN;
    validateHeadName(head);
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      stopAdvances.signal,
      ...(request.signal === undefined ? [] : [request.signal]),
    ]);
    const { promise: done, resolve: finish } = Promise.withResolvers<void>();
    const task = (async () => {
      signal.throwIfAborted();
      const pooled = await pool.open(request.sessionId);
      const activation = await pool.activationFor(request.sessionId, pooled);
      if (activation === undefined) throw new Error("Session is not active in this host");
      if (pooled.parent !== undefined) {
        const parent = await pool.open(pooled.parent.sessionId);
        await input.jobsFor(pooled.parent.sessionId, parent).recover();
        await input.delegation.childRunChanged(request.sessionId, pooled);
      }
      await input.jobsFor(request.sessionId, pooled).recover();
      signal.throwIfAborted();
      const active = advances.get(pooled) ?? new Set<ActiveAdvance>();
      advances.set(pooled, active);
      const execution = { controller, done };
      active.add(execution);
      pooled.runnerTasks.add(done);
      try {
        const prepared = prepareExecution(request.sessionId, pooled, activation);
        return await advanceStep({
          session: pooled.session,
          turn: prepared.turn,
          options: prepared.optionsFor(head, signal),
          readRun: async () => (await pool.readRun(pooled.session, head))?.run,
          recheckJobs: (runId) => input.jobsFor(request.sessionId, pooled).recheck(runId),
          onRef: async (event) => {
            await handleSessionRef(request.sessionId, pooled, event);
          },
        });
      } finally {
        active.delete(execution);
        pooled.runnerTasks.delete(done);
      }
    })();
    // Explicit callers receive their own errors. Shutdown only waits for cleanup.
    void task.then(
      () => finish(),
      () => finish(),
    );
    runnerLoops.add(done);
    void done.then(() => runnerLoops.delete(done));
    return task;
  };

  const createRunner = (id: SessionId, pooled: Pooled, activation: Activation): Disposer => {
    const stop = new AbortController();
    const states = new Map<HeadName, DriveState>();
    pooled.drives = states;
    const tasks = new Set<Promise<void>>();
    const prepared = prepareExecution(id, pooled, activation);
    let stopped = false;

    const stateFor = (head: HeadName): DriveState => {
      const found = states.get(head);
      if (found !== undefined) return found;
      const state: DriveState = { dirty: false };
      states.set(head, state);
      return state;
    };

    const readActiveRunId = async (head: HeadName): Promise<string | undefined> => {
      const stored = await pool.readRun(pooled.session, head);
      return stored !== undefined && !isTerminalPhase(stored.run.phase) ? stored.run.id : undefined;
    };

    const wake = (head: HeadName): void => {
      if (stopped || pooled.retired || pooled.relocating) return;
      const state = stateFor(head);
      clearTimeout(state.deadline);
      state.deadline = undefined;
      state.dirty = true;
      if (state.running !== undefined) return;

      let task: Promise<void>;
      task = (async () => {
        try {
          while (state.dirty && !stopped && !pooled.retired && !pooled.relocating) {
            state.dirty = false;
            const controller = new AbortController();
            state.controller = controller;
            state.runId = await readActiveRunId(head);
            try {
              const outcome = await drive(
                pooled.session,
                prepared.turn,
                prepared.optionsFor(head, controller.signal),
              );
              if (outcome.kind === "busy") return;
              // A job or a child that finished while its call was being parked
              // signalled a not-yet-waiting effect. Recheck only this run's parked calls.
              if (outcome.kind === "waiting" && !stopped && !pooled.retired) {
                await input.jobsFor(id, pooled).recheck(outcome.run.id);
                await input.delegation.recheck(id, pooled, outcome.run.id);
                if (outcome.until !== undefined) driveAt(head, outcome.until);
              }
            } catch (error) {
              if (!stopped && !pooled.retired) await emitRunnerDiagnostic(pooled.session, error);
            } finally {
              state.controller = undefined;
              state.runId = undefined;
            }
          }
        } finally {
          const completed = state.running;
          state.running = undefined;
          if (completed !== undefined) tasks.delete(completed);
          if (state.dirty && !stopped && !pooled.retired) wake(head);
        }
      })();
      state.running = task;
      tasks.add(task);
    };

    /** A parked deadline is durable; this timer only makes this host the one that notices it. */
    const driveAt = (head: HeadName, until: number): void => {
      const state = stateFor(head);
      clearTimeout(state.deadline);
      const check = (): void => {
        const remaining = until - Date.now();
        if (remaining > 0) {
          state.deadline = setTimeout(check, Math.min(remaining, MAX_TIMER_DELAY_MS));
          return;
        }
        state.deadline = undefined;
        wake(head);
      };
      state.deadline = setTimeout(
        check,
        Math.min(Math.max(0, until - Date.now()), MAX_TIMER_DELAY_MS),
      );
    };

    const inspectRunEvent = async (head: HeadName, event: Event): Promise<void> => {
      if (event.kind !== "ref" || event.name !== runRef(head)) return;
      const state = states.get(head);
      const controller = state?.controller;
      if (state === undefined || controller === undefined) return;
      // The event names an immutable object that may already be history: a
      // stopped run keeps its flag after it ends, and the drive may have started
      // the next run since. Only the ref says which run this drive is on.
      const stored = await pool.readRun(pooled.session, head);
      // The drive this read was taken for may have ended while it was in flight.
      // Its successor reads the ref for itself; what was read here is not its run.
      if (state.controller !== controller) return;
      if (stored === undefined || isTerminalPhase(stored.run.phase)) return;
      if (state.runId === undefined) state.runId = stored.run.id;
      if (state.runId === stored.run.id && stored.run.abortRequested === true) controller.abort();
    };

    const handleRef = async (event: Extract<Event, { readonly kind: "ref" }>): Promise<void> => {
      if (await handleSessionRef(id, pooled, event)) return;
      const runHead = headFromRunRef(event.name);
      if (runHead === MAIN && pooled.parent !== undefined) {
        await input.delegation
          .childRunChanged(id, pooled)
          .catch((cause: unknown) => emitRunnerDiagnostic(pooled.session, cause));
      }
      const inputHead = queueHead(event.name);
      if (inputHead !== undefined && pooled.parent === undefined) {
        await input.delegation
          .yieldToInput(id, pooled, inputHead)
          .catch((cause: unknown) => emitRunnerDiagnostic(pooled.session, cause));
      }
      const directHead = parseHeadRef(event.name) ?? inputHead ?? runHead;
      if (directHead !== undefined) {
        await inspectRunEvent(directHead, event);
        wake(directHead);
        return;
      }
      const runId = effectRunId(event.name);
      if (runId === undefined) return;
      const head = await headForRun(pooled.session, runId);
      if (head !== undefined) wake(head);
    };

    const loop = async (): Promise<void> => {
      try {
        const afterSeq = await pooled.session.events.last();
        const watching = pooled.session.events.watch({ afterSeq, signal: stop.signal });
        // The default head may hold pending changes before it has a tip.
        for (const item of await pool.listSessionHeads(pooled.session)) wake(item.head);
        for await (const event of watching) {
          if (event.kind === "ref") await handleRef(event);
        }
      } catch (error) {
        if (!stopped && !pooled.retired) await emitRunnerDiagnostic(pooled.session, error);
      } finally {
        for (const state of states.values()) state.controller?.abort();
        await Promise.all([...tasks].map((task) => task.catch(() => undefined)));
        if (pooled.drives === states) pooled.drives = undefined;
      }
    };

    pooled.wake = () => {
      for (const head of states.keys()) wake(head);
    };
    const done = loop();
    pooled.runnerTasks.add(done);
    runnerLoops.add(done);
    const dispose = (): void => {
      if (stopped) return;
      stopped = true;
      stop.abort();
      for (const state of states.values()) {
        state.controller?.abort();
        clearTimeout(state.deadline);
      }
    };
    runnerDone.set(dispose, done);
    void done.then(async () => {
      pooled.runnerTasks.delete(done);
      runnerLoops.delete(done);
      if (pooled.runner !== dispose) return;
      pooled.runner = undefined;
      // A loop nobody stopped ended on a fault. Give the fault time to clear;
      // restarting at once would spin, writing one diagnostic per turn.
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, RUNNER_RESTART_DELAY_MS));
      if (pool.closed || pooled.retired || pooled.runner !== undefined) return;
      if (input.covered(id, pooled)) {
        await reconcileRunner(id, pooled).catch(input.reportBackground);
      }
    });
    return dispose;
  };

  const stopRunner = async (pooled: Pooled): Promise<void> => {
    const active = [...(advances.get(pooled) ?? [])];
    for (const execution of active) execution.controller.abort();
    const runner = pooled.runner;
    if (runner !== undefined) {
      pooled.runner = undefined;
      runner();
      await runnerDone.get(runner)?.catch(() => undefined);
    }
    await Promise.all(active.map((execution) => execution.done));
  };

  function reconcileRunner(id: SessionId, pooled: Pooled): Promise<void> {
    const prior = pooled.reconciliation ?? Promise.resolve();
    const task = prior
      .catch(() => undefined)
      .then(async () => {
        if (pooled.relocating) return;
        if (!input.covered(id, pooled)) {
          await stopRunner(pooled);
          return;
        }
        if ((await pool.resolveSessionActivation(id, pooled)).kind !== "active") {
          await stopRunner(pooled);
          return;
        }
        if (pooled.runner !== undefined) {
          pooled.wake?.();
          return;
        }
        const activation = await pool.activationFor(id, pooled);
        if (activation === undefined || !input.covered(id, pooled)) return;
        if (pooled.parent !== undefined) {
          const parent = await pool.open(pooled.parent.sessionId);
          await input.jobsFor(pooled.parent.sessionId, parent).recover();
          await input.delegation.childRunChanged(id, pooled);
        }
        await input.jobsFor(id, pooled).recover();
        if (!input.covered(id, pooled) || pooled.relocating) return;
        pooled.runner = createRunner(id, pooled, activation);
      });
    pooled.reconciliation = task.catch(() => undefined);
    return task;
  }

  const requestAbortAtRef = async (
    pooled: Pooled,
    name: RefName,
    expectedRunId?: string,
  ): Promise<string | undefined> => {
    const { session } = pooled;
    for (;;) {
      const oid = await session.refs.read(name);
      if (oid === null) return undefined;
      const run = await runAtRef(session, oid);
      if (
        run === undefined ||
        (expectedRunId !== undefined && run.id !== expectedRunId) ||
        isTerminalPhase(run.phase)
      )
        return undefined;
      const head = headFromRunRef(name);
      if (run.abortRequested === true) {
        if (head !== undefined) abortLocalDrive(pooled, head, run.id);
        return run.id;
      }
      const next: Run = { ...run, abortRequested: true };
      const written = (await session.objects.put([next]))[0];
      if (written === undefined) throw new Error(`Writing abort for ${name} returned no oid`);
      const outcome = await session.refs.update(
        [{ name, from: oid, to: written }],
        attributed({ reason: "abort" }, options.actor),
      );
      if (outcome.ok) {
        if (head !== undefined) abortLocalDrive(pooled, head, run.id);
        return run.id;
      }
      switch (outcome.reason) {
        case "conflict":
          continue;
        case "fenced":
          throw new Error(`Participant abort was unexpectedly fenced: ${name}`);
        default: {
          const _exhaustive: never = outcome;
          return _exhaustive;
        }
      }
    }
  };

  function abortLocalDrive(pooled: Pooled, head: HeadName, runId: string): void {
    const state = pooled.drives?.get(head);
    if (state?.controller === undefined) return;
    if (state.runId === undefined || state.runId === runId) state.controller.abort();
  }

  return {
    advance,
    reconcileRunner,
    stopRunner,
    requestAbortAtRef,
    emitRunnerDiagnostic,
    /** Wait for every loop to end; the rejections are returned, not thrown. */
    settle: async (): Promise<readonly unknown[]> => {
      stopAdvances.abort();
      return (await Promise.allSettled(runnerLoops)).flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason] : [],
      );
    },
  };
}

export type Runners = ReturnType<typeof createRunners>;
