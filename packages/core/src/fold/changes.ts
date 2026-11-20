import type { DurableEvent, FileChange } from "@nyte-ai/schema";

export function changesEvents(
  listed: readonly FileChange[],
  next: readonly FileChange[],
): readonly DurableEvent[] {
  if (sameChanges(listed, next)) return [];
  const kept = new Map(listed.map((file) => [file.path, file]));
  const paths = new Set(next.map((file) => file.path));

  const merged = {
    head: null,
    kind: "changes",
    change: "merged",
    files: next.filter((file) => !sameChange(kept.get(file.path), file)),
    cleared: listed.flatMap((file) => (paths.has(file.path) ? [] : [file.path])),
  } as const;

  return [
    sameChanges(mergeChanges(listed, merged), next)
      ? merged
      : { head: null, kind: "changes", files: next },
  ];
}

export function mergeChanges(
  listed: readonly FileChange[],
  merged: { readonly files: readonly FileChange[]; readonly cleared: readonly string[] },
): readonly FileChange[] {
  const replaced = new Set([...merged.cleared, ...merged.files.map((file) => file.path)]);

  return [...listed.filter((file) => !replaced.has(file.path)), ...merged.files].sort(
    (left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  );
}

function sameChanges(left: readonly FileChange[], right: readonly FileChange[]): boolean {
  return (
    left.length === right.length && left.every((file, index) => sameChange(right[index], file))
  );
}

function sameChange(left: FileChange | undefined, right: FileChange): boolean {
  return (
    left !== undefined &&
    left.path === right.path &&
    left.status === right.status &&
    left.added === right.added &&
    left.removed === right.removed &&
    left.from === right.from
  );
}
