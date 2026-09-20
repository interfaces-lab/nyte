import { createHash, randomUUID } from "node:crypto";
import type { JsonValue } from "@nyte-ai/schema";
import {
  isTerminalPhase,
  schemas,
  type JobActionOutcome,
  type JobInfo,
  type JobReport,
} from "@nyte-ai/protocol";
import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolWakeOutcome,
} from "../loop/types.ts";
import { ToolWait } from "../loop/types.ts";
import { toolResultMessage } from "../loop/agent-loop.ts";
import { toolErrorResult, toolResultContent, toolResultText } from "../loop/tool-result.ts";
import { isJsonObject, toJsonValue } from "@nyte-ai/client";
import { factRef, runRef } from "../names.ts";
import { listEffects, signalEffect } from "../effects.ts";
import { toolProgress } from "../turn.ts";
import { withLeaseRenewal } from "../lease.ts";
import type { Lease, Oid } from "../model.ts";
import type { Session } from "../store.ts";

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
  completion: Type.Union([
    Type.Object({ kind: Type.Literal("none") }),
    Type.Object({ kind: Type.Literal("owed") }),
    Type.Object({ kind: Type.Literal("claimed") }),
    Type.Object({ kind: Type.Literal("delivered"), change: schemas.Oid }),
  ]),
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
  /** The tool reported non-empty output. */
  readonly produced: Promise<void>;
}

/** Commands run outside the model's turn: ownership, cancellation, durable results. */
export function createJobs(input: {
  readonly session: Session;
  readonly notify: (
    job: Extract<JobReport, { readonly kind: "command" }>,
    head: string,
  ) => Promise<Oid>;
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
    if (job.origin.kind === "user") return;
    const oid = await input.session.refs.read(runRef(job.head));
    const run = oid === null ? undefined : await input.session.objects.get(oid);
    // Abort already wakes the effect. Changing it underneath that wake would fence settlement.
    if (run?.kind === "run" && run.id === job.origin.runId && run.abortRequested) return;
    await signalEffect(input.session, {
      runId: job.origin.runId,
      callId: job.origin.callId,
      signal: { kind: "job", id: job.id },
    });
  };

  const deliver = (record: JobRecord): Promise<void> => {
    if (
      closing ||
      (record.completion.kind !== "owed" && record.completion.kind !== "claimed") ||
      record.info.phase.kind === "running"
    )
      return Promise.resolve();
    const id = record.info.id;
    const pending = deliveries.get(id);
    if (pending !== undefined) return pending;
    const task = (async () => {
      const claimed = await update(id, (current) =>
        current.completion.kind === "owed" && current.info.phase.kind !== "running" && !closing
          ? { ...current, completion: { kind: "claimed" } }
          : current,
      );
      if (
        claimed === undefined ||
        claimed.completion.kind !== "claimed" ||
        claimed.info.phase.kind === "running" ||
        closing
      )
        return;
      const change = await input.notify(
        {
          kind: "command",
          id,
          command: claimed.info.command,
          end: claimed.info.phase,
          output: claimed.info.output,
        },
        claimed.info.head,
      );
      await update(id, (current) =>
        current.completion.kind === "claimed"
          ? { ...current, completion: { kind: "delivered", change } }
          : current,
      );
    })().finally(() => deliveries.delete(id));
    deliveries.set(id, task);
    return task;
  };

  const sync = async (id: string) => {
    const stored = await read(id);
    if (stored === undefined) return;
    const job = stored.record.info;
    if (job.phase.kind !== "running") live.get(id)?.controller.abort();
    if (stored.record.completion.kind === "owed" || job.phase.kind !== "running") {
      await signal(job);
    }
    await deliver(stored.record);
  };

  const promote = async (id: string): Promise<JobActionOutcome> => {
    if (closing) throw new Error("Host is closing");
    const stored = await read(id);
    if (stored === undefined) return { kind: "not_found" };
    if (stored.record.info.phase.kind !== "running") return { kind: "finished" };
    const next = await update(id, (current) =>
      current.info.phase.kind !== "running"
        ? current
        : {
            ...current,
            completion: current.info.origin.kind === "user" ? current.completion : { kind: "owed" },
            info: {
              ...current.info,
              phase: { kind: "running", mode: "background" },
              updatedAt: Date.now(),
            },
          },
    );
    await sync(id);
    return {
      kind:
        next?.info.phase.kind === "running" && next.info.phase.mode === "background"
          ? "applied"
          : "finished",
    };
  };

  const interrupt = async (
    id: string,
    kind: "cancelled" | "interrupted",
    options?: { readonly lease?: Lease; readonly quiet?: true },
  ) => {
    const next = await update(
      id,
      (record) => {
        const completion =
          options?.quiet && record.completion.kind === "owed"
            ? { kind: "none" as const }
            : record.completion;
        if (record.info.phase.kind !== "running") {
          return completion === record.completion ? record : { ...record, completion };
        }
        return {
          ...record,
          completion,
          info: { ...record.info, phase: { kind }, updatedAt: Date.now() },
        };
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
   * Every runner reconciliation asks for recovery. Callers join a pass in
   * flight, and a settled instance answers without one.
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
        if (stored.record.info.phase.kind === "running" && !live.has(id)) {
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
      [
        `Started background command ${job.id}. It keeps running after this turn. Its exit arrives as a "Background" message before your next response while you are still working, or with the user's next message once you have finished.`,
        job.output === "" ? "No output yet." : `Output so far:\n${job.output}`,
      ].join("\n"),
    ),
    title: job.command,
    details: { jobId: job.id },
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
    if (aborted && stored.record.info.phase.kind === "running") {
      await interrupt(id, "cancelled");
      stored = (await read(id)) ?? stored;
    }
    const { info, result, completion } = stored.record;
    if (info.phase.kind === "running") {
      return info.phase.mode === "background"
        ? { kind: "settle", result: receipt(info) }
        : { kind: "wait" };
    }
    // Background work already answered its call with the receipt; its end is a completion.
    if (completion.kind !== "none") return { kind: "settle", result: receipt(info) };
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
        isError: info.phase.kind !== "completed",
      };
    }
    return {
      kind: "settle",
      isError: true,
      result: {
        content: toolResultContent(
          `Command ${info.phase.kind}.${info.output ? `\n${info.output}` : ""}`,
        ),
        title: info.command,
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
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback | undefined,
  ): Promise<Admitted> => {
    if (closing) throw new Error("Host is closing");
    signal?.throwIfAborted();
    const params = toJsonValue(args);
    if (!isJsonObject(params)) throw new Error("Job arguments must be an object");
    const command = params.command;
    if (typeof command !== "string") throw new Error("Job arguments must name a command");
    const id =
      owner.kind === "run" ? jobId(owner.runId, owner.callId) : jobId("user", randomUUID());
    const callId = owner.kind === "run" ? owner.callId : id;
    if ((await read(id)) !== undefined) throw new Error("Job already exists");
    const acquired = await input.session.leases.acquire(JOB_PREFIX + id, LEASE_MS);
    if (!acquired.ok) throw new Error("Job is already running");
    const controller = new AbortController();
    const now = Date.now();
    const background = params.background === true;
    const info: JobInfo = {
      id,
      head: owner.head,
      origin:
        owner.kind === "run"
          ? { kind: "run", runId: owner.runId, callId: owner.callId }
          : { kind: "user" },
      command,
      phase: { kind: "running", mode: background ? "background" : "foreground" },
      startedAt: now,
      updatedAt: now,
      output: "",
    };
    // Nobody is told when a user job ends; its card reads the job ref.
    const record: JobRecord = {
      info,
      completion: owner.kind === "run" && background ? { kind: "owed" } : { kind: "none" },
    };
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
        let failure: string | undefined;
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
                                    runId: owner.runId,
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
                                current.info.phase.kind !== "running"
                                  ? current
                                  : {
                                      ...current,
                                      info: {
                                        ...current.info,
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
          failure = cause instanceof Error ? cause.message : String(cause);
          result = toolErrorResult(cause);
        }
        await runtime.writes;
        const reason = failure;
        await update(
          id,
          (current) =>
            current.info.phase.kind !== "running"
              ? current
              : {
                  ...current,
                  result: toolResultMessage(
                    { toolCallId: callId, toolName: tool.name },
                    result,
                    reason !== undefined,
                  ),
                  info: {
                    ...current.info,
                    phase: shutdown.signal.aborted
                      ? { kind: "interrupted" }
                      : reason !== undefined
                        ? { kind: "failed", reason }
                        : { kind: "completed" },
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
    return { info, runtime, produced: produced.promise };
  };

  let commandTool: AgentTool | undefined;

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
                signal,
                (partial) => {
                  if (executing) onUpdate?.(partial);
                },
              );
              const { info, runtime } = admitted;
              if (info.phase.kind === "running" && info.phase.mode === "background") {
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
    commandTool = tool;
    return wrapper;
  };

  return {
    wrap,
    /** Run the command tool as a user-owned job on `head`; progress arrives as `job` events. */
    start(head: string, command: string): Promise<JobInfo> {
      if (commandTool === undefined) return Promise.reject(new Error("This chat has no bash tool"));
      return track(
        admit({ kind: "user", head }, commandTool, { command }, undefined, undefined).then(
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
    /** A stopped run takes every command it owns with it; user jobs have no run and stay. */
    interruptOwned(options: {
      readonly runId?: string;
      readonly kind: "cancelled" | "interrupted";
    }): Promise<void> {
      return track(
        (async () => {
          for (const ref of await input.session.refs.list(JOB_PREFIX)) {
            const id = ref.name.slice(JOB_PREFIX.length);
            const stored = await read(id);
            if (stored === undefined) continue;
            const { origin } = stored.record.info;
            if (
              origin.kind === "user" ||
              (options.runId !== undefined && origin.runId !== options.runId)
            )
              continue;
            await interrupt(id, options.kind, { quiet: true });
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
    background(id: string): Promise<JobActionOutcome> {
      return track(promote(id));
    },
    cancel(id: string): Promise<JobActionOutcome> {
      return track(
        (async (): Promise<JobActionOutcome> => {
          if (closing) throw new Error("Host is closing");
          const stored = await read(id);
          if (stored === undefined) return { kind: "not_found" };
          if (stored.record.info.phase.kind !== "running") return { kind: "finished" };
          const next = await interrupt(id, "cancelled");
          return { kind: next?.info.phase.kind === "cancelled" ? "applied" : "finished" };
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
