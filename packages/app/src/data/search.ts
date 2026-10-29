import { useQuery } from "@tanstack/react-query";
import type { SearchFrame, SearchInput } from "@nyte-ai/sdk";
import { keys } from "./query-client.ts";
import { workspaceFiles } from "./files.ts";
import { useHostState } from "./host.ts";

async function searchWorkspace(input: SearchInput) {
  const matches: Extract<SearchFrame, { readonly kind: "match" }>[] = [];
  let truncated = false;

  for await (const frame of (await workspaceFiles()).search(input)) {
    if (frame.kind === "match") matches.push(frame);

    if (frame.kind === "truncated") truncated = true;
  }

  return { matches, truncated };
}

export function useWorkspaceSearch(input: SearchInput | undefined, enabled = true) {
  const host = useHostState();
  const workspace = host.data.workspace?.id;

  return useQuery({
    queryKey: keys.workspaceSearch(workspace ?? "", input),
    queryFn: () => {
      if (input === undefined) throw new Error("Type to search");

      return searchWorkspace(input);
    },
    enabled: enabled && workspace !== undefined && input !== undefined && input.query.length > 0,
    retry: false,
    staleTime: 0,
    refetchOnMount: true,
    gcTime: 0,
  });
}
