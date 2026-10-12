import type { Authority } from "./declaration.ts";
import type { ValidationIssue } from "./errors.ts";
import type { CatalogGeneration, CommitId, Cursor, HeadName, ObjectId, PrincipalId, SessionId, WorkspaceId } from "./ids.ts";
import type { Json } from "./primitives.ts";

/**
 * Names which sessions a host runs.
 *
 * **Details**
 *
 * `sessions` includes future heads and children.
 *
 * @category host
 * @since 0.1.0
 */
export type ExecutionCoverage =
  | { readonly kind: "all" }
  | { readonly kind: "workspace"; readonly workspace: WorkspaceId }
  | { readonly kind: "sessions"; readonly sessions: readonly SessionId[] };

/**
 * Returns what one leased kernel step did; the driver schedules the next.
 *
 * **Outcomes**
 *
 * - `continue`: more work is ready; advance again.
 * - `idle`: nothing to do.
 * - `waiting`: parked until `until`; null = a durable wait with no timer, whose wake obligation remains.
 * - `retry`: a provider retry is due `until`.
 * - `busy`: another host holds the lease until `until`.
 * - `fenced`: this host's lease was taken; stop driving.
 *
 * @category host
 * @since 0.1.0
 */
export type AdvanceReport =
  | { readonly kind: "continue" }
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly until: number | null }
  | { readonly kind: "retry"; readonly until: number }
  | { readonly kind: "busy"; readonly until: number }
  | { readonly kind: "fenced" };

/**
 * Returns one page of heads owed a step that no wake reached.
 *
 * @category host
 * @since 0.1.0
 */
export type RepairPage = { readonly runnable: readonly { readonly session: SessionId; readonly head: HeadName }[]; readonly next: Cursor | null }

/**
 * Returns what `prune` collected: unreachable history; `retained` = pinned
 * by a ref.
 *
 * @category host
 * @since 0.1.0
 */
export type PruneReport = { readonly objects: number; readonly bytes: number; readonly retained: number }

/**
 * Returns one paired principal and its authority.
 *
 * @category host
 * @since 0.1.0
 */
export type PrincipalView = { readonly id: PrincipalId; readonly label: string; readonly authority: ReadonlySet<Authority>; readonly pairedAt: number }

/**
 * Returns the preflight `open` runs: per-plugin outcomes and collisions;
 * touches nothing.
 *
 * @category host
 * @since 0.1.0
 */
export type PluginCheckReport = { readonly plugins: readonly PluginLoadOutcome[]; readonly collisions: readonly ValidationIssue[] }

/**
 * Returns the new catalog generation and per-plugin outcomes of a
 * replacement.
 *
 * @category host
 * @since 0.1.0
 */
export type PluginReplacementReport = { readonly generation: CatalogGeneration; readonly plugins: readonly PluginLoadOutcome[] }

/**
 * Returns how one plugin loaded.
 *
 * **Outcomes**
 *
 * - `activated`: loaded; `issues` are warnings.
 * - `rejected`: could not parse; on replace, the previous stays as `kept-previous`.
 * - `kept-previous`: the replacement failed; the previous version still runs.
 *
 * @category host
 * @since 0.1.0
 */
export type PluginLoadOutcome =
  | { readonly kind: "activated"; readonly id: string; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "rejected"; readonly id: string; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "kept-previous"; readonly id: string; readonly issues: readonly ValidationIssue[] };

/**
 * Returns one stored object, decoded, for maintenance reads.
 *
 * @category host
 * @since 0.1.0
 */
export type DecodedObjectView = { readonly id: ObjectId; readonly kind: string; readonly parent: CommitId | null; readonly body: Json; readonly at: number }

/**
 * Returns whether a session's refs and objects are consistent, and what is
 * not.
 *
 * @category host
 * @since 0.1.0
 */
export type IntegrityReport = { readonly ok: boolean; readonly issues: readonly { readonly ref: string | null; readonly object: CommitId | null; readonly message: string }[] }
