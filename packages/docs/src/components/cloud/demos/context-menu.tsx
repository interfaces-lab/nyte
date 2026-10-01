"use client";
import { shape } from "@nyte-ai/ui/schema.stylex";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@nyte-ai/ui/context-menu";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";

const styles = create({
  area: {
    display: "grid",
    placeItems: "center",
    width: 240,
    height: 96,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: role.borderPrimaryTranslucent,
    borderRadius: shape.control,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    userSelect: "none",
  },
});

export function ContextMenuDemo() {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div {...props(styles.area)}>Right click this area</div>} />
      <ContextMenuContent aria-label="Session">
        <ContextMenuItem icon="pencil" onClick={() => {}}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem icon="archive" onClick={() => {}}>
          Archive
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon="trash" variant="danger" onClick={() => {}}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
