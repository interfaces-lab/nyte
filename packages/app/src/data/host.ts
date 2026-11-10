import { useSyncExternalStore } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { operationsDigest } from "@nyte-ai/sdk";
import type { Health } from "@nyte-ai/sdk/client";
import { currentLive, subscribeLive } from "./connection.ts";
import { keys } from "./query-client.ts";
import type { HostProcess, HostState, UpdateState } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { hostWatch } from "./watches.ts";
import { useWatchSelect } from "./watch-store.ts";
import { queryClient } from "./query-client.ts";

export const readHost = () => nyte.host.state();

const OPENING_HOST_STATE: HostState = { workspace: undefined };

export function useHostState() {
  const { data } = useQuery({
    queryKey: keys.host,
    queryFn: skipToken,
    initialData: OPENING_HOST_STATE,
  });

  return { data: data ?? OPENING_HOST_STATE };
}

export function useUpdateState() {
  return useQuery({
    queryKey: keys.updates,
    queryFn: async (): Promise<UpdateState> => nyte.host.updates?.state() ?? { kind: "idle" },
  });
}

export function useHostProcess() {
  return useQuery({
    queryKey: keys.hostProcess,
    queryFn: async (): Promise<HostProcess> =>
      (await nyte.host.hostProcess?.state()) ?? { kind: "offline" },
  });
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

function subscribeHealth(notice: () => void): () => void {
  let stop = currentLive()?.health.subscribe(notice);

  const leave = subscribeLive(() => {
    stop?.();
    stop = currentLive()?.health.subscribe(notice);
    notice();
  });

  return () => {
    stop?.();
    leave();
  };
}

const readHealth = (): Health | undefined => currentLive()?.health.snapshot();

export function useHostHealth(): Health | undefined {
  return useSyncExternalStore(subscribeHealth, readHealth, readHealth);
}

export function useHostRelease(): { readonly version: string } | undefined {
  const operations = useWatchSelect(hostWatch("host"), (state) => state.value?.operations);
  const version = useWatchSelect(hostWatch("host"), (state) => state.value?.version);

  const own = useQuery({
    queryKey: keys.clientOperations,
    queryFn: operationsDigest,
  }).data;

  return operations !== undefined &&
    operations !== null &&
    own !== undefined &&
    operations !== own &&
    version !== undefined
    ? { version }
    : undefined;
}
