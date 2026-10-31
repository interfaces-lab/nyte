import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { clientActions } from "../contract/client-actions.ts";
import { ContextSelector, type ContextSize } from "./context-selector.tsx";

export function EnvironmentMenu({
  active,
  size,
}: {
  readonly active: boolean;
  readonly size: ContextSize;
}): ReactElement {
  const navigate = useNavigate();

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
      <MenuItem
        icon="server"
        onClick={() => void navigate({ to: "/settings/$section", params: { section: "server" } })}
      >
        Server Settings…
      </MenuItem>
    </ContextSelector>
  );
}
