import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { props } from "@stylexjs/stylex";
import { createLink } from "@tanstack/react-router";
import type { ReactElement, ReactNode, RefObject } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { windowTabs } from "../tabs/window-tabs.ts";
import { usePaneActions, useCanSplitPane, usePaneControllerSnapshot } from "./pane-context.tsx";
import type { PaneId } from "./pane-layout.ts";
import { nyte } from "../contract/nyte.ts";

import { clientActions, clientActionShortcut } from "../contract/client-actions.ts";

const SessionLink = createLink(ButtonLink);

/** Back to the chat that started this one, through the same open as the link that came here. */
export function ParentLink({ parent }: { readonly parent: SessionId }): ReactElement {
  return (
    <SessionLink
      iconOnly
      icon="arrow-left"
      aria-label="Back to parent chat"
      to="/session/$sessionId"
      params={{ sessionId: parent }}
      preload={false}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        windowTabs.openChat(parent, "preview");
      }}
    />
  );
}

/** A pane's own header: its chat's way back to its parent, its title, and with two panes its actions. */
export function PaneHeader({
  paneId,
  parent,
  title,
  sessionItems,
  menuTriggerRef,
}: {
  paneId: PaneId;
  parent?: SessionId;
  title: ReactNode;
  sessionItems?: ReactNode;
  menuTriggerRef?: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const actions = usePaneActions();
  const canSplit = useCanSplitPane();
  const split = usePaneControllerSnapshot().layout.kind === "split";
  const mac = nyte.platform === "darwin";

  return (
    <div {...props(sessionScreenStyles.header)}>
      {parent !== undefined && <ParentLink parent={parent} />}
      <span {...props(sessionScreenStyles.title)}>{title}</span>
      {split && (
        <span {...props(sessionScreenStyles.headerActions)}>
          <Menu>
            <MenuTrigger
              render={
                <Button iconOnly ref={menuTriggerRef} icon="more" aria-label="Pane actions" />
              }
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
      )}
    </div>
  );
}
