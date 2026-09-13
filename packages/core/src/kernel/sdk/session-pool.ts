/**
 * One handle per open session, and everything that belongs to that handle:
 * the store session, its facts, its heads and runs, the host's activation
 * answer, and the notice fan-out to watchers. Runners and subagents are built
 * on top of it and reach back through `SessionPoolHooks`.
 */
import { isAbsolute } from "node:path";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { JsonValue } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { LoadedPlugin } from "../../plugins/types.ts";
import { listEffects } from "../effects.ts";
import { branch } from "../graph.ts";
import type { Actor, Oid, RefName, Run } from "../model.ts";
import { DELETED_REF, factRef, headRef, runRef } from "../names.ts";
import { pending } from "../queue.ts";
import { listHeads, type ListedHead } from "../stacks.ts";
import type { Session } from "../store.ts";
import { activate, type Activation } from "./activation.ts";
import type { createJobs } from "./jobs.ts";
import {
  ARCHIVED_FACT,
  NAME_FACT,
  PARENT_FACT,
  PINNED_FACT,
  headInfo,
  parentFromFact,
  runInfo,
} from "./snapshot.ts";
import {
  MAIN,
  NyteClosed,
  UnknownSession,
  sessionId,
  type ActiveSessionActivation,
  type ActivationTarget,
  type CommandInfo,
  type Disposer,
  type HeadInfo,
  type HeadName,
  type NyteOptions,
  type ParkedCall,
  type PluginCatalog,
  type RunInfo,
  type SessionActivation,
  type SessionActivationResolver,
  type SessionActivationState,
  type SessionId,
  type SessionInfo,
  type SessionParent,
  type Seq,
} from "./types.ts";
import type { HostNotice, NoticeListener } from "./watch.ts";

export const CWD_FACT = "cwd";
export const RUN_PREFIX = "refs/runs/";

export interface DriveState {
  dirty: boolean;
  controller?: AbortController;
  runId?: string;
  running?: Promise<void>;
  /** Re-drives the head at the nearest parked deadline. The deadline itself is on the effect. */
  deadline?: ReturnType<typeof setTimeout>;
}

export interface Pooled {
  readonly session: Session;
  /** The durable parent link, read once at adoption; a child's coverage follows its parent's. */
  readonly parent: SessionParent | undefined;
  /** Immutable, so one store listing per pooled session answers every later read. */
  createdAt?: number;
  /**
   * The directory row as of `seq`, for the host answer it was built with.
   * Every store write appends an event, so an unchanged `events.last()` means
   * the row's inputs (facts, refs, queue, main branch) are unchanged too, and
   * a list need not read the branch again.
   */
  listed?: {
    readonly seq: Seq;
    readonly activation: SessionActivation | undefined;
    readonly info: SessionInfo;
  };
  /** The host's answer for this session, once asked; `reactivate` clears a blocked one. */
  activationState?: SessionActivation;
  resolving?: Promise<SessionActivation>;
  activation?: Activation;
  activationCwd?: string;
  opening?: Promise<Activation | undefined>;
  background: boolean;
  relocating?: boolean;
  scopedPlugins?: boolean;
  jobs?: ReturnType<typeof createJobs>;
  /** Cancellation is terminal, so one completed interruption per pooled child covers every later request. */
  interrupting?: Promise<void>;
  runner?: Disposer;
  wake?: () => void;
  /** Runner loops started for this session that have not ended yet; `retire` waits for them. */
  readonly runnerTasks: Set<Promise<void>>;
  /** Per-head drive state while a runner is live; a participant abort reaches the local drive through it. */
  drives?: Map<HeadName, DriveState>;
  /** Reconcile passes for this session run one after another. */
  reconciliation?: Promise<void>;
  readonly noticeListeners: Set<NoticeListener>;
  retired: boolean;
}

/** What the pool needs from the runner and subagent modules, which are built after it. */
export interface SessionPoolHooks {
  readonly stopRunner: (pooled: Pooled) => Promise<void>;
  readonly requestAbort: (pooled: Pooled, name: RefName) => Promise<string | undefined>;
  readonly closeJobs: (id: SessionId, pooled: Pooled) => Promise<void>;
  readonly pluginsFor: (input: {
    readonly id: SessionId;
    readonly pooled: Pooled;
    readonly plugins: readonly LoadedPlugin[];
  }) => readonly LoadedPlugin[];
}

type ActivationSource =
  | { readonly kind: "static"; readonly activation: ActiveSessionActivation }
  | { readonly kind: "resolver"; readonly resolve: SessionActivationResolver };

export function attributed<const Input extends object>(input: Input, actor: Actor | undefined) {
  return actor === undefined ? input : { ...input, actor };
}

export function parentValue(parent: SessionParent): JsonValue {
  return {
    sessionId: parent.sessionId,
    runId: parent.runId,
    callId: parent.callId,
    depth: parent.depth,
  };
}

export function commandInfos(activation: Activation): CommandInfo[] {
  return [...activation.commands()].map(([name, command]) => ({
    name,
    owner: activation.commandOwner(name) ?? "",
    description: command.description,
  }));
}

export function clientActivation(activation: SessionActivation): SessionActivationState {
  switch (activation.kind) {
    case "active":
      return { kind: "active" };
    case "inactive":
    case "requires":
      return activation;
    default: {
      const _exhaustive: never = activation;
      return _exhaustive;
    }
  }
}

export function createSessionPool(input: {
  readonly options: NyteOptions;
  readonly hooks: SessionPoolHooks;
}) {
  const { options, hooks } = input;
  const pool = new Map<SessionId, Pooled>();
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
  // A host that saw plugin sources change holds the gate until its swap lands,
  // so a step that starts in between advertises the new tools, not the old.
  let pluginHolds = 0;
  let pluginsSettled = Promise.resolve();
  let releasePlugins: (() => void) | undefined;

  const alive = (): void => {
    if (closed) throw new NyteClosed();
  };

  // -------------------------------------------------------------------------
  // Handles
  // -------------------------------------------------------------------------

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
    const backgroundJob = (await readFact(session, "job-background")) === true;
    // Another opener or shutdown may have won while the parent fact was read.
    const winner = pool.get(id);
    if (closed || winner !== undefined) {
      await session.close();
      if (closed) throw new NyteClosed();
      if (winner === undefined || winner.retired) throw new UnknownSession(id);
      return winner;
    }
    const pooled: Pooled = {
      session,
      parent,
      background: backgroundJob,
      runnerTasks: new Set(),
      noticeListeners: new Set(),
      retired: false,
    };
    pool.set(id, pooled);
    return pooled;
  };

  const open = async (id: SessionId): Promise<Pooled> => {
    alive();
    const existing = pool.get(id);
    if (existing !== undefined) {
      if (existing.retired) throw new UnknownSession(id);
      return existing;
    }
    return adopt(await options.store.open(id));
  };

  /** Delete the session from the store and drop its handle, after its work has stopped. */
  const retire = async (id: SessionId, pooled: Pooled): Promise<void> => {
    pooled.retired = true;
    try {
      await hooks.closeJobs(id, pooled);
      await writeBlobRef(pooled.session, DELETED_REF, { at: Date.now() }, "delete");
      const runs = await pooled.session.refs.list(RUN_PREFIX);
      for (const ref of runs) {
        await hooks.requestAbort(pooled, ref.name);
      }
      await hooks.stopRunner(pooled);
      await Promise.all([...pooled.runnerTasks].map((task) => task.catch(() => undefined)));
      await pooled.reconciliation;
      await pooled.opening?.catch(() => undefined);
      await pooled.activation?.close();
      await options.store.delete(id);
      await pooled.session.close();
    } finally {
      // A failure above must not leave a live runner behind a dropped handle:
      // `close` would wait for that loop forever.
      try {
        await hooks.stopRunner(pooled);
      } finally {
        pool.delete(id);
      }
    }
  };

  // -------------------------------------------------------------------------
  // Facts
  // -------------------------------------------------------------------------

  async function readFact(session: Session, key: string): Promise<JsonValue | undefined> {
    const name = factRef(key);
    const oid = await session.refs.read(name);
    if (oid === null) return undefined;
    const object = await session.objects.get(oid);
    if (object?.kind !== "blob") throw new Error(`Corrupt fact ref ${name} at ${oid}`);
    return object.value;
  }

  const storedCwd = async (session: Session): Promise<string | undefined> => {
    const value = await readFact(session, CWD_FACT);
    if (value === undefined) return undefined;
    if (!Value.Check(Type.String(), value) || !isAbsolute(value)) {
      throw new Error("Invalid stored session cwd");
    }
    return value;
  };

  async function writeBlobRef(
    session: Session,
    name: RefName,
    value: JsonValue | undefined,
    reason: string,
  ): Promise<void> {
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
  }

  const writeFact = (session: Session, key: string, value: JsonValue | undefined): Promise<void> =>
    writeBlobRef(session, factRef(key), value, "fact");

  const readFacts = async (session: Session): Promise<ReadonlyMap<string, JsonValue>> => {
    // Session rows do not consume plugin settings or other host metadata.
    const keys = [NAME_FACT, PINNED_FACT, ARCHIVED_FACT, PARENT_FACT];
    const values = await Promise.all(keys.map((key) => readFact(session, key)));
    const facts = new Map<string, JsonValue>();
    keys.forEach((key, index) => {
      const value = values[index];
      if (value !== undefined) facts.set(key, value);
    });
    return facts;
  };

  // -------------------------------------------------------------------------
  // Runs, heads, and the session row
  // -------------------------------------------------------------------------

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
    if (isTerminalPhase(run.phase)) return [];
    const views = await listEffects(session, run.runId);
    return views.flatMap((view) => {
      if (view.effect.state !== "waiting") return [];
      const call = {
        runId: run.runId,
        callId: view.intent.callId,
        waitId: view.oid,
        tool: view.intent.tool,
        args: view.intent.args,
      };
      const { selection, until } = view.effect;
      const selected = selection === undefined ? call : { ...call, selection };
      return [until === undefined ? selected : { ...selected, until }];
    });
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
        const [parentTip, run] = await Promise.all([
          item.stack === undefined ? null : session.refs.read(headRef(item.stack.parent)),
          currentRun(session, item.head),
        ]);
        return headInfo(item, parentTip, run);
      }),
    );
  };

  const createdAtFor = async (id: SessionId, pooled: Pooled): Promise<number> => {
    if (pooled.createdAt !== undefined) return pooled.createdAt;
    const stored = (await options.store.list()).find((item) => item.id === id);
    if (stored === undefined) throw new UnknownSession(id);
    pooled.createdAt = stored.createdAt;
    return stored.createdAt;
  };

  const readSession = async (
    id: SessionId,
    pooled: Pooled,
    known: { readonly facts?: ReadonlyMap<string, JsonValue> } = {},
  ) => {
    const { session } = pooled;
    // Read queued choices first so a concurrent landing cannot make one disappear.
    const pendingChanges = await pending(session, MAIN);
    const listed = await listSessionHeads(session);
    const mainTip = listed.find((item) => item.head === MAIN)?.tip ?? null;
    const [activation, createdAt, heads, facts, commits] = await Promise.all([
      resolveSessionActivation(id, pooled),
      createdAtFor(id, pooled),
      projectHeads(session, listed),
      known.facts ?? readFacts(session),
      branch(session.objects, mainTip),
    ]);
    return {
      id,
      activation: clientActivation(activation),
      createdAt,
      heads,
      facts,
      mainCommits: commits.map((item) => item.commit),
      pendingChanges,
      commits,
    };
  };

  // -------------------------------------------------------------------------
  // Notices
  // -------------------------------------------------------------------------

  const dispatchNotice = async (pooled: Pooled, notice: HostNotice): Promise<void> => {
    for (const listener of pooled.noticeListeners) await listener(notice);
  };

  const subscribeNotices = (pooled: Pooled, listener: NoticeListener): Disposer => {
    pooled.noticeListeners.add(listener);
    return () => {
      pooled.noticeListeners.delete(listener);
    };
  };

  // -------------------------------------------------------------------------
  // Activation
  // -------------------------------------------------------------------------

  const resolveHostActivation = async (target: ActivationTarget): Promise<SessionActivation> => {
    const resolved =
      activationSource.kind === "static"
        ? activationSource.activation
        : await activationSource.resolve(target);
    if (resolved.kind !== "active" || pluginsOverride === undefined) return resolved;
    return { ...resolved, plugins: pluginsOverride };
  };

  const catalogForNewSession = (): Promise<PluginCatalog> => {
    if (catalogCache !== undefined) return catalogCache;
    const opening = (async (): Promise<PluginCatalog> => {
      const resolved = await resolveHostActivation({ kind: "new-session" });
      if (closed) throw new NyteClosed();
      if (resolved.kind !== "active")
        return { plugins: [], commands: [], skills: [], settings: [] };
      const activation = await activate({
        target: { kind: "new-session" },
        plugins: resolved.plugins,
        env: resolved.env,
      });
      try {
        if (closed) throw new NyteClosed();
        return {
          commands: commandInfos(activation),
          skills: [...activation.resources().values()],
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

  async function resolveSessionActivation(
    id: SessionId,
    pooled: Pooled,
  ): Promise<SessionActivation> {
    if (closed) throw new NyteClosed();
    if (pooled.retired) throw new UnknownSession(id);
    const saved = await storedCwd(pooled.session);
    if (
      pooled.activationState?.kind === "active" &&
      saved !== undefined &&
      saved !== pooled.activationState.env.cwd
    ) {
      pooled.activationState = {
        kind: "requires",
        requirement: { kind: "workspace_trust", cwd: saved },
      };
      pooled.scopedPlugins = true;
      await dispatchNotice(pooled, {
        kind: "activation_changed",
        activation: clientActivation(pooled.activationState),
      });
    }
    if (
      pooled.activationState !== undefined &&
      (pooled.parent === undefined || pooled.activationState.kind === "active")
    )
      return pooled.activationState;
    if (pooled.resolving !== undefined) return pooled.resolving;

    const resolving = (async () => {
      const resolved =
        pooled.parent === undefined
          ? await resolveHostActivation({ kind: "session", sessionId: id })
          : await resolveSessionActivation(
              pooled.parent.sessionId,
              await open(pooled.parent.sessionId),
            );
      if (closed || pooled.retired) throw closed ? new NyteClosed() : new UnknownSession(id);
      // Freeze the initial location too: a completed child must not follow a later parent move.
      const initialCwd =
        resolved.kind === "active"
          ? resolved.env.cwd
          : resolved.kind === "requires" && resolved.requirement.kind === "workspace_trust"
            ? resolved.requirement.cwd
            : undefined;
      if (saved === undefined && initialCwd !== undefined) {
        const [oid] = await pooled.session.objects.put([{ kind: "blob", value: initialCwd }]);
        if (oid === undefined) throw new Error("Writing session cwd returned no oid");
        await pooled.session.refs.update(
          [{ name: factRef(CWD_FACT), from: null, to: oid }],
          attributed({ reason: "fact" }, options.actor),
        );
      }
      const cwd = await storedCwd(pooled.session);
      const state: SessionActivation =
        cwd !== undefined && (resolved.kind !== "active" || resolved.env.cwd !== cwd)
          ? { kind: "requires", requirement: { kind: "workspace_trust", cwd } }
          : resolved;
      pooled.scopedPlugins =
        pooled.scopedPlugins === true ||
        (pooled.parent !== undefined
          ? (await open(pooled.parent.sessionId)).scopedPlugins === true
          : activationSource.kind === "static" &&
            cwd !== undefined &&
            cwd !== activationSource.activation.env.cwd);
      pooled.activationState = state;
      await dispatchNotice(pooled, {
        kind: "activation_changed",
        activation: clientActivation(state),
      });
      return state;
    })().finally(() => {
      if (pooled.resolving === resolving) pooled.resolving = undefined;
    });
    pooled.resolving = resolving;
    return resolving;
  }

  const activationFor = async (id: SessionId, pooled: Pooled): Promise<Activation | undefined> => {
    if (closed) throw new NyteClosed();
    if (pooled.retired) throw new UnknownSession(id);
    const state = await resolveSessionActivation(id, pooled);
    if (state.kind !== "active") return undefined;
    if (pooled.activation !== undefined && pooled.activationCwd !== state.env.cwd) {
      await hooks.stopRunner(pooled);
      await pooled.activation.close();
      pooled.activation = undefined;
    }
    if (pooled.activation !== undefined) return pooled.activation;
    if (pooled.opening !== undefined) return pooled.opening;

    const opening = (async (): Promise<Activation | undefined> => {
      const resolved = await resolveSessionActivation(id, pooled);
      if (closed || pooled.retired) throw closed ? new NyteClosed() : new UnknownSession(id);
      if (resolved.kind !== "active") return undefined;
      const built = await activate({
        target: { kind: "session", session: pooled.session },
        plugins: hooks.pluginsFor({ id, pooled, plugins: resolved.plugins }),
        env: resolved.env,
      });
      if (closed || pooled.retired) {
        await built.close();
        throw closed ? new NyteClosed() : new UnknownSession(id);
      }
      built.subscribe((notice) => dispatchNotice(pooled, notice));
      pooled.activation = built;
      pooled.activationCwd = resolved.env.cwd;
      // Activation's first inventory notice fires before activate() returns.
      // Relay the resulting inventory to watches that were already open.
      const plugins = built.plugins.list();
      if (plugins.length > 0) {
        await dispatchNotice(pooled, { kind: "plugins_changed", plugins });
      }
      return built;
    })().finally(() => {
      if (pooled.opening === opening) pooled.opening = undefined;
    });
    pooled.opening = opening;
    return opening;
  };

  const activeFor = async (id: SessionId): Promise<Activation> => {
    const pooled = await open(id);
    const active = await activationFor(id, pooled);
    if (active === undefined) throw new Error("Session is not active in this host");
    return active;
  };

  return {
    get closed(): boolean {
      return closed;
    },
    alive,
    /** Refuse new work; the caller drains what is pooled and then calls `clear`. */
    markClosed(): void {
      closed = true;
      pluginHolds = 0;
      releasePlugins?.();
    },
    holdPlugins(): Disposer {
      pluginHolds += 1;
      if (pluginHolds === 1) {
        pluginsSettled = new Promise((resolve) => {
          releasePlugins = resolve;
        });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pluginHolds = Math.max(0, pluginHolds - 1);
        if (pluginHolds === 0) releasePlugins?.();
      };
    },
    /** Resolves once no host holds a plugin swap open. Immediate when nothing is pending. */
    pluginsSettled: (): Promise<void> => pluginsSettled,
    entries: (): IterableIterator<[SessionId, Pooled]> => pool.entries(),
    /** The pooled handle without opening the store; `undefined` for a session nobody opened. */
    peek: (id: SessionId): Pooled | undefined => pool.get(id),
    clear: (): void => {
      pool.clear();
    },
    adopt,
    open,
    retire,
    readFact,
    writeFact,
    writeBlobRef,
    readFacts,
    storedCwd,
    readRun,
    currentRun,
    parkedCalls,
    listSessionHeads,
    projectHeads,
    readSession,
    dispatchNotice,
    subscribeNotices,
    resolveSessionActivation,
    activationFor,
    activeFor,
    catalogForNewSession,
    /** A global plugin swap replaces the host's answer for every unscoped session and the catalog. */
    setPluginsOverride(plugins: readonly LoadedPlugin[]): void {
      pluginsOverride = plugins;
      catalogCache = undefined;
    },
    resetCatalog(): void {
      catalogCache = undefined;
    },
  };
}

export type SessionPool = ReturnType<typeof createSessionPool>;
