import type { VcsFileKind } from "@nyte-ai/protocol";

export function filesChangedLabel(count: number): string {
  return count === 1 ? "1 File Changed" : `${String(count)} Files Changed`;
}

/** The working-tree change kinds the rail renders. */
export type ChangeStatus = VcsFileKind;

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
