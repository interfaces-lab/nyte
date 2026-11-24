/**
 * For each open file that shares its name with another, the shortest run of folders that tells it apart, as
 * `a/x` beside `b/x`. The run starts at `root`, the project folder's name, so a file at the root shows `root`. Paths use `/`.
 */
export function tabSuffixes(paths: readonly string[], root: string): ReadonlyMap<string, string> {
  const byName = Map.groupBy(new Set(paths), (path) => path.slice(path.lastIndexOf("/") + 1));

  return new Map(
    [...byName.values()]
      .filter((twins) => twins.length > 1)
      .flatMap((twins) => {
        const folders = twins.map((path) => [root, ...path.split("/").slice(0, -1)]);
        const deepest = Math.max(...folders.map((parts) => parts.length));

        return twins.map((path, index): [string, string] => {
          const own = folders[index] ?? [root];

          const depth =
            Array.from({ length: deepest }, (_, step) => step + 1).find((count) =>
              folders.every(
                (other, at) =>
                  at === index || other.slice(-count).join("/") !== own.slice(-count).join("/"),
              ),
            ) ?? deepest;

          return [path, own.slice(-depth).join("/")];
        });
      }),
  );
}
