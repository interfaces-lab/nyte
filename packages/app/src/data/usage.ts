import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { keys } from "./query-client.ts";
import type { UsageSnapshot, UsageWindow } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { connected } from "./connection.ts";
import { useCatalogGeneration } from "./catalog.ts";

/** A host read of local history, kept with the window it answers. */
export interface UsageRead {
  readonly window: UsageWindow;
  readonly report: UsageSnapshot;
}

export function usageReportOptions(window: UsageWindow) {
  return {
    queryKey: keys.usage(window.sinceDay, window.untilDay),
    queryFn: async (): Promise<UsageRead> => {
      const usage = nyte.host.usage;

      if (usage === undefined) throw new Error("This host keeps no usage history.");

      return { window, report: await usage(window) };
    },
    placeholderData: keepPreviousData,
    refetchOnMount: true,
    staleTime: USAGE_STALE_AFTER_MS,
    gcTime: Infinity,
  } as const;
}

interface UsageQueryView {
  readonly read: UsageRead | undefined;
  /** Whether `read` answers an earlier window while the requested one is read. */
  readonly superseded: boolean;
  readonly error: Error | null;
  readonly isFetching: boolean;
  readonly refresh: () => void;
}

export function useUsageReport(window: UsageWindow): UsageQueryView {
  const query = useQuery(usageReportOptions(window));

  return {
    read: query.data,
    superseded: query.isPlaceholderData,
    error: query.error,
    isFetching: query.isFetching,
    refresh: () => void query.refetch({ cancelRefetch: false }),
  };
}

function accountLimitsOptions(generation: string) {
  return {
    queryKey: keys.accountLimits(generation),
    queryFn: async () => (await connected()).models.usage(),
    refetchOnMount: true,
    staleTime: USAGE_STALE_AFTER_MS,
    gcTime: Infinity,
  } as const;
}

export function useAccountLimits() {
  return useQuery(accountLimitsOptions(useCatalogGeneration()));
}

export const USAGE_STALE_AFTER_MS = 60_000;
