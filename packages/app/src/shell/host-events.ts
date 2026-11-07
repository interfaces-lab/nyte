import { toast } from "@nyte-ai/ui/toast";
import type { HostEvent } from "../contract/bridge.ts";
import type { AlertState } from "../contract/desktop-settings.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { commitHostWorkspace } from "../data/workspaces.ts";
import { nyte } from "../contract/nyte.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import {
  applyBrowserEvent,
  applyBrowserAgentOpened,
  applyBrowserKey,
} from "../workbench/browser/browser-surfaces.ts";
import { applyBrowserHistory } from "../workbench/browser/browser-history.ts";
import { workbench } from "../workbench/store.ts";
import { requestTrust } from "../panes/open-workspace.tsx";
import { acceptHostSettings } from "../preferences/host.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

export function useHostEvents(): void {
  useMountEffect(() => {
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
        case "settings_changed":
          acceptHostSettings(event.settings);

          return;
        case "server_changed":
          void queryClient.invalidateQueries({ queryKey: keys.server });

          return;
        case "open_session":
          windowTabs.openChat(event.session, "permanent");

          return;
        case "chat_alert":
          showChatAlert(event);

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

    return unsubscribe;
  });
}

const ALERT_TOAST = {
  waiting: "warning",
  failed: "error",
  done: undefined,
} as const satisfies Readonly<Record<AlertState, string | undefined>>;

function showChatAlert(alert: Extract<HostEvent, { kind: "chat_alert" }>): void {
  const id = `chat-alert:${alert.session}`;

  toast.add({
    id,
    type: ALERT_TOAST[alert.state],
    title: alert.title,
    description: alert.body,
    actionProps: {
      children: "Open",
      onClick: () => {
        toast.close(id);
        windowTabs.openChat(alert.session, "permanent");
      },
    },
  });
}
