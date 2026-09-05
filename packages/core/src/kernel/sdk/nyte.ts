/**
 * The plain-data SDK over the kernel. Conversation behavior stays in kernel
 * verbs; this file pools session handles, supplies host activation, and
 * volunteers event-driven runners when a host attaches.
 */
import { createHash, randomUUID } from "node:crypto";
import type { JsonValue } from "@nyte-ai/schema";
import {
  DEFAULT_COMPACTION_SETTINGS,
  summarizeBranch,
  summaryCommit,
  writeCheckpoint,
  type SummarizeBranchInput,
  type WriteCheckpointInput,
} from "../compaction.ts";
import { branch, contextCommits, history } from "../graph.ts";
import { hashObject } from "../hash.ts";
import { listEffects, signalEffect } from "../effects.ts";
import type { Actor, Commit, CommitBody, Event, Oid, RefName, Run, RunPhase } from "../model.ts";
import {
  DELETED_REF,
  FACT_PREFIX,
  factRef,
  parseHeadRef,
  headRef,
  isHeadName,
  parseQueueRef,
  runRef,
} from "../names.ts";
import { cancel, pending, redeliver, submit } from "../queue.ts";
import {
  createHead,
  deleteHead,
  fastForward,
  listHeads,
  moveHead,
  stackStatus,
  type ListedHead,
} from "../stacks.ts";
import { drive } from "../step.ts";
import type { Session } from "../store.ts";
import { UnknownSession as StoreUnknownSession } from "../store.ts";
import {
  changesFromTurns,
  collectAbandoned,
  navigationTarget,
  projectContextStatus,
  transcriptFromCommits,
} from "../views/index.ts";
import { branchConfig, contextMessages } from "../context.ts";
import { toJsonValue } from "../json.ts";
import { inlinePlugin, isCommandPrompt, type LoadedPlugin } from "../../plugins/types.ts";
import {
  SUBAGENTS_PLUGIN_ID,
  subagentsPlugin,
  type SubagentHost,
  type SubagentState,
} from "../../plugins/builtin/subagents.ts";
import {
  activate,
  resolveTurnConfig,
  turnFor,
  type Activation,
  type Notice,
} from "./activation.ts";
import { projectEvent } from "./events.ts";
import { providerCompactionFor, requestStream } from "./requests.ts";
import {
  ARCHIVED_FACT,
  NAME_FACT,
  PARENT_FACT,
  PINNED_FACT,
  headConfig,
  headInfo,
  parentFromFact,
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
  type ActiveSessionActivation,
  type ActivationTarget,
  type ApplyOutcome,
  type AttachOptions,
  type CommandInfo,
  type CommandOutcome,
  type CompactOutcome,
  type ConfigureOutcome,
  type Disposer,
  type HeadInfo,
  type HeadName,
  type ModelInfo,
  type MoveOutcome,
  type Nyte,
  type NyteOptions,
  type ParkedCall,
  type PendingItem,
  type PluginCatalog,
  type ReplyOutcome,
  type RunInfo,
  type SendInput,
  type SendReceipt,
  type SessionActivation,
  type SessionActivationResolver,
  type SessionEvent,
  type SessionId,
  type SessionInfo,
  type SessionParent,
  type WaitOutcome,
} from "./types.ts";

const RUN_PREFIX = "refs/runs/";
const EFFECT_PREFIX = "refs/effects/";
const RUNNER_RESTART_DELAY_MS = 1000;

type ActivationSource =
  | { readonly kind: "static"; readonly activation: ActiveSessionActivation }
  | { readonly kind: "resolver"; readonly resolve: SessionActivationResolver };

interface Pooled {
  readonly session: Session;
  /** The durable parent link, read once at adoption; a child's coverage follows its parent's. */
  readonly parent: SessionParent | undefined;
  activation?: Activation;
  opening?: Promise<Activation | undefined>;
  runner?: Disposer;
  retired: boolean;
}

interface Attachment {
  readonly sessions?: ReadonlySet<SessionId>;
}

interface DriveState {
  dirty: boolean;
  controller?: AbortController;
  runId?: string;
  running?: Promise<void>;
}

type NoticeListener = (notice: Notice) => void | Promise<void>;

function childSessionId(parent: SessionId, runId: string, callId: string): SessionId {
  const digest = createHash("sha256").update([parent, runId, callId].join("\u0000")).digest("hex");
  return sessionId(`s_child_${digest.slice(0, 16)}`);
}

function attributed<const Input extends object>(input: Input, actor: Actor | undefined) {
  return actor === undefined ? input : { ...input, actor };
}

async function untilLeaseReleased(session: Session, name: string): Promise<boolean> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if ((await session.leases.read(name)) === undefined) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

function isTerminal(phase: RunPhase): boolean {
  switch (phase.kind) {
    case "done":
    case "aborted":
    case "failed":
      return true;
    case "respond":
    case "tools":
    case "waiting":
    case "retry":
      return false;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function matches(info: SessionInfo, search: string): boolean {
  const needle = search.toLowerCase();
  return (
    (info.name ?? "").toLowerCase().includes(needle) ||
    (info.preview ?? "").toLowerCase().includes(needle)
  );
}

function toModelInfo(model: {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly contextWindow: number;
}): ModelInfo {
  return {
    id: model.id,
    provider: model.provider,
    name: model.name,
    contextWindow: model.contextWindow,
  };
}

function pluginCatalog(activation: Activation): Pick<PluginCatalog, "commands" | "skills"> {
  return {
    commands: [...activation.commands()].map(([name, command]) => ({
      name,
      owner: activation.commandOwner(name) ?? "",
      description: command.description,
    })),
    skills: [...activation.resources().values()],
  };
}

function headFromRunRef(name: RefName): HeadName | undefined {
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

function parentValue(parent: SessionParent): JsonValue {
  return {
    sessionId: parent.sessionId,
    runId: parent.runId,
    callId: parent.callId,
    agent: parent.agent,
    depth: parent.depth,
  };
}

function noticeEvent(notice: Notice, seq: number): SessionEvent {
  switch (notice.kind) {
    case "diagnostic":
      return {
        seq,
        kind: "diagnostic",
        owner: notice.owner,
        level: notice.level,
        message: notice.message,
      };
    case "plugins_changed":
      return { seq, kind: "plugins_changed", plugins: notice.plugins };
    case "notification": {
      const base = {
        seq,
        kind: "notification",
        owner: notice.owner,
        message: notice.message,
        sound: notice.sound === true,
      } as const;
      return notice.title === undefined ? base : { ...base, title: notice.title };
    }
    case "status_changed":
      return { seq, kind: "status_changed", items: notice.items };
    default: {
      const _exhaustive: never = notice;
      return _exhaustive;
    }
  }
}

/** Compose the host services into the kernel SDK. */
export async function createNyte(options: NyteOptions): Promise<Nyte> {
  const pool = new Map<SessionId, Pooled>();
  const attachments = new Set<Attachment>();
  const reconciliations = new Map<SessionId, Promise<void>>();
  const runnerDone = new WeakMap<Disposer, Promise<void>>();
  const runnerTasks = new Map<SessionId, Set<Promise<void>>>();
  const driveStates = new Map<SessionId, Map<HeadName, DriveState>>();
  const noticeListeners = new Map<SessionId, Set<NoticeListener>>();
  const background: unknown[] = [];
  const activationSource: ActivationSource =
    options.resolveActivation === undefined
      ? {
          kind: "static",
          activation: { kind: "active", plugins: options.plugins, env: options.env },
        }
      : { kind: "resolver", resolve: options.resolveActivation };
  let pluginsOverride =
    activationSource.kind === "static" ? activationSource.activation.plugins : undefined;
  let catalogCache: Promise<PluginCatalog> | undefined;
  let closed = false;
  const landing = options.landing ?? DEFAULT_LANDING;

  const alive = (): void => {
    if (closed) throw new NyteClosed();
  };

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

  const resolveHostActivation = async (target: ActivationTarget): Promise<SessionActivation> => {
    const resolved =
      activationSource.kind === "static"
        ? activationSource.activation
        : await activationSource.resolve(target);
    if (resolved.kind === "inactive" || pluginsOverride === undefined) return resolved;
    return { ...resolved, plugins: pluginsOverride };
  };

  const catalogForNewSession = (): Promise<PluginCatalog> => {
    if (catalogCache !== undefined) return catalogCache;
    const opening = (async (): Promise<PluginCatalog> => {
      const resolved = await resolveHostActivation({ kind: "new-session" });
      if (closed) throw new NyteClosed();
      if (resolved.kind === "inactive")
        return { plugins: [], commands: [], skills: [], settings: [] };
      const activation = await activate({
        target: { kind: "new-session" },
        plugins: resolved.plugins,
        env: resolved.env,
      });
      try {
        if (closed) throw new NyteClosed();
        return {
          ...pluginCatalog(activation),
          plugins: activation.plugins.list(),
          settings: await activation.listSettings(),
        };
      } finally {
        await activation.close();
      }
    })();
    catalogCache = opening;
    void opening.catch(() => {
      if (catalogCache === opening) catalogCache = undefined;
    });
    return opening;
  };

  const dispatchNotice = async (id: SessionId, notice: Notice): Promise<void> => {
    const listeners = noticeListeners.get(id);
    if (listeners === undefined) return;
    for (const listener of listeners) await listener(notice);
  };

  const subscribeNotices = (id: SessionId, listener: NoticeListener): Disposer => {
    const listeners = noticeListeners.get(id);
    if (listeners === undefined) noticeListeners.set(id, new Set([listener]));
    else listeners.add(listener);
    return () => {
      const current = noticeListeners.get(id);
      current?.delete(listener);
      if (current?.size === 0) noticeListeners.delete(id);
    };
  };

  const readFact = async (session: Session, key: string): Promise<JsonValue | undefined> => {
    const name = factRef(key);
    const oid = await session.refs.read(name);
    if (oid === null) return undefined;
    const object = await session.objects.get(oid);
    if (object?.kind !== "blob") throw new Error(`Corrupt fact ref ${name} at ${oid}`);
    return object.value;
  };

  const writeBlobRef = async (
    session: Session,
    name: RefName,
    value: JsonValue | undefined,
    reason: string,
  ): Promise<void> => {
    const next =
      value === undefined
        ? null
        : ((await session.objects.put([{ kind: "blob", value }]))[0] ?? null);
    if (value !== undefined && next === null) throw new Error(`Writing ${name} returned no oid`);
    for (;;) {
      const current = await session.refs.read(name);
      if (current === next) return;
      const outcome = await session.refs.update(
        [{ name, from: current, to: next }],
        attributed({ reason }, options.actor),
      );
      if (outcome.ok) return;
      switch (outcome.reason) {
        case "conflict":
          continue;
        case "fenced":
          throw new Error(`Participant update was unexpectedly fenced: ${name}`);
        default: {
          const _exhaustive: never = outcome;
          return _exhaustive;
        }
      }
    }
  };

  const writeFact = (session: Session, key: string, value: JsonValue | undefined): Promise<void> =>
    writeBlobRef(session, factRef(key), value, "fact");

  const readFacts = async (session: Session): Promise<ReadonlyMap<string, JsonValue>> => {
    const facts = new Map<string, JsonValue>();
    for (const ref of await session.refs.list(FACT_PREFIX)) {
      const object = await session.objects.get(ref.oid);
      if (object?.kind !== "blob") {
        throw new Error(`Corrupt fact ref ${ref.name} at ${ref.oid}`);
      }
      facts.set(ref.name.slice(FACT_PREFIX.length), object.value);
    }
    return facts;
  };

  const readRun = async (
    session: Session,
    head: HeadName,
  ): Promise<{ readonly oid: Oid; readonly run: Run } | undefined> => {
    const oid = await session.refs.read(runRef(head));
    if (oid === null) return undefined;
    const object = await session.objects.get(oid);
    if (object?.kind !== "run") throw new Error(`Corrupt run ref ${runRef(head)} at ${oid}`);
    return { oid, run: object };
  };

  const currentRun = async (session: Session, head: HeadName): Promise<RunInfo | undefined> => {
    const stored = await readRun(session, head);
    if (stored === undefined) return undefined;
    const lease = await session.leases.read(headRef(head));
    return runInfo(stored.run, lease);
  };

  /** The run's calls still parked for a reply. A finished run has none. */
  const parkedCalls = async (session: Session, run: RunInfo): Promise<ParkedCall[]> => {
    if (isTerminal(run.phase)) return [];
    const views = await listEffects(session, run.runId);
    return views.flatMap((view) =>
      view.effect.state === "waiting"
        ? [
            {
              runId: run.runId,
              callId: view.intent.callId,
              tool: view.intent.tool,
              args: view.intent.args,
            },
          ]
        : [],
    );
  };

  /** The kernel lists heads by ref. This SDK's default head is addressable before it has one, and comes first. */
  const listSessionHeads = async (session: Session): Promise<ListedHead[]> => {
    const listed = await listHeads(session);
    const first = listed.find((item) => item.head === MAIN) ?? { head: MAIN, tip: null };
    return [first, ...listed.filter((item) => item.head !== MAIN)];
  };

  const projectHeads = async (
    session: Session,
    listed?: readonly ListedHead[],
  ): Promise<HeadInfo[]> => {
    const heads = listed ?? (await listSessionHeads(session));
    return Promise.all(
      heads.map(async (item) => {
        const [status, run] = await Promise.all([
          stackStatus(session, item.head),
          currentRun(session, item.head),
        ]);
        switch (status.kind) {
          case "no_stack":
            return headInfo(item, null, run);
          case "current":
          case "stale":
            return headInfo(item, status.parentTip, run);
          default: {
            const _exhaustive: never = status;
            return _exhaustive;
          }
        }
      }),
    );
  };

  const mainCommits = async (session: Session, tip: Oid | null): Promise<Commit[]> => {
    const commits: Commit[] = [];
    for await (const item of history(session.objects, tip)) {
      commits.push(item.commit);
    }
    commits.reverse();
    return commits;
  };

  const createdAtFor = async (id: SessionId): Promise<number> => {
    const stored = (await options.store.list()).find((item) => item.id === id);
    if (stored === undefined) throw new UnknownSession(id);
    return stored.createdAt;
  };

  const projectSession = async (
    id: SessionId,
    session: Session,
    knownCreatedAt?: number,
  ): Promise<SessionInfo> => {
    const listed = await listSessionHeads(session);
    const mainTip = listed.find((item) => item.head === MAIN)?.tip ?? null;
    const [createdAt, heads, facts, commits] = await Promise.all([
      knownCreatedAt ?? createdAtFor(id),
      projectHeads(session, listed),
      readFacts(session),
      mainCommits(session, mainTip),
    ]);
    return sessionInfo({ id, createdAt, heads, facts, mainCommits: commits });
  };

  /**
   * The attachment that covers a session. A child is covered by whatever
   * covers its parent: a host that volunteered for a session volunteered for
   * the work that session delegates.
   */
  const selectedAttachment = (id: SessionId, pooled: Pooled): Attachment | undefined => {
    if (closed || pooled.retired) return undefined;
    for (const attachment of attachments) {
      if (attachment.sessions === undefined || attachment.sessions.has(id)) return attachment;
      if (pooled.parent !== undefined && attachment.sessions.has(pooled.parent.sessionId)) {
        return attachment;
      }
    }
    return undefined;
  };

  const pluginsFor = (
    id: SessionId,
    pooled: Pooled,
    plugins: readonly LoadedPlugin[],
  ): readonly LoadedPlugin[] => {
    const hostPlugins = plugins.filter((plugin) => plugin.id !== SUBAGENTS_PLUGIN_ID);
    return pooled.parent === undefined
      ? [...hostPlugins, inlinePlugin(subagentsPlugin(subagentHost(id, pooled)))]
      : hostPlugins;
  };

  const activationFor = (id: SessionId, pooled: Pooled): Promise<Activation | undefined> => {
    if (closed) return Promise.reject(new NyteClosed());
    if (pooled.retired) return Promise.reject(new UnknownSession(id));
    if (pooled.activation !== undefined) return Promise.resolve(pooled.activation);
    if (pooled.opening !== undefined) return pooled.opening;

    const opening = (async (): Promise<Activation | undefined> => {
      const resolved = await resolveHostActivation({ kind: "session", sessionId: id });
      if (closed || pooled.retired) throw closed ? new NyteClosed() : new UnknownSession(id);
      if (resolved.kind === "inactive") return undefined;
      const built = await activate({
        target: { kind: "session", session: pooled.session },
        plugins: pluginsFor(id, pooled, resolved.plugins),
        env: resolved.env,
      });
      if (closed || pooled.retired) {
        await built.close();
        throw closed ? new NyteClosed() : new UnknownSession(id);
      }
      built.subscribe((notice) => dispatchNotice(id, notice));
      pooled.activation = built;
      // Activation's first inventory notice fires before activate() returns.
      // Relay the resulting inventory to watches that were already open.
      const plugins = built.plugins.list();
      if (plugins.length > 0) {
        await dispatchNotice(id, { kind: "plugins_changed", plugins });
      }
      return built;
    })().finally(() => {
      if (pooled.opening === opening) pooled.opening = undefined;
    });
    pooled.opening = opening;
    return opening;
  };

  const activeFor = async (id: SessionId): Promise<Activation> => {
    const pooled = await openPooled(id);
    const active = await activationFor(id, pooled);
    if (active === undefined) throw new Error(`Session is not active in this host: ${id}`);
    return active;
  };

  const resolveBranchTurn = async (
    id: SessionId,
    pooled: Pooled,
    commits: readonly { readonly oid: Oid; readonly commit: Commit }[],
  ) => {
    const activation = await activationFor(id, pooled);
    if (activation === undefined) throw new Error(`Session is not active in this host: ${id}`);
    const defaults = { model: options.model, resolveModel: resolveModelRef };
    return resolveTurnConfig(
      activation,
      options.thinkingLevel === undefined
        ? defaults
        : { ...defaults, thinkingLevel: options.thinkingLevel },
      branchConfig(commits.map((item) => item.commit)),
    );
  };

  const emitRunnerDiagnostic = async (session: Session, cause: unknown): Promise<void> => {
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
  };

  const runAtRef = async (session: Session, oid: Oid | null): Promise<Run | undefined> => {
    if (oid === null) return undefined;
    const object = await session.objects.get(oid);
    if (object?.kind !== "run") throw new Error(`Corrupt run object at ${oid}`);
    return object;
  };

  const headForRun = async (session: Session, runId: string): Promise<HeadName | undefined> => {
    for (const ref of await session.refs.list(RUN_PREFIX)) {
      const run = await runAtRef(session, ref.oid);
      if (run?.id !== runId) continue;
      return headFromRunRef(ref.name);
    }
    return undefined;
  };

  const createRunner = (id: SessionId, pooled: Pooled, activation: Activation): Disposer => {
    const stop = new AbortController();
    const states = new Map<HeadName, DriveState>();
    driveStates.set(id, states);
    const tasks = new Set<Promise<void>>();
    const bound = turnFor(activation, {
      streamFn: options.streamFn,
      model: options.model,
      resolveModel: resolveModelRef,
      thinkingLevel: options.thinkingLevel,
      streamOptions: options.streamOptions,
      compaction: options.compaction,
    });
    let stopped = false;

    const stateFor = (head: HeadName): DriveState => {
      const found = states.get(head);
      if (found !== undefined) return found;
      const state: DriveState = { dirty: false };
      states.set(head, state);
      return state;
    };

    const readActiveRunId = async (head: HeadName): Promise<string | undefined> => {
      const stored = await readRun(pooled.session, head);
      return stored !== undefined && !isTerminal(stored.run.phase) ? stored.run.id : undefined;
    };

    const wake = (head: HeadName): void => {
      if (stopped || pooled.retired) return;
      const state = stateFor(head);
      state.dirty = true;
      if (state.running !== undefined) return;

      let task: Promise<void>;
      task = (async () => {
        try {
          while (state.dirty && !stopped && !pooled.retired) {
            state.dirty = false;
            const controller = new AbortController();
            state.controller = controller;
            state.runId = await readActiveRunId(head);
            try {
              const outcome = await drive(pooled.session, bound.turn, {
                head,
                landing,
                signal: controller.signal,
                steps: (run) => bound.stepsFor(run),
                resolveConfig: bound.resolveConfig,
              });
              if (outcome.kind === "busy") return;
              if (!stopped && !pooled.retired) {
                await settleDelegations(
                  id,
                  pooled,
                  head,
                  outcome.kind === "waiting" ? outcome.run : undefined,
                );
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

    const inspectRunEvent = async (head: HeadName, event: Event): Promise<void> => {
      if (event.kind !== "ref" || event.name !== runRef(head)) return;
      const run = await runAtRef(pooled.session, event.to);
      if (run === undefined) return;
      const state = states.get(head);
      if (state?.controller === undefined) return;
      if (state.runId === undefined) state.runId = run.id;
      if (state.runId === run.id && run.abortRequested === true) state.controller.abort();
    };

    const handleRef = async (event: Extract<Event, { readonly kind: "ref" }>): Promise<void> => {
      const directHead =
        parseHeadRef(event.name) ?? queueHead(event.name) ?? headFromRunRef(event.name);
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
        for (const item of await listSessionHeads(pooled.session)) wake(item.head);
        for await (const event of watching) {
          if (event.kind === "ref") await handleRef(event);
        }
      } catch (error) {
        if (!stopped && !pooled.retired) await emitRunnerDiagnostic(pooled.session, error);
      } finally {
        for (const state of states.values()) state.controller?.abort();
        await Promise.all([...tasks].map((task) => task.catch(() => undefined)));
        if (driveStates.get(id) === states) driveStates.delete(id);
      }
    };

    const done = loop();
    const sessionTasks = runnerTasks.get(id);
    if (sessionTasks === undefined) runnerTasks.set(id, new Set([done]));
    else sessionTasks.add(done);
    const dispose = (): void => {
      if (stopped) return;
      stopped = true;
      stop.abort();
      for (const state of states.values()) state.controller?.abort();
    };
    runnerDone.set(dispose, done);
    void done.then(async () => {
      const activeTasks = runnerTasks.get(id);
      activeTasks?.delete(done);
      if (activeTasks?.size === 0) runnerTasks.delete(id);
      if (pooled.runner !== dispose) return;
      pooled.runner = undefined;
      // A loop nobody stopped ended on a fault. Give the fault time to clear;
      // restarting at once would spin, writing one diagnostic per turn.
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, RUNNER_RESTART_DELAY_MS));
      if (closed || pooled.retired || pooled.runner !== undefined) return;
      if (selectedAttachment(id, pooled) !== undefined) {
        await reconcileRunner(id, pooled).catch((cause: unknown) => background.push(cause));
      }
    });
    return dispose;
  };

  const stopRunner = async (pooled: Pooled): Promise<void> => {
    const runner = pooled.runner;
    if (runner === undefined) return;
    pooled.runner = undefined;
    runner();
    await runnerDone.get(runner)?.catch(() => undefined);
  };

  function reconcileRunner(id: SessionId, pooled: Pooled): Promise<void> {
    const prior = reconciliations.get(id) ?? Promise.resolve();
    const task = prior
      .catch(() => undefined)
      .then(async () => {
        const wanted = selectedAttachment(id, pooled);
        if (wanted === undefined) {
          await stopRunner(pooled);
          return;
        }
        if (pooled.runner !== undefined) return;
        const activation = await activationFor(id, pooled);
        const current = selectedAttachment(id, pooled);
        if (activation === undefined || current === undefined) return;
        pooled.runner = createRunner(id, pooled, activation);
      });
    reconciliations.set(
      id,
      task.catch(() => undefined),
    );
    return task;
  }

  const adopt = async (session: Session): Promise<Pooled> => {
    const id = sessionId(session.id);
    const existing = pool.get(id);
    if (closed || existing !== undefined) {
      await session.close().catch(() => undefined);
      if (closed || existing === undefined) throw new NyteClosed();
      if (existing.retired) throw new UnknownSession(id);
      return existing;
    }
    const parent = parentFromFact(await readFact(session, PARENT_FACT));
    // Another opener or shutdown may have won while the parent fact was read.
    const winner = pool.get(id);
    if (closed || winner !== undefined) {
      await session.close();
      if (closed) throw new NyteClosed();
      if (winner === undefined || winner.retired) throw new UnknownSession(id);
      return winner;
    }
    const pooled: Pooled = { session, parent, retired: false };
    pool.set(id, pooled);
    await reconcileRunner(id, pooled);
    return pooled;
  };

  async function openPooled(id: SessionId): Promise<Pooled> {
    alive();
    const existing = pool.get(id);
    if (existing !== undefined) {
      if (existing.retired) throw new UnknownSession(id);
      return existing;
    }
    try {
      return await adopt(await options.store.open(id));
    } catch (error) {
      if (error instanceof NyteClosed || error instanceof UnknownSession) throw error;
      if (error instanceof StoreUnknownSession) throw new UnknownSession(id);
      throw error;
    }
  }

  const requestAbortAtRef = async (
    id: SessionId,
    session: Session,
    name: RefName,
  ): Promise<string | undefined> => {
    for (;;) {
      const oid = await session.refs.read(name);
      if (oid === null) return undefined;
      const run = await runAtRef(session, oid);
      if (run === undefined || isTerminal(run.phase)) return undefined;
      const head = headFromRunRef(name);
      if (run.abortRequested === true) {
        if (head !== undefined) abortLocalDrive(id, head, run.id);
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
        if (head !== undefined) abortLocalDrive(id, head, run.id);
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

  function abortLocalDrive(id: SessionId, head: HeadName, runId: string): void {
    const state = driveStates.get(id)?.get(head);
    if (state?.controller === undefined) return;
    if (state.runId === undefined || state.runId === runId) state.controller.abort();
  }

  /** A child by the parent call that created it. */
  const openChild = async (
    parent: SessionId,
    runId: string,
    callId: string,
  ): Promise<{ readonly id: SessionId; readonly pooled: Pooled } | undefined> => {
    const id = childSessionId(parent, runId, callId);
    try {
      return { id, pooled: await openPooled(id) };
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

  const childState = async (id: SessionId, session: Session): Promise<SubagentState> => {
    const stored = await readRun(session, MAIN);
    if (stored === undefined) return { kind: "running", childSessionId: id };
    switch (stored.run.phase.kind) {
      case "done":
        return {
          kind: "completed",
          childSessionId: id,
          text: await childResultText(session),
        };
      case "failed":
        return {
          kind: "failed",
          childSessionId: id,
          error: stored.run.phase.error,
        };
      case "aborted":
        return { kind: "aborted", childSessionId: id };
      case "respond":
      case "tools":
      case "waiting":
      case "retry":
        return { kind: "running", childSessionId: id };
      default: {
        const _exhaustive: never = stored.run.phase;
        return _exhaustive;
      }
    }
  };

  const signalParent = async (
    parent: Pick<SessionParent, "sessionId" | "runId" | "callId">,
    child: SessionId,
  ): Promise<void> => {
    let pooled: Pooled;
    try {
      pooled = await openPooled(parent.sessionId);
    } catch (error) {
      if (error instanceof UnknownSession) return;
      throw error;
    }
    await signalEffect(
      pooled.session,
      attributed(
        {
          runId: parent.runId,
          callId: parent.callId,
          signal: { kind: "child", sessionId: child },
        },
        options.actor,
      ),
    );
  };

  /** Find the durable intent the runner wrote before calling `task.execute`. */
  const runForCall = async (session: Session, callId: string): Promise<string | undefined> => {
    const runIds = new Set(
      (await session.refs.list(EFFECT_PREFIX)).flatMap((ref) => {
        const runId = effectRunId(ref.name);
        return runId === undefined ? [] : [runId];
      }),
    );
    for (const runId of runIds) {
      if ((await listEffects(session, runId)).some((view) => view.intent.callId === callId)) {
        return runId;
      }
    }
    return undefined;
  };

  const subagentHost = (id: SessionId, pooled: Pooled): SubagentHost => ({
    async spawn(input) {
      if (pooled.parent !== undefined) return { kind: "depth_exceeded" };
      const runId = await runForCall(pooled.session, input.callId);
      if (runId === undefined) throw new Error(`No run owns task call ${input.callId}`);
      const existing = await openChild(id, runId, input.callId);
      if (existing !== undefined) {
        return { kind: "spawned", childSessionId: existing.id };
      }

      const childId = childSessionId(id, runId, input.callId);
      const parent: SessionParent = {
        sessionId: id,
        runId,
        callId: input.callId,
        agent: input.agent,
        depth: 1,
      };
      const session = await options.store.create({ id: childId });
      try {
        await writeFact(session, PARENT_FACT, parentValue(parent));
        await adopt(session);
      } catch (error) {
        if (!pool.has(childId)) await session.close().catch(() => undefined);
        throw error;
      }
      await submit(
        session,
        attributed(
          {
            head: MAIN,
            lane: defaultLane(),
            body: { kind: "config", agent: input.agent } satisfies CommitBody,
          },
          options.actor,
        ),
      );
      await submit(
        session,
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
      return { kind: "spawned", childSessionId: childId };
    },
    async state(input) {
      const child = await openChild(id, input.runId, input.callId);
      if (child === undefined) {
        return {
          kind: "failed",
          childSessionId: childSessionId(id, input.runId, input.callId),
          error: "The delegated session no longer exists.",
        };
      }
      return childState(child.id, child.pooled.session);
    },
    async abort(input) {
      const child = await openChild(id, input.runId, input.callId);
      if (child !== undefined) {
        await requestAbortAtRef(child.id, child.pooled.session, runRef(MAIN));
      }
    },
  });

  /** Notify a parent, and close the race where a child finished before its call parked. */
  const settleDelegations = async (
    id: SessionId,
    pooled: Pooled,
    head: HeadName,
    waitingRun?: Run,
  ): Promise<void> => {
    const childRun = head === MAIN ? await readRun(pooled.session, MAIN) : undefined;
    if (pooled.parent !== undefined && childRun !== undefined && isTerminal(childRun.run.phase)) {
      await signalParent(pooled.parent, id);
    }
    if (waitingRun === undefined) return;
    for (const effect of await listEffects(pooled.session, waitingRun.id)) {
      if (effect.effect.state !== "waiting") continue;
      const child = await openChild(id, waitingRun.id, effect.intent.callId);
      if (child === undefined) continue;
      const run = await readRun(child.pooled.session, MAIN);
      if (run === undefined || !isTerminal(run.run.phase)) continue;
      await signalParent(
        { sessionId: id, runId: waitingRun.id, callId: effect.intent.callId },
        child.id,
      );
    }
  };

  const contextFor = async (session: Session, head: HeadName) => {
    const tip = await session.refs.read(headRef(head));
    const [commits, context, run] = await Promise.all([
      branch(session.objects, tip),
      contextCommits(session.objects, tip),
      currentRun(session, head),
    ]);
    const config = headConfig(
      commits.map((item) => item.commit),
      run,
    );
    const model = config.model === undefined ? undefined : resolveModelRef(config.model);
    return {
      tip,
      commits,
      run,
      config,
      status: projectContextStatus(
        context.map((item) => item.commit),
        model?.contextWindow ?? 0,
        model === undefined
          ? undefined
          : { provider: model.provider, api: model.api, model: model.id },
      ),
    };
  };

  if (activationSource.kind === "static") {
    await options.workspaces?.touch(activationSource.activation.env.cwd);
  }

  return {
    landing,
    sessions: {
      async create(input = {}) {
        alive();
        const session = await options.store.create(
          input.sessionId === undefined ? {} : { id: input.sessionId },
        );
        try {
          if (input.name !== undefined) await writeFact(session, NAME_FACT, input.name);
          if (input.parent !== undefined) {
            await writeFact(session, PARENT_FACT, parentValue(input.parent));
          }
          const pooled = await adopt(session);
          return projectSession(sessionId(session.id), pooled.session);
        } catch (error) {
          if (!pool.has(sessionId(session.id))) await session.close().catch(() => undefined);
          throw error;
        }
      },
      async get(input) {
        alive();
        try {
          const pooled = await openPooled(input.sessionId);
          return await projectSession(input.sessionId, pooled.session);
        } catch (error) {
          if (error instanceof UnknownSession) return undefined;
          throw error;
        }
      },
      async snapshot(input) {
        alive();
        try {
          const pooled = await openPooled(input.sessionId);
          const { session } = pooled;
          // Read the cursor first. A commit may land before the remaining reads,
          // so a watch from this seq can replay a commit already in the snapshot.
          // appendTranscriptCommit returns undefined and the client refolds.
          const seq = await session.events.last();
          const head = input.head ?? MAIN;
          const [info, projected, pendingChanges] = await Promise.all([
            projectSession(input.sessionId, session),
            contextFor(session, head),
            pending(session, head),
          ]);
          const { run } = projected;
          const parked = run === undefined ? [] : await parkedCalls(session, run);
          const snapshot = {
            seq,
            session: info,
            head,
            tip: projected.tip,
            config: projected.config,
            transcript: transcriptFromCommits(projected.commits),
            pending: pendingItems(pendingChanges),
            context: projected.status,
          };
          const withRun = run === undefined ? snapshot : { ...snapshot, run };
          return parked.length === 0 ? withRun : { ...withRun, parked };
        } catch (error) {
          if (error instanceof UnknownSession) return undefined;
          throw error;
        }
      },
      async list(input = {}) {
        alive();
        const all = await options.store.list();
        const parsed = input.cursor === undefined ? 0 : Number.parseInt(input.cursor, 10);
        const start = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
        const limit = input.limit ?? all.length;
        const items: SessionInfo[] = [];
        let index = start;
        for (; index < all.length && items.length < limit; index += 1) {
          const stored = all[index];
          if (stored === undefined) continue;
          const id = sessionId(stored.id);
          try {
            const pooled = await openPooled(id);
            const info = await projectSession(id, pooled.session, stored.createdAt);
            if (info.archived && input.includeArchived !== true) continue;
            if (input.search !== undefined && !matches(info, input.search)) continue;
            if (input.parent === null && info.parent !== undefined) continue;
            if (
              input.parent !== undefined &&
              input.parent !== null &&
              info.parent?.sessionId !== input.parent
            ) {
              continue;
            }
            items.push(info);
          } catch (error) {
            if (error instanceof UnknownSession) continue;
            throw error;
          }
        }
        return index < all.length ? { items, next: String(index) } : { items };
      },
      async rename(input) {
        alive();
        await writeFact((await openPooled(input.sessionId)).session, NAME_FACT, input.name);
      },
      async setPinned(input) {
        alive();
        const session = (await openPooled(input.sessionId)).session;
        const current = await readFact(session, PINNED_FACT);
        if ((input.pinned && current === true) || (!input.pinned && current === undefined)) return;
        await writeFact(session, PINNED_FACT, input.pinned ? true : undefined);
      },
      async setArchived(input) {
        alive();
        const session = (await openPooled(input.sessionId)).session;
        const current = await readFact(session, ARCHIVED_FACT);
        if ((input.archived && current === true) || (!input.archived && current === undefined)) {
          return;
        }
        await writeFact(session, ARCHIVED_FACT, input.archived ? true : undefined);
      },
      async delete(input) {
        alive();
        const pooled = await openPooled(input.sessionId);
        pooled.retired = true;
        try {
          await writeBlobRef(pooled.session, DELETED_REF, { at: Date.now() }, "delete");
          const runs = await pooled.session.refs.list(RUN_PREFIX);
          for (const ref of runs) {
            await requestAbortAtRef(input.sessionId, pooled.session, ref.name);
          }
          await stopRunner(pooled);
          await Promise.all(
            [...(runnerTasks.get(input.sessionId) ?? [])].map((task) =>
              task.catch(() => undefined),
            ),
          );
          await reconciliations.get(input.sessionId);
          await pooled.opening?.catch(() => undefined);
          await pooled.activation?.close();
          await options.store.delete(input.sessionId);
          await pooled.session.close();
        } finally {
          pool.delete(input.sessionId);
          reconciliations.delete(input.sessionId);
          runnerTasks.delete(input.sessionId);
          noticeListeners.delete(input.sessionId);
        }
      },
      async configure(input): Promise<ConfigureOutcome> {
        alive();
        const pooled = await openPooled(input.sessionId);
        if (
          input.model !== undefined &&
          options.models.getModel(input.model.provider, input.model.id) === undefined
        ) {
          return { kind: "unknown_model" };
        }
        if (input.agent !== undefined) {
          const activation = await activationFor(input.sessionId, pooled);
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
        return { kind: "queued", change: outcome.change };
      },
    },

    messages: {
      async send(input: SendInput): Promise<SendReceipt> {
        alive();
        const { session } = await openPooled(input.sessionId);
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
        return submit(
          session,
          input.key === undefined ? submission : { ...submission, key: input.key },
        );
      },
      async cancel(input) {
        alive();
        return cancel(
          (await openPooled(input.sessionId)).session,
          attributed({ head: input.head ?? MAIN, change: input.change }, options.actor),
        );
      },
      async redeliver(input) {
        alive();
        return redeliver(
          (await openPooled(input.sessionId)).session,
          attributed(
            {
              head: input.head ?? MAIN,
              change: input.change,
              lane: servedLane(input.lane),
            },
            options.actor,
          ),
        );
      },
      async list(input) {
        alive();
        const session = (await openPooled(input.sessionId)).session;
        const tip = await session.refs.read(headRef(input.head ?? MAIN));
        return transcriptFromCommits(await branch(session.objects, tip));
      },
      async pending(input): Promise<readonly PendingItem[]> {
        alive();
        return pendingItems(
          await pending((await openPooled(input.sessionId)).session, input.head ?? MAIN),
        );
      },
    },

    runs: {
      async current(input) {
        alive();
        return currentRun((await openPooled(input.sessionId)).session, input.head ?? MAIN);
      },
      async abort(input): Promise<AbortOutcome> {
        alive();
        const pooled = await openPooled(input.sessionId);
        const head = input.head ?? MAIN;
        const runId = await requestAbortAtRef(input.sessionId, pooled.session, runRef(head));
        return runId === undefined ? { kind: "not_running" } : { kind: "requested", runId };
      },
      async wait(input): Promise<WaitOutcome> {
        alive();
        const session = (await openPooled(input.sessionId)).session;
        const head = input.head ?? MAIN;
        const cursor = await session.events.last();
        const status = async (): Promise<WaitOutcome | undefined> => {
          for (;;) {
            const [stored, queued] = await Promise.all([
              readRun(session, head),
              pending(session, head),
            ]);
            if (stored?.run.phase.kind === "waiting") {
              // A parked run with an answer or an abort pending is about to be
              // woken; only a run with nothing to wake it is parked.
              if (stored.run.abortRequested === true) return undefined;
              const effects = await listEffects(session, stored.run.id);
              if (effects.some((view) => view.effect.state === "signal")) return undefined;
              // The parking publish and the lease release are two writes, and
              // a runner mid-wake still holds the lease. A parked run is one
              // whose runner has let go; re-read once it has.
              if ((await session.leases.read(headRef(head))) === undefined) {
                return { kind: "waiting", runId: stored.run.id };
              }
              if (!(await untilLeaseReleased(session, headRef(head)))) return undefined;
              continue;
            }
            if (stored !== undefined && !isTerminal(stored.run.phase)) return undefined;
            if (queued.length > 0) return undefined;
            // The run's last publish and the lease release are two writes.
            // `idle` promises the head is free, so wait for the runner to let go.
            if ((await session.leases.read(headRef(head))) === undefined) return { kind: "idle" };
            if (!(await untilLeaseReleased(session, headRef(head)))) return undefined;
          }
        };
        const initial = await status();
        if (initial !== undefined) return initial;
        const watchOptions =
          input.signal === undefined
            ? { afterSeq: cursor }
            : { afterSeq: cursor, signal: input.signal };
        for await (const _event of session.events.watch(watchOptions)) {
          const next = await status();
          if (next !== undefined) return next;
        }
        return (await status()) ?? { kind: "idle" };
      },
      async reply(input): Promise<ReplyOutcome> {
        alive();
        const session = (await openPooled(input.sessionId)).session;
        const runId = input.runId ?? (await readRun(session, input.head ?? MAIN))?.run.id;
        if (runId === undefined) return { kind: "not_found" };
        const outcome = await signalEffect(
          session,
          attributed(
            {
              runId,
              callId: input.callId,
              signal: toJsonValue(input.reply),
            },
            options.actor,
          ),
        );
        switch (outcome.kind) {
          case "signalled":
            return { kind: "signalled" };
          case "not_waiting":
            return { kind: "not_waiting" };
          case "not_found":
            return { kind: "not_found" };
          default: {
            const _exhaustive: never = outcome;
            return _exhaustive;
          }
        }
      },
      async compact(input): Promise<CompactOutcome> {
        alive();
        if (input.signal?.aborted) return { kind: "aborted" };
        const pooled = await openPooled(input.sessionId);
        const { session } = pooled;
        const head = input.head ?? MAIN;
        const running = await readRun(session, head);
        if (running !== undefined && !isTerminal(running.run.phase)) {
          const lease = await session.leases.read(headRef(head));
          return { kind: "busy", run: runInfo(running.run, lease) };
        }

        try {
          const tip = await session.refs.read(headRef(head));
          if (tip === null) return { kind: "nothing_to_compact" };
          const commits = await branch(session.objects, tip);
          const resolved = await resolveBranchTurn(input.sessionId, pooled, commits);
          const activation = await activeFor(input.sessionId);
          const operation = {
            head,
            runId: randomUUID(),
            sessionId: input.sessionId,
            attempt: 1,
          };
          const request = {
            hooks: activation.hooks,
            invocation: () => operation,
            streamFn: options.streamFn,
            streamOptions: options.streamOptions,
          };
          let checkpoint: WriteCheckpointInput = {
            head,
            streamFn: requestStream({ ...request, step: "compaction" }),
            providerCompaction: providerCompactionFor(request),
            systemPrompt: resolved.systemPrompt,
            tools: [...resolved.tools],
            model: resolved.model,
            settings: options.compaction ?? DEFAULT_COMPACTION_SETTINGS,
            reason: "manual",
            signal: input.signal,
          };
          if (resolved.thinkingLevel !== undefined) {
            checkpoint = { ...checkpoint, thinkingLevel: resolved.thinkingLevel };
          }
          if (input.customInstructions !== undefined) {
            checkpoint = { ...checkpoint, customInstructions: input.customInstructions };
          }
          const outcome = await writeCheckpoint(session, checkpoint);
          switch (outcome.kind) {
            case "compacted":
              return { kind: "compacted", commit: outcome.commit };
            case "nothing_to_compact":
              return { kind: "nothing_to_compact" };
            case "aborted":
              return { kind: "aborted" };
            case "busy": {
              const current = await currentRun(session, head);
              return current !== undefined && !isTerminal(current.phase)
                ? { kind: "busy", run: current }
                : { kind: "failed", message: `Head ${head} is busy without a live run` };
            }
            case "failed":
              return { kind: "failed", message: outcome.error };
            default: {
              const _exhaustive: never = outcome;
              return _exhaustive;
            }
          }
        } catch (cause) {
          if (input.signal?.aborted) return { kind: "aborted" };
          return { kind: "failed", message: errorMessage(cause) };
        }
      },
      async context(input) {
        alive();
        return (await contextFor((await openPooled(input.sessionId)).session, input.head ?? MAIN))
          .status;
      },
      async changes(input) {
        alive();
        const session = (await openPooled(input.sessionId)).session;
        const tip = await session.refs.read(headRef(input.head ?? MAIN));
        const commits = await branch(session.objects, tip);
        if (input.runId === undefined) {
          return changesFromTurns(transcriptFromCommits(commits));
        }
        const selected = commits.filter((item) => item.commit.run === input.runId);
        if (selected.length === 0) return [];
        let parent: Oid | null = null;
        const contiguous = selected.map((item) => {
          const projected = { oid: item.oid, commit: { ...item.commit, parent } };
          parent = item.oid;
          return projected;
        });
        return changesFromTurns(transcriptFromCommits(contiguous));
      },
    },

    heads: {
      async list(input) {
        alive();
        return projectHeads((await openPooled(input.sessionId)).session);
      },
      async create(input) {
        alive();
        const session = (await openPooled(input.sessionId)).session;
        // The kernel stacks on any name. A parent this session does not list
        // (and is not its default head) is a mistake, caught here.
        const parent = "head" in input.from ? input.from.head : undefined;
        if (
          parent !== undefined &&
          !(await listSessionHeads(session)).some((item) => item.head === parent)
        ) {
          return { kind: "unknown_parent" };
        }
        return createHead(
          session,
          attributed({ head: input.head, from: input.from }, options.actor),
        );
      },
      async move(input): Promise<MoveOutcome> {
        alive();
        const pooled = await openPooled(input.sessionId);
        const { session } = pooled;
        const head = input.head ?? MAIN;
        // The kernel moves any name. Only heads this session lists, or its
        // default, are moved from here, so a mistyped head is not created.
        if (!(await listSessionHeads(session)).some((item) => item.head === head)) {
          return { kind: "not_found" };
        }
        // Read the tip before the run. A run that starts after this check also
        // advances the tip, so the CAS below rejects that race.
        const tip = await session.refs.read(headRef(head));
        if (input.expect !== undefined && input.expect !== tip) {
          return { kind: "moved_since", tip };
        }
        const running = await readRun(session, head);
        if (running !== undefined && !isTerminal(running.run.phase)) {
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
          const [sourceBranch, selectedBranch] = await Promise.all([
            branch(session.objects, tip),
            branch(session.objects, input.to),
          ]);
          const byOid = new Map<Oid, Commit>();
          for (const item of [...sourceBranch, ...selectedBranch]) {
            byOid.set(item.oid, item.commit);
          }
          const abandoned = collectAbandoned(byOid, { from: tip, selected: input.to }).commits;
          if (abandoned.length > 0) {
            let summaryInput: SummarizeBranchInput;
            try {
              const resolved = await resolveBranchTurn(input.sessionId, pooled, sourceBranch);
              summaryInput = {
                abandoned,
                streamFn: options.streamFn,
                model: resolved.model,
              };
              if (resolved.thinkingLevel !== undefined) {
                summaryInput = { ...summaryInput, thinkingLevel: resolved.thinkingLevel };
              }
              if (input.summary.customInstructions !== undefined) {
                summaryInput = {
                  ...summaryInput,
                  customInstructions: input.summary.customInstructions,
                };
              }
              const summarized = await summarizeBranch(summaryInput);
              if (!summarized.ok) {
                return { kind: "failed", message: summarized.error.message };
              }
              if (summarized.value.text !== "") {
                const commit = summaryCommit({
                  parent: target.to,
                  body: summarized.value,
                  imports: abandoned.map((item) => item.oid),
                });
                summaryOid = hashObject(commit);
                await session.objects.put([commit]);
              }
            } catch (cause) {
              return { kind: "failed", message: errorMessage(cause) };
            }
          }
        }

        const move = attributed({ head, to: summaryOid ?? target.to, expect: tip }, options.actor);
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
      },
      async delete(input) {
        alive();
        if (input.head === MAIN) throw new TypeError("The default head cannot be deleted");
        return deleteHead(
          (await openPooled(input.sessionId)).session,
          attributed({ head: input.head }, options.actor),
        );
      },
      async merge(input) {
        alive();
        return fastForward(
          (await openPooled(input.sessionId)).session,
          attributed({ head: input.head }, options.actor),
        );
      },
    },

    workspace: {
      async list() {
        alive();
        return (await options.workspaces?.list()) ?? [];
      },
      async forget(input) {
        alive();
        await options.workspaces?.forget(input.path);
      },
      vcs: {
        async status() {
          alive();
          return options.vcs?.status();
        },
        async diff(input) {
          alive();
          return (await options.vcs?.diff(input)) ?? [];
        },
      },
    },

    provider: {
      models: {
        async list(): Promise<readonly ModelInfo[]> {
          alive();
          return options.models.getModels().map(toModelInfo);
        },
        async default(): Promise<ModelInfo | undefined> {
          alive();
          return toModelInfo(options.model);
        },
      },
    },

    plugins: {
      async catalog() {
        alive();
        return catalogForNewSession();
      },
      async list(input) {
        alive();
        return (await activeFor(input.sessionId)).plugins.list();
      },
      commands: {
        async list(input): Promise<readonly CommandInfo[]> {
          alive();
          return pluginCatalog(await activeFor(input.sessionId)).commands;
        },
        async run(input): Promise<CommandOutcome> {
          alive();
          const activation = await activeFor(input.sessionId);
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
          alive();
          return (await activeFor(input.sessionId)).listSettings();
        },
        async apply(input): Promise<ApplyOutcome> {
          alive();
          return (await activeFor(input.sessionId)).applySetting(input.id, input.choiceId);
        },
      },
      resources: {
        async list(input) {
          alive();
          return [...(await activeFor(input.sessionId)).resources().values()];
        },
      },
      status: {
        async list(input) {
          alive();
          return (await activeFor(input.sessionId)).statuses();
        },
      },
    },

    async *watch(input): AsyncIterable<SessionEvent> {
      const pooled = await openPooled(input.sessionId);
      const { session } = pooled;
      const notices: SessionEvent[] = [];
      let notify: (() => void) | undefined;
      let iterator: AsyncIterator<Event> | undefined;
      const unsubscribe = subscribeNotices(input.sessionId, async (notice) => {
        notices.push(noticeEvent(notice, await session.events.last()));
        notify?.();
      });
      try {
        const target = await session.events.last();
        const after = "live" in input ? target : (input.afterSeq ?? 0);
        let synced = after >= target;
        if (synced) yield { seq: target, kind: "synced" };
        const watchOptions =
          input.signal === undefined
            ? { afterSeq: after }
            : { afterSeq: after, signal: input.signal };
        iterator = session.events.watch(watchOptions)[Symbol.asyncIterator]();
        let nextEvent = iterator.next();
        for (;;) {
          while (notices.length > 0) {
            const notice = notices.shift();
            if (notice !== undefined) yield notice;
          }
          const noticeArrived = new Promise<"notice">((resolve) => {
            notify = () => resolve("notice");
          });
          const woken = await Promise.race([nextEvent, noticeArrived]);
          notify = undefined;
          if (woken === "notice") continue;
          if (woken.done === true) break;
          const event = woken.value;
          for (const projected of await projectEvent(event, (oid) => session.objects.get(oid))) {
            yield projected;
          }
          if (!synced && event.seq >= target) {
            synced = true;
            yield { seq: target, kind: "synced" };
          }
          nextEvent = iterator.next();
        }
      } finally {
        unsubscribe();
        notify = undefined;
        await iterator?.return?.().catch(() => undefined);
      }
    },

    async setPlugins(next) {
      alive();
      pluginsOverride = next;
      catalogCache = undefined;
      for (const [id, pooled] of pool) {
        const activation = await activationFor(id, pooled);
        if (activation !== undefined) await activation.setPlugins(pluginsFor(id, pooled, next));
      }
    },

    attach(input?: AttachOptions): Disposer {
      alive();
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
            await reconcileRunner(id, await openPooled(id));
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
        for (const [id, pooled] of pool) {
          if (selectedAttachment(id, pooled) !== undefined) continue;
          const runner = pooled.runner;
          pooled.runner = undefined;
          runner?.();
        }
      };
    },

    async close() {
      if (closed) return;
      closed = true;
      attachments.clear();
      for (const pooled of pool.values()) {
        if (pooled.runner === undefined) continue;
        pooled.runner();
        pooled.runner = undefined;
      }
      const errors: unknown[] = [];
      for (const tasks of runnerTasks.values()) {
        await Promise.all(tasks).catch((cause: unknown) => errors.push(cause));
      }
      for (const opening of reconciliations.values()) await opening;
      for (const pooled of pool.values()) {
        await pooled.opening?.catch(() => undefined);
        await pooled.activation?.close().catch((cause: unknown) => errors.push(cause));
        await pooled.session.close().catch((cause: unknown) => errors.push(cause));
      }
      pool.clear();
      reconciliations.clear();
      runnerTasks.clear();
      noticeListeners.clear();
      errors.push(...background.splice(0));
      if (errors.length > 0) throw new AggregateError(errors, "Failed to close nyte");
    },
  };
}
