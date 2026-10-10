import { asId } from "@nyte-ai/schema";
import type { ObjectId, PruneReport } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import { decodeCommitRecord } from "./records.ts";

const HEAD_REF = /^sessions\/[^/]+\/heads\/[^/]+$/;

/** Yields every object the store must keep, each once: the target of every ref (`refs.list("")`: sessions with their heads, inboxes, runs, parts, receipts, calls, seen marks and leases; workspaces, kv, host), and every commit reachable by `parent` from a `sessions/<id>/heads/<name>` ref. Objects written but named by no ref and no commit (message objects, superseded part states, old records) are not yielded; blobs are not objects and are not walked. The boundary of prune (§37e): core computes reachability and deletes nothing; a store driver that collects garbage keeps what this yields and may delete the rest, since `ObjectStore` has no enumeration or delete. */
export async function* reachableObjects(kernel: Kernel): AsyncIterable<ObjectId> {
  const seen = new Set<ObjectId>();
  const refs = await kernel.store.refs.list("");

  for (const ref of refs) {
    if (ref.target === null || seen.has(ref.target)) continue;
    seen.add(ref.target);

    yield ref.target;
  }

  const walked = new Set<ObjectId>();

  for (const ref of refs) {
    if (ref.target === null || !HEAD_REF.test(ref.name)) continue;
    let next: ObjectId | null = ref.target;

    while (next !== null && !walked.has(next)) {
      const id: ObjectId = next;
      walked.add(id);

      if (!seen.has(id)) {
        seen.add(id);

        yield id;
      }

      const parent = decodeCommitRecord(await kernel.store.objects.get(id))?.parent ?? null;
      next = parent === null ? null : asId<"object">(parent);
    }
  }
}

/** Walks `reachableObjects` and reports it: `objects` the number reachable, `bytes` 0 (core does not size objects), `retained` the number of refs. Collects nothing; collection is the store driver's, through `reachableObjects`. What `kernel.prune` and `Host.prune` run. */
export async function prune(kernel: Kernel): Promise<PruneReport> {
  let objects = 0;

  for await (const _id of reachableObjects(kernel)) objects += 1;

  return { objects, bytes: 0, retained: (await kernel.store.refs.list("")).length };
}
