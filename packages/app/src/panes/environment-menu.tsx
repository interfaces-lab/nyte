import type { ReactElement } from "react";
import { MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { clientActions } from "../contract/client-actions.ts";
import { ContextSelector } from "./context-selector.tsx";
import type { ContextSize } from "./context-selector.tsx";
import { appActions } from "../data/app-actions.ts";

export function EnvironmentMenu({
  active,
  size,
}: {
  readonly active: boolean;
  readonly size: ContextSize;
}): ReactElement {
  return (
    <ContextSelector
      action={clientActions.selectEnvironment}
      value="This Mac"
      icon="laptop"
      size={size}
      active={active}
    >
      <MenuRadioGroup value="this-mac">
        <MenuRadioItem value="this-mac" icon="laptop">
          This Mac
        </MenuRadioItem>
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem icon="server" onClick={() => appActions.run("settings.open", { page: "server" })}>
        Server Settings…
      </MenuItem>
    </ContextSelector>
  );
}
