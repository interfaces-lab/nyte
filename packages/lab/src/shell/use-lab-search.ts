import { rootRouteId, useNavigate, useSearch } from "@tanstack/react-router";
import { readLabSearch } from "./lab-search.ts";
import type { LabSearch } from "./lab-search.ts";

export interface LabSearchState {
  readonly search: LabSearch;
  /** Replaces the history entry, so tuning doesn't fill the back button. */
  readonly update: (patch: LabSearch) => void;
}

/** The lab's address state. The lab's router is untyped, so the search is parsed here again. */
export function useLabSearch(): LabSearchState {
  const search = readLabSearch(useSearch({ from: rootRouteId }));
  const navigate = useNavigate();

  return {
    search,
    update: (patch) =>
      void navigate({
        to: ".",
        search: (previous: LabSearch) => ({ ...previous, ...patch }),
        replace: true,
      }),
  };
}
