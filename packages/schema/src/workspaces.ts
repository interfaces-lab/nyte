import type { SessionId, WorkspaceId } from "./ids.ts";

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
export type Availability = { readonly kind: "available" } | { readonly kind: "unavailable"; readonly reason: "unsupported" | "unreachable" };

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
export type AddOutcome = { readonly kind: "added"; readonly workspace: WorkspaceId } | { readonly kind: "exists"; readonly workspace: WorkspaceId } | { readonly kind: "stale"; readonly identity: EnvironmentIdentity } | { readonly kind: "unavailable"; readonly reason: "unsupported" | "unreachable" };
/** Returns the result of forgetting a workspace. */
export type ForgetOutcome = { readonly kind: "forgotten" } | { readonly kind: "busy"; readonly sessions: readonly SessionId[] } | { readonly kind: "missing" };
