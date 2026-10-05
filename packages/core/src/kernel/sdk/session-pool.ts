/**
 * One handle per open session, and everything that belongs to that handle:
 * the store session, its facts, its heads and runs, the host's activation
 * answer, and the notice fan-out to watchers. Runners and delegation are built
 * on top of it and reach back through `SessionPoolHooks`.
 */
import { isTerminalPhase, schemas, type WorkspaceRef } from "@nyte-ai/protocol";
import type { JsonValue } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { environmentProviders } from "../../plugins/environment.ts";
import type { Plugin, PluginInfo } from "../../plugins/types.ts";
import type { ExecutionEnv } from "../loop/env.ts";
import { listEffects } from "../effects.ts";
import { branch } from "../graph.ts";
import type { Actor, Oid, RefName, Run } from "../model.ts";
import { DELETED_REF, WORKSPACE_REF, factRef, headRef, runRef } from "../names.ts";
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
  CorruptObject,
  MAIN,
  NyteClosed,
  UnknownSession,
  WorkspaceNotActive,
  sessionId,
  type CommandInfo,
  type Disposer,
  type HeadInfo,
  type HeadName,
  type NyteOptions,
  type ParkedCall,
  type PluginCatalog,
  type RunInfo,
  type SessionActivationState,
  type SessionId,
  type SessionInfo,
  type SessionParent,
  type Seq,
  type Workspace,
  type WorkspaceTrust,
} from "./types.ts";
import type { HostNotice, NoticeListener } from "./watch.ts";

const CWD_FACT = "cwd";

/** What clients see of a workspace: never the locator. */
function workspaceRef(workspace: Workspace): WorkspaceRef {
  return { kind: workspace.kind, id: workspace.id, cwd: workspace.cwd };
}

export function actsIn(
  env: Pick<ExecutionEnv, "id" | "cwd">,
  workspace: Pick<Workspace, "id" | "cwd">,
): boolean {
  return env.id === workspace.id && env.cwd === workspace.cwd;
}

export const RUN_PREFIX = "refs/runs/";

export interface DriveState {
  dirty: boolean;
  controller?: AbortController;
  runId?: string;
  running?: Promise<void>;
  /** Re-drives the head at the nearest parked deadline. The deadline itself is on the effect. */
  deadline?: ReturnType<typeof setTimeout>;
}

/** An opened workspace a session runs in. */
interface ActiveSessionActivation {
  readonly kind: "active";
  readonly plugins: readonly Plugin[];
  /** The provider's environment, before any plugin wraps it. */
  readonly env: ExecutionEnv;
  /** The bootstrap plugins and the workspace's project plugins, loaded again. */
  readonly reload?: () => Promise<readonly Plugin[]>;
}

/** A plugin set the host could not bring up; the inventory names the plugin that stopped it. */
interface FailedSessionActivation {
  readonly kind: "failed";
  readonly error: string;
  readonly plugins: readonly PluginInfo[];
}

type SessionActivation =
  | ActiveSessionActivation
  | FailedSessionActivation
  | Exclude<SessionActivationState, { readonly kind: "active" | "failed" }>;

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
   * a list need not read the branch again, except a child's workspace, which
   * comes from its root.
   */
  listed?: {
    readonly seq: Seq;
    readonly activation: SessionActivation | undefined;
    readonly info: SessionInfo;
    /** The root's `refs/workspace` oid the row was built against; a child's row changes with it. */
    readonly workspace: Oid | null;
  };
  /** The host's answer for this session, once asked; `reactivate` clears a blocked one. */
  activationState?: SessionActivation & { readonly resolvedFor: Workspace };
  resolving?: Promise<NonNullable<Pooled["activationState"]>>;
  activation?: Activation;
  opening?: Promise<Activation | undefined>;
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
    readonly plugins: readonly Plugin[];
  }) => readonly Plugin[];
}

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
  return [...activation.commands()].map(([name, command]) => {
    const info: CommandInfo = {
      name,
      owner: activation.commandOwner(name) ?? "",
      description: command.description,
    };

    return command.selection === undefined ? info : { ...info, selection: command.selection };
  });
}

function unavailable(
  workspace: Workspace,
  reason: "unsupported" | "unreachable",
): SessionActivation {
  return {
    kind: "requires",
    requirement: { kind: "workspace_unavailable", workspace: workspaceRef(workspace), reason },
  };
}

export function clientActivation(activation: SessionActivation): SessionActivationState {
  switch (activation.kind) {
    case "active":
      return { kind: "active" };
    case "failed":
      return { kind: "failed", error: activation.error };
    case "inactive":
      return { kind: "inactive" };
    case "requires":
      return { kind: "requires", requirement: activation.requirement };
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
  const providers = environmentProviders(options.plugins);

  if (!providers.has(options.defaultWorkspace.kind))
    throw new Error(
      `No plugin provides the "${options.defaultWorkspace.kind}" environment of the default workspace`,
    );
  const opened = new Map<string, Promise<SessionActivation>>();
  let pluginsOverride: readonly Plugin[] | undefined;

  let catalogCache: Promise<PluginCatalog> | undefined;
  let closed = false;
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

  const rootOf = async (pooled: Pooled, seen = new Set<string>()): Promise<Pooled> => {
    if (pooled.parent === undefined) return pooled;

    if (seen.has(pooled.session.id)) throw new Error("Session parent chain forms a cycle");
    seen.add(pooled.session.id);

    return rootOf(await open(pooled.parent.sessionId), seen);
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

  async function readBlobRef(session: Session, name: RefName): Promise<JsonValue | undefined> {
    const oid = await session.refs.read(name);

    if (oid === null) return undefined;
    const object = await session.objects.get(oid);

    if (object?.kind !== "blob") throw new CorruptObject(oid, `is not the blob ${name} names`);

    return object.value;
  }

  const readFact = (session: Session, key: string): Promise<JsonValue | undefined> =>
    readBlobRef(session, factRef(key));

  /**
   * The root's workspace. A root from before `refs/workspace` acts where new
   * sessions start, at the directory its `cwd` fact kept if it has one.
   */
  const storedWorkspace = async (pooled: Pooled): Promise<Workspace> => {
    const root = await rootOf(pooled);
    const value = await readBlobRef(root.session, WORKSPACE_REF);

    if (value === undefined) {
      const cwd = await readFact(root.session, CWD_FACT);

      if (cwd === undefined) return options.defaultWorkspace;

      if (!Value.Check(Type.String({ minLength: 1 }), cwd)) {
        throw new Error("Invalid stored session cwd");
      }

      return { ...options.defaultWorkspace, cwd };
    }

    if (!Value.Check(schemas.WorkspaceRef, value))
      throw new Error("Invalid stored session workspace");

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

  /** Record the root's workspace against what the writer saw; `false` when another writer got there first. */
  const writeWorkspace = async (
    root: Session,
    workspace: Workspace,
    expect: Oid | null,
  ): Promise<boolean> => {
    const { kind, id, cwd, locator } = workspace;
    const value: JsonValue = locator === undefined ? { kind, id, cwd } : { kind, id, cwd, locator };
    const [oid] = await root.objects.put([{ kind: "blob", value }]);

    if (oid === undefined) throw new Error(`Writing ${WORKSPACE_REF} returned no oid`);

    const outcome = await root.refs.update(
      [{ name: WORKSPACE_REF, from: expect, to: oid }],
      attributed({ reason: "workspace" }, options.actor),
    );

    if (outcome.ok) return true;

    if (outcome.reason === "fenced") throw new Error(`Workspace update was fenced: ${root.id}`);

    return false;
  };

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

    if (object?.kind !== "run")
      throw new CorruptObject(oid, `is not the run ${runRef(head)} names`);

    return { oid, run: object };
  };

  const currentRun = async (session: Session, head: HeadName): Promise<RunInfo | undefined> => {
    const stored = await readRun(session, head);

    if (stored === undefined) return undefined;

    const [lease, question] = await Promise.all([
      session.leases.read(headRef(head)),
      participantQuestion(session, stored.run),
    ]);

    const projected = runInfo(stored.run, lease);

    return question === undefined ? projected : { ...projected, awaitingReply: true, question };
  };

  /**
   * What a parked run asks a participant, when it waits on one rather than on
   * background work. Only a parked run pays the effect read; every other phase
   * answers from the run alone, so listing a directory of idle sessions costs
   * nothing extra.
   */
  const participantQuestion = async (session: Session, run: Run): Promise<string | undefined> => {
    if (run.phase.kind !== "waiting") return undefined;
    const views = await listEffects(session, run.id);

    for (const { effect } of views)
      if (effect.state === "waiting" && effect.selection !== undefined)
        return effect.selection.title;

    return undefined;
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

    const [activation, createdAt, heads, facts, commits, workspace] = await Promise.all([
      resolveSessionActivation(id, pooled),
      createdAtFor(id, pooled),
      projectHeads(session, listed),
      known.facts ?? readFacts(session),
      branch(session.objects, mainTip),
      storedWorkspace(pooled),
    ]);

    return {
      id,
      activation: clientActivation(activation),
      workspace: workspaceRef(workspace),
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

  /**
   * Open a workspace once: the host's trust first, then its kind's provider,
   * then its project plugins. Only an active outcome is kept; anything else is asked again.
   */
  const openWorkspace = (workspace: Workspace): Promise<SessionActivation> => {
    const key = JSON.stringify([workspace.kind, workspace.id, workspace.cwd]);
    const known = opened.get(key);

    if (known !== undefined) return known;

    const opening = (async (): Promise<SessionActivation> => {
      const trust: WorkspaceTrust =
        options.trust !== undefined
          ? await options.trust(workspace)
          : actsIn(workspace, options.defaultWorkspace)
            ? { kind: "trusted" }
            : { kind: "requires", requirement: { kind: "workspace_trust", cwd: workspace.cwd } };

      if (trust.kind !== "trusted") return trust;
      const provider = providers.get(workspace.kind);

      if (provider === undefined) return unavailable(workspace, "unsupported");
      const env = await provider.open(workspace).catch(() => undefined);

      if (env === undefined || !actsIn(env, workspace))
        return unavailable(workspace, "unreachable");
      const load = trust.plugins;

      if (load === undefined) return { kind: "active", plugins: options.plugins, env };
      const reload = async () => [...options.plugins, ...(await load(env))];

      try {
        return { kind: "active", plugins: await reload(), env, reload };
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);

        return { kind: "failed", error, plugins: [] };
      }
    })();

    opened.set(key, opening);

    void opening
      .catch(() => undefined)
      .then((state) => {
        if (state?.kind !== "active") opened.delete(key);
      });

    return opening;
  };

  const catalogForNewSession = (): Promise<PluginCatalog> => {
    if (catalogCache !== undefined) return catalogCache;

    const opening = (async (): Promise<PluginCatalog> => {
      const resolved = await openWorkspace(options.defaultWorkspace);

      if (closed) throw new NyteClosed();

      if (resolved.kind !== "active")
        throw new WorkspaceNotActive(
          resolved.kind === "failed" ? { kind: "failed", error: resolved.error } : resolved,
        );

      const outcome = await activate({
        target: { kind: "new-session" },
        plugins: pluginsOverride ?? resolved.plugins,
        env: resolved.env,
      });

      if (outcome.kind === "failed")
        return { plugins: outcome.plugins, commands: [], skills: [], settings: [] };
      const { activation } = outcome;

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
  ): Promise<NonNullable<Pooled["activationState"]>> {
    if (closed) throw new NyteClosed();

    if (pooled.retired) throw new UnknownSession(id);
    const workspace = await storedWorkspace(pooled);

    // A tree that moved, here or on another host, opens again where it is now.
    if (
      pooled.activationState !== undefined &&
      !actsIn(pooled.activationState.resolvedFor, workspace)
    ) {
      pooled.activationState = undefined;
      pooled.scopedPlugins = true;
    }

    if (pooled.activationState !== undefined) return pooled.activationState;

    if (pooled.resolving !== undefined) return pooled.resolving;

    const resolving = (async () => {
      const resolved =
        pooled.parent === undefined
          ? await openWorkspace(workspace)
          : await resolveSessionActivation(
              pooled.parent.sessionId,
              await open(pooled.parent.sessionId),
            );

      if (closed || pooled.retired) throw closed ? new NyteClosed() : new UnknownSession(id);

      pooled.scopedPlugins =
        pooled.scopedPlugins === true ||
        (pooled.parent === undefined
          ? !actsIn(workspace, options.defaultWorkspace)
          : (await open(pooled.parent.sessionId)).scopedPlugins === true);

      // A global plugin swap reaches the roots that act where new sessions start.
      const state = {
        ...(resolved.kind === "active" &&
        pooled.parent === undefined &&
        !pooled.scopedPlugins &&
        pluginsOverride !== undefined
          ? { ...resolved, plugins: pluginsOverride }
          : resolved),
        resolvedFor: workspace,
      };

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

    const stale = pooled.activation;

    if (stale !== undefined && !actsIn(stale.env, state.env)) {
      pooled.activation = undefined;
      await hooks.stopRunner(pooled);
      await stale.close();
    }

    if (pooled.activation !== undefined) return pooled.activation;

    if (pooled.opening !== undefined) return pooled.opening;

    const opening = (async (): Promise<Activation | undefined> => {
      const resolved = await resolveSessionActivation(id, pooled);

      if (closed || pooled.retired) throw closed ? new NyteClosed() : new UnknownSession(id);

      if (resolved.kind !== "active") return undefined;

      const outcome = await activate({
        target: { kind: "session", session: pooled.session },
        plugins: hooks.pluginsFor({ id, pooled, plugins: resolved.plugins }),
        env: resolved.env,
      });

      if (closed || pooled.retired) {
        if (outcome.kind === "active") await outcome.activation.close();
        throw closed ? new NyteClosed() : new UnknownSession(id);
      }

      if (outcome.kind === "failed") {
        pooled.activationState = { ...outcome, resolvedFor: resolved.resolvedFor };
        await dispatchNotice(pooled, {
          kind: "activation_changed",
          activation: clientActivation(outcome),
        });
        await dispatchNotice(pooled, { kind: "plugins_changed", plugins: outcome.plugins });

        return undefined;
      }

      const built = outcome.activation;
      built.subscribe((notice) => dispatchNotice(pooled, notice));
      pooled.activation = built;
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

  return {
    get closed(): boolean {
      return closed;
    },
    alive,
    /** Refuse new work; the caller drains what is pooled and then calls `clear`. */
    markClosed(): void {
      closed = true;
    },
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
    rootOf,
    storedWorkspace,
    writeWorkspace,
    openWorkspace,
    /** Whether the host's workspace backend reads this environment's files: it reads the default workspace's. */
    served: (env: Pick<Workspace, "id">): boolean => env.id === options.defaultWorkspace.id,
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
    catalogForNewSession,
    /** Where a new session would start, once its workspace opens; nothing is created or activated. */
    async cwdForNewSession(): Promise<string | undefined> {
      const resolved = await openWorkspace(options.defaultWorkspace);

      return resolved.kind === "active" ? resolved.env.cwd : undefined;
    },
    /** A global plugin swap replaces the host's answer for every unscoped session and the catalog. */
    setPluginsOverride(plugins: readonly Plugin[]): void {
      pluginsOverride = plugins;
      catalogCache = undefined;
    },
    resetCatalog(): void {
      catalogCache = undefined;
    },
  };
}

export type SessionPool = ReturnType<typeof createSessionPool>;
