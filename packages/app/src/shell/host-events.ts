import { keys, queryClient } from "../data/query-client.ts";
import { currentConnection } from "../data/connection.ts";
import { nyte } from "../contract/nyte.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import {
  applyBrowserEvent,
  applyBrowserAgentOpened,
  applyBrowserBoard,
  applyBrowserKey,
  applyBrowserPick,
} from "../workbench/browser/browser-surfaces.ts";
import { applyBrowserHistory } from "../workbench/browser/browser-history.ts";
import { applyBrowserGuests } from "../workbench/browser/browser-guests.tsx";
import { workbench } from "../workbench/store.ts";
import { showNotifiedChat } from "../settings/return.ts";

export function useHostEvents(): void {
  useMountEffect(() => {
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

          if (event.state.kind === "current" || event.state.kind === "stale") {
            currentConnection()?.retry();
          }

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
        case "browser_guests":
          applyBrowserGuests(event);

          return;
        case "browser_board_leave":
        case "browser_board_wheel":
          applyBrowserBoard(event);

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
