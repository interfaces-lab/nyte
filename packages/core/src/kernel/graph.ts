/** Commit graph walks over the kernel's content-addressed object store. */
import type { Commit, Obj, Oid } from "./model.ts";
import type { Objects } from "./store.ts";

function isCommit(object: Obj): object is Commit {
  return object.kind === "commit";
}

async function readCommit(objects: Objects, oid: Oid): Promise<Commit> {
  const object = await objects.get(oid);
  if (object === undefined || !isCommit(object)) {
    throw new Error(`Corrupt commit graph at ${oid}: missing or non-commit object`);
  }
  return object;
}

/** Walk from a tip toward the root, newest commit first. */
export async function* history(
  objects: Objects,
  tip: Oid | null,
  options?: { readonly limit?: number },
): AsyncIterable<{ readonly oid: Oid; readonly commit: Commit }> {
  const seen = new Set<Oid>();
  let oid = tip;
  let count = 0;

  while (oid !== null && (options?.limit === undefined || count < options.limit)) {
    if (seen.has(oid)) throw new Error(`Commit graph cycle at ${oid}`);
    seen.add(oid);

    const commit = await readCommit(objects, oid);
    yield { oid, commit };
    oid = commit.parent;
    count += 1;
  }
}

/** Return the complete branch ending at `tip`, oldest commit first. */
export async function branch(
  objects: Objects,
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
  objects: Objects,
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
  objects: Objects,
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
