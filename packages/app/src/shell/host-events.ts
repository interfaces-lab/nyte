import { toast } from "@nyte-ai/ui/toast";
import type { HostProcess } from "../contract/bridge.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { currentConnection } from "../data/connection.ts";
import { hostProcessQuery } from "../data/host.ts";
import { nyte } from "../contract/nyte.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import {
  applyBrowserEvent,
  applyBrowserAgentOpened,
  applyBrowserKey,
  applyBrowserPick,
} from "../workbench/browser/browser-surfaces.ts";
import { applyBrowserHistory } from "../workbench/browser/browser-history.ts";
import { workbench } from "../workbench/store.ts";
import { showNotifiedChat } from "../settings/return.ts";

export function useHostEvents(): void {
  useMountEffect(() => {
    const showHostProcess = followHostProcess();

    if (nyte.host.hostProcess !== undefined)
      void queryClient
        .fetchQuery(hostProcessQuery)
        .then((state) => showHostProcess("reply", state));

    const reconnect = (): void => {
      if (document.visibilityState !== "hidden") currentConnection()?.retry();
    };

    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", reconnect);

    const unsubscribe = nyte.host.onEvent((event) => {
      switch (event.kind) {
        case "update_changed":
          queryClient.setQueryData(keys.updates, event.state);

          return;
        case "update_channel_changed":
          queryClient.setQueryData(keys.updateChannel, event.channel);

          return;
        case "host_process_changed":
          queryClient.setQueryData(keys.hostProcess, event.state);
          showHostProcess("event", event.state);

          if (event.state.kind === "current" || event.state.kind === "stale")
            currentConnection()?.retry();

          return;
        case "server_changed":
          void queryClient.invalidateQueries({ queryKey: keys.server });

          return;
        case "open_session":
          showNotifiedChat(event.session);

          return;
        case "remote_access_changed":
          void queryClient.invalidateQueries({ queryKey: keys.remoteAccess });

          return;
        case "browser_changed":
        case "browser_download":
        case "browser_open_tab":
        case "browser_login_requested":
          applyBrowserEvent(event);

          return;
        case "browser_key":
          applyBrowserKey(event);

          return;
        case "browser_design_pick":
          applyBrowserPick(event);

          return;
        case "browser_history_changed":
          applyBrowserHistory(event);

          return;
        case "browser_agent_opened":
          applyBrowserAgentOpened(workbench, event);

          return;
        default: {
          const _exhaustive: never = event;

          return _exhaustive;
        }
      }
    });

    return () => {
      unsubscribe();
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  });
}

const HOST_RESTART = "host-restart";

export type HostToast = "loading" | "restarted" | "close" | "none";

export interface HostToastState {
  readonly restarting: boolean;
  readonly heard: boolean;
}

export interface HostToastStep extends HostToastState {
  readonly toast: HostToast;
}

export function hostToast(
  previous: HostToastState,
  source: "reply" | "event",
  state: HostProcess,
): HostToastStep {
  const restarting = previous.restarting;

  if (source === "reply" && previous.heard) return { ...previous, toast: "none" };

  switch (state.kind) {
    case "restarting":
      return { restarting: true, heard: true, toast: "loading" };
    case "stale":
      return { restarting: false, heard: true, toast: "close" };
    case "offline":
      return { restarting, heard: true, toast: restarting ? "none" : "close" };
    case "current":
      return { restarting: false, heard: true, toast: restarting ? "restarted" : "close" };
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

function followHostProcess(): (source: "reply" | "event", state: HostProcess) => void {
  let current: HostToastState = { restarting: false, heard: false };

  return (source, state) => {
    const next = hostToast(current, source, state);

    current = next;
    showHostToast(next.toast);
  };
}

function showHostToast(shown: HostToast): void {
  switch (shown) {
    case "loading":
      toast.add({
        id: HOST_RESTART,
        type: "loading",
        timeout: 0,
        title: "Restarting Nyte Host…",
        description: undefined,
        actionProps: undefined,
      });

      return;
    case "restarted":
      toast.add({
        id: HOST_RESTART,
        type: "success",
        timeout: 4000,
        title: "Nyte Host restarted",
        description: undefined,
        actionProps: undefined,
      });

      return;
    case "close":
      toast.close(HOST_RESTART);

      return;
    case "none":
      return;
    default: {
      const _exhaustive: never = shown;

      return _exhaustive;
    }
  }
}
