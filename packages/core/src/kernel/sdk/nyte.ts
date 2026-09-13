/**
 * The plain-data SDK over the kernel. Conversation behavior stays in kernel
 * operations; this file composes the session pool, runners, subagents,
 * relocation, and summaries, and exposes them as the `Nyte` namespaces.
 */
import { isTerminalPhase, OPERATIONS, validateHeadName } from "@nyte-ai/protocol";
import { getSupportedThinkingLevels } from "@nyte-ai/ai";
import { Value } from "typebox/value";
import { branch } from "../graph.ts";
import { signalEffect } from "../effects.ts";
import type { Commit, CommitBody, Oid } from "../model.ts";
import { headRef, runRef } from "../names.ts";
import { cancel, pending, redeliver, submit } from "../queue.ts";
import { createHead, deleteHead, fastForward, moveHead } from "../stacks.ts";
import { navigationTarget, transcriptFromCommits } from "../views/index.ts";
import { toJsonValue } from "../json.ts";
import { isCommandPrompt } from "../../plugins/types.ts";
import { createReads } from "./reads.ts";
import { createRunners, errorMessage } from "./runner.ts";
import { createRelocation } from "./relocate.ts";
import { createSubagents } from "./subagent-host.ts";
import { createSummaries } from "./summaries.ts";
import {
  CWD_FACT,
  attributed,
  createSessionPool,
  clientActivation,
  commandInfos,
  parentValue,
  type Pooled,
} from "./session-pool.ts";
import { watchSession } from "./watch.ts";
import { waitForHead } from "./wait.ts";
import {
  ARCHIVED_FACT,
  NAME_FACT,
  PARENT_FACT,
  PINNED_FACT,
  pendingItems,
  runInfo,
  sessionInfo,
} from "./snapshot.ts";
import {
  DEFAULT_LANDING,
  MAIN,
  NyteClosed,
  UnknownSession,
  sessionId,
  type AbortOutcome,
  type ApplyOutcome,
  type AttachOptions,
  type CommandInfo,
  type CommandOutcome,
  type ConfigureOutcome,
  type Disposer,
  type ModelInfo,
  type MoveOutcome,
  type Nyte,
  type NyteOptions,
  type PendingItem,
  type ReplyOutcome,
  type SendInput,
  type SendReceipt,
  type SessionEvent,
  type SessionId,
  type WaitOutcome,
} from "./types.ts";

interface Attachment {
  readonly sessions?: ReadonlySet<SessionId>;
}

function toModelInfo(model: NyteOptions["model"]): ModelInfo {
  return {
    id: model.id,
    provider: model.provider,
    name: model.name,
    contextWindow: model.contextWindow,
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    },
    thinkingLevels: getSupportedThinkingLevels(model),
  };
}

/** Compose the host services into the kernel SDK. */
export async function createNyte(options: NyteOptions): Promise<Nyte> {
  const attachments = new Set<Attachment>();
  const background: unknown[] = [];
  const landing = options.landing ?? DEFAULT_LANDING;

  /** Where a send with no lane goes: the first lane the runner serves. */
  const defaultLane = (): string => {
    const first = landing.lanes[0];
    if (first === undefined) throw new TypeError("The landing policy has no lane to send to");
    return first.lane;
  };

  /** A lane no runner here serves would hold a message forever; refuse it at the door. */
  const servedLane = (lane: string): string => {
    if (!landing.lanes.some((policy) => policy.lane === lane)) {
      throw new TypeError(`Lane ${lane} is not in the landing policy`);
    }
    return lane;
  };

  const resolveModelRef = (ref: { readonly provider?: string; readonly id: string }) =>
    ref.provider === undefined
      ? options.models.getModels().find((candidate) => candidate.id === ref.id)
      : options.models.getModel(ref.provider, ref.id);

  /**
   * The attachment that covers a session. A child is covered by whatever
   * covers its parent: a host that volunteered for a session volunteered for
   * the work that session delegates.
   */
  const selectedAttachment = (id: SessionId, pooled: Pooled): Attachment | undefined => {
    if (pool.closed || pooled.retired) return undefined;
    for (const attachment of attachments) {
      if (attachment.sessions === undefined || attachment.sessions.has(id)) return attachment;
      if (pooled.parent !== undefined && attachment.sessions.has(pooled.parent.sessionId)) {
        return attachment;
      }
    }
    return undefined;
  };

  // The modules reach each other only through these closures, so the order
  // below is free of cycles: nothing is called until every module exists.
  const pool = createSessionPool({
    options,
    hooks: {
      stopRunner: (pooled) => runners.stopRunner(pooled),
      requestAbort: (pooled, name) => runners.requestAbortAtRef(pooled, name),
      closeJobs: (id, pooled) => subagents.jobsFor(id, pooled).close(),
      pluginsFor: (input) => subagents.pluginsFor(input),
    },
  });
  const runners = createRunners({
    options,
    pool,
    landing: {
      ...landing,
      lanes: [
        ...landing.lanes.filter((lane) => lane.lane !== "background"),
        { lane: "background", lands: "boundary" as const },
      ],
    },
    resolveModel: resolveModelRef,
    jobsFor: (id, pooled) => subagents.jobsFor(id, pooled),
    backgroundChild: (id) => subagents.backgroundChild(id),
    covered: (id, pooled) => selectedAttachment(id, pooled) !== undefined,
    reportBackground: (cause) => {
      background.push(cause);
    },
  });
  const subagents = createSubagents({ options, pool, runners, defaultLane });
  const relocation = createRelocation({ options, pool, runners, subagents });
  const summaries = createSummaries({ options, pool, resolveModel: resolveModelRef });
  const reads = createReads({ options, pool, resolveModel: resolveModelRef });

  if (options.resolveActivation === undefined) {
    await options.workspaces?.touch(options.env.cwd);
  }

  return {
    landing,
    advance: runners.advance,
    sessions: {
      async create(input = {}) {
        pool.alive();
        const session = await options.store.create(
          input.sessionId === undefined ? {} : { id: input.sessionId },
        );
        try {
          if (input.name !== undefined) await pool.writeFact(session, NAME_FACT, input.name);
          if (input.parent !== undefined) {
            await pool.writeFact(session, PARENT_FACT, parentValue(input.parent));
            const parent = await pool.open(input.parent.sessionId);
            await pool.resolveSessionActivation(input.parent.sessionId, parent);
            const cwd = await pool.storedCwd(parent.session);
            if (cwd !== undefined) await pool.writeFact(session, CWD_FACT, cwd);
          }
          const pooled = await pool.adopt(session);
          return sessionInfo(await pool.readSession(sessionId(session.id), pooled));
        } catch (error) {
          if (pool.peek(sessionId(session.id)) === undefined)
            await session.close().catch(() => undefined);
          throw error;
        }
      },
      async get(input) {
        pool.alive();
        try {
          const pooled = await pool.open(input.sessionId);
          return sessionInfo(await pool.readSession(input.sessionId, pooled));
        } catch (error) {
          if (error instanceof UnknownSession) return undefined;
          throw error;
        }
      },
      snapshot: reads.snapshot,
      metadata: reads.metadata,
      list: reads.list,
      async rename(input) {
        pool.alive();
        await pool.writeFact((await pool.open(input.sessionId)).session, NAME_FACT, input.name);
      },
      async setPinned(input) {
        pool.alive();
        const session = (await pool.open(input.sessionId)).session;
        const current = await pool.readFact(session, PINNED_FACT);
        if ((input.pinned && current === true) || (!input.pinned && current === undefined)) return;
        await pool.writeFact(session, PINNED_FACT, input.pinned ? true : undefined);
      },
      async setArchived(input) {
        pool.alive();
        const session = (await pool.open(input.sessionId)).session;
        const current = await pool.readFact(session, ARCHIVED_FACT);
        if ((input.archived && current === true) || (!input.archived && current === undefined)) {
          return;
        }
        await pool.writeFact(session, ARCHIVED_FACT, input.archived ? true : undefined);
      },
      async delete(input) {
        pool.alive();
        await pool.retire(input.sessionId, await pool.open(input.sessionId));
      },
      async configure(input): Promise<ConfigureOutcome> {
        pool.alive();
        validateHeadName(input.head ?? MAIN);
        const pooled = await pool.open(input.sessionId);
        if (
          input.model !== undefined &&
          options.models.getModel(input.model.provider, input.model.id) === undefined
        ) {
          return { kind: "unknown_model" };
        }
        if (input.agent !== undefined) {
          const activation = await pool.activationFor(input.sessionId, pooled);
          const known = activation
            ?.agents()
            .some((agent) => agent.id === input.agent && agent.disabled !== true);
          if (known !== true) return { kind: "unknown_agent" };
        }
        const config = { kind: "config" } satisfies CommitBody;
        const withModel = input.model === undefined ? config : { ...config, model: input.model };
        const withThinking =
          input.thinkingLevel === undefined
            ? withModel
            : { ...withModel, thinkingLevel: input.thinkingLevel };
        const body =
          input.agent === undefined ? withThinking : { ...withThinking, agent: input.agent };
        const outcome = await submit(
          pooled.session,
          attributed(
            {
              head: input.head ?? MAIN,
              lane: defaultLane(),
              body,
            },
            options.actor,
          ),
        );
        void (async () => {
          try {
            await runners.reconcileRunner(input.sessionId, pooled);
          } catch (error) {
            background.push(error);
          }
        })();
        return { kind: "queued", change: outcome.change };
      },
    },

    messages: {
      async send(input: SendInput): Promise<SendReceipt> {
        pool.alive();
        const pooled = await pool.open(input.sessionId);
        const { session } = pooled;
        const head = input.head ?? MAIN;
        const lane = input.lane === undefined ? defaultLane() : servedLane(input.lane);
        const message = {
          kind: "message",
          message: { role: "user", content: input.content, timestamp: Date.now() },
        } satisfies CommitBody;
        const submission = attributed(
          {
            head,
            lane,
            body: input.agent === undefined ? message : { ...message, agent: input.agent },
          },
          options.actor,
        );
        const receipt = await submit(
          session,
          input.key === undefined ? submission : { ...submission, key: input.key },
        );
        void (async () => {
          try {
            await runners.reconcileRunner(input.sessionId, pooled);
          } catch (error) {
            background.push(error);
          }
        })();
        return receipt;
      },
      async cancel(input) {
        pool.alive();
        return cancel(
          (await pool.open(input.sessionId)).session,
          attributed({ head: input.head ?? MAIN, change: input.change }, options.actor),
        );
      },
      async redeliver(input) {
        pool.alive();
        return redeliver(
          (await pool.open(input.sessionId)).session,
          attributed(
            {
              head: input.head ?? MAIN,
              change: input.change,
              lane: servedLane(input.lane),
              content: input.content,
              before: input.before,
            },
            options.actor,
          ),
        );
      },
      async list(input) {
        pool.alive();
        const session = (await pool.open(input.sessionId)).session;
        const tip = await session.refs.read(headRef(input.head ?? MAIN));
        return transcriptFromCommits(await branch(session.objects, tip));
      },
      async pending(input): Promise<readonly PendingItem[]> {
        pool.alive();
        return pendingItems(
          await pending((await pool.open(input.sessionId)).session, input.head ?? MAIN),
        );
      },
    },

    jobs: {
      async list(input) {
        const pooled = await pool.open(input.sessionId);
        return subagents.jobsFor(input.sessionId, pooled).list(input.head);
      },
      async start(input) {
        pool.alive();
        const pooled = await pool.open(input.sessionId);
        // Activation registers the jobs wrapper that `start` runs the tool through.
        if ((await pool.activationFor(input.sessionId, pooled)) === undefined)
          throw new Error("This chat is not active");
        return subagents
          .jobsFor(input.sessionId, pooled)
          .start("bash", input.head ?? MAIN, { command: input.command }, input.command);
      },
      async background(input) {
        const pooled = await pool.open(input.sessionId);
        return subagents.jobsFor(input.sessionId, pooled).background(input.jobId);
      },
      async cancel(input) {
        const pooled = await pool.open(input.sessionId);
        return subagents.jobsFor(input.sessionId, pooled).cancel(input.jobId);
      },
    },

    runs: {
      async current(input) {
        pool.alive();
        return pool.currentRun((await pool.open(input.sessionId)).session, input.head ?? MAIN);
      },
      async abort(input): Promise<AbortOutcome> {
        pool.alive();
        if (!Value.Check(OPERATIONS["runs.abort"].input, input)) {
          throw new TypeError("Invalid runs.abort input");
        }
        const pooled = await pool.open(input.sessionId);
        const head = input.head ?? MAIN;
        const runId = await runners.requestAbortAtRef(pooled, runRef(head), input.runId);
        if (runId !== undefined) {
          if (pooled.parent !== undefined) await subagents.interruptChild(input.sessionId);
          else
            await subagents
              .jobsFor(input.sessionId, pooled)
              .interruptOwned({ runId, state: "cancelled" });
        }
        return runId === undefined ? { kind: "not_running" } : { kind: "requested", runId };
      },
      async wait(input): Promise<WaitOutcome> {
        pool.alive();
        if (input.signal?.aborted) return { kind: "cancelled" };
        return waitForHead((await pool.open(input.sessionId)).session, {
          head: input.head ?? MAIN,
          signal: input.signal,
          drain: landing.drain,
        });
      },
      async reply(input): Promise<ReplyOutcome> {
        pool.alive();
        const session = (await pool.open(input.sessionId)).session;
        const runId = input.runId ?? (await pool.readRun(session, input.head ?? MAIN))?.run.id;
        if (runId === undefined) return { kind: "not_found" };
        const outcome = await signalEffect(
          session,
          attributed(
            {
              runId,
              callId: input.callId,
              waitId: input.waitId,
              signal: toJsonValue(input.reply),
            },
            options.actor,
          ),
        );
        return { kind: outcome.kind };
      },
      compact: summaries.compact,
      context: reads.context,
      changes: reads.changes,
    },

    heads: {
      async list(input) {
        pool.alive();
        return pool.projectHeads((await pool.open(input.sessionId)).session);
      },
      async create(input) {
        pool.alive();
        const session = (await pool.open(input.sessionId)).session;
        // The kernel stacks on any name. A parent this session does not list
        // (and is not its default head) is a mistake, caught here.
        const parent = "head" in input.from ? input.from.head : undefined;
        if (
          parent !== undefined &&
          !(await pool.listSessionHeads(session)).some((item) => item.head === parent)
        ) {
          return { kind: "unknown_parent" };
        }
        return createHead(
          session,
          attributed({ head: input.head, from: input.from }, options.actor),
        );
      },
      async move(input): Promise<MoveOutcome> {
        pool.alive();
        try {
          const pooled = await pool.open(input.sessionId);
          const { session } = pooled;
          const head = input.head ?? MAIN;
          // The kernel moves any name. Only heads this session lists, or its
          // default, are moved from here, so a mistyped head is not created.
          if (!(await pool.listSessionHeads(session)).some((item) => item.head === head)) {
            return { kind: "not_found" };
          }
          // Read the tip before the run. A run that starts after this check also
          // advances the tip, so the CAS below rejects that race.
          const tip = await session.refs.read(headRef(head));
          if (input.expect !== undefined && input.expect !== tip) {
            return { kind: "moved_since", tip };
          }
          const running = await pool.readRun(session, head);
          if (running !== undefined && !isTerminalPhase(running.run.phase)) {
            const lease = await session.leases.read(headRef(head));
            return { kind: "busy", run: runInfo(running.run, lease) };
          }

          let selected: { readonly oid: Oid; readonly commit: Commit } | undefined;
          if (input.to !== null) {
            const object = await session.objects.get(input.to);
            if (object?.kind !== "commit") return { kind: "not_found" };
            selected = { oid: input.to, commit: object };
          }
          const target = navigationTarget(selected);
          let summaryOid: Oid | undefined;
          if (input.summary !== undefined) {
            const summarized = await summaries.summarizeAbandoned({
              sessionId: input.sessionId,
              pooled,
              head,
              tip,
              to: input.to,
              parent: target.to,
              customInstructions: input.summary.customInstructions,
            });
            if (summarized.kind === "failed") return summarized;
            summaryOid = summarized.oid;
          }

          const move = attributed(
            { head, to: summaryOid ?? target.to, expect: tip },
            options.actor,
          );
          const moved = await moveHead(session, move);
          switch (moved.kind) {
            case "moved": {
              let outcome: Extract<MoveOutcome, { readonly kind: "moved" }> = {
                kind: "moved",
                from: moved.from,
              };
              if (target.kind === "move") {
                return summaryOid === undefined ? outcome : { ...outcome, summary: summaryOid };
              }
              if (
                target.commit.commit.body.kind !== "message" ||
                target.commit.commit.body.message.role !== "user"
              ) {
                throw new Error(
                  `Navigation restore target is not a user message: ${target.commit.oid}`,
                );
              }
              outcome = {
                ...outcome,
                restored: {
                  commit: target.commit.oid,
                  content: target.commit.commit.body.message.content,
                },
              };
              return summaryOid === undefined ? outcome : { ...outcome, summary: summaryOid };
            }
            case "moved_since":
              return { kind: "moved_since", tip: moved.tip };
            case "not_found":
              return { kind: "not_found" };
            default: {
              const _exhaustive: never = moved;
              return _exhaustive;
            }
          }
        } catch (cause) {
          if (cause instanceof NyteClosed || cause instanceof UnknownSession) throw cause;
          return summaries.summaryFailure("heads.move", cause);
        }
      },
      async delete(input) {
        pool.alive();
        if (input.head === MAIN) throw new TypeError("The default head cannot be deleted");
        return deleteHead(
          (await pool.open(input.sessionId)).session,
          attributed({ head: input.head }, options.actor),
        );
      },
      async merge(input) {
        pool.alive();
        return fastForward(
          (await pool.open(input.sessionId)).session,
          attributed({ head: input.head }, options.actor),
        );
      },
    },

    workspace: {
      async list() {
        pool.alive();
        return (await options.workspaces?.list()) ?? [];
      },
      async forget(input) {
        pool.alive();
        await options.workspaces?.forget(input.path);
      },
      vcs: {
        async status() {
          pool.alive();
          return options.vcs?.status();
        },
        async diff(input) {
          pool.alive();
          return (await options.vcs?.diff(input)) ?? [];
        },
      },
    },

    provider: {
      models: {
        async list(): Promise<readonly ModelInfo[]> {
          pool.alive();
          const models = await options.models.getAvailable();
          return models.map(toModelInfo);
        },
        async default(): Promise<ModelInfo | undefined> {
          pool.alive();
          return toModelInfo(options.model);
        },
      },
    },

    plugins: {
      async catalog() {
        pool.alive();
        return pool.catalogForNewSession();
      },
      async list(input) {
        pool.alive();
        const pooled = await pool.open(input.sessionId);
        const activation = await pool.activationFor(input.sessionId, pooled);
        return activation === undefined ? [] : activation.plugins.list();
      },
      commands: {
        async list(input): Promise<readonly CommandInfo[]> {
          pool.alive();
          const pooled = await pool.open(input.sessionId);
          const activation = await pool.activationFor(input.sessionId, pooled);
          return activation === undefined ? [] : commandInfos(activation);
        },
        async run(input): Promise<CommandOutcome> {
          pool.alive();
          const pooled = await pool.open(input.sessionId);
          const activation = await pool.activationFor(input.sessionId, pooled);
          if (activation === undefined) return { kind: "not_found" };
          if (!activation.commands().has(input.name)) return { kind: "not_found" };
          try {
            const output = await activation.runCommand(input.name, input.argument ?? "");
            if (output === undefined) return { kind: "ran" };
            if (isCommandPrompt(output)) return { kind: "prompt", prompt: output.prompt };
            return { kind: "ran", output };
          } catch (error) {
            return { kind: "failed", message: errorMessage(error) };
          }
        },
      },
      settings: {
        async list(input) {
          pool.alive();
          const pooled = await pool.open(input.sessionId);
          const activation = await pool.activationFor(input.sessionId, pooled);
          return activation === undefined ? [] : activation.listSettings();
        },
        async apply(input): Promise<ApplyOutcome> {
          pool.alive();
          const pooled = await pool.open(input.sessionId);
          const activation = await pool.activationFor(input.sessionId, pooled);
          return activation === undefined
            ? { kind: "not_found" }
            : activation.applySetting(input.id, input.choiceId);
        },
      },
      resources: {
        async list(input) {
          pool.alive();
          const pooled = await pool.open(input.sessionId);
          const activation = await pool.activationFor(input.sessionId, pooled);
          return activation === undefined ? [] : [...activation.resources().values()];
        },
      },
      status: {
        async list(input) {
          pool.alive();
          const pooled = await pool.open(input.sessionId);
          const activation = await pool.activationFor(input.sessionId, pooled);
          return activation === undefined ? [] : activation.statuses();
        },
      },
    },

    async *watch(input): AsyncIterable<SessionEvent> {
      const pooled = await pool.open(input.sessionId);
      yield* watchSession({
        session: pooled.session,
        input,
        subscribe: (listener) => pool.subscribeNotices(pooled, listener),
        activation: async () =>
          clientActivation(await pool.resolveSessionActivation(input.sessionId, pooled)),
      });
    },

    sessionCwd: relocation.sessionCwd,

    relocate: relocation.relocate,

    async setPlugins(next, input) {
      pool.alive();
      if (input !== undefined) {
        const pooled = await pool.open(input.sessionId);
        if (pooled.relocating) throw new Error("Session directory change is in progress");
        const activation = await pool.activationFor(input.sessionId, pooled);
        if (activation === undefined) throw new Error("Session is not active in this host");
        await activation.setPlugins(
          subagents.pluginsFor({ id: input.sessionId, pooled, plugins: next }),
        );
        if (pooled.activationState?.kind === "active") {
          pooled.activationState = { ...pooled.activationState, plugins: next };
        }
        return;
      }
      pool.setPluginsOverride(next);
      for (const [id, pooled] of pool.entries()) {
        if (pooled.relocating) continue;
        await pool.resolveSessionActivation(id, pooled);
        if (pooled.scopedPlugins) continue;
        if (pooled.activationState?.kind === "active") {
          pooled.activationState = { ...pooled.activationState, plugins: next };
        }
        const activation = await pool.activationFor(id, pooled);
        if (activation !== undefined)
          await activation.setPlugins(subagents.pluginsFor({ id, pooled, plugins: next }));
      }
    },

    holdPlugins: () => pool.holdPlugins(),

    /** The host's answer may have changed: ask again for every session it had blocked. */
    async reactivate() {
      pool.alive();
      pool.resetCatalog();
      await Promise.all(
        [...pool.entries()].map(async ([id, pooled]) => {
          if (pooled.activationState?.kind !== "active") {
            // An answer still in flight predates the change; let it land, then discard it.
            await pooled.resolving?.catch(() => undefined);
            pooled.activationState = undefined;
            await pool.resolveSessionActivation(id, pooled);
          }
          await runners.reconcileRunner(id, pooled);
        }),
      );
    },

    attach(input?: AttachOptions): Disposer {
      pool.alive();
      const attachment: Attachment =
        input?.sessions === undefined ? {} : { sessions: new Set(input.sessions) };
      attachments.add(attachment);
      const begin = async (): Promise<void> => {
        // A named attachment also covers the children of what it names, and
        // those are found only by opening the store's sessions and reading
        // their parent link; `reconcileRunner` then keeps the ones it covers.
        const ids = (await options.store.list()).map((item) => sessionId(item.id));
        for (const id of ids) {
          if (!attachments.has(attachment)) return;
          try {
            await runners.reconcileRunner(id, await pool.open(id));
          } catch (error) {
            if (error instanceof UnknownSession) continue;
            throw error;
          }
        }
      };
      void begin().catch((cause: unknown) => {
        if (cause instanceof NyteClosed || !attachments.has(attachment)) return;
        background.push(cause);
      });
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        attachments.delete(attachment);
        for (const [id, pooled] of pool.entries()) {
          if (selectedAttachment(id, pooled) !== undefined) continue;
          const runner = pooled.runner;
          pooled.runner = undefined;
          runner?.();
        }
      };
    },

    async close() {
      if (pool.closed) return;
      pool.markClosed();
      attachments.clear();
      for (const [, pooled] of pool.entries()) {
        if (pooled.runner === undefined) continue;
        pooled.runner();
        pooled.runner = undefined;
      }
      const errors: unknown[] = [];
      for (const [, pooled] of pool.entries()) {
        await pooled.jobs?.close().catch((cause: unknown) => errors.push(cause));
      }
      errors.push(...(await runners.settle()));
      for (const [, pooled] of pool.entries()) await pooled.reconciliation;
      for (const [, pooled] of pool.entries()) {
        await pooled.opening?.catch(() => undefined);
        await pooled.activation?.close().catch((cause: unknown) => errors.push(cause));
        await pooled.session.close().catch((cause: unknown) => errors.push(cause));
      }
      pool.clear();
      errors.push(...background.splice(0));
      if (errors.length > 0) throw new AggregateError(errors, "Failed to close nyte");
    },
  };
}
