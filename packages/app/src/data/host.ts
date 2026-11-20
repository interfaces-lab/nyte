import { useSyncExternalStore } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { operationsDigest } from "@nyte-ai/sdk";
import type { Health } from "@nyte-ai/sdk/client";
import { installedLive } from "./connection.ts";
import { keys } from "./query-client.ts";
import type { HostProcess, HostState, UpdateState } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { hostWatch } from "./watches.ts";
import { useWatchSelect } from "./watch-store.ts";
import { queryClient } from "./query-client.ts";

const OPENING_HOST_STATE: HostState = { workspace: undefined };

export function useHostState() {
  const { data } = useQuery<HostState>({
    queryKey: keys.host,
    queryFn: skipToken,
  });

  return { data: data ?? OPENING_HOST_STATE };
}

export function useUpdateState() {
  return useQuery({
    queryKey: keys.updates,
    queryFn: async (): Promise<UpdateState> => nyte.host.updates?.state() ?? { kind: "idle" },
  });
}

export const hostProcessQuery = {
  queryKey: keys.hostProcess,
  queryFn: async (): Promise<HostProcess> =>
    (await nyte.host.hostProcess?.state()) ?? { kind: "offline" },
  staleTime: Infinity,
};

export function useHostProcess() {
  return useQuery(hostProcessQuery);
}

export function setUpdateStateForDemo(state: UpdateState): void {
  queryClient.setQueryData(keys.updates, state);
}

export function useServerState() {
  return useQuery({
    queryKey: keys.server,
    queryFn: () => nyte.host.server.state(),
  });
}

export function useRemoteAccessState(active: boolean) {
  return useQuery({
    queryKey: keys.remoteAccess,
    queryFn: () => nyte.host.remote.state(),
    enabled: active,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });
}

const health = installedLive((current) => current.health);

export function useHostHealth(): Health | undefined {
  return useSyncExternalStore(health.subscribe, health.read, health.read);
}

export function useHostBuildMismatch(): { readonly operations: string } | undefined {
  const operations = useWatchSelect(hostWatch("host"), (state) => state.value?.operations);

  const own = useQuery({
    queryKey: keys.clientOperations,
    queryFn: operationsDigest,
  }).data;

  return operations !== undefined && operations !== null && own !== undefined && operations !== own
    ? { operations }
    : undefined;
}
