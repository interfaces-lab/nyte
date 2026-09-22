/**
 * Commit graph walks over the kernel's content-addressed object store. A walk
 * reads the parent chain through `objects.chain`, one store query per page,
 * the way git reads its commit-graph instead of one object at a time.
 */
import type { Commit, Obj, Oid } from "./model.ts";
import type { Objects } from "./store.ts";

/** Commits per `objects.chain` query. Bounds what a walk that stops early has read. */
const PAGE_SIZE = 64;

function isCommit(object: Obj): object is Commit {
  return object.kind === "commit";
}

async function readCommit(objects: Pick<Objects, "get">, oid: Oid): Promise<Commit> {
  const object = await objects.get(oid);

  if (object === undefined || !isCommit(object)) {
    throw new Error(`Corrupt commit graph at ${oid}: missing or non-commit object`);
  }

  return object;
}

/** Walk from a tip toward the root, newest commit first. */
export async function* history(
  objects: Pick<Objects, "chain">,
  tip: Oid | null,
  options?: { readonly limit?: number },
): AsyncIterable<{ readonly oid: Oid; readonly commit: Commit }> {
  const seen = new Set<Oid>();
  let oid = tip;
  let count = 0;

  while (oid !== null && (options?.limit === undefined || count < options.limit)) {
    const limit =
      options?.limit === undefined ? PAGE_SIZE : Math.min(PAGE_SIZE, options.limit - count);

    const page = await objects.chain(oid, { limit });

    for (const entry of page) {
      if (seen.has(entry.oid)) throw new Error(`Commit graph cycle at ${entry.oid}`);
      seen.add(entry.oid);

      if (!isCommit(entry.object)) {
        throw new Error(`Corrupt commit graph at ${entry.oid}: missing or non-commit object`);
      }

      yield { oid: entry.oid, commit: entry.object };
      oid = entry.object.parent;
      count += 1;
    }

    // A short page means the store stopped: the next parent is not there.
    if (page.length < limit && oid !== null) {
      throw new Error(`Corrupt commit graph at ${oid}: missing or non-commit object`);
    }
  }
}

/** Return the complete branch ending at `tip`, oldest commit first. */
export async function branch(
  objects: Pick<Objects, "chain">,
  tip: Oid | null,
): Promise<{ readonly oid: Oid; readonly commit: Commit }[]> {
  const commits: { readonly oid: Oid; readonly commit: Commit }[] = [];

  for await (const entry of history(objects, tip)) commits.push(entry);
  commits.reverse();

  return commits;
}

/**
 * Return the newest checkpoint and later commits, oldest first, or the whole
 * branch when none exists. Walks back from the tip and stops at the
 * checkpoint, so a long history behind a checkpoint is never read.
 */
export async function contextCommits(
  objects: Pick<Objects, "chain">,
  tip: Oid | null,
): Promise<{ readonly oid: Oid; readonly commit: Commit }[]> {
  const commits: { readonly oid: Oid; readonly commit: Commit }[] = [];

  for await (const entry of history(objects, tip)) {
    commits.push(entry);

    if (entry.commit.body.kind === "checkpoint") break;
  }

  commits.reverse();

  return commits;
}

/** Whether `ancestor` occurs on the context-parent chain ending at `descendant`. */
export async function isAncestor(
  objects: Pick<Objects, "get" | "chain">,
  options: { readonly ancestor: Oid | null; readonly descendant: Oid | null },
): Promise<boolean> {
  if (options.ancestor === null) {
    if (options.descendant !== null) await readCommit(objects, options.descendant);

    return true;
  }

  await readCommit(objects, options.ancestor);

  for await (const entry of history(objects, options.descendant)) {
    if (entry.oid === options.ancestor) return true;
  }

  return false;
}
