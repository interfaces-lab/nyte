import type { ReactElement } from "react";
import { MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { shellActions } from "../tabs/shell-state.ts";
import { clientActions } from "../contract/client-actions.ts";
import { ContextSelector, type ContextSize } from "./context-selector.tsx";

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
      <MenuItem icon="server" onClick={() => shellActions.openEnvironments()}>
        Environments…
      </MenuItem>
    </ContextSelector>
  );
}
