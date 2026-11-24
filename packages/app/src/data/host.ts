import { useSyncExternalStore } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { LinkState } from "@nyte-ai/sdk/client";
import { installedLive } from "./connection.ts";
import { keys, queryClient } from "./query-client.ts";
import type { HostProcess, HostState, UpdateState } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";

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

const hostProcessQuery = {
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

const link = installedLive((current) => current.link);

export function useHostLink(): LinkState | undefined {
  return useSyncExternalStore(link.subscribe, link.read, link.read);
}
