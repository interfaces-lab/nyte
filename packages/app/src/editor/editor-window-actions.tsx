import { Button } from "@nyte-ai/ui/button";
import { PanelToggleIcon, SplitPreviewIcon } from "@nyte-ai/ui/icon";
import { MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { Toggle } from "@nyte-ai/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import type { ReactElement, ReactNode } from "react";
import {
  clientActionAriaShortcut,
  clientActionKeys,
  clientActions,
} from "../contract/client-actions.ts";
import { appActions } from "../data/app-actions.ts";
import type { WorkbenchTabId } from "../workbench/model.ts";
import type { FileTab } from "./file-store.ts";

/** The main area's own title-bar controls: split the editor, toggle the dock, and the More menu. */
export function EditorWindowActions({
  mac,
  canSplit,
  dockShown,
  onSplit,
  menu,
}: {
  readonly mac: boolean;
  readonly canSplit: boolean;
  readonly dockShown: boolean;
  readonly onSplit: () => void;
  /** The More menu, built around the active file's options. */
  readonly menu: ReactNode;
}): ReactElement {
  const split = mac ? ["⌘", "\\"] : ["Ctrl", "\\"];

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              iconOnly
              aria-label="Split Editor Right"
              aria-keyshortcuts={mac ? "Meta+\\" : "Control+\\"}
              disabled={!canSplit}
              onClick={onSplit}
              title={undefined}
            >
              <SplitPreviewIcon side="right" />
            </Button>
          }
        />
        <TooltipContent shortcut={split}>Split Editor Right</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              iconOnly
              indicator="glyph"
              aria-label={dockShown ? "Hide panel" : "Show panel"}
              aria-keyshortcuts={clientActionAriaShortcut(clientActions.terminal, mac)}
              pressed={dockShown}
              onPressedChange={() => void appActions.run("terminal.toggle", {})}
              title={undefined}
            >
              <PanelToggleIcon side="bottom" visible={dockShown} />
            </Toggle>
          }
        />
        <TooltipContent shortcut={clientActionKeys(clientActions.terminal, mac)}>
          {dockShown ? "Hide Panel" : "Show Panel"}
        </TooltipContent>
      </Tooltip>
      {menu}
    </>
  );
}

/** The More menu's items above the file's options: the open files, and the way to the chats. */
export function MoreMenuItems({
  files,
  active,
  mac,
  onSelect,
}: {
  readonly files: readonly FileTab[];
  readonly active: WorkbenchTabId | undefined;
  readonly mac: boolean;
  readonly onSelect: (id: WorkbenchTabId) => void;
}): ReactElement {
  return (
    <>
      {files.length > 0 && (
        <>
          <MenuGroup>
            <MenuGroupLabel>Open Files</MenuGroupLabel>
            {files.map((file) => (
              <MenuItem
                key={file.id}
                icon={file.id === active ? "checkmark" : undefined}
                aria-current={file.id === active ? "true" : undefined}
                onClick={() => onSelect(file.id)}
              >
                {file.displayPath}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator inset />
        </>
      )}
      <MenuItem
        layout="plain"
        meta={clientActionKeys(clientActions.search, mac).join(mac ? "" : "+")}
        onClick={() => void appActions.run("search.toggle", {})}
      >
        Search Chats
      </MenuItem>
      <MenuSeparator inset />
    </>
  );
}
