import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode, RefObject } from "react";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Button } from "@nyte-ai/ui/button";
import { usePaneActions, useCanSplitPane } from "../layout/pane-context.tsx";
import type { PaneId } from "../layout/pane-layout.ts";
import { nyte } from "../nyte.ts";

import { clientActions, clientActionShortcut } from "../client-actions.ts";

export function PaneHeader({
  paneId,
  title,
  sessionItems,
  menuTriggerRef,
}: {
  paneId: PaneId;
  title: ReactNode;
  sessionItems?: ReactNode;
  menuTriggerRef?: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const actions = usePaneActions();
  const canSplit = useCanSplitPane();
  const mac = nyte.platform === "darwin";

  return (
    <div {...props(sessionScreenStyles.header)}>
      <span {...props(sessionScreenStyles.title)}>{title}</span>
      <span {...props(sessionScreenStyles.headerActions)}>
        <Menu>
          <MenuTrigger
            render={<Button iconOnly ref={menuTriggerRef} icon="more" aria-label="Pane actions" />}
          />
          <MenuContent align="end">
            <MenuItem
              icon="split-down"
              meta={clientActionShortcut(clientActions.splitDown, mac)}
              disabled={!canSplit}
              onClick={() => actions.split("down")}
            >
              {clientActions.splitDown.label}
            </MenuItem>
            <MenuItem
              icon="split-right"
              meta={clientActionShortcut(clientActions.splitRight, mac)}
              disabled={!canSplit}
              onClick={() => actions.split("right")}
            >
              {clientActions.splitRight.label}
            </MenuItem>
            <MenuItem icon="x" onClick={() => actions.close(paneId)}>
              Close Pane
            </MenuItem>
            {sessionItems}
          </MenuContent>
        </Menu>
      </span>
    </div>
  );
}
