import type { PrincipalId, RunId, SessionId, WorkspaceId } from "./ids.ts";
import type { Json } from "./primitives.ts";

/**
 * Names what an environment sees: equal identities see the same files at
 * the same paths.
 *
 * **Details**
 *
 * Local: a stable id for the folder, not its path.
 *
 * @category environment
 * @since 0.1.0
 */
export type EnvironmentIdentity = string & { readonly __brand: "environment-identity" };

/**
 * Returns whether an environment provider can serve a workspace.
 *
 * @category workspaces
 * @since 0.1.0
 */
export type Availability =
  | { readonly kind: "available" }
  | { readonly kind: "unavailable"; readonly reason: "unsupported" | "unreachable" };

/**
 * Names where a workspace lives: a local absolute path, or a locator for any
 * registered environment provider.
 *
 * @category workspaces
 * @since 0.1.0
 */
export type WorkspaceTarget =
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: string; readonly locator: Json };

/**
 * Returns whether this host serves a session's workspace.
 *
 * **Details**
 *
 * - `active`: served.
 * - `inactive`: this host does not serve the workspace; history is readable.
 * - `unavailable`: the provider cannot reach `workspace`.
 * - `failed`: activation threw; `workspace.reload()` retries.
 *
 * @category workspaces
 * @since 0.1.0
 */
export type Activation =
  | { readonly kind: "active" }
  | { readonly kind: "inactive" }
  | ({ readonly workspace: WorkspaceId } & Extract<Availability, { readonly kind: "unavailable" }>)
  | { readonly kind: "failed"; readonly message: string };

/** Returns the result of registering a workspace. */
export type AddOutcome =
  | { readonly kind: "added"; readonly workspace: WorkspaceId }
  | { readonly kind: "exists"; readonly workspace: WorkspaceId }
  | { readonly kind: "stale"; readonly identity: EnvironmentIdentity }
  | { readonly kind: "unavailable"; readonly reason: "unsupported" | "unreachable" };
/** Returns the result of forgetting a workspace. */
export type ForgetOutcome =
  | { readonly kind: "forgotten" }
  | { readonly kind: "busy"; readonly sessions: readonly SessionId[] }
  | { readonly kind: "missing" };

/**
 * Returns what a target is before it is registered.
 *
 * @category workspaces
 * @since 0.1.0
 */
export type WorkspaceInspection = {
  /** The target as resolved. */
  readonly target: WorkspaceTarget;
  /** Equal identities see the same files. Pass it back as `expect` so a swapped folder is stale, not added. */
  readonly identity: EnvironmentIdentity;
  /** Whether the provider can serve it. */
  readonly availability: Availability;
  /** ".nyte/plugins/x.ts", "AGENTS.md": what would run. */
  readonly projectSources: readonly string[];
  /** The workspace already registered for this target, if any. */
  readonly registered: WorkspaceId | null;
};

/**
 * Returns a registered workspace's record.
 *
 * @category workspaces
 * @since 0.1.0
 */
export type WorkspaceInfo = {
  readonly id: WorkspaceId;
  readonly target: WorkspaceTarget;
  readonly identity: EnvironmentIdentity;
  readonly availability: Availability;
  /**
   * Whether the workspace's own code runs too.
   *
   * **Details**
   *
   * There is no trust state. Core loads project plugins and skills for a
   * workspace with project resources through its environment provider; the host
   * supplies no loader closure and no trust store.
   */
  readonly projectResources: boolean;
  /** What project resources would load. */
  readonly projectSources: readonly string[];
  readonly addedBy: PrincipalId;
  /** How many sessions use it. */
  readonly sessions: number;
  /** Runs editing the tree now; what git writes answer busy with. */
  readonly writers: readonly RunId[];
};
