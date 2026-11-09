import type { FileTree, FileTreeBatchOperation } from "@nyte-ai/ui/trees";

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
