import { useQuery } from "@tanstack/react-query";
import type { BrowserHistoryEntry, HostEvent } from "../bridge.ts";
import { nyte } from "../nyte.ts";
import { keys, queryClient } from "../queries.ts";

const NONE: readonly BrowserHistoryEntry[] = [];

export function useBrowserHistory(owner: string | null): readonly BrowserHistoryEntry[] {
  const history = useQuery({
    queryKey: keys.browserHistory(owner),
    queryFn: async () => (await nyte.host.browser?.history({ owner })) ?? NONE,
  });

  return history.data ?? NONE;
}

export function applyBrowserHistory(
  event: Extract<HostEvent, { kind: "browser_history_changed" }>,
): void {
  queryClient.setQueryData(keys.browserHistory(event.owner), event.entries);
}
