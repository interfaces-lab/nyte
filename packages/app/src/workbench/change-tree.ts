import type { FileStatus } from "@nyte-ai/sdk";

export const CHANGES_VISIBLE_FILES = 5;

export function filesChangedLabel(count: number): string {
  return count === 1 ? "1 File Changed" : `${String(count)} Files Changed`;
}

export type ChangeStatus = FileStatus;

type ChangeViewedFilter =
  | { readonly mode: "all" }
  | {
      readonly mode: "viewed" | "not-viewed";
      readonly isViewed: (path: string) => boolean;
    };

interface ChangeFilterEntry {
  readonly path: string;
  readonly status?: ChangeStatus;
}

interface ChangeFilter {
  readonly query?: string;
  readonly statuses?: readonly ChangeStatus[];
  readonly viewed?: ChangeViewedFilter;
}

function matchesChangePathQuery(path: string, query: string): boolean {
  const needle = query.trim().toLowerCase();

  if (needle === "") return true;
  const characters = Array.from(needle);
  let matched = 0;

  for (const character of path.toLowerCase()) {
    if (character === characters[matched]) matched += 1;
  }

  return matched === characters.length;
}

export function filterChangePaths(
  entries: readonly ChangeFilterEntry[],
  filter: ChangeFilter,
): readonly string[] {
  const statuses = filter.statuses;
  const viewed = filter.viewed;

  return entries
    .values()
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
    .map((entry) => entry.path)
    .toArray();
}

type ChangeSelectionSummary = "none" | "some" | "all";

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
