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
  readonly event?: DurableEvent;
};

export type SetOutcome =
  | { readonly kind: "set"; readonly seq: Seq; readonly revisions: readonly Revision[] }
  | { readonly kind: "stale"; readonly name: string; readonly revision: Revision | null };
