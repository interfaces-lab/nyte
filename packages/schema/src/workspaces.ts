import type { PrincipalId, RunId, SessionId, WorkspaceId } from "./ids.ts";
import type { Json } from "./primitives.ts";

export type EnvironmentIdentity = string & { readonly __brand: "environment-identity" };

export type Availability =
  | { readonly kind: "available" }
  | { readonly kind: "unavailable"; readonly reason: "unsupported" | "unreachable" };

export type WorkspaceTarget =
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: string; readonly locator: Json };

export type Activation =
  | { readonly kind: "active" }
  | { readonly kind: "inactive" }
  | ({ readonly workspace: WorkspaceId } & Extract<Availability, { readonly kind: "unavailable" }>)
  | { readonly kind: "failed"; readonly message: string };

export type AddOutcome =
  | { readonly kind: "added"; readonly workspace: WorkspaceId }
  | { readonly kind: "exists"; readonly workspace: WorkspaceId }
  | { readonly kind: "stale"; readonly identity: EnvironmentIdentity }
  | { readonly kind: "unavailable"; readonly reason: "unsupported" | "unreachable" };
export type ForgetOutcome =
  | { readonly kind: "forgotten" }
  | { readonly kind: "busy"; readonly sessions: readonly SessionId[] }
  | { readonly kind: "missing" };

export type WorkspaceInspection = {
  readonly target: WorkspaceTarget;
  readonly identity: EnvironmentIdentity;
  readonly availability: Availability;
  readonly projectSources: readonly string[];
  readonly registered: WorkspaceId | null;
};

export type WorkspaceInfo = {
  readonly id: WorkspaceId;
  readonly target: WorkspaceTarget;
  readonly identity: EnvironmentIdentity;
  readonly availability: Availability;
  /** The user's saved trust decision for this folder, or `null` when there is none. */
  readonly projectResources: boolean | null;
  /**
   * Whether the folder's project files load now (skills, prompts, system
   * prompt files, plugins and `.nyte/mcp.json`): the saved decision, else
   * the nearest registered parent folder's, else the host's `workspaceTrust`
   * mode. `null` means ask: nothing loads until the user decides, so a
   * client should ask when `projectSources` is not empty, then call
   * `workspace(id).update({ projectResources })`.
   */
  readonly trusted: boolean | null;
  readonly projectSources: readonly string[];
  readonly addedBy: PrincipalId;
  readonly sessions: number;
  readonly writers: readonly RunId[];
};
