import type {
  Availability,
  Capability,
  ChangeSet,
  DiffOptions,
  Disposer,
  EnvironmentIdentity,
  PatchEntry,
  RunId,
  SessionId,
  SnapshotId,
  WorkspaceId,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { wrapBrowser } from "./browser.ts";
import type { BrowserApi, PageHolder } from "./browser.ts";
import { SdkError } from "./error.ts";
import { wrapFiles } from "./files.ts";
import type { FileScope, FilesApi } from "./files.ts";
import type { GitApi } from "./git.ts";
import type { Job } from "./jobs.ts";
import type { Kernel } from "./kernel.ts";
import { decodeWorkspaceRecord } from "./records.ts";
import type { WorkspaceRecord } from "./records.ts";
import { workspaceRef } from "./refs.ts";
import { load, requireSession } from "./session-state.ts";

export interface ExecutionEnv {
  readonly identity: EnvironmentIdentity;
  readonly cwd: string;
  readonly files: FilesApi;
  exec(
    command: string | readonly string[],
    options?: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
      readonly signal?: AbortSignal;
      readonly pty?: { readonly columns: number; readonly rows: number };
    },
  ): Promise<Job>;
  close(): Promise<void>;
}

export type EnvironmentWrap = (
  inner: ExecutionEnv,
) => ExecutionEnv & { readonly browser?: BrowserApi };

export interface SnapshotsApi {
  before(run: RunId): Promise<SnapshotId>;
  after(run: RunId): Promise<SnapshotId>;
  diff(from: SnapshotId, to: SnapshotId): Promise<ChangeSet>;
  patches(
    from: SnapshotId,
    to: SnapshotId,
    paths: readonly string[],
    options?: DiffOptions,
  ): Promise<readonly PatchEntry[]>;
}

export interface EnvironmentProvider {
  readonly kind: string;
  inspect(target: WorkspaceTarget): Promise<{
    readonly identity: EnvironmentIdentity;
    readonly availability: Availability;
    readonly projectSources: readonly string[];
  }>;
  attach(target: WorkspaceTarget): Promise<ExecutionEnv>;
  readonly git?: (env: ExecutionEnv) => GitApi | undefined;
  readonly snapshots?: (env: ExecutionEnv) => SnapshotsApi | undefined;
  readonly browser?: (env: ExecutionEnv) => BrowserApi;
  destroy?(target: WorkspaceTarget): Promise<void>;
}

export interface Resources {
  readonly user: FilesApi | null;
  readonly project: FilesApi | null;
  readonly skills: readonly {
    readonly name: string;
    readonly location: string;
    readonly scope: "user" | "project" | "path";
    readonly description: string;
  }[];
  readonly contextFiles: readonly {
    readonly path: string;
    readonly scope: "user" | "ancestor" | "project";
    readonly content: string;
  }[];
  readonly prompt: {
    readonly system: string | null;
    readonly append: string | null;
    readonly scope: "user" | "project" | null;
  };
  readonly prompts: readonly {
    readonly name: string;
    readonly location: string;
    readonly scope: "user" | "project";
  }[];
}

/** Returns what a workspace's `files()`, `git()` and `browser()` answer. */
export type EnvironmentCapabilities = {
  readonly files: Capability<FilesApi>;
  readonly git: Capability<GitApi>;
  readonly browser: Capability<BrowserApi>;
};

/** Holds the environment providers the loaded plugins supply and the environments attached through them: one per session with its plugins' wraps, one per workspace for callers outside a session. A session's attach settles once and is kept, a failure included, until `detach`. */
export interface EnvironmentRegistry {
  /** Returns one provider per kind: the host plugins' in registration order, then those only a session's runtime has active. */
  providers(): readonly EnvironmentProvider[];
  provider(kind: string): EnvironmentProvider | undefined;
  /** Resolves a session's environment: `exec`, `files` and a wrap's `browser` go through the session's wraps, rebuilt lazily when one is added or removed; `files` carries core's `upload` and `batch()`. Rejects with `UnavailableError` when no provider serves the kind or `inspect` answers unavailable. */
  attach(session: SessionId): Promise<ExecutionEnv>;
  wrap(session: SessionId, wrap: EnvironmentWrap): Disposer;
  snapshots(session: SessionId): Promise<SnapshotsApi | null>;
  /** Resolves a session's capabilities; pages its browser opens are held through `kernel.pages` by `holder`. */
  capabilities(session: SessionId, holder?: PageHolder | null): Promise<EnvironmentCapabilities>;
  /** Closes a session's environment; the next `attach` attaches again. */
  detach(session: SessionId): Promise<void>;
  /** Resolves a workspace's own environment, no wraps; a failed attach is tried again by the next call. */
  attachWorkspace(workspace: WorkspaceId): Promise<ExecutionEnv>;
  workspaceSnapshots(workspace: WorkspaceId): Promise<SnapshotsApi | null>;
  workspaceCapabilities(
    workspace: WorkspaceId,
    holder?: PageHolder | null,
  ): Promise<EnvironmentCapabilities>;
  detachWorkspace(workspace: WorkspaceId): Promise<void>;
}

/** Throws when no provider serves a workspace's kind or its `inspect` answers unavailable; `reason` is the availability's, from which the activation and the capabilities are derived. */
export class UnavailableError extends SdkError {
  readonly reason: Extract<Availability, { readonly kind: "unavailable" }>["reason"];

  constructor(reason: UnavailableError["reason"], message: string) {
    super("unavailable", message);
    this.reason = reason;
  }
}

/** Returns one attachment and what is built from it on first use. */
interface Attachment {
  readonly provider: EnvironmentProvider;
  readonly base: ExecutionEnv;
  readonly env: ExecutionEnv;
  browser(): BrowserApi | undefined;
  git(): GitApi | undefined;
  snapshots(): SnapshotsApi | null;
}

/** Returns a session's wraps and its attach; `version` moves with every change to the wraps. */
interface Slot {
  readonly wraps: { readonly wrap: EnvironmentWrap }[];
  version: number;
  attaching: Promise<Attachment> | null;
}

/** Returns a kernel's environment registry with nothing attached. */
export function createEnvironmentRegistry(kernel: Kernel): EnvironmentRegistry {
  const sessions = new Map<SessionId, Slot>();
  const workspaces = new Map<WorkspaceId, Promise<Attachment>>();

  const providers = (): readonly EnvironmentProvider[] => {
    const byKind = new Map<string, EnvironmentProvider>();

    const plugins = [
      ...kernel.hostPlugins,
      ...[...kernel.runtimes().values()].flatMap((runtime) => runtime.plugins()),
    ];

    for (const plugin of plugins) {
      const provider = plugin.environment;

      if (provider !== undefined && !byKind.has(provider.kind)) byKind.set(provider.kind, provider);
    }

    return [...byKind.values()];
  };

  const provider = (kind: string): EnvironmentProvider | undefined =>
    providers().find((candidate) => candidate.kind === kind);

  const slotOf = (session: SessionId): Slot => {
    const known = sessions.get(session);

    if (known !== undefined) return known;
    const created: Slot = { wraps: [], version: 0, attaching: null };
    sessions.set(session, created);

    return created;
  };

  const open = async (
    workspace: WorkspaceId,
    scope: FileScope,
    slot: Slot | null,
  ): Promise<Attachment> => {
    const record = await requireWorkspace(kernel, workspace);
    const serving = provider(record.target.kind);

    if (serving === undefined)
      throw new UnavailableError(
        "unsupported",
        `No environment provider serves ${record.target.kind}.`,
      );

    const inspected = await serving.inspect(record.target).catch((error: unknown) => {
      throw new UnavailableError("unreachable", messageOf(error));
    });

    if (inspected.availability.kind === "unavailable")
      throw new UnavailableError(
        inspected.availability.reason,
        `Workspace ${workspace} is ${inspected.availability.reason}.`,
      );

    return attachment(kernel, serving, await serving.attach(record.target), scope, slot);
  };

  const attaching = (session: SessionId): Promise<Attachment> => {
    const slot = slotOf(session);

    slot.attaching ??= requireSession(kernel, session).then((found) =>
      open(found.record.workspace, { session }, slot),
    );

    return slot.attaching;
  };

  const attachingWorkspace = (workspace: WorkspaceId): Promise<Attachment> => {
    const known = workspaces.get(workspace);

    if (known !== undefined) return known;
    const started = open(workspace, { workspace }, null);
    workspaces.set(workspace, started);
    started.catch(() => {
      if (workspaces.get(workspace) === started) workspaces.delete(workspace);
    });

    return started;
  };

  const capabilitiesOf = async (
    attached: Promise<Attachment>,
    holder: PageHolder | null,
  ): Promise<EnvironmentCapabilities> => {
    let found: Attachment;

    try {
      found = await attached;
    } catch (error) {
      const failure = failureOf(error);

      return { files: failure, git: failure, browser: failure };
    }

    const git = found.git();
    const browser = found.browser();

    return {
      files:
        filesOf(found.provider) === "unsupported"
          ? { kind: "unsupported", reason: `The ${found.provider.kind} provider serves no files.` }
          : { kind: "available", api: found.env.files },
      git:
        git === undefined
          ? { kind: "unsupported", reason: `The ${found.provider.kind} provider serves no git.` }
          : { kind: "available", api: git },
      browser:
        browser === undefined
          ? {
              kind: "unsupported",
              reason: `The ${found.provider.kind} provider serves no browser.`,
            }
          : { kind: "available", api: wrapBrowser(kernel, browser, holder) },
    };
  };

  return {
    providers,
    provider,
    attach: async (session) => (await attaching(session)).env,
    wrap(session, wrap) {
      const slot = slotOf(session);
      const entry = { wrap };
      slot.wraps.push(entry);
      slot.version += 1;

      return () => {
        const index = slot.wraps.indexOf(entry);

        if (index < 0) return;
        slot.wraps.splice(index, 1);
        slot.version += 1;
      };
    },
    async snapshots(session) {
      return (await attaching(session).catch(() => null))?.snapshots() ?? null;
    },
    capabilities: (session, holder) => capabilitiesOf(attaching(session), holder ?? null),
    async detach(session) {
      const slot = sessions.get(session);

      if (slot === undefined) return;
      const attached = slot.attaching;
      slot.attaching = null;

      if (slot.wraps.length === 0 && sessions.get(session) === slot) sessions.delete(session);
      await (await attached?.catch(() => null))?.base.close();
    },
    attachWorkspace: async (workspace) => (await attachingWorkspace(workspace)).env,
    async workspaceSnapshots(workspace) {
      return (await attachingWorkspace(workspace).catch(() => null))?.snapshots() ?? null;
    },
    workspaceCapabilities: (workspace, holder) =>
      capabilitiesOf(attachingWorkspace(workspace), holder ?? null),
    async detachWorkspace(workspace) {
      const known = workspaces.get(workspace);
      workspaces.delete(workspace);
      await (await known?.catch(() => null))?.base.close();
    },
  };
}

/** Returns the kind of a workspace's files capability for its provider: the baseline requires `snapshots` "wherever files are served", so a provider without it (chat-only) or no provider at all answers `unsupported`. */
export function filesOf(
  provider: EnvironmentProvider | undefined,
): Extract<Capability<FilesApi>["kind"], "available" | "unsupported"> {
  return provider?.snapshots === undefined ? "unsupported" : "available";
}

/** Returns whether a target can be served: `unsupported` without a provider for its kind, `unreachable` when `inspect` throws. */
export async function availabilityOf(
  kernel: Kernel,
  target: WorkspaceTarget,
): Promise<Availability> {
  const serving = kernel.environments.provider(target.kind);

  if (serving === undefined) return { kind: "unavailable", reason: "unsupported" };

  try {
    return (await serving.inspect(target)).availability;
  } catch {
    return { kind: "unavailable", reason: "unreachable" };
  }
}

/** Returns a registered workspace's record, or null. */
export async function readWorkspace(
  kernel: Kernel,
  workspace: WorkspaceId,
): Promise<WorkspaceRecord | null> {
  return (
    (
      await load(
        kernel,
        await kernel.store.refs.get(workspaceRef(workspace)),
        decodeWorkspaceRecord,
      )
    )?.record ?? null
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireWorkspace(kernel: Kernel, workspace: WorkspaceId): Promise<WorkspaceRecord> {
  const record = await readWorkspace(kernel, workspace);

  if (record === null)
    throw new SdkError("unknown", `Workspace ${workspace} is not registered on this host.`);

  return record;
}

/** Returns what every capability answers for an attach that failed, from the failure itself. */
function failureOf(
  error: unknown,
): Extract<Capability<never>, { readonly kind: "unsupported" | "unavailable" }> {
  const reason = messageOf(error);

  if (error instanceof UnavailableError && error.reason === "unsupported")
    return { kind: "unsupported", reason };

  return error instanceof SdkError && error.code === "unknown"
    ? { kind: "unavailable", retry: "manual", reason }
    : { kind: "unavailable", retry: "allowed", reason };
}

/** Returns an attachment over a provider's env; with a slot, `files`, `exec` and `browser` go through its wraps. */
function attachment(
  kernel: Kernel,
  provider: EnvironmentProvider,
  base: ExecutionEnv,
  scope: FileScope,
  slot: Slot | null,
): Attachment {
  let built: {
    readonly version: number;
    readonly env: ExecutionEnv;
    readonly files: FilesApi;
    readonly browser: BrowserApi | undefined;
  } | null = null;

  const current = () => {
    const version = slot?.version ?? 0;

    if (built !== null && built.version === version) return built;
    let env: ExecutionEnv = base;
    let browser: BrowserApi | undefined;

    for (const { wrap } of slot?.wraps ?? []) {
      const next = wrap(env);
      browser = next.browser ?? browser;
      env = next;
    }

    built = { version, env, files: wrapFiles(kernel, scope, env.files), browser };

    return built;
  };

  const env: ExecutionEnv = {
    identity: base.identity,
    cwd: base.cwd,
    get files() {
      return current().files;
    },
    exec: (command, options) => current().env.exec(command, options),
    close: async () => undefined,
  };

  let git: GitApi | undefined;
  let snapshots: SnapshotsApi | null | undefined;
  let own: BrowserApi | undefined;

  return {
    provider,
    base,
    env,
    browser() {
      const wrapped = current().browser;

      if (wrapped !== undefined) return wrapped;
      own ??= provider.browser?.(env);

      return own;
    },
    git() {
      git ??= provider.git?.(env);

      return git;
    },
    snapshots() {
      snapshots ??= provider.snapshots?.(env) ?? null;

      return snapshots;
    },
  };
}
