import { toast } from "@nyte-ai/ui/toast";
import type { HostProcess } from "../contract/bridge.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { commitHostWorkspace } from "../data/workspaces.ts";
import { currentLive } from "../data/connection.ts";
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
import { requestTrust } from "../panes/open-workspace.tsx";
import { acceptHostSettings } from "../preferences/host.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

export function useHostEvents(): void {
  useMountEffect(() => {
    const showHostProcess = followHostProcess();

    void nyte.host.hostProcess?.state().then(showHostProcess);

    const reconnect = (): void => {
      if (document.visibilityState !== "hidden") currentLive()?.retry();
    };

    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", reconnect);

    const unsubscribe = nyte.host.onEvent((event) => {
      switch (event.kind) {
        case "workspace_trust_required":
          requestTrust(event.path);

          return;
        case "workspace_opened":
          commitHostWorkspace(event.workspace);
          void queryClient.invalidateQueries({ queryKey: keys.workspaces, exact: true });

          return;
        case "workspace_closed":
          commitHostWorkspace(undefined);

          return;
        case "update_changed":
          queryClient.setQueryData(keys.updates, event.state);

          return;
        case "update_channel_changed":
          queryClient.setQueryData(keys.updateChannel, event.channel);

          return;
        case "host_process_changed":
          queryClient.setQueryData(keys.hostProcess, event.state);
          showHostProcess(event.state);

          if (event.state.kind === "current" || event.state.kind === "stale")
            currentLive()?.retry();

          return;
        case "settings_changed":
          acceptHostSettings(event.settings);

          return;
        case "server_changed":
          void queryClient.invalidateQueries({ queryKey: keys.server });

          return;
        case "open_session":
          windowTabs.openChat(event.session, "permanent");

          return;
        case "remote_access_changed":
          void queryClient.invalidateQueries({ queryKey: keys.remoteAccess });

          return;
        case "status":
          toast.add({ title: event.message });

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

export interface HostToastStep {
  readonly restarting: boolean;
  readonly toast: HostToast;
}

/** The restart toast's next step: it loads from a restart until the host is current again, and an offline host mid-restart leaves it loading. */
export function hostToast(restarting: boolean, state: HostProcess): HostToastStep {
  switch (state.kind) {
    case "restarting":
      return { restarting: true, toast: "loading" };
    case "stale":
      return { restarting: false, toast: "close" };
    case "offline":
      return { restarting, toast: restarting ? "none" : "close" };
    case "current":
      return { restarting: false, toast: restarting ? "restarted" : "close" };
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

function followHostProcess(): (state: HostProcess) => void {
  let restarting = false;

  return (state) => {
    const next = hostToast(restarting, state);

    restarting = next.restarting;
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
