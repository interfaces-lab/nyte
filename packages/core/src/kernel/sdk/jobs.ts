import { createHash, randomUUID } from "node:crypto";
import type { JsonValue } from "@nyte-ai/schema";
import {
  isTerminalPhase,
  isUserJob,
  schemas,
  USER_JOB_RUN_ID,
  type JobInfo,
  type JobActionOutcome,
} from "@nyte-ai/protocol";
import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolWakeOutcome,
} from "../../types.ts";
import { ToolWait } from "../../types.ts";
import { toolResultMessage } from "../../agent-loop.ts";
import { toolErrorResult, toolResultContent, toolResultText } from "../../utils/tool-result.ts";
import { isJsonObject, toJsonValue } from "../json.ts";
import { factRef, runRef } from "../names.ts";
import { listEffects, signalEffect } from "../effects.ts";
import { toolProgress } from "../turn.ts";
import { withLeaseRenewal } from "../lease.ts";
import type { Lease } from "../model.ts";
import type { Session } from "../store.ts";
import type { SessionId } from "./types.ts";

export const JOB_PREFIX = "refs/jobs/";
export const JOBS_CANCELLED_REF = factRef("jobs-cancelled");
const LEASE_MS = 15_000;
const OUTPUT_LIMIT = 50_000;
// A background command parks after its first output or this long, so the receipt
// can carry a listening address or an immediate failure.
const BACKGROUND_PEEK_MS = 1_500;
const jobRecord = Type.Object({
  info: schemas.JobInfo,
  result: Type.Optional(schemas.ToolResultMessage),
  delivered: Type.Boolean(),
});
type JobRecord = Static<typeof jobRecord>;
const checkJobRecord = Compile(jobRecord);

export function parseJobRecord(value: JsonValue): JobRecord {
  if (!checkJobRecord.Check(value)) throw new Error("Invalid stored job");
  return value;
}

function jobId(runId: string, callId: string): string {
  return `job_${createHash("sha256")
    .update(JSON.stringify([runId, callId]))
    .digest("hex")
    .slice(0, 24)}`;
}

/**
 * Who a job answers to. A run's job parks the tool call that started it and
 * wakes it; a user's job (`jobs.start`) has no call to wake, is never a
 * completion, and is not swept when a run is aborted.
 */
export type JobOwner =
  | {
      readonly kind: "run";
      readonly runId: string;
      readonly callId: string;
      readonly head: string;
    }
  | { readonly kind: "user"; readonly head: string };

interface LiveJob {
  readonly controller: AbortController;
  readonly lease: Lease;
  done: Promise<void>;
  writes: Promise<void>;
}

interface Admitted {
  readonly info: JobInfo;
  readonly runtime: LiveJob;
  /** The tool reported its first progress. */
  readonly started: Promise<void>;
  /** The tool reported non-empty output. */
  readonly produced: Promise<void>;
}

/** Commands and child sessions share ownership, cancellation, and durable results. */
export function createJobs(input: {
  readonly session: Session;
  readonly childId: (runId: string, callId: string) => SessionId;
  readonly backgroundChild: (id: SessionId) => Promise<void>;
  readonly interruptChild: (id: SessionId) => Promise<void>;
  readonly notify: (job: JobInfo) => Promise<void>;
  readonly diagnostic: (cause: unknown) => Promise<void>;
}) {
  const live = new Map<string, LiveJob>();
  let closing = false;
  const shutdown = new AbortController();
  const operations = new Set<Promise<unknown>>();
  const deliveries = new Map<string, Promise<void>>();
  let closed: Promise<void> | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

  const track = <T>(task: Promise<T>): Promise<T> => {
    operations.add(task);
    void task.then(
      () => operations.delete(task),
      () => operations.delete(task),
    );
    return task;
  };

  const diagnostic = async (cause: unknown): Promise<void> => {
    try {
      await input.diagnostic(cause);
    } catch {
      // Reporting a store failure may hit the same failure. Detached work must still settle.
    }
  };

  const read = async (id: string) => {
    const oid = await input.session.refs.read(JOB_PREFIX + id);
    if (oid === null) return undefined;
    const blob = await input.session.objects.get(oid);
    if (blob?.kind !== "blob") throw new Error(`Missing job ${id}`);
    return { oid, record: parseJobRecord(blob.value) };
  };

  const update = async (
    id: string,
    change: (record: JobRecord) => JobRecord,
    lease?: Lease,
  ): Promise<JobRecord | undefined> => {
    for (;;) {
      const current = await read(id);
      if (current === undefined) return undefined;
      const next = change(current.record);
      if (next === current.record) return next;
      const oid = (
        await input.session.objects.put([{ kind: "blob", value: toJsonValue(next) }])
      )[0];
      if (oid === undefined) throw new Error("Job write returned no object");
      const saved = await input.session.refs.update(
        [{ name: JOB_PREFIX + id, from: current.oid, to: oid }],
        { reason: "job", lease },
      );
      if (saved.ok) return next;
      if (saved.reason === "fenced") throw new Error("Job ownership was lost");
    }
  };

  const signal = async (job: JobInfo) => {
    if (isUserJob(job)) return;
    const oid = await input.session.refs.read(runRef(job.head));
    const run = oid === null ? undefined : await input.session.objects.get(oid);
    // Abort already wakes the effect. Changing it underneath that wake would fence settlement.
    if (run?.kind === "run" && run.id === job.runId && run.abortRequested) return;
    await signalEffect(input.session, {
      runId: job.runId,
      callId: job.callId,
      signal: { kind: "job", id: job.id },
    });
  };

  const deliver = (record: JobRecord): Promise<void> => {
    if (
      closing ||
      record.info.mode !== "background" ||
      record.info.state === "running" ||
      record.delivered
    )
      return Promise.resolve();
    const id = record.info.id;
    const pending = deliveries.get(id);
    if (pending !== undefined) return pending;
    const task = (async () => {
      const current = await read(id);
      if (current === undefined || current.record.delivered || closing) return;
      // notify uses the job id as an admission key across hosts and crash recovery.
      await input.notify(current.record.info);
      await update(id, (current) => ({ ...current, delivered: true }));
    })().finally(() => deliveries.delete(id));
    deliveries.set(id, task);
    return task;
  };

  const sync = async (id: string) => {
    const stored = await read(id);
    if (stored === undefined) return;
    const job = stored.record.info;
    if (job.state !== "running") live.get(id)?.controller.abort();
    if (job.kind === "subagent") {
      if (job.state === "cancelled" || job.state === "interrupted")
        await input.interruptChild(job.childSessionId);
      else if (job.state === "running" && job.mode === "background" && !closing)
        await input.backgroundChild(job.childSessionId);
    }
    if (job.mode === "background" || job.state !== "running") await signal(job);
    await deliver(stored.record);
  };

  const interrupt = async (
    id: string,
    state: "cancelled" | "interrupted",
    options?: { readonly lease?: Lease; readonly quiet?: true },
  ) => {
    const next = await update(
      id,
      (record) =>
        record.info.state !== "running"
          ? record
          : {
              ...record,
              info: { ...record.info, state, updatedAt: Date.now() },
              // An owner that stops its own jobs has nothing to learn from them.
              ...(options?.quiet ? { delivered: true } : {}),
            },
      options?.lease,
    );
    await sync(id);
    return next;
  };

  let recovering: Promise<void> | undefined;
  // A clean pass leaves nothing for a later one; a deferred lease or a failure unsettles it.
  let settled = false;
  const scheduleRecovery = () => {
    settled = false;
    if (closing || recoveryTimer !== undefined) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      void track(recover().catch(diagnostic));
    }, LEASE_MS);
    recoveryTimer.unref();
  };

  /**
   * Every runner reconciliation asks for recovery, including each child's for
   * its parent. Callers join a pass in flight, and a settled instance answers
   * without one.
   */
  const recover = (): Promise<void> => {
    if (closing || settled) return Promise.resolve();
    recovering ??= track(
      recoverAll()
        .then(() => {
          settled = recoveryTimer === undefined;
        })
        .catch((cause: unknown) => {
          scheduleRecovery();
          throw cause;
        })
        .finally(() => {
          recovering = undefined;
        }),
    );
    return recovering;
  };

  const recoverAll = async (): Promise<void> => {
    for (const ref of await input.session.refs.list(JOB_PREFIX)) {
      if (closing) return;
      const id = ref.name.slice(JOB_PREFIX.length);
      try {
        const stored = await read(id);
        if (stored === undefined || closing) continue;
        if (stored.record.info.state === "running" && !live.has(id)) {
          const acquired = await input.session.leases.acquire(ref.name, LEASE_MS);
          if (!acquired.ok) {
            scheduleRecovery();
            await sync(id);
            continue;
          }
          try {
            if (!closing) await interrupt(id, "interrupted", { lease: acquired.lease });
          } finally {
            await input.session.leases.release(acquired.lease);
          }
        } else await sync(id);
      } catch (cause) {
        scheduleRecovery();
        await diagnostic(cause);
      }
    }
  };

  const receipt = (job: JobInfo): AgentToolResult<unknown> => ({
    content: toolResultContent(
      job.kind === "subagent"
        ? `Started background subagent ${job.title} as ${job.id}. Finish your turn; its report arrives as a new message when it ends.`
        : [
            `Started background command ${job.id}. It keeps running after this turn; its exit is reported in a later message.`,
            job.output === "" ? "No output yet." : `Output so far:\n${job.output}`,
          ].join("\n"),
    ),
    title: job.title,
    details:
      job.kind === "subagent"
        ? { jobId: job.id, childSessionId: job.childSessionId }
        : { jobId: job.id },
  });

  const wake = async (id: string, aborted: boolean): Promise<ToolWakeOutcome> => {
    let stored = await read(id);
    if (stored === undefined)
      return {
        kind: "settle",
        isError: true,
        result: {
          content: toolResultContent("Work was interrupted before it could start."),
          details: {},
        },
      };
    if (aborted && stored.record.info.state === "running") {
      await interrupt(id, "cancelled");
      stored = (await read(id)) ?? stored;
    }
    if (stored.record.info.mode === "background")
      return { kind: "settle", result: receipt(stored.record.info) };
    const { info, result } = stored.record;
    if (info.state === "running") return { kind: "wait" };
    if (result !== undefined) {
      const settled = { content: result.content, details: result.details };
      const titled = result.title === undefined ? settled : { ...settled, title: result.title };
      const measured = result.usage === undefined ? titled : { ...titled, usage: result.usage };
      return {
        kind: "settle",
        result:
          result.addedToolNames === undefined
            ? measured
            : { ...measured, addedToolNames: result.addedToolNames },
        isError: info.state !== "completed",
      };
    }
    return {
      kind: "settle",
      isError: true,
      result: {
        content: toolResultContent(
          `${info.kind === "command" ? "Command" : "Subagent"} ${info.state}.${info.output ? `\n${info.output}` : ""}`,
        ),
        title: info.title,
        details: { jobId: id },
      },
    };
  };

  /**
   * Publish the job and start its work. A run owner's admission and abort
   * compete on the same run ref, so an abort sweep cannot miss a job published
   * after it read the job list. A user job has no run to race.
   */
  const admit = async (
    owner: JobOwner,
    tool: AgentTool,
    args: unknown,
    title: string,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback | undefined,
  ): Promise<Admitted> => {
    if (closing) throw new Error("Host is closing");
    signal?.throwIfAborted();
    const params = toJsonValue(args);
    if (!isJsonObject(params)) throw new Error("Job arguments must be an object");
    const id =
      owner.kind === "run"
        ? jobId(owner.runId, owner.callId)
        : jobId(USER_JOB_RUN_ID, randomUUID());
    const callId = owner.kind === "run" ? owner.callId : id;
    const runId = owner.kind === "run" ? owner.runId : USER_JOB_RUN_ID;
    if ((await read(id)) !== undefined) throw new Error("Job already exists");
    const acquired = await input.session.leases.acquire(JOB_PREFIX + id, LEASE_MS);
    if (!acquired.ok) throw new Error("Job is already running");
    const controller = new AbortController();
    const now = Date.now();
    const base = {
      id,
      runId,
      callId,
      head: owner.head,
      title,
      mode: params.background === true ? "background" : "foreground",
      state: "running",
      startedAt: now,
      updatedAt: now,
      output: "",
    } satisfies Omit<JobInfo, "kind">;
    const info: JobInfo =
      tool.name === "task"
        ? { ...base, kind: "subagent", childSessionId: input.childId(runId, callId) }
        : { ...base, kind: "command" };
    // Nobody is told when a user job ends; its card reads the job ref.
    const record: JobRecord = { info, delivered: owner.kind === "user" };
    const runtime: LiveJob = {
      controller,
      lease: acquired.lease,
      done: Promise.resolve(),
      writes: Promise.resolve(),
    };
    live.set(id, runtime);
    try {
      if (closing) throw new Error("Host is closing");
      signal?.throwIfAborted();
      const oid = (
        await input.session.objects.put([{ kind: "blob", value: toJsonValue(record) }])
      )[0];
      if (oid === undefined) throw new Error("Job write returned no object");
      for (;;) {
        const runOid =
          owner.kind === "run" ? await input.session.refs.read(runRef(owner.head)) : null;
        const run = runOid === null ? undefined : await input.session.objects.get(runOid);
        if (
          (owner.kind === "run" &&
            run !== undefined &&
            (run.kind !== "run" ||
              run.id !== owner.runId ||
              run.abortRequested ||
              isTerminalPhase(run.phase))) ||
          (await input.session.refs.read(JOBS_CANCELLED_REF)) !== null
        )
          throw new Error("Job owner was cancelled");
        const saved = await input.session.refs.update(
          [
            { name: JOB_PREFIX + id, from: null, to: oid },
            ...(owner.kind === "run"
              ? [{ name: runRef(owner.head), from: runOid, to: runOid }]
              : []),
            { name: JOBS_CANCELLED_REF, from: null, to: null },
          ],
          { reason: "job", lease: acquired.lease },
        );
        if (saved.ok) break;
        if (saved.reason === "fenced") throw new Error("Job ownership was lost");
        if ((await read(id)) !== undefined) throw new Error("Job already exists");
      }
    } catch (cause) {
      if (live.get(id) === runtime) live.delete(id);
      await input.session.leases.release(acquired.lease);
      throw cause;
    }
    const started = Promise.withResolvers<void>();
    const produced = Promise.withResolvers<void>();
    const watching = new AbortController();
    // Job ownership outlives a head runner or attachment. Remote control must still
    // reach the executing tool when the SDK is not watching that head.
    const watch = (async () => {
      const afterSeq = await input.session.events.last();
      await sync(id);
      for await (const event of input.session.events.watch({
        afterSeq,
        signal: watching.signal,
      })) {
        if (event.kind === "ref" && event.name === JOB_PREFIX + id) await sync(id);
      }
    })().catch(async (cause: unknown) => {
      controller.abort(cause);
      scheduleRecovery();
      await diagnostic(cause);
    });
    const context = owner.kind === "run" ? { runId: owner.runId, head: owner.head } : undefined;
    runtime.done = track(
      (async () => {
        let result: AgentToolResult<unknown>;
        let failed = false;
        try {
          result = await withLeaseRenewal(
            {
              session: input.session,
              lease: acquired.lease,
              ttlMs: LEASE_MS,
              signal: AbortSignal.any([controller.signal, shutdown.signal]),
            },
            async (jobSignal) => {
              const aborted = Promise.withResolvers<never>();
              const onAbort = () => aborted.reject(jobSignal.reason);
              jobSignal.throwIfAborted();
              jobSignal.addEventListener("abort", onAbort, { once: true });
              let acceptingUpdates = true;
              try {
                // A tool may ignore cancellation. Observe its eventual rejection, but do not
                // keep the manager or lease renewal alive waiting for it.
                return await Promise.race([
                  aborted.promise,
                  Promise.resolve().then(() => {
                    jobSignal.throwIfAborted();
                    return tool.execute(
                      callId,
                      args,
                      jobSignal,
                      (partial: AgentToolResult<unknown>) => {
                        if (!acceptingUpdates || jobSignal.aborted) return;
                        started.resolve();
                        if (toolResultText(partial.content) !== "") produced.resolve();
                        try {
                          onUpdate?.(partial);
                        } catch (cause) {
                          void track(diagnostic(cause));
                        }
                        runtime.writes = runtime.writes
                          .then(async () => {
                            if (owner.kind === "run") {
                              const progress = toolProgress(partial);
                              await input.session.events.append(
                                [
                                  {
                                    kind: "progress",
                                    runId,
                                    callId,
                                    progress: {
                                      ...progress,
                                      text: progress.text.slice(-OUTPUT_LIMIT),
                                    },
                                  },
                                ],
                                { lease: acquired.lease },
                              );
                            }
                            await update(
                              id,
                              (current) =>
                                current.info.state !== "running"
                                  ? current
                                  : {
                                      ...current,
                                      info: {
                                        ...current.info,
                                        title: partial.title ?? current.info.title,
                                        output: toolResultText(partial.content).slice(
                                          -OUTPUT_LIMIT,
                                        ),
                                        updatedAt: Date.now(),
                                      },
                                    },
                              acquired.lease,
                            );
                          })
                          .catch(diagnostic);
                      },
                      context,
                    );
                  }),
                ]);
              } finally {
                acceptingUpdates = false;
                jobSignal.removeEventListener("abort", onAbort);
              }
            },
          );
        } catch (cause) {
          failed = true;
          result = toolErrorResult(cause);
        }
        await runtime.writes;
        await update(
          id,
          (current) =>
            current.info.state !== "running"
              ? current
              : {
                  ...current,
                  result: toolResultMessage(
                    { toolCallId: callId, toolName: tool.name },
                    result,
                    failed,
                  ),
                  info: {
                    ...current.info,
                    state: shutdown.signal.aborted
                      ? "interrupted"
                      : failed
                        ? "failed"
                        : "completed",
                    output: toolResultText(result.content).slice(-OUTPUT_LIMIT),
                    updatedAt: Date.now(),
                  },
                },
          acquired.lease,
        );
        await sync(id);
      })()
        .finally(async () => {
          watching.abort();
          await watch;
          if (live.get(id) === runtime) live.delete(id);
          await input.session.leases.release(acquired.lease);
        })
        .catch(async (cause: unknown) => {
          scheduleRecovery();
          await diagnostic(cause);
        }),
    );
    return { info, runtime, started: started.promise, produced: produced.promise };
  };

  /** The tool behind each wrapper by name, so a user job runs it without the parking wrapper. */
  const wrappedTools = new Map<string, AgentTool>();

  const wrap = (tool: AgentTool): AgentTool => {
    const wrapper: AgentTool = {
      ...tool,
      replay: "never",
      execute(callId, args, signal, onUpdate, context) {
        return track(
          (async () => {
            let executing = true;
            try {
              if (context === undefined) throw new Error("Job execution requires a run context");
              const admitted = await admit(
                { kind: "run", runId: context.runId, callId, head: context.head },
                tool,
                args,
                tool.name,
                signal,
                (partial) => {
                  if (executing) onUpdate?.(partial);
                },
              );
              const { info, runtime } = admitted;
              if (tool.name === "task") {
                const cancelled = Promise.withResolvers<void>();
                const onAbort = () => cancelled.resolve();
                signal?.addEventListener("abort", onAbort, { once: true });
                try {
                  if (!signal?.aborted)
                    await Promise.race([admitted.started, cancelled.promise, runtime.done]);
                  if (signal?.aborted) await interrupt(info.id, "cancelled");
                } finally {
                  signal?.removeEventListener("abort", onAbort);
                }
              } else if (info.mode === "background") {
                await Promise.race([
                  admitted.produced,
                  runtime.done,
                  new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, BACKGROUND_PEEK_MS);
                    timer.unref();
                  }),
                ]);
                await runtime.writes;
              }
              // Both modes park first. The runner rechecks jobs after parking, closing the fast-completion race.
              throw new ToolWait();
            } finally {
              executing = false;
            }
          })(),
        );
      },
      wake: (call, context) => track(wake(jobId(call.runId, call.toolCallId), context.aborted)),
    };
    wrappedTools.set(tool.name, tool);
    return wrapper;
  };

  return {
    wrap,
    /** Run a wrapped tool as a user-owned job on `head`; progress arrives as `job` events. */
    start(toolName: string, head: string, args: JsonValue, title: string): Promise<JobInfo> {
      const tool = wrappedTools.get(toolName);
      if (tool === undefined) return Promise.reject(new Error(`This chat has no ${toolName} tool`));
      return track(
        admit({ kind: "user", head }, tool, args, title, undefined, undefined).then(
          (admitted) => admitted.info,
        ),
      );
    },
    sync: (id: string) => (closing ? Promise.resolve() : track(sync(id))),
    /**
     * Re-sync the jobs behind a run's parked calls. A job that finished before
     * its effect was parked signalled nothing; this closes that race without
     * touching jobs of other runs.
     */
    recheck(runId: string): Promise<void> {
      if (closing) return Promise.resolve();
      return track(
        (async () => {
          for (const view of await listEffects(input.session, runId)) {
            if (view.effect.state !== "waiting") continue;
            await sync(jobId(runId, view.intent.callId));
          }
        })(),
      );
    },
    recover,
    interruptOwned(options: {
      readonly runId?: string;
      readonly state: "cancelled" | "interrupted";
    }): Promise<void> {
      return track(
        (async () => {
          for (const ref of await input.session.refs.list(JOB_PREFIX)) {
            const id = ref.name.slice(JOB_PREFIX.length);
            const stored = await read(id);
            if (stored === undefined) continue;
            const job = stored.record.info;
            // A stopped run takes every job it owns with it, background ones included.
            // User jobs have no run owner; only host close interrupts them.
            if (isUserJob(job) || (options.runId !== undefined && job.runId !== options.runId))
              continue;
            await interrupt(id, options.state, { quiet: true });
          }
          await Promise.all(deliveries.values());
        })(),
      );
    },
    async list(head?: string): Promise<readonly JobInfo[]> {
      const refs = await input.session.refs.list(JOB_PREFIX);
      const jobs = await Promise.all(
        refs.map(async (ref) => {
          const blob = await input.session.objects.get(ref.oid);
          if (blob?.kind !== "blob") throw new Error(`Missing job ${ref.name}`);
          return parseJobRecord(blob.value).info;
        }),
      );
      return jobs
        .filter((job) => head === undefined || job.head === head)
        .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    },
    /** The job a tool call owns, by the same derivation that named it. */
    async find(runId: string, callId: string): Promise<JobInfo | undefined> {
      return (await read(jobId(runId, callId)))?.record.info;
    },
    background(id: string): Promise<JobActionOutcome> {
      return track(
        (async (): Promise<JobActionOutcome> => {
          if (closing) throw new Error("Host is closing");
          const stored = await read(id);
          if (stored === undefined) return { kind: "not_found" };
          if (stored.record.info.state !== "running") return { kind: "finished" };
          const next = await update(id, (current) =>
            current.info.state !== "running"
              ? current
              : {
                  ...current,
                  info: { ...current.info, mode: "background", updatedAt: Date.now() },
                },
          );
          await sync(id);
          return {
            kind:
              next?.info.mode === "background" && next.info.state === "running"
                ? "applied"
                : "finished",
          };
        })(),
      );
    },
    cancel(id: string): Promise<JobActionOutcome> {
      return track(
        (async (): Promise<JobActionOutcome> => {
          if (closing) throw new Error("Host is closing");
          const stored = await read(id);
          if (stored === undefined) return { kind: "not_found" };
          if (stored.record.info.state !== "running") return { kind: "finished" };
          const next = await interrupt(id, "cancelled");
          return { kind: next?.info.state === "cancelled" ? "applied" : "finished" };
        })(),
      );
    },
    close(): Promise<void> {
      if (closed !== undefined) return closed;
      closing = true;
      if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
      shutdown.abort();
      closed = (async () => {
        const stopping = [...live].map(async ([id, runtime]) => {
          try {
            await interrupt(id, "interrupted", { lease: runtime.lease });
          } catch (cause) {
            await diagnostic(cause);
          }
          await runtime.done;
        });
        await Promise.allSettled([...operations, ...stopping]);
        await Promise.all([...live.values()].map((runtime) => runtime.done));
      })();
      return closed;
    },
  };
}
