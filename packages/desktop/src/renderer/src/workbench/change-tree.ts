/**
 * Compact changes rail: files sit under one group header per parent
 * folder. Headers use a short unique tail (`src / kernel`) so the
 * narrow column keeps the basename and +/- readable.
 */

export interface ChangeFileGroup {
  readonly path: string;
  readonly label: string;
  readonly files: readonly string[];
}

export interface ChangeTreeVisibleRow {
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly label: string;
  readonly depth: number;
}

function basename(path: string): string {
  return (
    path
      .split("/")
      .filter((part) => part.length > 0)
      .at(-1) ?? path
  );
}

function dirSegments(path: string): readonly string[] {
  return path.split("/").filter((part) => part.length > 0);
}

function uniqueDirLabels(dirs: readonly string[]): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const dir of dirs) {
    if (dir === "") {
      labels.set(dir, "");
      continue;
    }
    const parts = dirSegments(dir);
    let take = 1;
    while (take <= parts.length) {
      const tail = parts.slice(-take);
      const label = tail.join(" / ");
      const unique = dirs.every((peer) => {
        if (peer === dir || peer === "") return true;
        return dirSegments(peer).slice(-take).join(" / ") !== label;
      });
      if (unique) {
        labels.set(dir, label);
        break;
      }
      take += 1;
    }
    if (!labels.has(dir)) labels.set(dir, parts.join(" / "));
  }
  return labels;
}

export function changeFileGroups(paths: readonly string[]): readonly ChangeFileGroup[] {
  const buckets = new Map<string, string[]>();
  for (const path of paths) {
    const parts = path.split("/").filter((part) => part.length > 0);
    if (parts.length === 0) continue;
    const dir = parts.length === 1 ? "" : `${parts.slice(0, -1).join("/")}/`;
    const files = buckets.get(dir) ?? [];
    files.push(path);
    buckets.set(dir, files);
  }
  const dirs = [...buckets.keys()].sort((left, right) => left.localeCompare(right));
  const labels = uniqueDirLabels(dirs);
  return dirs.map((dir) => ({
    path: dir,
    label: labels.get(dir) ?? dir,
    files: (buckets.get(dir) ?? []).toSorted((left, right) =>
      basename(left).localeCompare(basename(right)),
    ),
  }));
}

export type ChangeFileTone = "added" | "deleted" | "modified";

export function changeFileTone(
  input:
    | { readonly status: "added" | "deleted" | "modified" | "untracked" }
    | { readonly added: number; readonly removed: number },
): ChangeFileTone | undefined {
  if ("status" in input) {
    if (input.status === "deleted") return "deleted";
    if (input.status === "added" || input.status === "untracked") return "added";
    if (input.status === "modified") return "modified";
    return undefined;
  }
  if (input.added === 0 && input.removed > 0) return "deleted";
  if (input.removed === 0 && input.added > 0) return "added";
  if (input.added > 0 || input.removed > 0) return "modified";
  return undefined;
}

export function filesChangedLabel(count: number): string {
  return count === 1 ? "1 File Changed" : `${String(count)} Files Changed`;
}

export function visibleChangeTreeRows({
  groups,
  collapsed,
}: {
  readonly groups: readonly ChangeFileGroup[];
  readonly collapsed: readonly string[];
}): readonly ChangeTreeVisibleRow[] {
  const rows: ChangeTreeVisibleRow[] = [];
  for (const group of groups) {
    if (group.path !== "") {
      rows.push({
        kind: "directory",
        path: group.path,
        label: group.label,
        depth: 0,
      });
    }
    if (collapsed.includes(group.path)) continue;
    const depth = group.path === "" ? 0 : 1;
    for (const path of group.files) {
      rows.push({
        kind: "file",
        path,
        label: basename(path),
        depth,
      });
    }
  }
  return rows;
}
