import { toast } from "@nyte-ai/ui/toast";
import { keys, queryClient } from "../data/query-client.ts";
import { loadLocalResources } from "../data/local-host.ts";
import type { AppRouter } from "./routes.tsx";
import { nyte } from "../contract/nyte.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import {
  applyBrowserEvent,
  applyBrowserAgentOpened,
  applyBrowserKey,
} from "../workbench/browser-surfaces.ts";
import { applyBrowserHistory } from "../workbench/browser-history.ts";
import { workbenchController } from "../workbench/controller.ts";
import { requestTrust } from "../panes/open-workspace.tsx";
import { acceptHostSettings } from "../preferences/host.ts";

export function useHostEvents(router: AppRouter): void {
  useMountEffect(() => {
    const unsubscribe = nyte.host.onEvent((event) => {
      switch (event.kind) {
        case "workspace_trust_required":
          requestTrust(event.path);

          return;
        case "workspace_opened":
        case "workspace_closed":
          void loadLocalResources()
            .then(() => router.invalidate())
            .catch(() => undefined);

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
          applyBrowserAgentOpened(workbenchController, event);

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
