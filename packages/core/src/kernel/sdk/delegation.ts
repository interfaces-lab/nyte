/**
 * Child sessions a parent addresses by id: how they are named and created,
 * the requests the parent sends them, the completions their answers land as,
 * the parked waits those answers wake, and the jobs wrapper that makes `bash`
 * durable. The subagent plugin a root session loads talks to the host built here.
 */
import { createHash } from "node:crypto";
import { contentText } from "@nyte-ai/ai";
import { isTerminalPhase, type JobEnd, type Landing, type RunPhase } from "@nyte-ai/protocol";
import type { JsonValue } from "@nyte-ai/schema";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { definePlugin, inlinePlugin, type LoadedPlugin } from "../../plugins/types.ts";
import {
  SUBAGENTS_PLUGIN_ID,
  awaitedAgents,
  satisfied,
  subagentsPlugin,
  type AgentPhase,
  type AgentReport,
  type AgentStatus,
  type SubagentHost,
} from "../../plugins/builtin/subagents.ts";
import { transcriptFromCommits } from "@nyte-ai/client";
import { isUserInput } from "../admission.ts";
import { listEffects, signalEffect } from "../effects.ts";
import { branch } from "../graph.ts";
import type { Commit, CommitBody, Oid, RefName } from "../model.ts";
import { delegationPrefix, delegationRef, headRef, runRef } from "../names.ts";
import { cancel, pending, submit } from "../queue.ts";
import { createJobs, JOBS_CANCELLED_REF } from "./jobs.ts";
import { runAtRef, type Runners } from "./runner.ts";
import {
  CWD_FACT,
  RUN_PREFIX,
  parentValue,
  type Pooled,
  type SessionPool,
} from "./session-pool.ts";
import { NAME_FACT, PARENT_FACT } from "./snapshot.ts";
import {
  MAIN,
  UnknownSession,
  sessionId,
  type NyteOptions,
  type SessionId,
  type SessionParent,
} from "./types.ts";

const SYSTEM_FACT = "system";

const delegationRecord = Type.Object({
  runId: Type.String(),
  callId: Type.String(),
  head: Type.String(),
  at: Type.Number(),
  delivered: Type.Boolean(),
});
type DelegationRecord = Static<typeof delegationRecord>;

interface Request {
  readonly ref: RefName;
  readonly oid: Oid;
  readonly change: Oid;
  readonly record: DelegationRecord;
}

export function childIdOf(parent: SessionId, runId: string, callId: string): SessionId {
  const digest = createHash("sha256").update([parent, runId, callId].join("\u0000")).digest("hex");
  return sessionId(`s_child_${digest.slice(0, 16)}`);
}

function jobEnd(phase: RunPhase): JobEnd | undefined {
  switch (phase.kind) {
    case "done":
      return { kind: "completed" };
    case "failed":
      return { kind: "failed", reason: phase.failure.message };
    case "aborted":
      return { kind: "cancelled" };
    case "respond":
    case "tools":
    case "waiting":
    case "retry":
      return undefined;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/** How a run that a newer run has since replaced ended, read from its last answer. */
function endOfSuperseded(last: Commit | undefined): JobEnd {
  if (last?.body.kind !== "message" || last.body.message.role !== "assistant")
    return { kind: "interrupted" };
  switch (last.body.message.stopReason) {
    case "error":
      return { kind: "failed", reason: last.body.message.errorMessage ?? "error" };
    case "aborted":
      return { kind: "cancelled" };
    default:
      return { kind: "completed" };
  }
}

function assistantText(commit: Commit): string {
  if (commit.body.kind !== "message" || commit.body.message.role !== "assistant") return "";
  return commit.body.message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

export function createDelegation(input: {
  readonly options: NyteOptions;
  readonly pool: SessionPool;
  readonly runners: Runners;
  /** The host's landing policy: where a child's config and messages go. */
  readonly landing: Landing;
}) {
  const { options, pool, runners, landing } = input;
  const firstLane = landing.lanes[0]?.lane;
  if (firstLane === undefined) throw new TypeError("The landing policy has no lane to send to");
  const boundaryLanes = landing.lanes
    .filter((policy) => policy.lands === "boundary")
    .map((policy) => policy.lane);
  const boundaryLane = boundaryLanes[0] ?? firstLane;
  const idleLane = landing.lanes.find((policy) => policy.lands === "idle")?.lane ?? firstLane;

  const pluginsFor = (target: {
    readonly id: SessionId;
    readonly pooled: Pooled;
    readonly plugins: readonly LoadedPlugin[];
  }): readonly LoadedPlugin[] => {
    const { id, pooled, plugins } = target;
    const hostPlugins = plugins.filter(
      (plugin) => plugin.id !== SUBAGENTS_PLUGIN_ID && plugin.id !== "jobs",
    );
    const roleAware =
      pooled.parent === undefined
        ? [...hostPlugins, inlinePlugin(subagentsPlugin(subagentHost(id, pooled)))]
        : [
            ...hostPlugins,
            inlinePlugin(
              definePlugin({
                id: "delegate-system",
                async session(api) {
                  const text = await pool.readFact(pooled.session, SYSTEM_FACT);
                  if (typeof text !== "string") return;
                  api.prompt.add((draft) => draft.set("delegate-system", { text, order: 1 }));
                },
              }),
            ),
          ];
    return [
      ...roleAware,
      inlinePlugin(
        definePlugin({
          id: "jobs",
          session(api) {
            api.tools.add((draft) => {
              const bash = draft.get("bash");
              if (bash !== undefined) draft.set("bash", jobsFor(id, pooled).wrap(bash));
            });
          },
        }),
      ),
    ];
  };

  const jobsFor = (id: SessionId, pooled: Pooled) => {
    pooled.jobs ??= createJobs({
      session: pooled.session,
      notify: async (job, head) => {
        if ((await pooled.session.refs.read(JOBS_CANCELLED_REF)) !== null) return;
        await submit(pooled.session, {
          head,
          lane: "background",
          key: `background-${job.id}`,
          body: { kind: "completion", job },
        });
      },
      diagnostic: (cause) => runners.emitRunnerDiagnostic(pooled.session, cause),
    });
    return pooled.jobs;
  };

  const openChild = async (
    id: SessionId,
  ): Promise<{ readonly id: SessionId; readonly pooled: Pooled } | undefined> => {
    try {
      return { id, pooled: await pool.open(id) };
    } catch (error) {
      if (error instanceof UnknownSession) return undefined;
      throw error;
    }
  };

  /** The child, when `parent` created it. */
  const ownedChild = async (parent: SessionId, id: SessionId) => {
    const child = pool.closed ? undefined : await openChild(id);
    return child?.pooled.parent?.sessionId === parent ? child : undefined;
  };

  const titleOf = async (child: Pooled): Promise<string> => {
    const name = await pool.readFact(child.session, NAME_FACT);
    return typeof name === "string" ? name : "";
  };

  const stopped = async (child: Pooled): Promise<boolean> =>
    (await child.session.refs.read(JOBS_CANCELLED_REF)) !== null;

  const requestsOf = async (parent: Pooled, child: SessionId): Promise<Request[]> => {
    const prefix = delegationPrefix(child);
    const entries = await parent.session.refs.list(prefix);
    const requests = await Promise.all(
      entries.map(async (entry) => {
        const blob = await parent.session.objects.get(entry.oid);
        if (blob?.kind !== "blob" || !Value.Check(delegationRecord, blob.value))
          throw new Error(`Corrupt delegation record ${entry.name}`);
        return {
          ref: entry.name,
          oid: entry.oid,
          change: entry.name.slice(prefix.length),
          record: blob.value,
        };
      }),
    );
    return requests.sort((a, b) => a.record.at - b.record.at || a.change.localeCompare(b.change));
  };

  const writeRequest = async (
    parent: Pooled,
    request: { readonly ref: RefName; readonly oid: Oid | null },
    record: DelegationRecord,
  ): Promise<boolean> => {
    const oid = (await parent.session.objects.put([{ kind: "blob", value: record }]))[0];
    if (oid === undefined) throw new Error("Delegation record write returned no object");
    const outcome = await parent.session.refs.update(
      [{ name: request.ref, from: request.oid, to: oid }],
      { reason: "delegation" },
    );
    return outcome.ok;
  };

  /**
   * The report of one request, once the child run that answered it has ended.
   * A request the child will never land (it was stopped first) ends cancelled,
   * named by its change.
   */
  const reportFor = async (
    child: { readonly id: SessionId; readonly pooled: Pooled },
    title: string,
    change: Oid,
  ): Promise<AgentReport | undefined> => {
    const { session } = child.pooled;
    const commits = await branch(session.objects, await session.refs.read(headRef(MAIN)));
    const landed = commits.find((item) => item.commit.change === change);
    const base = { kind: "delegate", session: child.id, title } as const;
    if (landed === undefined) {
      return (await stopped(child.pooled))
        ? { ...base, request: change, end: { kind: "cancelled" }, report: { kind: "none" } }
        : undefined;
    }
    const runId = landed.commit.run;
    if (runId === undefined) return undefined;
    const last = commits.findLast(
      (item) =>
        item.commit.run === runId &&
        item.commit.body.kind === "message" &&
        item.commit.body.message.role === "assistant",
    );
    const current = await pool.readRun(session, MAIN);
    const end =
      current?.run.id === runId ? jobEnd(current.run.phase) : endOfSuperseded(last?.commit);
    if (end === undefined) return undefined;
    return {
      ...base,
      request: landed.oid,
      end,
      report:
        last === undefined
          ? { kind: "none" }
          : { kind: "text", text: assistantText(last.commit), commit: last.oid },
    };
  };

  const phaseOf = async (child: Pooled, latest: Request | undefined): Promise<AgentPhase> => {
    if (latest !== undefined) {
      const { session } = child;
      const commits = await branch(session.objects, await session.refs.read(headRef(MAIN)));
      if (!commits.some((item) => item.commit.change === latest.change)) return "queued";
    }
    return (await pool.readRun(child.session, MAIN))?.run.phase.kind ?? "idle";
  };

  const status = async (
    parentId: SessionId,
    parent: Pooled,
    agents: readonly SessionId[],
  ): Promise<AgentStatus[]> =>
    Promise.all(
      agents.map(async (agent): Promise<AgentStatus> => {
        const child = await ownedChild(parentId, agent);
        if (child === undefined) return { kind: "not_found", session: agent };
        const title = await titleOf(child.pooled);
        const latest = (await requestsOf(parent, agent)).at(-1);
        const report =
          latest === undefined ? undefined : await reportFor(child, title, latest.change);
        if (report !== undefined) return { kind: "report", report };
        return { kind: "phase", session: agent, title, phase: await phaseOf(child.pooled, latest) };
      }),
    );

  const inputPending = async (parent: Pooled, head: string): Promise<boolean> =>
    (await pending(parent.session, head)).some(
      (item) => boundaryLanes.includes(item.lane) && isUserInput(item),
    );

  /**
   * Signal the parked waits of `parent` that can settle now: every wait on a
   * live run, or one run's. A wait settles for the input it holds up, or once
   * the agents it names satisfy it.
   */
  const wakeWaits = async (
    parentId: SessionId,
    parent: Pooled,
    scope:
      | { readonly kind: "run"; readonly runId: string }
      | { readonly kind: "child"; readonly child: SessionId },
  ): Promise<void> => {
    for (const ref of await parent.session.refs.list(RUN_PREFIX)) {
      const run = await runAtRef(parent.session, ref.oid);
      if (run === undefined || isTerminalPhase(run.phase)) continue;
      if (scope.kind === "run" && run.id !== scope.runId) continue;
      const yielding = await inputPending(parent, run.head);
      for (const view of await listEffects(parent.session, run.id)) {
        if (view.effect.state !== "waiting") continue;
        const awaited = awaitedAgents(
          {
            tool: view.intent.tool,
            args: view.intent.args,
            runId: run.id,
            callId: view.intent.callId,
          },
          (runId, callId) => childIdOf(parentId, runId, callId),
        );
        if (awaited === undefined) continue;
        if (scope.kind === "child" && !awaited.agents.includes(scope.child)) continue;
        const signal: JsonValue = yielding
          ? { kind: "yield" }
          : satisfied(await status(parentId, parent, awaited.agents), awaited.mode)
            ? { kind: "delegate" }
            : null;
        if (signal === null) continue;
        await signalEffect(parent.session, { runId: run.id, callId: view.intent.callId, signal });
      }
    }
  };

  /** Land every answered request of `child` on its parent as a completion, once each, and wake the waits it satisfies. */
  const deliverDue = async (childId: SessionId, child: Pooled): Promise<void> => {
    const parentId = child.parent?.sessionId;
    if (parentId === undefined || pool.closed) return;
    const parent = await pool.open(parentId);
    const title = await titleOf(child);
    for (const request of await requestsOf(parent, childId)) {
      if (request.record.delivered) continue;
      const report = await reportFor({ id: childId, pooled: child }, title, request.change);
      if (report === undefined) continue;
      // Claim before submitting: a crash in between leaves a claimed record whose
      // completion the submission key still makes one message on retry.
      const claimed = await writeRequest(parent, request, { ...request.record, delivered: true });
      if (!claimed) continue;
      await submit(parent.session, {
        head: request.record.head,
        lane: "background",
        key: `delegate-${childId}-${request.change}`,
        body: { kind: "completion", job: report },
      });
    }
    await wakeWaits(parentId, parent, { kind: "child", child: childId });
  };

  const interruptChild = async (id: SessionId): Promise<void> => {
    const child = pool.peek(id) ?? (pool.closed ? undefined : (await openChild(id))?.pooled);
    if (child === undefined) return;
    // Cancellation is terminal: one completed pass covers every later request,
    // and a failed pass clears the memo so the next request repeats it.
    child.interrupting ??= interruptPooledChild(child).catch((cause: unknown) => {
      child.interrupting = undefined;
      throw cause;
    });
    await child.interrupting;
  };

  const interruptPooledChild = async (child: Pooled): Promise<void> => {
    await pool.writeBlobRef(child.session, JOBS_CANCELLED_REF, true, "abort");
    await runners.requestAbortAtRef(child, runRef(MAIN));
    await jobsFor(sessionId(child.session.id), child).interruptOwned({ kind: "cancelled" });
    for (const queued of await pending(child.session, MAIN)) {
      await cancel(child.session, { head: MAIN, change: queued.oid });
    }
    await runners.requestAbortAtRef(child, runRef(MAIN));
  };

  const subagentHost = (id: SessionId, pooled: Pooled): SubagentHost => ({
    childOf: (runId, callId) => childIdOf(id, runId, callId),
    async create(input) {
      if (pooled.parent !== undefined)
        throw new Error("Delegation depth is 1: an agent cannot delegate further.");
      const stored = await pool.readRun(pooled.session, input.head);
      if (stored?.run.id !== input.runId) throw new Error("The parent run is no longer current");
      const childId = childIdOf(id, input.runId, input.callId);
      if ((await openChild(childId)) !== undefined) return childId;

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

      const parent: SessionParent = {
        sessionId: id,
        runId: input.runId,
        callId: input.callId,
        depth: 1,
      };
      const session = await options.store.create({ id: childId });
      try {
        input.signal?.throwIfAborted();
        await pool.writeFact(session, PARENT_FACT, parentValue(parent));
        await pool.writeFact(session, NAME_FACT, input.title);
        if (input.system !== undefined) await pool.writeFact(session, SYSTEM_FACT, input.system);
        const location = await pool.storedCwd(pooled.session);
        if (location === undefined) throw new Error("Parent session has no directory");
        await pool.writeFact(session, CWD_FACT, location);
        // A follower may pool the child first; adopt then closes this handle
        // and answers with the pooled one, which the rest of setup must use.
        const child = await pool.adopt(session);
        input.signal?.throwIfAborted();
        await submit(child.session, {
          head: MAIN,
          lane: firstLane,
          body: {
            kind: "config",
            model: { provider: model.provider, id: model.id },
            thinkingLevel: input.thinkingLevel,
          } satisfies CommitBody,
          actor: { clientId: id, device: "delegate" },
        });
        return childId;
      } catch (error) {
        if (pool.peek(childId) !== undefined) await interruptChild(childId);
        else await session.close().catch(() => undefined);
        throw error;
      }
    },
    async send(input) {
      const child = await ownedChild(id, input.agent);
      if (child === undefined) return { kind: "not_found" };
      const title = await titleOf(child.pooled);
      if (await stopped(child.pooled)) return { kind: "stopped", title };
      const current = await pool.readRun(child.pooled.session, MAIN);
      const live = current !== undefined && !isTerminalPhase(current.run.phase);
      const receipt = await submit(child.pooled.session, {
        head: MAIN,
        lane: live ? boundaryLane : idleLane,
        body: {
          kind: "message",
          message: { role: "user", content: input.message, timestamp: Date.now() },
        } satisfies CommitBody,
        actor: { clientId: id, device: "delegate" },
      });
      const record: DelegationRecord = {
        runId: input.runId,
        callId: input.callId,
        head: input.head,
        at: Date.now(),
        delivered: false,
      };
      await writeRequest(
        pooled,
        { ref: delegationRef(input.agent, receipt.change), oid: null },
        record,
      );
      await runners.reconcileRunner(input.agent, child.pooled);
      return { kind: "sent", title };
    },
    status: (agents) => status(id, pooled, agents),
    async read(input) {
      const child = await ownedChild(id, input.agent);
      if (child === undefined) return { kind: "not_found" };
      const { session } = child.pooled;
      const commits = await branch(session.objects, await session.refs.read(headRef(MAIN)));
      const turns = transcriptFromCommits(commits)
        .flatMap((turn) => (turn.kind === "turn" ? [turn] : []))
        .slice(-input.turns);
      const lines = turns.flatMap((turn) =>
        turn.parts.flatMap((part) => {
          switch (part.kind) {
            case "user":
              return [`User: ${contentText(part.content)}`];
            case "assistant":
              return [`Assistant: ${part.text}`];
            case "thinking":
              return [];
            case "tool":
              return [
                `[${part.class.kind}${part.result === undefined ? "" : `: ${part.result.output.slice(0, 200)}`}]`,
              ];
            default: {
              const _exhaustive: never = part;
              return _exhaustive;
            }
          }
        }),
      );
      return {
        kind: "read",
        title: await titleOf(child.pooled),
        phase: await phaseOf(child.pooled, (await requestsOf(pooled, input.agent)).at(-1)),
        text: lines.join("\n\n"),
      };
    },
    async stop(agent) {
      const child = await ownedChild(id, agent);
      if (child === undefined) return { kind: "not_found" };
      await interruptChild(agent);
      await deliverDue(agent, child.pooled);
      return { kind: "stopped", title: await titleOf(child.pooled) };
    },
    inputPending: (head) => inputPending(pooled, head),
  });

  return {
    pluginsFor,
    jobsFor,
    interruptChild,
    /** A child's run ref moved, or its runner is being reconciled: deliver what it answered. */
    childRunChanged: deliverDue,
    /** A run parked; wake the waits that were satisfied before they parked. */
    recheck: (id: SessionId, pooled: Pooled, runId: string) =>
      wakeWaits(id, pooled, { kind: "run", runId }),
    /** Input arrived on `head`; a wait holding it up settles early. */
    yieldToInput: async (id: SessionId, pooled: Pooled, head: string) => {
      const run = await pool.readRun(pooled.session, head);
      if (run === undefined || isTerminalPhase(run.run.phase)) return;
      if (await inputPending(pooled, head))
        await wakeWaits(id, pooled, { kind: "run", runId: run.run.id });
    },
  };
}

export type Delegation = ReturnType<typeof createDelegation>;
