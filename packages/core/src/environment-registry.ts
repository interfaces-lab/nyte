import type {
  Authority,
  Availability,
  Capability,
  Declaration,
  Disposer,
  SessionId,
  WorkspaceId,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import type { BrowserApi } from "./browser.ts";
import type {
  EnvironmentProvider,
  EnvironmentWrap,
  ExecutionEnv,
  SnapshotsApi,
} from "./environment.ts";
import { SdkError } from "./error.ts";
import { wrapFiles } from "./files-wrap.ts";
import type { FileScope } from "./files-wrap.ts";
import type { FilesApi } from "./files.ts";
import type { GitApi } from "./git.ts";
import type { Kernel } from "./kernel.ts";
import { wrapBrowser } from "./pages.ts";
import type { PageHolder } from "./pages.ts";
import { requireAuthority } from "./principals.ts";
import { decodeWorkspaceRecord } from "./records.ts";
import type { WorkspaceRecord } from "./records.ts";
import { workspaceRef } from "./refs.ts";
import { load, requireSession } from "./session-state.ts";

/** Returns `A`; fails to compile unless every member of `A` is in `B`. */
type Within<A extends B, B> = A;

/** Names a capability a workspace serves: `files` wherever an environment attaches, and the optional `EnvironmentProvider` members that supply the rest. Equal to `Declaration.capability`, which schema writes as a literal union (§16); this alias fails to compile when the two drift. */
export type CapabilityName = Within<
  NonNullable<Declaration<unknown, unknown>["capability"]>,
  Within<
    "files" | keyof Pick<EnvironmentProvider, "git" | "browser">,
    NonNullable<Declaration<unknown, unknown>["capability"]>
  >
>;

/** Returns one `Capability` per `CapabilityName`: what a workspace's `files()`, `git()` and `browser()` answer. */
export type EnvironmentCapabilities = {
  readonly files: Capability<FilesApi>;
  readonly git: Capability<GitApi>;
  readonly browser: Capability<BrowserApi>;
};

/** Holds the environment providers the loaded plugins supply and the environments attached through them: one per session, its plugins' wraps layered on, and one per workspace for callers outside a session (a client's `Workspace`, a job started without a session). One per kernel (`kernel.environments`), built on first use; `kernel.env`, `kernel.wrapEnv` and `kernel.snapshots` read it. */
export interface EnvironmentRegistry {
  /** Returns every provider, one per kind: the `environment` of each of `kernel.hostPlugins` in registration order, then those only a session's runtime has active (`PluginRuntime.plugins()`). The decision-13 built-ins supply none. A kind supplied twice keeps the first; a runtime's preflight already rejects the second within one load. */
  providers(): readonly EnvironmentProvider[];
  /** Returns the provider serving a workspace target kind, as `providers()` orders them, or undefined when no loaded plugin supplies it. */
  provider(kind: string): EnvironmentProvider | undefined;
  /** Resolves a session's environment, attached once per session: the provider of its workspace's target kind attaches the target. Throws `unknown` when the session or its workspace record is gone, `unavailable` when no provider serves the kind or its `inspect` answers unavailable, and the attach's own error otherwise, the next call attaching again. Resolves one stable `ExecutionEnv` per attachment: `identity` and `cwd` pass through; `exec` and the `browser` a wrap adds resolve through the session's wraps applied over the attached env in registration order, and `files` through the same stack with core's `upload` and `batch()` laid over it (`wrapFiles` in this session). A wrap added or removed later is applied lazily: the stack is rebuilt from the attached env on the first use after the change, so an env a plugin api resolved before another plugin's `wrapEnv` sees that wrap too. Its `close` leaves the attachment open; `detach` closes it. What `kernel.env(session)` resolves. */
  attach(session: SessionId): Promise<ExecutionEnv>;
  /** Adds a wrap to a session's stack after those added before it; the disposer removes it. Attaches nothing and never waits. What `kernel.wrapEnv` and `PluginApi.wrapEnv` do. */
  wrap(session: SessionId, wrap: EnvironmentWrap): Disposer;
  /** Resolves the run snapshots of a session's environment: the provider's `snapshots` applied to the env `attach` resolves, built once per attachment; null when the provider supplies none or the environment does not attach. What `kernel.snapshots(session)` resolves. */
  snapshots(session: SessionId): Promise<SnapshotsApi | null>;
  /** Resolves a session's capabilities for an authority, starting nothing beyond the attachment; pages opened or adopted through its browser are held through `kernel.pages` by `holder` (`wrapBrowser`, §37i), null for a client. Without participant authority each is `denied`. When the environment does not attach, each is `unsupported` if no provider serves the kind or its `inspect` answers unsupported, and `unavailable` otherwise (`retry: "allowed"`, the reason the attach or `inspect` gave). Attached: `files` is `available` with the env's files (core's `upload` and batch receipts in this session); `git` is `available` with the provider's `git` applied to the env, its writes checking owner authority, else `unsupported`; `browser` is `available` with the browser the wrap stack adds, else the provider's `browser` applied to the env, held through the page table, else `unsupported`. */
  capabilities(
    session: SessionId,
    authority: ReadonlySet<Authority>,
    holder?: PageHolder | null,
  ): Promise<EnvironmentCapabilities>;
  /** Closes a session's environment; the next `attach` attaches again, for the session's workspace then. Its wraps stay for that attach (a plugin's wrap goes when the plugin deactivates), and a session left with none is forgotten. A session never attached resolves at once. What removing a session and moving it to another workspace do. */
  detach(session: SessionId): Promise<void>;
  /** Resolves a workspace's own environment: its provider attaching its target once, no wraps, shared by every caller outside a session; its `files` carry core's `upload` and a `batch()` whose receipt is held in memory (§37b). Fails as `attach` does. */
  attachWorkspace(workspace: WorkspaceId): Promise<ExecutionEnv>;
  /** Resolves the run snapshots of a workspace's own environment, as `snapshots` does over `attachWorkspace`: what `Workspace.changes` and `patches` read outside a session (§37f). */
  workspaceSnapshots(workspace: WorkspaceId): Promise<SnapshotsApi | null>;
  /** Resolves a workspace's own capabilities for an authority, as `capabilities` does over `attachWorkspace`. */
  workspaceCapabilities(
    workspace: WorkspaceId,
    authority: ReadonlySet<Authority>,
    holder?: PageHolder | null,
  ): Promise<EnvironmentCapabilities>;
  /** Closes a workspace's own environment; the next `attachWorkspace` attaches again. What `forget` and `reload` do. */
  detachWorkspace(workspace: WorkspaceId): Promise<void>;
}

/** Returns one attachment: the provider and env it came from, the stable env callers hold, and the browser, git and snapshots built from it on first use. */
interface Attachment {
  readonly provider: EnvironmentProvider;
  readonly base: ExecutionEnv;
  readonly env: ExecutionEnv;
  browser(): BrowserApi | undefined;
  git(): GitApi | undefined;
  snapshots(): SnapshotsApi | null;
}

/** Returns a wrap stack as last built: the version it was built at, the env on top, its files with core's members laid over them, and the browser a wrap added. */
interface Built {
  readonly version: number;
  readonly env: ExecutionEnv;
  readonly files: FilesApi;
  readonly browser: BrowserApi | undefined;
}

/** Returns a session's wrap stack and its attachment; `version` moves with every change to the stack. */
interface Slot {
  readonly wraps: { readonly wrap: EnvironmentWrap }[];
  version: number;
  attaching: Promise<Attachment> | null;
}

/** Returns a kernel's environment registry with nothing attached: what `kernel.environments` holds, built on first use once the kernel object exists. */
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
      throw new SdkError("unavailable", `No environment provider serves ${record.target.kind}.`);
    const inspected = await serving.inspect(record.target);

    if (inspected.availability.kind === "unavailable")
      throw new SdkError(
        "unavailable",
        `Workspace ${workspace} is ${inspected.availability.reason}.`,
      );

    return attachment(kernel, serving, await serving.attach(record.target), scope, slot);
  };

  const attaching = (session: SessionId): Promise<Attachment> => {
    const slot = slotOf(session);

    if (slot.attaching !== null) return slot.attaching;

    const started = requireSession(kernel, session).then((found) =>
      open(found.record.workspace, { session }, slot),
    );

    slot.attaching = started;
    started.catch(() => {
      if (slot.attaching === started) slot.attaching = null;
    });

    return started;
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
    attached: () => Promise<Attachment>,
    workspace: () => Promise<WorkspaceId>,
    authority: ReadonlySet<Authority>,
    holder: PageHolder | null,
  ): Promise<EnvironmentCapabilities> => {
    if (!authority.has("participant")) {
      const reason = "This principal lacks participant authority.";

      return {
        files: { kind: "denied", reason },
        git: { kind: "denied", reason },
        browser: { kind: "denied", reason },
      };
    }

    let found: Attachment;

    try {
      found = await attached();
    } catch (error) {
      const failure = await failureOf(kernel, await workspace().catch(() => null), error);

      return { files: failure, git: failure, browser: failure };
    }

    const git = found.git();
    const browser = found.browser();

    return {
      files: { kind: "available", api: found.env.files },
      git:
        git === undefined
          ? { kind: "unsupported", reason: `The ${found.provider.kind} provider serves no git.` }
          : { kind: "available", api: guardGit(git, authority) },
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
    capabilities: (session, authority, holder) =>
      capabilitiesOf(
        () => attaching(session),
        async () => (await requireSession(kernel, session)).record.workspace,
        authority,
        holder ?? null,
      ),
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
    workspaceCapabilities: (workspace, authority, holder) =>
      capabilitiesOf(
        () => attachingWorkspace(workspace),
        async () => workspace,
        authority,
        holder ?? null,
      ),
    async detachWorkspace(workspace) {
      const known = workspaces.get(workspace);
      workspaces.delete(workspace);
      const attached = await known?.catch(() => null);
      await attached?.base.close();
    },
  };
}

/** Returns whether a target can be served: `unsupported` when no loaded plugin provides its kind, else what the provider's `inspect` says, `unreachable` when `inspect` throws. */
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

/** Returns a registered workspace's record, or null when `workspaces/<id>` is absent. */
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

async function requireWorkspace(kernel: Kernel, workspace: WorkspaceId): Promise<WorkspaceRecord> {
  const record = await readWorkspace(kernel, workspace);

  if (record === null)
    throw new SdkError("unknown", `Workspace ${workspace} is not registered on this host.`);

  return record;
}

/** Returns what every capability answers when the environment does not attach: `unsupported` when no provider serves the workspace's kind or its `inspect` says unsupported, else `unavailable` with the reason, a retry allowed. */
async function failureOf(
  kernel: Kernel,
  workspace: WorkspaceId | null,
  error: unknown,
): Promise<Extract<Capability<never>, { readonly kind: "unsupported" | "unavailable" }>> {
  const record = workspace === null ? null : await readWorkspace(kernel, workspace);
  const reason = error instanceof Error ? error.message : String(error);

  if (record === null) return { kind: "unavailable", retry: "manual", reason };
  const availability = await availabilityOf(kernel, record.target);

  return availability.kind === "unavailable" && availability.reason === "unsupported"
    ? { kind: "unsupported", reason }
    : { kind: "unavailable", retry: "allowed", reason };
}

/** Returns an attachment over a provider's env: with a slot, `files`, `exec` and `browser` go through the slot's wraps, the stack rebuilt from `base` whenever its version moved; `files` carries core's `upload` and `batch()` in `scope`. */
function attachment(
  kernel: Kernel,
  provider: EnvironmentProvider,
  base: ExecutionEnv,
  scope: FileScope,
  slot: Slot | null,
): Attachment {
  let built: Built | null = null;

  const current = (): Built => {
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

/** Returns a git capability whose writes check owner authority; reads pass through (§37: the capability itself is participant's). */
function guardGit(git: GitApi, authority: ReadonlySet<Authority>): GitApi {
  const owner = (operation: string): void =>
    requireAuthority(authority, "owner", `git.${operation}`);

  return {
    status: () => git.status(),
    watch: () => git.watch(),
    changes: (scope, options) => git.changes(scope, options),
    watchChanges: (scope, options) => git.watchChanges(scope, options),
    patches: (scope, paths, options) => git.patches(scope, paths, options),
    contents: (path, scope) => git.contents(path, scope),
    log: (input) => git.log(input),
    refs: () => git.refs(),
    blame: (path) => git.blame(path),
    async stage(paths, options) {
      owner("stage");

      return git.stage(paths, options);
    },
    async unstage(paths, options) {
      owner("unstage");

      return git.unstage(paths, options);
    },
    async discard(paths, options) {
      owner("discard");

      return git.discard(paths, options);
    },
    async commit(input, options) {
      owner("commit");

      return git.commit(input, options);
    },
    async branch(input, options) {
      owner("branch");

      return git.branch(input, options);
    },
    async push(input, options) {
      owner("push");

      return git.push(input, options);
    },
  };
}
