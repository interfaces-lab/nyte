/**
 * The new chat's first choice: where it runs. This Mac is the default; Cloud
 * starts a chat on the configured server and opens it. Environments manages
 * the list.
 */
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { toast } from "@nyte-ai/ui/toast";
import { shellActions } from "../chrome/shell-state.ts";
import { usePaneActions } from "../layout/pane-context.tsx";
import { nyte } from "../nyte.ts";
import { keys, queryClient, useServerState } from "../queries.ts";
import { threadStyles } from "./thread.stylex.ts";

export function EnvironmentMenu(): ReactElement {
  const server = useServerState(false);
  const panes = usePaneActions();
  const [starting, setStarting] = useState(false);
  const configured = server.data !== undefined && server.data.kind !== "none";
  const cloudReady = server.data?.kind === "connected";

  const startCloudChat = async (): Promise<void> => {
    setStarting(true);

    try {
      const session = await nyte.host.server.createSession();
      panes.openSession(session.sessionId);
    } catch {
      toast.error("Couldn't start a Cloud chat. Check the connection in Environments.");
      void queryClient.invalidateQueries({ queryKey: keys.server });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Menu
      label="Select environment"
      align="start"
      trigger={
        <Button size="condensed" xstyle={threadStyles.workspaceContextPath}>
          <Icon name="computer" size={13} />
          <span {...stylex.props(threadStyles.workspaceContextText)}>This Mac</span>
          <Icon name="chevron-down" size={10} />
        </Button>
      }
    >
      <MenuRadioGroup
        value="this-mac"
        onValueChange={(value) => {
          if (value === "cloud") void startCloudChat();
        }}
      >
        <MenuRadioItem value="this-mac" icon="computer">
          This Mac
        </MenuRadioItem>
        {configured && (
          <MenuRadioItem
            value="cloud"
            icon="cloud"
            disabled={!cloudReady || starting}
            meta={cloudReady ? undefined : "Unavailable"}
          >
            Cloud
          </MenuRadioItem>
        )}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem icon="server" onSelect={() => shellActions.openEnvironments()}>
        Environments…
      </MenuItem>
    </Menu>
  );
}
