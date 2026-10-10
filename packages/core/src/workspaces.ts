import type { Activation, Disposer, SessionId, WorkspaceId, WorkspaceInfo } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { ConnectionContext } from "./principals.ts";
import type { Workspace, Workspaces } from "./workspace.ts";

/** Carries workspace changes in this process: registering, forgetting, `update`, `reload` and an activation announce them; `Workspace.watch` listens, alongside the bus's `session` and `run` events that move `sessions` and `writers`. One per kernel, created on first use. */
interface WorkspaceBus {
  /** Calls every listener with the workspace that changed. */
  changed(id: WorkspaceId): void;
  /** Calls the listener on every change; the disposer stops it. */
  subscribe(listener: (id: WorkspaceId) => void): Disposer;
}

/** Returns the workspaces registered on this host for a connection; every member checks its `@authority` tag against the context's authority. `list` reads every `workspaces/` ref through `workspaceInfo`. `inspect` asks the provider of the target's kind (`SdkError("unavailable")` when none serves it) and names the registered workspace with the same identity, if any. `add` answers `unavailable { reason }` when no provider serves the kind (`unsupported`) or its `inspect` says unavailable, `stale { identity }` when `expect.identity` differs from the inspected one, `exists` when a workspace with that identity is registered, and otherwise writes a `WorkspaceRecord` under a minted id (`expect: "absent"`; `projectResources` default true, `projectSources` as inspected, `addedBy` the context's principal) and answers `added`. `forget` answers `missing` without a record and `busy { sessions }` while sessions use it; otherwise it deletes the ref, detaches the workspace's own environment, drops its cached resources and answers `forgotten`. Each change is announced on the workspace bus. What `kernel.workspaces` holds as `CORE_CONTEXT`. */
export function createWorkspaces(kernel: Kernel, context: ConnectionContext): Workspaces {
  throw new Error("not implemented");
}

/** Returns a handle on a workspace for a connection; binds synchronously, no I/O, and checks each member's `@authority` tag against the context's authority. A context whose `origin` names a session (a tool invocation's) is that session's view: its capabilities and jobs go through the session's environment; otherwise the workspace's own environment serves them. `info` is `workspaceInfo` (`SdkError("unknown")` when the record is gone); `watch` yields it coalesced on workspace-bus changes and on `session` and `run` events of the sessions on it. `update` rewrites `projectResources` on the record, drops its cached resources and announces it: `missing` without a record. `reload` drops the cached resources, detaches the workspace's own environment and re-activates every session on it (`activateSession`): `missing` without a record. `jobs` is `createJobs(kernel, context, id)` and `job(id)` is `jobHandle`. `changes(run)` diffs the provider snapshots `before(run)` and `after(run)` (`SdkError("unavailable")` when the provider takes none); `patches(run, paths, options)` yields one `PatchSet` over the same revision, every requested path `failed` until the provider can produce run patches. `files()`, `git()` and `browser()` are the matching entry of the environment registry's `capabilities` (session view) or `workspaceCapabilities`. What `kernel.workspace(id)` returns as `CORE_CONTEXT`. */
export function workspaceHandle(
  kernel: Kernel,
  context: ConnectionContext,
  id: WorkspaceId,
): Workspace {
  throw new Error("not implemented");
}

/** Activates a session on this host and returns how it stands, set with `kernel.setActivation`. A session this host's execution does not cover stays `inactive` and attaches nothing. Otherwise the session's plugins are loaded first when its runtime has none active (`kernel.hostPlugins`, as `sessions.create` loads them, §36c), then its environment attaches through the registry: `active` once it attaches; `unavailable { workspace, reason }` when no provider serves the workspace's kind (`unsupported`) or its `inspect` says unavailable; `failed { message }` when attaching throws. The workspace bus announces the change. What `sessions.create`, a session's first use after this host started, and `Workspace.reload()` run. */
export function activateSession(kernel: Kernel, session: SessionId): Promise<Activation> {
  throw new Error("not implemented");
}

/** Returns a registered workspace's record with its live fields, or null when `workspaces/<id>` is absent: `availability` from its provider's `inspect` (`unavailable { reason: "unsupported" }` when no provider serves the kind), `sessions` the number of session records naming it, and `writers` the live runs of those sessions. */
export function workspaceInfo(kernel: Kernel, id: WorkspaceId): Promise<WorkspaceInfo | null> {
  throw new Error("not implemented");
}
