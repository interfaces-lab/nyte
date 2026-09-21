/**
 * Child sessions a parent addresses by id: how they are named and created,
 * the requests the parent sends them, the completions their answers land as,
 * the parked waits those answers wake, and the jobs wrapper that makes `bash`
 * durable. The subagent plugin a root session loads talks to the host built here.
 */
import { createHash } from "node:crypto";
import { contentText } from "@nyte-ai/ai";
import { isTerminalPhase, type JobEnd, type RunPhase } from "@nyte-ai/protocol";
import type { JsonValue } from "@nyte-ai/schema";
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
import {
  putDelegationRecord,
  readDelegation,
  type DelegationRecord,
  type StoredDelegation,
} from "../delegation-record.ts";
import { listEffects, signalEffect } from "../effects.ts";
import { branch } from "../graph.ts";
import type { Commit, CommitBody, Oid, RefName, RefUpdate, Run } from "../model.ts";
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

type Request = StoredDelegation;

export function childIdOf(
  parent: SessionId,
  head: string,
  runId: string,
  callId: string,
): SessionId {
  const digest = createHash("sha256")
    .update([parent, head, runId, callId].join("\u0000"))
    .digest("hex");
  return sessionId(`s_child_${digest.slice(0, 32)}`);
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

/** How a run ended, read from the terminal run object retained by its request record. */
function terminalEndOf(run: Run, runId: string): JobEnd | undefined {
  if (run.id !== runId) throw new Error(`Delegation record names the wrong child run: ${runId}`);
  return jobEnd(run.phase);
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
}) {
  const { options, pool, runners } = input;

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
        if ((await pooled.session.refs.read(JOBS_CANCELLED_REF)) !== null) {
          throw new Error("Session jobs were cancelled");
        }
        const receipt = await submit(pooled.session, {
          head,
          kind: "report",
          delivery: "steer",
          key: `background-${job.id}`,
          body: { kind: "completion", job },
          preparation: { kind: "none" },
        });
        return receipt.change;
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
        return readDelegation(parent.session, entry, prefix);
      }),
    );
    return requests.sort((a, b) => a.record.at - b.record.at || a.change.localeCompare(b.change));
  };

  const writeRequest = async (
    parent: Pooled,
    request: { readonly ref: RefName; readonly oid: Oid | null },
    record: DelegationRecord,
    authority:
      | { readonly kind: "none" }
      | { readonly kind: "run"; readonly ref: RefName; readonly oid: Oid },
  ): Promise<boolean> => {
    const oid = await putDelegationRecord(parent.session, record);
    const updates: RefUpdate[] = [{ name: request.ref, from: request.oid, to: oid }];
    if (authority.kind === "run") {
      updates.push({ name: authority.ref, from: authority.oid, to: authority.oid });
    }
    const outcome = await parent.session.refs.update(updates, { reason: "delegation" });
    return outcome.ok;
  };

  const updateRequest = async (
    parent: Pooled,
    ref: RefName,
    change: (record: DelegationRecord) => DelegationRecord,
  ): Promise<DelegationRecord | undefined> => {
    for (;;) {
      const oid = await parent.session.refs.read(ref);
      if (oid === null) return undefined;
      const slash = ref.lastIndexOf("/");
      const prefix = slash === -1 ? "" : ref.slice(0, slash + 1);
      const stored = await readDelegation(parent.session, { name: ref, oid }, prefix);
      const next = change(stored.record);
      if (next === stored.record) return next;
      const nextOid = await putDelegationRecord(parent.session, next);
      const outcome = await parent.session.refs.update([{ name: ref, from: oid, to: nextOid }], {
        reason: "delegation",
      });
      if (outcome.ok) return next;
      switch (outcome.reason) {
        case "conflict":
          continue;
        case "fenced":
          throw new Error(`Delegation update was unexpectedly fenced: ${ref}`);
        default: {
          const _exhaustive: never = outcome;
          return _exhaustive;
        }
      }
    }
  };

  const removePreparedRequest = async (
    parent: Pooled,
    ref: RefName,
    expected: DelegationRecord,
  ): Promise<void> => {
    const expectedOid = await putDelegationRecord(parent.session, expected);
    const oid = await parent.session.refs.read(ref);
    if (oid === null || oid !== expectedOid) return;
    await parent.session.refs.update([{ name: ref, from: oid, to: null }], {
      reason: "delegation conflict",
    });
  };

  /** The report of one request once its child run has ended, plus the run object that keeps its end durable. */
  const reportFor = async (
    parent: Pooled,
    child: { readonly id: SessionId; readonly pooled: Pooled },
    title: string,
    request: Request,
  ): Promise<
    | {
        readonly answer: Extract<DelegationRecord["answer"], { readonly kind: "ready" }>;
        readonly report: AgentReport | undefined;
      }
    | undefined
  > => {
    const { session } = child.pooled;
    const commits = await branch(session.objects, await session.refs.read(headRef(MAIN)));
    const landed = commits.find((item) => item.commit.change === request.change);
    const base = { kind: "delegate", session: child.id, title } as const;
    if (landed === undefined) {
      if (!(await stopped(child.pooled))) return undefined;
      const answer = {
        kind: "ready",
        request: { kind: "change", oid: request.change },
        source: { kind: "cancelled" },
      } as const;
      return {
        answer,
        report: {
          ...base,
          request: answer.request,
          end: { kind: "cancelled" },
          report: { kind: "none" },
        },
      };
    }
    const runId = landed.commit.run;
    if (runId === undefined) return undefined;
    const requestIdentity = { kind: "commit", oid: landed.oid } as const;
    let answer: Extract<DelegationRecord["answer"], { readonly kind: "ready" }>;
    let run: Run;
    if (request.record.answer.kind === "ready") {
      answer = request.record.answer;
      if (answer.source.kind === "cancelled") {
        return {
          answer,
          report: {
            ...base,
            request: answer.request,
            end: { kind: "cancelled" },
            report: { kind: "none" },
          },
        };
      }
      const stored = await parent.session.objects.get(answer.source.oid);
      if (stored?.kind !== "run")
        throw new Error(`Missing retained child run ${answer.source.oid}`);
      run = stored;
    } else {
      const current = await pool.readRun(session, MAIN);
      if (current?.run.id !== runId || terminalEndOf(current.run, runId) === undefined) {
        return undefined;
      }
      await parent.session.objects.put([current.run]);
      answer = {
        kind: "ready",
        request: requestIdentity,
        source: { kind: "run", oid: current.oid },
      };
      run = current.run;
    }
    const end = terminalEndOf(run, runId);
    if (end === undefined) return { answer, report: undefined };
    const last = commits.findLast(
      (item) =>
        item.commit.run === runId &&
        item.commit.body.kind === "message" &&
        item.commit.body.message.role === "assistant",
    );
    return {
      answer,
      report: {
        ...base,
        request: requestIdentity,
        end,
        report:
          last === undefined
            ? { kind: "none" }
            : { kind: "text", text: assistantText(last.commit), commit: last.oid },
      },
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
        const observation =
          latest === undefined ? undefined : await reportFor(parent, child, title, latest);
        if (observation?.report !== undefined)
          return { kind: "report", report: observation.report };
        return { kind: "phase", session: agent, title, phase: await phaseOf(child.pooled, latest) };
      }),
    );

  const inputPending = async (parent: Pooled, head: string): Promise<boolean> =>
    (await pending(parent.session, head)).some(
      (item) => item.delivery === "steer" && item.change.kind === "user",
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
          (runId, callId) => childIdOf(parentId, run.head, runId, callId),
        );
        if (awaited.kind === "not_awaited") continue;
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
      if (request.record.delivery.kind === "delivered") continue;
      const observed = await reportFor(parent, { id: childId, pooled: child }, title, request);
      if (observed === undefined) continue;
      const ready = await updateRequest(parent, request.ref, (record) =>
        record.answer.kind === "ready" ? record : { ...record, answer: observed.answer },
      );
      if (
        ready === undefined ||
        ready.delivery.kind === "delivered" ||
        observed.report === undefined
      )
        continue;
      const receipt = await submit(parent.session, {
        head: ready.head,
        kind: "answer",
        delivery: "steer",
        key: `delegate-${childId}-${request.change}`,
        body: { kind: "completion", job: observed.report },
        preparation: { kind: "none" },
      });
      await updateRequest(parent, request.ref, (record) =>
        record.delivery.kind === "owed"
          ? { ...record, delivery: { kind: "delivered", change: receipt.change } }
          : record,
      );
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
    childOf: (head, runId, callId) => childIdOf(id, head, runId, callId),
    async create(input) {
      if (pooled.parent !== undefined)
        throw new Error("Delegation depth is 1: an agent cannot delegate further.");
      const stored = await pool.readRun(pooled.session, input.head);
      if (stored?.run.id !== input.runId) throw new Error("The parent run is no longer current");
      const childId = childIdOf(id, input.head, input.runId, input.callId);
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
          kind: "passive",
          delivery: "next",
          body: {
            kind: "config",
            model: { provider: model.provider, id: model.id },
            thinkingLevel: input.thinkingLevel,
          } satisfies CommitBody,
          preparation: { kind: "none" },
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
      const owner = await pool.readRun(pooled.session, input.head);
      if (
        owner === undefined ||
        owner.run.id !== input.runId ||
        isTerminalPhase(owner.run.phase) ||
        owner.run.abortRequested === true
      ) {
        throw new Error("The parent run is no longer live");
      }
      const child = await ownedChild(id, input.agent);
      if (child === undefined) return { kind: "not_found" };
      const title = await titleOf(child.pooled);
      if (await stopped(child.pooled)) return { kind: "stopped", title };
      const current = await pool.readRun(child.pooled.session, MAIN);
      const live = current !== undefined && !isTerminalPhase(current.run.phase);
      const record: DelegationRecord = {
        runId: input.runId,
        callId: input.callId,
        head: input.head,
        at: Date.now(),
        continuation: { kind: "authorized", root: owner.run.root },
        delivery: { kind: "owed" },
        answer: { kind: "pending" },
      };
      await submit(child.pooled.session, {
        head: MAIN,
        kind: "user",
        delivery: live ? "steer" : "next",
        body: {
          kind: "message",
          message: { role: "user", content: input.message, timestamp: Date.now() },
        } satisfies CommitBody,
        actor: { clientId: id, device: "delegate" },
        preparation: {
          kind: "prepared",
          publish: async (change) => {
            const saved = await writeRequest(
              pooled,
              { ref: delegationRef(input.agent, change), oid: null },
              record,
              { kind: "run", ref: runRef(input.head), oid: owner.oid },
            );
            if (!saved) throw new Error("The parent run is no longer live");
          },
          abandon: (change) =>
            removePreparedRequest(pooled, delegationRef(input.agent, change), record),
        },
      });
      await runners.reconcileRunner(input.agent, child.pooled);
      await deliverDue(input.agent, child.pooled);
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
    participantSend(id: SessionId, pooled: Pooled) {
      const parentLink = pooled.parent;
      if (parentLink === undefined)
        return Promise.resolve({ preparation: { kind: "none" as const } });
      return pool.open(parentLink.sessionId).then((parent) => {
        const record: DelegationRecord = {
          runId: parentLink.runId,
          callId: parentLink.callId,
          head: MAIN,
          at: Date.now(),
          continuation: { kind: "input" },
          delivery: { kind: "owed" },
          answer: { kind: "pending" },
        };
        return {
          preparation: {
            kind: "prepared" as const,
            publish: async (change: Oid) => {
              const saved = await writeRequest(
                parent,
                { ref: delegationRef(id, change), oid: null },
                record,
                { kind: "none" },
              );
              if (!saved) throw new Error("Delegation request already exists");
            },
            abandon: (change: Oid) =>
              removePreparedRequest(parent, delegationRef(id, change), record),
          },
        };
      });
    },
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
