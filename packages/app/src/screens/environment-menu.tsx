import { useState } from "react";
import type { ReactElement } from "react";
import { MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { toast } from "@nyte-ai/ui/toast";
import { shellActions } from "../chrome/shell-state.ts";
import { usePaneActions } from "../layout/pane-context.tsx";
import { nyte } from "../nyte.ts";
import { keys, queryClient, useServerState } from "../queries.ts";
import { clientActions } from "../client-actions.ts";
import { ContextSelector } from "./context-selector.tsx";

export function EnvironmentMenu({ active }: { readonly active: boolean }): ReactElement {
  const server = useServerState(false);
  const panes = usePaneActions();
  const [starting, setStarting] = useState(false);
  const configured = server.data !== undefined && server.data.kind !== "none";
  const cloudReady = server.data?.kind === "connected";

  const startCloudChat = async (): Promise<void> => {
    if (starting) return;
    setStarting(true);

    try {
      const session = await nyte.host.server.createSession();
      panes.openSession(session.sessionId);
    } catch {
      toast.add({
        type: "error",
        title: "Couldn't start a Cloud chat. Check the connection in Environments.",
      });
      void queryClient.invalidateQueries({ queryKey: keys.server });
    } finally {
      setStarting(false);
    }
  };

  return (
    <ContextSelector
      action={clientActions.selectEnvironment}
      value="This Mac"
      icon="laptop"
      active={active}
    >
      <MenuRadioGroup
        value="this-mac"
        onValueChange={(value) => {
          if (value === "cloud") void startCloudChat();
        }}
      >
        <MenuRadioItem value="this-mac" icon="laptop">
          This Mac
        </MenuRadioItem>
        {configured && (
          <MenuRadioItem value="cloud" icon="cloud" disabled={!cloudReady || starting}>
            Cloud
          </MenuRadioItem>
        )}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem icon="server" onClick={() => shellActions.openEnvironments()}>
        Environments…
      </MenuItem>
    </ContextSelector>
  );
}
