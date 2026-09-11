/**
 * Child sessions delegated by a parent run: how they are named, spawned,
 * watched, backgrounded, and interrupted, and the jobs wrapper that makes
 * `bash` and `task` durable. The subagent plugin a parent session loads talks
 * to the host built here.
 */
import { createHash } from "node:crypto";
import { definePlugin, inlinePlugin, type LoadedPlugin } from "../../plugins/types.ts";
import {
  SUBAGENTS_PLUGIN_ID,
  TASK_TOOL,
  subagentsPlugin,
  type SubagentHost,
  type SubagentResult,
} from "../../plugins/builtin/subagents.ts";
import { contextMessages } from "../context.ts";
import { listEffects, signalEffect } from "../effects.ts";
import { contextCommits } from "../graph.ts";
import type { CommitBody } from "../model.ts";
import { headRef, runRef } from "../names.ts";
import { cancel, pending, submit } from "../queue.ts";
import type { Session } from "../store.ts";
import { createJobs, JOBS_CANCELLED_REF } from "./jobs.ts";
import { runAtRef, type Runners } from "./runner.ts";
import {
  CWD_FACT,
  RUN_PREFIX,
  attributed,
  parentValue,
  type Pooled,
  type SessionPool,
} from "./session-pool.ts";
import { PARENT_FACT } from "./snapshot.ts";
import {
  MAIN,
  UnknownSession,
  sessionId,
  type NyteOptions,
  type SessionId,
  type SessionParent,
} from "./types.ts";

export function childSessionId(parent: SessionId, runId: string, callId: string): SessionId {
  const digest = createHash("sha256").update([parent, runId, callId].join("\u0000")).digest("hex");
  return sessionId(`s_child_${digest.slice(0, 16)}`);
}

export function createSubagents(input: {
  readonly options: NyteOptions;
  readonly pool: SessionPool;
  readonly runners: Runners;
  /** Where a child's config and first message go: the first lane the runner serves. */
  readonly defaultLane: () => string;
}) {
  const { options, pool, runners, defaultLane } = input;

  const pluginsFor = (target: {
    readonly id: SessionId;
    readonly pooled: Pooled;
    readonly plugins: readonly LoadedPlugin[];
  }): readonly LoadedPlugin[] => {
    const { id, pooled, plugins } = target;
    const hostPlugins = plugins.filter(
      (plugin) => plugin.id !== SUBAGENTS_PLUGIN_ID && plugin.id !== "jobs",
    );
    const withAgents =
      pooled.parent === undefined
        ? [...hostPlugins, inlinePlugin(subagentsPlugin(subagentHost(id, pooled)))]
        : hostPlugins;
    return [
      ...withAgents,
      inlinePlugin(
        definePlugin({
          id: "jobs",
          session(api) {
            api.tools.add((draft) => {
              for (const name of ["bash", TASK_TOOL]) {
                const tool = draft.get(name);
                if (tool !== undefined) draft.set(name, jobsFor(id, pooled).wrap(tool));
              }
            });
          },
        }),
      ),
    ];
  };

  const openChild = async (
    parent: SessionId,
    runId: string,
    callId: string,
  ): Promise<{ readonly id: SessionId; readonly pooled: Pooled } | undefined> => {
    const id = childSessionId(parent, runId, callId);
    try {
      return { id, pooled: await pool.open(id) };
    } catch (error) {
      if (error instanceof UnknownSession) return undefined;
      throw error;
    }
  };

  const childResultText = async (session: Session): Promise<string> => {
    const tip = await session.refs.read(headRef(MAIN));
    const commits = await contextCommits(session.objects, tip);
    const messages = contextMessages(commits.map((item) => item.commit));
    const last = messages.findLast((message) => message.role === "assistant");
    if (last === undefined || last.role !== "assistant") return "";
    return last.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  };

  const childResult = async (session: Session): Promise<SubagentResult | undefined> => {
    const stored = await pool.readRun(session, MAIN);
    if (stored === undefined) return undefined;
    switch (stored.run.phase.kind) {
      case "done":
        return {
          kind: "completed",
          text: await childResultText(session),
        };
      case "failed":
        return {
          kind: "failed",
          error: stored.run.phase.error,
        };
      case "aborted":
        return { kind: "aborted" };
      case "respond":
      case "tools":
      case "waiting":
      case "retry":
        return undefined;
      default: {
        const _exhaustive: never = stored.run.phase;
        return _exhaustive;
      }
    }
  };

  const interruptChild = async (id: SessionId): Promise<void> => {
    const child =
      pool.peek(id) ??
      (pool.closed
        ? undefined
        : await pool.open(id).catch((cause: unknown) => {
            if (cause instanceof UnknownSession) return undefined;
            throw cause;
          }));
    if (child === undefined) return;
    // Recovery, owner interruption, and abort cascades all reach the same child;
    // a failed pass clears the memo so the next request repeats it.
    child.interrupting ??= interruptPooledChild(id, child).catch((cause: unknown) => {
      child.interrupting = undefined;
      throw cause;
    });
    await child.interrupting;
  };

  const interruptPooledChild = async (id: SessionId, child: Pooled): Promise<void> => {
    await pool.writeBlobRef(child.session, JOBS_CANCELLED_REF, true, "abort");
    await runners.requestAbortAtRef(child, runRef(MAIN));
    const owner = child.parent;
    const parent = owner === undefined ? undefined : pool.peek(owner.sessionId);
    const job =
      parent === undefined || owner === undefined
        ? undefined
        : await jobsFor(owner.sessionId, parent).find(owner.runId, owner.callId);
    await jobsFor(id, child).interruptOwned({
      state: job?.state === "interrupted" ? "interrupted" : "cancelled",
    });
    for (const queued of await pending(child.session, MAIN)) {
      await cancel(child.session, { head: MAIN, change: queued.oid });
    }
    await runners.requestAbortAtRef(child, runRef(MAIN));
  };

  const backgroundChild = async (childId: SessionId): Promise<void> => {
    const child = pool.peek(childId);
    if (child === undefined || child.background) return;
    child.background = true;
    await pool.writeFact(child.session, "job-background", true);
    const activation = child.activation;
    if (activation === undefined) return;
    const foregroundOnly = new Set(
      activation
        .tools()
        .filter((tool) => tool.availability === "foreground")
        .map((tool) => tool.name),
    );
    for (const ref of await child.session.refs.list(RUN_PREFIX)) {
      const run = await runAtRef(child.session, ref.oid);
      if (run === undefined) continue;
      for (const effect of await listEffects(child.session, run.id)) {
        if (foregroundOnly.has(effect.intent.tool))
          await signalEffect(child.session, {
            runId: run.id,
            callId: effect.intent.callId,
            signal: { kind: "backgrounded" },
          });
      }
    }
  };

  const jobsFor = (id: SessionId, pooled: Pooled) => {
    pooled.jobs ??= createJobs({
      session: pooled.session,
      childId: (runId, callId) => childSessionId(id, runId, callId),
      interruptChild,
      backgroundChild,
      notify: async (job) => {
        if ((await pooled.session.refs.read(JOBS_CANCELLED_REF)) !== null) return;
        await submit(pooled.session, {
          head: job.head,
          lane: "background",
          key: `background-${job.id}`,
          body: { kind: "completion", job },
        });
      },
      diagnostic: (cause) => runners.emitRunnerDiagnostic(pooled.session, cause),
    });
    return pooled.jobs;
  };

  const subagentHost = (id: SessionId, pooled: Pooled): SubagentHost => ({
    async stop(jobId) {
      const jobs = jobsFor(id, pooled);
      const job = (await jobs.list()).find((candidate) => candidate.id === jobId);
      if (job?.kind !== "subagent") return { kind: "not_found" };
      return jobs.cancel(jobId);
    },
    async spawn(input) {
      if (pooled.parent !== undefined)
        throw new Error("Delegation depth is 1: a subagent cannot delegate further.");
      const stored = await pool.readRun(pooled.session, input.head);
      if (stored?.run.id !== input.runId) throw new Error("The parent run is no longer current");
      const parentRun = stored.run;
      const runId = input.runId;
      const existing = await openChild(id, runId, input.callId);
      if (existing !== undefined) return existing.id;

      const slash = input.model.indexOf("/");
      const selected = { provider: input.model.slice(0, slash), id: input.model.slice(slash + 1) };
      const available = await options.models.getAvailable(selected.provider, {
        signal: input.signal,
      });
      input.signal?.throwIfAborted();
      const model = available.find(
        (candidate) => candidate.provider === selected.provider && candidate.id === selected.id,
      );
      if (model === undefined) {
        throw new Error(
          `Subagent model is unavailable: ${input.model}. Choose an available model or connect its provider.`,
        );
      }

      const childId = childSessionId(id, runId, input.callId);
      const parent: SessionParent = {
        sessionId: id,
        runId,
        callId: input.callId,
        depth: 1,
      };
      input.signal?.throwIfAborted();
      const session = await options.store.create({ id: childId });
      try {
        input.signal?.throwIfAborted();
        await pool.writeFact(session, PARENT_FACT, parentValue(parent));
        const location = await pool.storedCwd(pooled.session);
        if (location === undefined) throw new Error("Parent session has no directory");
        await pool.writeFact(session, CWD_FACT, location);
        // A follower may pool the child first; adopt then closes this handle
        // and answers with the pooled one, which the rest of setup must use.
        const child = await pool.adopt(session);
        input.signal?.throwIfAborted();
        // A promotion that raced this setup found no pooled child to flag.
        // Reread the durable mode after pooling; later promotions reach the
        // pooled child through the job sync.
        const job = await jobsFor(id, pooled).find(runId, input.callId);
        if (job?.mode === "background") await backgroundChild(childId);
        await submit(
          child.session,
          attributed(
            {
              head: MAIN,
              lane: defaultLane(),
              body: {
                kind: "config",
                model: { provider: model.provider, id: model.id },
                thinkingLevel:
                  input.thinkingLevel ?? parentRun.config.thinkingLevel ?? options.thinkingLevel,
              } satisfies CommitBody,
            },
            options.actor,
          ),
        );
        input.signal?.throwIfAborted();
        await submit(
          child.session,
          attributed(
            {
              head: MAIN,
              lane: defaultLane(),
              key: input.callId,
              body: {
                kind: "message",
                message: { role: "user", content: input.prompt, timestamp: Date.now() },
              } satisfies CommitBody,
            },
            options.actor,
          ),
        );
        input.signal?.throwIfAborted();
        await runners.reconcileRunner(childId, child);
        input.signal?.throwIfAborted();
        return childId;
      } catch (error) {
        if (pool.peek(childId) !== undefined) await interruptChild(childId);
        else await session.close().catch(() => undefined);
        throw error;
      }
    },
    async wait(input) {
      const childId = sessionId(input.childSessionId);
      const child = await pool.open(childId);
      const cursor = await child.session.events.last();
      const state = async (): Promise<SubagentResult | undefined> => {
        if (input.signal?.aborted) {
          await interruptChild(childId);
          return { kind: "aborted" };
        }
        if ((await pending(child.session, MAIN)).length > 0) return undefined;
        return childResult(child.session);
      };
      const initial = await state();
      if (initial !== undefined) return initial;
      for await (const _event of child.session.events.watch({
        afterSeq: cursor,
        signal: input.signal,
      })) {
        const current = await state();
        if (current !== undefined) return current;
      }
      await interruptChild(childId);
      return { kind: "aborted" };
    },
  });

  return { pluginsFor, jobsFor, interruptChild, backgroundChild };
}

export type Subagents = ReturnType<typeof createSubagents>;
