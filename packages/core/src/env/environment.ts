import type { Availability, Capability, SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { decodeWorkspaceRecord } from "../contract/records.ts";
import type { WorkspaceRecord } from "../contract/records.ts";
import type {
  BatchEntry,
  BrowserApi,
  EnvironmentCapabilities,
  EnvironmentProvider,
  EnvironmentRegistry,
  EnvironmentWrap,
  ExecutionEnv,
  FileBatch,
  FilesApi,
  FileScope,
  GitApi,
  PageHolder,
  SnapshotsApi,
} from "../contract/workspace.ts";
import { applyBatch } from "../engine/batches.ts";
import { workspaceRef } from "../store/refs.ts";
import { load, requireSession } from "../store/session.ts";
import { SdkError } from "../util/error.ts";
import { wrapBrowser } from "./browser.ts";
import type { StoreConnection } from "../contract/store.ts";

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
    const record = await requireWorkspace(kernel.store, workspace);
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

    slot.attaching ??= requireSession(kernel.store, session).then((found) =>
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
  store: StoreConnection,
  workspace: WorkspaceId,
): Promise<WorkspaceRecord | null> {
  return (
    (await load(store, await store.refs.get(workspaceRef(workspace)), decodeWorkspaceRecord))
      ?.record ?? null
  );
}

export async function workspaceRecords(
  store: StoreConnection,
): Promise<readonly WorkspaceRecord[]> {
  const refs = await store.refs.list("workspaces/");
  const found = await Promise.all(refs.map((ref) => load(store, ref, decodeWorkspaceRecord)));

  return found.flatMap((entry) => (entry === null ? [] : [entry.record]));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireWorkspace(
  store: StoreConnection,
  workspace: WorkspaceId,
): Promise<WorkspaceRecord> {
  const record = await readWorkspace(store, workspace);

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

function wrapFiles(kernel: Kernel, scope: FileScope, files: FilesApi): FilesApi {
  const plan = (entries: readonly BatchEntry[]): FileBatch => ({
    put: (input) => plan([...entries, { kind: "put", ...input }]),
    remove: (input) => plan([...entries, { kind: "remove", ...input }]),
    apply: () => applyBatch(kernel, scope, files, entries),
  });

  return {
    read: (path) => files.read(path),
    bytes: (path) => files.bytes(path),
    stat: (path) => files.stat(path),
    write: (path, contents, options) => files.write(path, contents, options),
    remove: (path, options) => files.remove(path, options),
    batch: () => plan([]),
    format: (path, contents) => files.format(path, contents),
    scan: (input) => files.scan(input),
    find: (input) => files.find(input),
    search: (input) => files.search(input),
    watch: (input) => files.watch(input),
    upload: (source) => kernel.store.objects.putBlob(source),
  };
}
