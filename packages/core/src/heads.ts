import type {
  CreateHeadOutcome,
  HeadName,
  MergeOutcome,
  Position,
  RemoveHeadOutcome,
  Revision,
  SessionId,
} from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";

/** Creates a head at a position, default its stack parent's tip, and publishes `head created` with the updated session record. */
export function createHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  input?: { readonly from?: Position },
): Promise<CreateHeadOutcome> {
  throw new Error("not implemented");
}

/** Fast-forwards a head's stack parent to its tip and publishes `head merged` with the updated session record. */
export function mergeHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  options?: { readonly expect?: Revision },
): Promise<MergeOutcome> {
  throw new Error("not implemented");
}

/** Deletes a head's ref and publishes `head removed` with the updated session record; its commits stay reachable from the others. */
export function removeHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  options?: { readonly expect?: Revision },
): Promise<RemoveHeadOutcome> {
  throw new Error("not implemented");
}
