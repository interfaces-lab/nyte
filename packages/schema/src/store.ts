import type { DurableEvent } from "./events.ts";
import type { ObjectId, Revision, Seq } from "./ids.ts";

/**
 * Returns a ref: its name, the object it points at, and its revision.
 *
 * @category store
 * @since 0.1.0
 */
export type Ref = {
  readonly name: string;
  readonly target: ObjectId | null;
  readonly revision: Revision;
};

/**
 * Describes one entry of a ref publish.
 *
 * @category store
 * @since 0.1.0
 */
export type RefUpdate = {
  readonly name: string;
  /** Null deletes. */
  readonly target: ObjectId | null;
  /** Omitted = unconditional. */
  readonly expect?: Revision | "absent";
  /** What this update means, for the log and the fold. */
  readonly event?: DurableEvent;
};

/**
 * Returns the result of a ref publish.
 *
 * **Outcomes**
 *
 * - `set`: every entry applied; `seq` is the log position, `revisions` in entry order.
 * - `stale`: `name` is the first entry whose expect failed; `revision` is current; nothing was written.
 *
 * @category store
 * @since 0.1.0
 */
export type SetOutcome =
  | { readonly kind: "set"; readonly seq: Seq; readonly revisions: readonly Revision[] }
  | { readonly kind: "stale"; readonly name: string; readonly revision: Revision | null };
