import type { Configuration, ConfigurationPatch } from "./configuration.ts";
import type { ValidationIssue } from "./errors.ts";
import type { CommitId, HeadName, MessageId, ReceiptId, Revision, RunId } from "./ids.ts";
import type { Delivery, MessageSource, Position, UserContent } from "./messages.ts";
import type { ModelRef } from "./models.ts";

/**
 * Returns the head's commit DAG as flat rows, ready to draw in one pass.
 *
 * **Details**
 *
 * Filters (hide tools, users only, all) are the client's one pass over
 * `nodes`; folding is client state. Nothing walks the DAG outside core.
 *
 * @category heads
 * @since 0.1.0
 */
export type TreeView = {
  /** Pass as `expect` to `move`; stale if the tree grew meanwhile. Null when the host holds no revision paired with this tip (§54a): read the tree again. */
  readonly revision: Revision | null;
  readonly tip: Position;
  /** Parents before children; siblings in creation order. One pass draws it. */
  readonly nodes: readonly TreeNode[];
};

/**
 * Returns one commit as a tree row.
 *
 * @category heads
 * @since 0.1.0
 */
export type TreeNode = {
  readonly id: CommitId;
  readonly parent: CommitId | null;
  readonly depth: number;
  /** First child of a parent with several: draw a connector. */
  readonly branch: boolean;
  /** On the path from the root to this head's tip. */
  readonly active: boolean;
  /** Heads whose tip is here. */
  readonly heads: readonly HeadName[];
  readonly kind: "user" | "part" | "compaction" | "branchSummary";
  /** "text" | "thinking" | "tool" | ... for kind part; what a filter keys on. */
  readonly partKind: string | null;
  /** One line. */
  readonly preview: string;
  readonly at: number;
  readonly run: RunId | null;
};

/**
 * Returns the result of creating a head.
 *
 * **Outcomes**
 *
 * - `created`: the head exists at `basedOn`.
 * - `exists`: a head with this name already exists; nothing changed.
 * - `missing-source`: `from` names a position that does not exist.
 *
 * @category heads
 * @since 0.1.0
 */
export type CreateHeadOutcome =
  | { readonly kind: "created"; readonly basedOn: Position }
  | { readonly kind: "exists" }
  | { readonly kind: "missing-source" };

/**
 * Returns the result of merging a head into its stack parent.
 *
 * **Outcomes**
 *
 * - `merged`: the parent advanced; `revision` is current.
 * - `stale`: another client moved first; `revision` is current.
 * - `diverged`: the parent moved since `base`; move or recreate.
 * - `is-main`: main has no parent to merge into.
 *
 * @category heads
 * @since 0.1.0
 */
export type MergeOutcome =
  | { readonly kind: "merged"; readonly revision: Revision }
  | { readonly kind: "stale"; readonly revision: Revision }
  | { readonly kind: "diverged"; readonly base: Position }
  | { readonly kind: "is-main" };

/**
 * Returns the result of removing a head.
 *
 * **Outcomes**
 *
 * - `removed`: the head is gone; its commits stay reachable from the others.
 * - `missing`: no head has this name.
 * - `is-main`: main cannot be removed.
 * - `busy`: `run` is live on the head.
 *
 * @category heads
 * @since 0.1.0
 */
export type RemoveHeadOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "missing" }
  | { readonly kind: "is-main" }
  | { readonly kind: "busy"; readonly run: RunId };

/**
 * Returns the result of moving a head, directly or as part of an edit.
 *
 * **Outcomes**
 *
 * - `moved`: the head is at `position`; `summary` is the branch summary if
 *   one was written; `handback` is a user commit's content returned for the
 *   composer, because moving to a user commit lands on its parent.
 * - `stale`: another client moved first; `revision` is current.
 * - `busy`: `run` is live and `running` was `"refuse"`.
 * - `pending-input`: `messages` are queued behind the target; withdraw or place them first.
 * - `missing-target`: the position does not exist.
 * - `summary-failed`: summarising the abandoned path failed; nothing moved.
 *
 * @category heads
 * @since 0.1.0
 */
export type MoveOutcome =
  | {
      readonly kind: "moved";
      readonly revision: Revision;
      readonly position: Position;
      readonly summary: MessageId | null;
      readonly handback: UserContent | null;
    }
  | { readonly kind: "stale"; readonly revision: Revision }
  | { readonly kind: "busy"; readonly run: RunId }
  | { readonly kind: "pending-input"; readonly messages: readonly MessageId[] }
  | { readonly kind: "missing-target" }
  | { readonly kind: "summary-failed"; readonly reason: string };

/**
 * Describes what a move does about a live run and the path it leaves.
 *
 * @category heads
 * @since 0.1.0
 */
export type MoveOptions = {
  /** Default refuse. */
  readonly running?: "refuse" | "stop";
  /** Default keep; summarize writes a branch summary of the abandoned path. */
  readonly abandoned?: "keep" | { readonly summarize: { readonly instructions?: string } };
  /** The tree revision the client showed; stale if it moved. */
  readonly expect?: Revision;
};

/**
 * Describes how a send is delivered, and whether it replaces an earlier
 * message.
 *
 * @see {@link Head.send}
 * @category heads
 * @since 0.1.0
 */
export type SendOptions = {
  /** Default steer. */
  readonly delivery?: Delivery;
  /** A user message in any status. See Editing on {@link Head.send}. */
  readonly replace?: MessageId;
  /** With replace on a landed message while a run is live. Default stop: the edit is the user's intent. */
  readonly running?: "refuse" | "stop";
  /** With replace; default keep. */
  readonly abandoned?: "keep" | { readonly summarize: { readonly instructions?: string } };
  /** With replace; stale if another client moved first. */
  readonly expect?: Revision;
  /** With replace on a pending message: reorder the queue. */
  readonly position?:
    | { readonly kind: "last" }
    | { readonly kind: "before"; readonly message: MessageId };
  /** Default user. */
  readonly source?: MessageSource;
  /** Default: capture the head's selection at admission. */
  readonly configuration?: Configuration | ConfigurationPatch;
  /** Only to retry across your own restart; same id + same content replays the receipt. */
  readonly id?: ReceiptId;
};

/**
 * Returns the result of changing a head's durable selection.
 *
 * **Outcomes**
 *
 * - `configured`: `selected` is the resolved choice now stored; `revision` is current.
 * - `unknown-model`: `model` is not in the catalog.
 * - `unknown-agent`: `agent` is not registered.
 * - `invalid`: a setting failed its schema; `issues` says which.
 *
 * @category heads
 * @since 0.1.0
 */
export type ConfigureOutcome =
  | { readonly kind: "configured"; readonly selected: Configuration; readonly revision: Revision }
  | { readonly kind: "unknown-model"; readonly model: ModelRef }
  | { readonly kind: "unknown-agent"; readonly agent: string }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] };
