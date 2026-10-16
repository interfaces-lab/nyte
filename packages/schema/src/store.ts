import type { DurableEvent } from "./events.ts";
import type { ObjectId, Revision, Seq } from "./ids.ts";

export type Ref = {
  readonly name: string;
  readonly target: ObjectId | null;
  readonly revision: Revision;
};

export type RefUpdate = {
  readonly name: string;
  readonly target: ObjectId | null;
  readonly expect?: Revision | "absent";
  /** The events this write logs to the ref's session, in order; a ref outside a session carries none. */
  readonly events?: readonly DurableEvent[];
};

/** What `RefStore.set` did: `set` with the seq each event was logged at, in update order and each update's events in order, the time it logged them at, and each update's new revision; or `stale`, naming the first ref whose expectation failed. */
export type SetOutcome =
  | {
      readonly kind: "set";
      readonly logged: readonly Seq[];
      readonly at: number;
      readonly revisions: readonly Revision[];
    }
  | { readonly kind: "stale"; readonly name: string; readonly revision: Revision | null };
