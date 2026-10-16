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

export type EnvironmentCapabilities = {
  readonly files: Capability<FilesApi>;
  readonly git: Capability<GitApi>;
  readonly browser: Capability<BrowserApi>;
};

export interface EnvironmentRegistry {
  providers(): readonly EnvironmentProvider[];
  provider(kind: string): EnvironmentProvider | undefined;

  attach(session: SessionId): Promise<ExecutionEnv>;
  wrap(session: SessionId, wrap: EnvironmentWrap): Disposer;
  snapshots(session: SessionId): Promise<SnapshotsApi | null>;

  capabilities(session: SessionId, holder?: PageHolder | null): Promise<EnvironmentCapabilities>;

  detach(session: SessionId): Promise<void>;

  attachWorkspace(workspace: WorkspaceId): Promise<ExecutionEnv>;
  workspaceSnapshots(workspace: WorkspaceId): Promise<SnapshotsApi | null>;
  workspaceCapabilities(
    workspace: WorkspaceId,
    holder?: PageHolder | null,
  ): Promise<EnvironmentCapabilities>;
  detachWorkspace(workspace: WorkspaceId): Promise<void>;
}

export class UnavailableError extends SdkError {
  readonly reason: Extract<Availability, { readonly kind: "unavailable" }>["reason"];

  constructor(reason: UnavailableError["reason"], message: string) {
    super("unavailable", message);
    this.reason = reason;
  }
}

interface Attachment {
  readonly provider: EnvironmentProvider;
  readonly env: ExecutionEnv;
  close(): Promise<void>;
  browser(): BrowserApi | undefined;
  git(): GitApi | undefined;
  snapshots(): SnapshotsApi | null;
}

interface Slot {
  readonly wraps: { readonly wrap: EnvironmentWrap }[];
  version: number;
  attaching: Promise<Attachment> | null;
}

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

  const ensureSessionSlot = (session: SessionId): Slot => {
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
      throw new UnavailableError("unreachable", formatErrorMessage(error));
    });

    if (inspected.availability.kind === "unavailable")
      throw new UnavailableError(
        inspected.availability.reason,
        `Workspace ${workspace} is ${inspected.availability.reason}.`,
      );

    if (inspected.identity !== record.identity)
      throw new UnavailableError(
        "unreachable",
        `Workspace ${workspace} no longer refers to its registered environment.`,
      );

    const attached = await serving.attach(record.target);

    if (attached.identity !== record.identity) {
      await attached.close();

      throw new UnavailableError(
        "unreachable",
        `Workspace ${workspace} changed while its environment was attached.`,
      );
    }

    return attachment(kernel, serving, attached, scope, slot);
  };

  const attaching = (session: SessionId): Promise<Attachment> => {
    const slot = ensureSessionSlot(session);

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

  const inspectEnvironmentCapabilities = async (
    attached: Promise<Attachment>,
    holder: PageHolder | null,
  ): Promise<EnvironmentCapabilities> => {
    let found: Attachment;

    try {
      found = await attached;
    } catch (error) {
      const failure = classifyCapabilityFailure(error);

      return { files: failure, git: failure, browser: failure };
    }

    const git = found.git();
    const browser = found.browser();

    return {
      files:
        classifyFileSupport(found.provider) === "unsupported"
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
      const slot = ensureSessionSlot(session);
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
    capabilities: (session, holder) =>
      inspectEnvironmentCapabilities(attaching(session), holder ?? null),
    async detach(session) {
      const slot = sessions.get(session);

      if (slot === undefined) return;
      const attached = slot.attaching;
      slot.attaching = null;

      if (slot.wraps.length === 0 && sessions.get(session) === slot) sessions.delete(session);
      await (await attached?.catch(() => null))?.close();
    },
    attachWorkspace: async (workspace) => (await attachingWorkspace(workspace)).env,
    async workspaceSnapshots(workspace) {
      return (await attachingWorkspace(workspace).catch(() => null))?.snapshots() ?? null;
    },
    workspaceCapabilities: (workspace, holder) =>
      inspectEnvironmentCapabilities(attachingWorkspace(workspace), holder ?? null),
    async detachWorkspace(workspace) {
      const known = workspaces.get(workspace);
      workspaces.delete(workspace);
      await (await known?.catch(() => null))?.close();
    },
  };
}

export function classifyFileSupport(
  provider: EnvironmentProvider | undefined,
): Extract<Capability<FilesApi>["kind"], "available" | "unsupported"> {
  return provider?.snapshots === undefined ? "unsupported" : "available";
}

export async function inspectWorkspaceAvailability(
  kernel: Kernel,
  workspace: Pick<WorkspaceRecord, "target" | "identity">,
): Promise<Availability> {
  const serving = kernel.environments.provider(workspace.target.kind);

  if (serving === undefined) return { kind: "unavailable", reason: "unsupported" };

  try {
    const inspected = await serving.inspect(workspace.target);

    return inspected.availability.kind === "unavailable" ||
      inspected.identity === workspace.identity
      ? inspected.availability
      : { kind: "unavailable", reason: "unreachable" };
  } catch {
    return { kind: "unavailable", reason: "unreachable" };
  }
}

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

export async function workspaceRecords(kernel: Kernel): Promise<readonly WorkspaceRecord[]> {
  const refs = await kernel.store.refs.list("workspaces/");
  const found = await Promise.all(refs.map((ref) => load(kernel, ref, decodeWorkspaceRecord)));

  return found.flatMap((entry) => (entry === null ? [] : [entry.record]));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireWorkspace(kernel: Kernel, workspace: WorkspaceId): Promise<WorkspaceRecord> {
  const record = await readWorkspace(kernel, workspace);

  if (record === null)
    throw new SdkError("unknown", `Workspace ${workspace} is not registered on this host.`);

  return record;
}

function classifyCapabilityFailure(
  error: unknown,
): Extract<Capability<never>, { readonly kind: "unsupported" | "unavailable" }> {
  const reason = formatErrorMessage(error);

  if (error instanceof UnavailableError && error.reason === "unsupported")
    return { kind: "unsupported", reason };

  return error instanceof SdkError && error.code === "unknown"
    ? { kind: "unavailable", retry: "manual", reason }
    : { kind: "unavailable", retry: "allowed", reason };
}

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

  let running = 0;
  let closing = false;

  const closeIdle = async (): Promise<void> => {
    if (closing && running === 0) await base.close();
  };

  const env: ExecutionEnv = {
    identity: base.identity,
    cwd: base.cwd,
    get files() {
      return current().files;
    },
    async exec(command, options) {
      const job = await current().env.exec(command, options);
      running += 1;

      void job
        .settled()
        .catch(() => undefined)
        .finally(() => {
          running -= 1;
          void closeIdle().catch(() => undefined);
        });

      return job;
    },
    close: async () => undefined,
  };

  let git: GitApi | undefined;
  let snapshots: SnapshotsApi | null | undefined;
  let own: BrowserApi | undefined;

  return {
    provider,
    env,
    async close() {
      if (closing) return;
      closing = true;
      await closeIdle();
    },
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
