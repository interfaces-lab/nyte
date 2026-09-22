import { props } from "@stylexjs/stylex";
import { Popover } from "@nyte-ai/ui/popover";
import { useState } from "react";
import type { ReactElement, RefObject } from "react";
import {
  Menu,
  MenuItem,
  MenuGroup,
  MenuSeparator,
  MenuSubmenu,
  MenuCheckboxItem,
  MenuSwitchItem,
  MenuRadioGroup,
  MenuRadioItem,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../../../desktop/src/renderer/src/components/menu.tsx";
import { ConfirmDialog } from "../../../desktop/src/renderer/src/components/confirm-dialog.tsx";
import { Icon } from "../../../desktop/src/renderer/src/components/icons.tsx";
import type { IconName } from "../../../desktop/src/renderer/src/components/icons.tsx";
import { composerStyles } from "../../../desktop/src/renderer/src/conversation/styles.stylex.ts";
import { floatingSurfaceStyles } from "../../../desktop/src/renderer/src/theme/floating-surface.stylex.ts";
import { overlayRef } from "../../../desktop/src/renderer/src/components/overlay-occlusion.ts";
import type { AuditSurface } from "./audit-state";

type SurfaceProps = {
  surface: AuditSurface;
  onSurface: (surface: AuditSurface) => void;
  trigger: ReactElement;
};

function dismiss(surface: AuditSurface, onSurface: SurfaceProps["onSurface"]) {
  if (document.hasFocus() && document.documentElement.dataset.labSurface === surface)
    onSurface("none");
}

/*
 * The menu carries every row anatomy the desktop ships: a group heading, a
 * shortcut column, a checkmark, a switch, a disabled row, a submenu with a
 * trailing value, and the danger row. A menu dial is only worth moving if
 * every slot it touches is on screen at once.
 */
export function PaneMenu({ surface, onSurface, trigger }: SurfaceProps) {
  const [workspace, setWorkspace] = useState("nyte");
  const [wrap, setWrap] = useState(true);
  const [whitespace, setWhitespace] = useState(false);

  return (
    <Menu
      label="Pane actions"
      trigger={trigger}
      open={surface === "menu" || surface === "submenu"}
      modal={false}
      align="end"
      onOpenChange={(open) => {
        if (open) onSurface("menu");
        else dismiss(surface === "submenu" ? "submenu" : "menu", onSurface);
      }}
    >
      <MenuGroup label="Pane">
        <MenuItem icon="split-down" meta="⌘D" onSelect={() => onSurface("none")}>
          Split down
        </MenuItem>
        <MenuItem icon="split-right" meta="⇧⌘D" onSelect={() => onSurface("none")}>
          Split right
        </MenuItem>
        <MenuItem icon="expand" meta="⌃⌘F" disabled onSelect={() => {}}>
          Enter full screen
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup label="View">
        <MenuCheckboxItem icon="list" checked={wrap} onCheckedChange={setWrap}>
          Wrap long lines
        </MenuCheckboxItem>
        <MenuSwitchItem icon="eye" checked={whitespace} onCheckedChange={setWhitespace}>
          Show whitespace
        </MenuSwitchItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuSubmenu
        label="Move to"
        icon="folder"
        value={workspace}
        open={surface === "submenu" ? true : undefined}
        onOpenChange={(open) => {
          if (!open && surface === "submenu" && document.hasFocus()) onSurface("menu");
        }}
      >
        <MenuRadioGroup value={workspace} onValueChange={setWorkspace}>
          <MenuRadioItem value="nyte" closeOnClick={false}>
            nyte
          </MenuRadioItem>
          <MenuRadioItem value="website" closeOnClick={false}>
            website
          </MenuRadioItem>
          <MenuRadioItem value="protocol" closeOnClick={false}>
            protocol
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuSubmenu>
      <MenuItem icon="copy" meta="⇧⌘C" onSelect={() => onSurface("none")}>
        Copy transcript
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="trash" danger closeOnClick={false} onSelect={() => onSurface("dialog")}>
        Delete chat
      </MenuItem>
    </Menu>
  );
}

export function SessionContext({
  surface,
  onSurface,
  trigger,
  pinned,
  onPin,
  onArchive,
}: SurfaceProps & { pinned: boolean; onPin: () => void; onArchive: () => void }) {
  return (
    <ContextMenu
      label="Chat actions"
      trigger={trigger}
      open={surface === "context"}
      onOpenChange={(open) => {
        if (open) onSurface("context");
        else dismiss("context", onSurface);
      }}
    >
      <ContextMenuItem icon={pinned ? "unpin" : "pin"} onSelect={onPin}>
        {pinned ? "Unpin" : "Pin"}
      </ContextMenuItem>
      <ContextMenuItem icon="pencil" disabled onSelect={() => {}}>
        Rename
      </ContextMenuItem>
      <ContextMenuItem icon="archive" onSelect={onArchive}>
        Archive
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon="trash" danger onSelect={() => onSurface("dialog")}>
        Delete chat
      </ContextMenuItem>
    </ContextMenu>
  );
}

const suggestions = [
  { label: "Files", description: "Find a file in this workspace", icon: "file" },
  { label: "Skills", description: "Add a skill to this message", icon: "skills" },
  { label: "MCP servers", description: "Browse connected tools", icon: "mcp" },
] satisfies { label: string; description: string; icon: IconName }[];

export function DemoPopover({
  surface,
  onSurface,
  trigger,
  anchor,
  onChoose,
}: SurfaceProps & { anchor: RefObject<HTMLDivElement | null>; onChoose: (value: string) => void }) {
  const [active, setActive] = useState(0);

  return (
    <Popover.Root
      open={surface === "popover"}
      modal={false}
      onOpenChange={(open) => {
        if (open) onSurface("popover");
        else dismiss("popover", onSurface);
      }}
    >
      <Popover.Trigger render={trigger} />
      <Popover.Portal>
        <Popover.Positioner
          positionMethod="fixed"
          anchor={anchor}
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          {...props(composerStyles.suggestionPositioner)}
        >
          <Popover.Popup
            ref={overlayRef}
            role="listbox"
            aria-label="Commands, skills, and prompts"
            initialFocus={false}
            finalFocus={false}
            {...props(floatingSurfaceStyles.popup, composerStyles.suggestionMenu)}
          >
            <div {...props(composerStyles.suggestionList)}>
              {suggestions.map((item, index) => (
                <div
                  key={item.label}
                  role="option"
                  aria-selected={active === index}
                  tabIndex={0}
                  {...props(composerStyles.suggestionItem)}
                  onPointerMove={() => setActive(index)}
                  onClick={() => {
                    onChoose(`/${item.label.toLowerCase().replaceAll(" ", "-")} `);
                    onSurface("none");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.currentTarget.click();
                    }
                  }}
                >
                  <span aria-hidden="true" {...props(composerStyles.suggestionIcon)}>
                    <Icon name={item.icon} size={12} />
                  </span>
                  <span {...props(composerStyles.suggestionText)}>
                    <span {...props(composerStyles.suggestionLabel)}>{item.label}</span>
                    <span {...props(composerStyles.suggestionDescription)}>{item.description}</span>
                  </span>
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DemoDialog({
  surface,
  onSurface,
  returnFocusRef,
  onConfirm,
}: {
  surface: AuditSurface;
  onSurface: SurfaceProps["onSurface"];
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={surface === "dialog"}
      pending={false}
      error={undefined}
      returnFocusRef={returnFocusRef}
      description="This removes the chat from the preview."
      onOpenChange={(open) => {
        if (!open) onSurface("none");
      }}
      onConfirm={() => {
        onConfirm();
        onSurface("none");
      }}
    />
  );
}
