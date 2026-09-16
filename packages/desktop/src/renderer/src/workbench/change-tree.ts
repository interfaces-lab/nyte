/**
 * Compact changes rail: files sit under one group header per parent
 * folder. Headers use a short unique tail (`src / kernel`) so the
 * narrow column keeps the basename and +/- readable.
 */

interface ChangeFileGroup {
  readonly path: string;
  readonly label: string;
  readonly files: readonly string[];
}

interface ChangeTreeVisibleRow {
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

/** The working-tree change kinds the rail renders, matching `VcsStatus["files"][number]["kind"]`. */
export type ChangeStatus = "added" | "modified" | "deleted" | "untracked";

/**
 * Viewed state lives in the panel's store, so the caller passes the lookup in
 * and this module stays a pure function of its inputs.
 */
export type ChangeViewedFilter =
  | { readonly mode: "all" }
  | {
      readonly mode: "viewed" | "not-viewed";
      readonly isViewed: (path: string) => boolean;
    };

export interface ChangeFilterEntry {
  readonly path: string;
  /** Absent for rows with no working-tree status, such as per-turn changes. */
  readonly status?: ChangeStatus;
}

export interface ChangeFilter {
  /** Blank or whitespace-only keeps every path. */
  readonly query?: string;
  /** Empty or absent keeps every status; entries without a status drop when set. */
  readonly statuses?: readonly ChangeStatus[];
  readonly viewed?: ChangeViewedFilter;
}

/**
 * Case-insensitive subsequence match over the whole path, so `dsktheme`
 * finds `packages/desktop/.../theme/...`. Matching against the full path is
 * what keeps the tree navigable: a query hitting a directory segment matches
 * every path beneath it, and a query hitting a basename keeps that path, whose
 * ancestors `changeFileGroups` rebuilds as headers.
 */
export function matchesChangePathQuery(path: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = path.toLowerCase();
  let cursor = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return false;
    cursor = found + 1;
  }
  return true;
}

/** Narrows a change list to the paths a search query and filter menu keep, in input order. */
export function filterChangePaths(
  entries: readonly ChangeFilterEntry[],
  filter: ChangeFilter,
): readonly string[] {
  const statuses = filter.statuses;
  const viewed = filter.viewed;
  return entries
    .filter((entry) => {
      if (!matchesChangePathQuery(entry.path, filter.query ?? "")) return false;
      if (statuses !== undefined && statuses.length > 0) {
        if (entry.status === undefined || !statuses.includes(entry.status)) return false;
      }
      if (viewed !== undefined && viewed.mode !== "all") {
        const isViewed = viewed.isViewed(entry.path);
        if (viewed.mode === "viewed" ? !isViewed : isViewed) return false;
      }
      return true;
    })
    .map((entry) => entry.path);
}

/** Master-checkbox state over a list of paths. An empty list reports `"none"`. */
export type ChangeSelectionSummary = "none" | "some" | "all";

export function changeSelectionSummary(
  paths: readonly string[],
  selected: (path: string) => boolean,
): ChangeSelectionSummary {
  if (paths.length === 0) return "none";
  let matched = 0;
  for (const path of paths) {
    if (selected(path)) matched += 1;
  }
  if (matched === 0) return "none";
  return matched === paths.length ? "all" : "some";
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
