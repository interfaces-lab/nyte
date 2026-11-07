import type { FileTree, FileTreeBatchOperation } from "@pierre/trees";

/**
 * Moves `model` from showing `shown` to showing `paths` and returns what it shows now: the
 * paths and their folders. The first fill resets the tree, so its initial expansion applies;
 * later fills remove and add only what changed, so the folders a reader opened stay open. A
 * later fill checks each path against the tree, which an inline rename moves on its own.
 */
export function syncTreePaths(
  model: FileTree,
  shown: ReadonlySet<string>,
  paths: readonly string[],
): ReadonlySet<string> {
  const next = new Set(paths.flatMap(withFolders));

  if (shown.size === 0) {
    model.resetPaths(paths);

    return next;
  }

  const changes: FileTreeBatchOperation[] = [
    ...[...shown]
      .filter((path) => !next.has(path) && model.getItem(path) !== null)
      .sort((left, right) => right.length - left.length)
      .map((path) => ({ type: "remove" as const, path })),
    ...paths.flatMap((path) =>
      shown.has(path) || model.getItem(path) !== null ? [] : [{ type: "add" as const, path }],
    ),
  ];

  if (changes.length > 0) model.batch(changes);

  return next;
}

function withFolders(path: string): readonly string[] {
  const folders = [path];

  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    folders.push(path.slice(0, index + 1));
  }

  return folders;
}
