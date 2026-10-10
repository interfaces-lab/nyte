import type { ObjectId, PruneReport } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";

/** Yields every object the store must keep, each once: the target of every ref (`refs.list("")`: sessions, workspaces, kv, host), and every commit reachable by `parent` from a `sessions/<id>/heads/<name>` ref. Objects written but named by no ref and no commit (message objects, superseded part states, old records) are not yielded; blobs are not objects and are not walked. The boundary of prune (the f2 question, answered): core computes reachability and deletes nothing; a store driver that collects garbage keeps what this yields and may delete the rest, since `ObjectStore` has no enumeration or delete. */
export function reachableObjects(kernel: Kernel): AsyncIterable<ObjectId> {
  throw new Error("not implemented");
}

/** Walks `reachableObjects` and reports it: `objects` the number reachable, `bytes` 0 (core does not size objects), `retained` the number of refs. Collects nothing; collection is the store driver's, through `reachableObjects`. What `kernel.prune` and `Host.prune` run. */
export function prune(kernel: Kernel): Promise<PruneReport> {
  throw new Error("not implemented");
}
