import type {
  Authority,
  Capability,
  Declaration,
  Disposer,
  SessionId,
  WorkspaceId,
} from "@nyte-ai/schema";
import type { BrowserApi } from "./browser.ts";
import type { EnvironmentProvider, EnvironmentWrap, ExecutionEnv } from "./environment.ts";
import type { FilesApi } from "./files.ts";
import type { GitApi } from "./git.ts";
import type { Kernel, RunSnapshots } from "./kernel.ts";

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
  /** Resolves a session's environment, attached once per session: the provider of its workspace's target kind attaches the target. Throws `unknown` when the session or its workspace record is gone, `unavailable` when no provider serves the kind or its `inspect` answers unavailable, and the attach's own error otherwise, the next call attaching again. Resolves one stable `ExecutionEnv` per attachment: `identity` and `cwd` pass through, and `files`, `exec` and the `browser` a wrap adds resolve through the session's wraps applied over the attached env in registration order. A wrap added or removed later is applied lazily: the stack is recomposed on the first use after the change, so an env a plugin api resolved before another plugin's `wrapEnv` sees that wrap too. What `kernel.env(session)` resolves. */
  attach(session: SessionId): Promise<ExecutionEnv>;
  /** Adds a wrap to a session's stack after those added before it; the disposer removes it. Attaches nothing and never waits. What `kernel.wrapEnv` and `PluginApi.wrapEnv` do. */
  wrap(session: SessionId, wrap: EnvironmentWrap): Disposer;
  /** Resolves the run snapshots of a session's environment: the provider's `snapshots` applied to the env `attach` resolves, built once per attachment; null when the provider supplies none or the environment does not attach. What `kernel.snapshots(session)` resolves. */
  snapshots(session: SessionId): Promise<RunSnapshots | null>;
  /** Resolves a session's capabilities for an authority, starting nothing beyond the attachment. Without participant authority each is `denied`. When the environment does not attach, each is `unsupported` if no provider serves the kind or its `inspect` answers unsupported, and `unavailable` otherwise (`retry: "allowed"`, the reason the attach or `inspect` gave). Attached: `files` is `available` with the env's files through `wrapFiles` (`upload` and batch receipts in this session); `git` is `available` with the provider's `git` applied to the env, else `unsupported`; `browser` is `available` with the browser the wrap stack adds, else the provider's `browser` applied to the env, else `unsupported`. */
  capabilities(
    session: SessionId,
    authority: ReadonlySet<Authority>,
  ): Promise<EnvironmentCapabilities>;
  /** Closes a session's environment and forgets it with its wraps; the next `attach` attaches again. A session never attached resolves at once. What removing a session does. */
  detach(session: SessionId): Promise<void>;
  /** Resolves a workspace's own environment: its provider attaching its target once, no wraps, shared by every caller outside a session. Fails as `attach` does. */
  attachWorkspace(workspace: WorkspaceId): Promise<ExecutionEnv>;
  /** Resolves a workspace's own capabilities for an authority, as `capabilities` does over `attachWorkspace`, except that its `files` carry core's `upload` and a `batch()` whose `apply()` rejects `unavailable`: a batch receipt lives in a session (`Session.receipt`). */
  workspaceCapabilities(
    workspace: WorkspaceId,
    authority: ReadonlySet<Authority>,
  ): Promise<EnvironmentCapabilities>;
  /** Closes a workspace's own environment; the next `attachWorkspace` attaches again. What `forget` and `reload` do. */
  detachWorkspace(workspace: WorkspaceId): Promise<void>;
}

/** Returns a kernel's environment registry with nothing attached: what `kernel.environments` holds, built on first use once the kernel object exists. */
export function createEnvironmentRegistry(kernel: Kernel): EnvironmentRegistry {
  throw new Error("not implemented");
}
