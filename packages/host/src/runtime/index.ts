/**
 * `@nyte-ai/host/runtime`: a host profile composed into one running runtime.
 * The profile owns the identity, the bearer, the session store, the workspace
 * registry and the start journal; this module composes the SDK over them,
 * resolves principals, judges every operation, answers the registry and
 * start operations, and volunteers the process as runner for each root once
 * its start is admitted.
 *
 * One rule decides what a client may do with a session: the state of its
 * tree, read from the root's durable start. Children inherit it. An unsealed
 * tree does not exist for clients; a tombstoned tree can only finish being
 * deleted; a sealed tree is observed and controlled freely and executed in
 * only while its folder is ready. Core's attachment of a root covers its
 * children, so no second scheduler exists here.
 *
 * Listening is not here: `@nyte-ai/serve/headless` binds this to HTTP, so
 * `host` never depends on `server`.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import type { MutableModels } from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/schema";
import type { Disposer, Nyte, SessionId, SessionInfo, ThinkingLevel } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/core";
import type { Store } from "@nyte-ai/core/store";
import { StartInputSchema } from "@nyte-ai/protocol";
import type {
  Environment,
  EnvironmentCallContext,
  ForgetOutcome,
  IdentityChallenge,
  StartInput,
  StartReceipt,
  UsageSnapshot,
  UsageWindow,
} from "@nyte-ai/protocol";
import type { TelemetryContext } from "@nyte-ai/telemetry";
import { Value } from "typebox/value";
import { createModelPreferencesStore, readCatalog } from "../catalog.ts";
import { environmentId } from "../environment-id.ts";
import { createProviderEnvironment } from "../environment.ts";
import { createHost } from "../index.ts";
import type { HostOptions, HostPlugins } from "../index.ts";
import { catalogForUsage, projectUsageReport, UsageScanner } from "../store-usage.ts";
import type { StoreRead } from "../store-usage.ts";
import { readAccountUsage } from "../usage.ts";
import { createWorkspaceBackend } from "../workspace-backend.ts";
import { WorkspaceStore } from "../workspace-store.ts";
import { grantOf, hostPermissions, principalName } from "./policy.ts";
import type { Grant, HostPermissions, Principal, TreeState } from "./policy.ts";
import type { HostProfile } from "./profile.ts";
import { WorkspaceRegistry } from "./registry.ts";
import { StartJournal, startInputHash } from "./starts.ts";
import type { StartRecord } from "./starts.ts";

export { verifyIdentityChallenge } from "./identity.ts";
export {
  openProfile,
  readProfile,
  profileDirectory,
  ProfileExposed,
  ProfileLocked,
} from "./profile.ts";
export type { HostProfile, ProfilePaths, SavedProfile } from "./profile.ts";
export type { Grant, Principal, TreeState } from "./policy.ts";
export type { RegisteredWorkspace, StartInput, StartReceipt } from "@nyte-ai/protocol";

/** The request as the runtime reads it: the bearer header, nothing else. */
export interface AuthorizingRequest {
  readonly headers: { get(name: string): string | null };
}

export type RuntimeAuthDecision =
  | { readonly kind: "allow"; readonly principal: string }
  | { readonly kind: "deny"; readonly reason: "unauthorized" | "forbidden" };

/**
 * Names callers the bearer does not, on one listener: a relay device behind
 * the account route. Consulted only when the request does not carry the
 * owner token. Returns the device principal, or `undefined` to refuse.
 */
export type DeviceResolver = (request: AuthorizingRequest) => Promise<Principal | undefined>;

type WorkspacePlugins = Extract<HostPlugins, { readonly kind: "workspace" }>;

export interface HostRuntimeOptions {
  readonly profile: HostProfile;
  /** Opened at `profile.storePath` by the caller (a worker store in Bun, SQLite in Node); the runtime closes it, whether opening succeeds or not. */
  readonly store: Store;
  readonly models: MutableModels;
  readonly model: Model<Api>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly telemetry?: TelemetryContext;
  readonly compaction?: HostOptions["compaction"];
  readonly streamOptions?: HostOptions["streamOptions"];
  readonly plugins?: Pick<WorkspacePlugins, "extra" | "sources" | "codemode">;
  /** Canonical directories registration is confined to. */
  readonly roots?: readonly string[];
  readonly onDiagnostic: (message: string) => void;
  /** Time for a provider's account-usage read before Usage paints without it. */
  readonly accountLimitsTimeoutMs?: number;
}

/** The owner's registry operations, as the host's own terminal uses them. */
export interface RuntimeWorkspaces {
  readonly list: WorkspaceRegistry["list"];
  readonly register: WorkspaceRegistry["register"];
  readonly grant: WorkspaceRegistry["grant"];
}

export interface HostRuntime {
  readonly profile: HostProfile;
  /** The SDK as clients see it: trees that are not sealed hidden, deletion tombstoned first and whole. */
  readonly sdk: Nyte;
  readonly environment: Environment;
  readonly workspaces: RuntimeWorkspaces;
  readonly permissions: HostPermissions;
  /** A listener's authorizer: owner token, else a device that listener's resolver names, else refused. */
  authorize(request: AuthorizingRequest, devices?: DeviceResolver): Promise<RuntimeAuthDecision>;
  sign(nonce: string): IdentityChallenge;
  /** `environment.start` for an in-process owner (the host's own terminal). */
  start(principal: Principal, input: StartInput): Promise<StartReceipt>;
  /** Refuse new admission, settle what is in flight, detach, then release everything, reporting every failure. */
  close(): Promise<void>;
}

const STORE_FAILURE = "Couldn't read this host's chat history.";

const DEFAULT_ACCOUNT_LIMITS_TIMEOUT_MS = 10_000;

/** Deeper than any delegation tree Nyte builds; a cycle in stored parents stops here. */
const MAX_TREE_DEPTH = 32;

function bearerDigest(request: AuthorizingRequest): Buffer | undefined {
  const header = request.headers.get("authorization");

  if (header === null) return undefined;
  const space = header.indexOf(" ");

  if (space === -1 || header.slice(0, space).toLowerCase() !== "bearer") return undefined;

  return createHash("sha256")
    .update(header.slice(space + 1).trim())
    .digest();
}

/** Work on one key runs one at a time; a waiter joins the queue behind the holder. */
class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(work, work);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    void settled.then(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });

    return result;
  }
}

export class HostClosing extends Error {
  constructor() {
    super("The host is closing");
    this.name = "HostClosing";
  }
}

/** Every step runs, in order; every failure is reported, none hides another. */
async function releaseAll(steps: readonly (() => Promise<void> | void)[]): Promise<void> {
  const failures: unknown[] = [];

  for (const step of steps) {
    try {
      await step();
    } catch (cause) {
      failures.push(cause);
    }
  }

  if (failures.length > 0) throw new AggregateError(failures, "Failed to close the host runtime");
}

/**
 * Everything the runtime acquires, from the store and profile it is handed to
 * the SDK it builds, is released in reverse by `close()`, or by this factory
 * when anything before the return fails: the caller has no runtime to close.
 */
export async function openHostRuntime(options: HostRuntimeOptions): Promise<HostRuntime> {
  const acquired: (() => Promise<void> | void)[] = [
    () => options.profile.release(),
    () => options.store.close(),
  ];
  const release = (): Promise<void> => releaseAll(acquired.toReversed());

  try {
    return await composeRuntime(options, (step) => acquired.push(step), release);
  } catch (cause) {
    try {
      await release();
    } catch (failure) {
      options.onDiagnostic(`releasing after a failed open: ${String(failure)}`);
    }

    throw cause;
  }
}

async function composeRuntime(
  options: HostRuntimeOptions,
  hold: (release: () => Promise<void> | void) => void,
  release: () => Promise<void>,
): Promise<HostRuntime> {
  const { profile, models, store } = options;
  const registry = new WorkspaceRegistry({ path: profile.registryPath, roots: options.roots });
  const starts = new StartJournal(profile.startsPath);
  hold(() => starts.close());
  const preferences = createModelPreferencesStore();
  const environment = await environmentId();
  const recents = new WorkspaceStore(`${profile.directory}/recents.json`);
  /** Where core puts a root created with no workspace: the one place an unsealed root may be repaired from. */
  const defaultCwd = homedir();

  const sdk = await createHost({
    store,
    models,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    telemetry: options.telemetry,
    compaction: options.compaction,
    streamOptions: options.streamOptions,
    onDiagnostic: (diagnostic) =>
      options.onDiagnostic(
        `${diagnostic.operation} failed (${diagnostic.correlationId}): ${String(diagnostic.cause)}`,
      ),
    workspace: createWorkspaceBackend(recents),
    registeredWorkspace: async (id) => {
      const resolved = await registry.resolve(id);

      return resolved.kind === "ready" ? resolved.path : undefined;
    },
    resolveWorkspace: (cwd) => registry.resolveCwd(cwd),
    plugins: {
      kind: "workspace",
      target: { kind: "home" },
      ...options.plugins,
      onFailure: (failure) => options.onDiagnostic(`plugin ${failure.path}: ${failure.error}`),
    },
  });
  hold(() => sdk.close());

  let closing: Promise<void> | undefined;
  const sessions = new KeyedQueue();
  const workspaces = new KeyedQueue();
  /** Work accepted before closing began; close lets it settle before its dependencies go. */
  const accepted = new Set<Promise<unknown>>();

  const accept = <T>(work: Promise<T>): Promise<T> => {
    const done = (): void => {
      accepted.delete(work);
    };

    accepted.add(work);
    void work.then(done, done);

    return work;
  };

  // -------------------------------------------------------------------------
  // Trees: the root's start decides for every session under it
  // -------------------------------------------------------------------------

  const rootOf = async (id: SessionId): Promise<SessionInfo | undefined> => {
    let current = id;

    for (let depth = 0; depth < MAX_TREE_DEPTH; depth++) {
      const info = await sdk.sessions.get({ sessionId: current });

      if (info === undefined) return undefined;

      if (info.parent === undefined) return info;
      current = info.parent.sessionId;
    }

    return undefined;
  };

  const folderReady = async (root: SessionInfo): Promise<boolean> =>
    root.workspace.id === environment &&
    (await registry.resolveCwd(root.workspace.cwd))?.kind === "trusted";

  const treeState = async (id: SessionId): Promise<TreeState> => {
    const root = await rootOf(id);

    if (root === undefined) return { kind: "unknown" };

    switch (starts.rootState(root.sessionId)) {
      case "unminted":
      case "unsealed":
        return { kind: "unsealed" };
      case "tombstoned":
        return { kind: "tombstoned" };
      case "sealed":
        return { kind: "sealed", ready: await folderReady(root) };
      default:
        return { kind: "unknown" };
    }
  };

  // -------------------------------------------------------------------------
  // Principals and policy
  // -------------------------------------------------------------------------

  const ownerDigest = createHash("sha256").update(profile.token).digest();
  const principals = new Map<string, Principal>();

  const authorize = async (
    request: AuthorizingRequest,
    devices?: DeviceResolver,
  ): Promise<RuntimeAuthDecision> => {
    const presented = bearerDigest(request);

    if (presented === undefined) return { kind: "deny", reason: "unauthorized" };

    if (timingSafeEqual(presented, ownerDigest)) {
      const owner: Principal = { kind: "owner" };
      principals.set(principalName(owner), owner);

      return { kind: "allow", principal: principalName(owner) };
    }

    const device = await devices?.(request);

    if (device === undefined) return { kind: "deny", reason: "forbidden" };
    const name = principalName(device);
    principals.set(name, device);

    return { kind: "allow", principal: name };
  };

  const grantFor = (name: string | undefined): Grant | undefined => {
    if (name === undefined) return undefined;
    const principal = principals.get(name);

    return principal === undefined ? undefined : grantOf(principal);
  };

  const permissions = hostPermissions(grantFor, {
    tree: treeState,
    ready: async (id) => (await registry.resolve(id)).kind === "ready",
  });

  // -------------------------------------------------------------------------
  // Runner attachments: one per sealed root
  // -------------------------------------------------------------------------

  const attachments = new Map<SessionId, Disposer>();

  const attachRoot = (id: SessionId): void => {
    if (closing !== undefined || attachments.has(id)) return;
    attachments.set(id, sdk.attach({ sessions: [id] }));
  };

  const detachRoot = (id: SessionId): void => {
    const dispose = attachments.get(id);
    attachments.delete(id);
    dispose?.();
  };

  // -------------------------------------------------------------------------
  // Deletion: the whole tree, tombstone first
  // -------------------------------------------------------------------------

  /** Children first, then the session: core deletes one row at a time and would strand the rest. */
  const deleteTree = async (id: SessionId): Promise<void> => {
    let cursor: string | undefined;

    do {
      const page = await sdk.sessions.list({ parent: id, includeArchived: true, cursor });

      for (const child of page.items) await deleteTree(child.sessionId);
      cursor = page.next;
    } while (cursor !== undefined);

    await sdk.sessions.delete({ sessionId: id });
  };

  /** Detach, tombstone, delete; a tombstone that is already there is kept, so a retry converges. */
  const deleteRoot = (id: SessionId): Promise<void> =>
    sessions.run(id, async () => {
      detachRoot(id);
      starts.tombstone(id);
      await deleteTree(id);
    });

  // -------------------------------------------------------------------------
  // Durable start
  // -------------------------------------------------------------------------

  const inFlight = new Map<
    string,
    { readonly hash: string; readonly receipt: Promise<StartReceipt> }
  >();

  const modelKnown = async (model: StartInput["model"]): Promise<boolean> => {
    if (model === undefined) return true;
    const listed = await sdk.provider.models.list();

    return listed.some((entry) => entry.id === model.id && entry.provider === model.provider);
  };

  /**
   * The session this record minted exists with exactly the recorded binding:
   * a root in `cwd`. Created here when absent. The one repair: a root a crash
   * left in the host's default folder, still empty, is moved to its folder
   * before anything can happen in it. A root with history, a child, or a
   * root bound to some other real folder is not this start's to touch.
   */
  const ensureBound = async (
    record: StartRecord,
    input: StartInput,
    cwd: string,
  ): Promise<void> => {
    const id = sessionId(record.sessionId);
    const workspace = { kind: "local", id: environment, cwd } as const;
    let info: SessionInfo | undefined = await sdk.sessions.get({ sessionId: id });

    if (info === undefined) {
      info = await sdk.sessions.create({ sessionId: id, name: input.name, workspace });
    }

    if (info.parent !== undefined)
      throw new Error(`Start ${record.requestId} names a child session`);

    if (info.workspace.cwd === cwd && info.workspace.id === environment) return;

    const empty =
      info.heads.every((head) => head.tip === null && head.run === undefined) &&
      info.workspace.id === environment &&
      info.workspace.cwd === defaultCwd;

    if (!empty) {
      throw new Error(
        `Start ${record.requestId} found its session bound to ${info.workspace.cwd}; refusing to move it`,
      );
    }

    const moved = await sdk.relocate({ sessionId: id, workspace });

    if (moved.kind !== "relocated") {
      throw new Error(`Start ${record.requestId} could not bind its workspace: ${moved.kind}`);
    }
  };

  /** Run the steps the record has not reached. Each step is safe to repeat after a crash. */
  const advance = (record: StartRecord, input: StartInput, cwd: string): Promise<StartReceipt> =>
    sessions.run(record.sessionId, async (): Promise<StartReceipt> => {
      let current = record;
      const id = sessionId(current.sessionId);

      if (current.state === "allocated") {
        await ensureBound(current, input, cwd);
        current = starts.advance(current, "created");
      }

      if (current.state === "created") {
        await ensureBound(current, input, cwd);

        if (input.model !== undefined || input.thinkingLevel !== undefined) {
          const configured = await sdk.sessions.configure({
            sessionId: id,
            ...(input.model === undefined ? {} : { model: input.model }),
            ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
          });

          if (configured.kind !== "queued")
            throw new Error(`Start configuration ${configured.kind}`);
        }

        current = starts.advance(current, "configured");
      }

      if (current.state === "configured") {
        await ensureBound(current, input, cwd);
        const receipt = await sdk.messages.send({
          sessionId: id,
          content: input.message.content,
          delivery: input.message.delivery,
          key: current.messageKey,
        });
        current = starts.advance(current, "admitted", receipt.change);
      }

      if (current.state === "deleted") return { kind: "refused", reason: "deleted" };

      if (current.change === undefined) throw new Error("Admitted start without a change");

      // Admitted and sealed: now, and only now, this process drives the root.
      if (starts.rootState(id) === "sealed") attachRoot(id);

      return { kind: "accepted", sessionId: id, change: current.change };
    });

  /**
   * Admission holds the workspace while it resolves, allocates and seals, so
   * `forget` cannot remove the folder under it; the same request converges on
   * one record even while the first attempt is still running.
   */
  const start = async (principal: Principal, input: StartInput): Promise<StartReceipt> => {
    if (closing !== undefined) throw new HostClosing();
    const key = `${principalName(principal)}\0${input.requestId}`;
    const hash = startInputHash(input);
    const running = inFlight.get(key);

    if (running !== undefined)
      return running.hash === hash ? running.receipt : { kind: "conflict" };

    const receipt = workspaces.run(input.workspace.id, async (): Promise<StartReceipt> => {
      const resolved = await registry.resolve(input.workspace.id);

      switch (resolved.kind) {
        case "unknown":
          return { kind: "refused", reason: "workspace_unknown" };
        case "unavailable":
          return { kind: "refused", reason: "workspace_unavailable" };
        case "changed":
        case "untrusted":
          return { kind: "refused", reason: "workspace_untrusted" };
        case "ready":
          break;
        default: {
          const _exhaustive: never = resolved;

          return _exhaustive;
        }
      }

      if (!(await modelKnown(input.model))) return { kind: "refused", reason: "model_unknown" };

      const record = starts.begin({
        principal: principalName(principal),
        requestId: input.requestId,
        inputHash: hash,
        input: JSON.stringify(input),
        workspaceId: input.workspace.id,
        sessionId: randomUUID(),
        messageKey: input.requestId,
      });

      if (record.inputHash !== hash) return { kind: "conflict" };

      if (record.state === "deleted") return { kind: "refused", reason: "deleted" };

      if (record.state === "admitted") {
        if (record.change === undefined) throw new Error("Admitted start without a change");

        return { kind: "accepted", sessionId: sessionId(record.sessionId), change: record.change };
      }

      return advance(record, input, resolved.path);
    });

    inFlight.set(key, { hash, receipt: accept(receipt) });

    try {
      return await receipt;
    } finally {
      inFlight.delete(key);
    }
  };

  /**
   * Startup reconciliation, before this process volunteers as runner.
   * Deletions that began finish. The owner's unfinished starts resume from
   * the step they reached, replaying the input they stored; a device's waits
   * for that device's authenticated retry, since its grant is checked then.
   * A folder that is no longer ready stays pending too.
   */
  const recover = async (): Promise<void> => {
    for (const id of starts.tombstoned()) {
      const root = sessionId(id);

      if ((await sdk.sessions.get({ sessionId: root })) === undefined) continue;

      try {
        await deleteRoot(root);
      } catch (cause) {
        options.onDiagnostic(`deleting ${id} did not finish: ${String(cause)}`);
      }
    }

    for (const record of starts.pending()) {
      if (record.principal !== principalName({ kind: "owner" })) continue;
      let parsed: unknown;

      try {
        parsed = JSON.parse(record.input);
      } catch {
        parsed = undefined;
      }

      if (!Value.Check(StartInputSchema, parsed)) {
        options.onDiagnostic(`start ${record.requestId}: stored input is unreadable; left pending`);
        continue;
      }

      const resolved = await registry.resolve(record.workspaceId);

      if (resolved.kind !== "ready") {
        options.onDiagnostic(
          `start ${record.requestId}: workspace ${record.workspaceId} is ${resolved.kind}; left pending`,
        );
        continue;
      }

      try {
        await advance(record, parsed, resolved.path);
      } catch (cause) {
        options.onDiagnostic(`start ${record.requestId} did not resume: ${String(cause)}`);
      }
    }
  };

  // -------------------------------------------------------------------------
  // The SDK as clients see it
  // -------------------------------------------------------------------------

  const visible = async (id: SessionId): Promise<boolean> =>
    (await treeState(id)).kind === "sealed";

  const owned: Nyte = {
    ...sdk,
    sessions: {
      ...sdk.sessions,
      get: async (input) => {
        const info = await sdk.sessions.get(input);

        return info !== undefined && (await visible(info.sessionId)) ? info : undefined;
      },
      list: async (input) => {
        const page = await sdk.sessions.list(input);
        const kept = await Promise.all(page.items.map((info) => visible(info.sessionId)));

        return { ...page, items: page.items.filter((_, index) => kept[index] === true) };
      },
      snapshot: async (input) =>
        (await visible(input.sessionId)) ? sdk.sessions.snapshot(input) : undefined,
      metadata: async (input) =>
        (await visible(input.sessionId)) ? sdk.sessions.metadata(input) : undefined,
      delete: (input) => {
        if (closing !== undefined) return Promise.reject(new HostClosing());

        return accept(
          (async () => {
            const root = await rootOf(input.sessionId);

            if (root === undefined) return;

            if (root.sessionId === input.sessionId) return deleteRoot(root.sessionId);
            await sessions.run(root.sessionId, () => deleteTree(input.sessionId));
          })(),
        );
      },
    },
  };

  // -------------------------------------------------------------------------
  // Environment
  // -------------------------------------------------------------------------

  const scanner = new UsageScanner(profile.directory);

  const usage = async (window: UsageWindow): Promise<UsageSnapshot> => {
    const scan = await scanner.scan({
      stores: [{ workspacePath: profile.directory, path: profile.storePath }],
      catalog: catalogForUsage(models),
    });
    const [scanned] = scan.stores;

    if (scanned !== undefined && scanned.failure !== null) {
      options.onDiagnostic(`usage: reading ${profile.storePath} failed: ${scanned.failure}`);
    }

    const read: StoreRead =
      scanned === undefined || scanned.failure !== null
        ? { workspacePath: profile.directory, sessions: [], failure: { message: STORE_FAILURE } }
        : { workspacePath: profile.directory, sessions: scanned.sessions, failure: null };

    return {
      ...projectUsageReport([read], window, Date.now()),
      nyteError: null,
      claudeCode: scan.claudeCode,
      codex: scan.codex,
    };
  };

  const providers = createProviderEnvironment({
    catalog: async () => (await readCatalog(models, await preferences.read())).catalog,
    setPreference: async (change) => {
      await preferences.update(change);
    },
    usage,
    accountLimits: () => {
      const signal = AbortSignal.timeout(
        options.accountLimitsTimeoutMs ?? DEFAULT_ACCOUNT_LIMITS_TIMEOUT_MS,
      );

      return Promise.all([
        readAccountUsage({ models, provider: "anthropic", signal }),
        readAccountUsage({ models, provider: "openai-codex", signal }),
      ]);
    },
    login: (...input) => models.login(...input),
    refresh: async (provider, signal) => {
      const refreshed = await models.refresh({ providers: [provider], force: true, signal });

      return !refreshed.aborted && refreshed.errors.size === 0;
    },
    logout: (provider) => models.logout(provider),
  });
  hold(() => providers.close());

  const principalOf = (context: EnvironmentCallContext | undefined): Principal => {
    const principal =
      context?.principal === undefined ? undefined : principals.get(context.principal);

    if (principal === undefined) throw new Error("environment.start needs an authenticated caller");

    return principal;
  };

  /** Any root still recorded in the folder keeps it registered; forgetting would strand it. */
  const rootIn = async (path: string): Promise<SessionId | undefined> => {
    let cursor: string | undefined;

    do {
      const page = await sdk.sessions.list({ parent: null, includeArchived: true, cursor });
      const found = page.items.find((info) => info.workspace.cwd === path);

      if (found !== undefined) return found.sessionId;
      cursor = page.next;
    } while (cursor !== undefined);

    return undefined;
  };

  const forget = (id: string): Promise<ForgetOutcome> =>
    workspaces.run(id, async (): Promise<ForgetOutcome> => {
      const resolved = await registry.resolve(id);

      if (resolved.kind === "unknown") return { kind: "unknown" };
      // A start that has allocated but not yet created its root is a reference too.
      const [recorded] = starts.byWorkspace(id);

      if (recorded !== undefined) return { kind: "busy", sessionId: sessionId(recorded.sessionId) };
      const busy = await rootIn(resolved.path);

      if (busy !== undefined) return { kind: "busy", sessionId: busy };

      return registry.forget(id);
    });

  const hostEnvironment: Environment = {
    ...providers.operations,
    "environment.workspaces.list": () => registry.list(),
    "environment.workspaces.register": (input) => registry.register(input.path),
    "environment.workspaces.trust": (input) => registry.grant(input.id, input.path, input.identity),
    "environment.workspaces.forget": (input) => forget(input.id),
    "environment.start": (input, context) => start(principalOf(context), input),
  };

  // -------------------------------------------------------------------------
  // Lifetime
  // -------------------------------------------------------------------------

  await recover();

  for (const id of starts.admitted()) attachRoot(sessionId(id));

  return {
    profile,
    sdk: owned,
    environment: hostEnvironment,
    workspaces: {
      list: () => registry.list(),
      register: (path) => registry.register(path),
      grant: (id, path, identity) => registry.grant(id, path, identity),
    },
    permissions,
    authorize,
    sign: (nonce) => profile.sign(nonce),
    start,
    close() {
      closing ??= (async () => {
        // No new admission from here on; what was accepted settles before its dependencies close.
        await Promise.allSettled(accepted);

        for (const id of attachments.keys()) detachRoot(id);
        await release();
      })();

      return closing;
    },
  };
}
