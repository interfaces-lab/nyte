"use client";
import { shape } from "@nyte-ai/ui/schema.stylex";

import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "@nyte-ai/ui/context-menu";
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
    <ContextMenu label="Session" trigger={<div {...props(styles.area)}>Right click this area</div>}>
      <ContextMenuItem icon="pencil" onSelect={() => {}}>
        Rename
      </ContextMenuItem>
      <ContextMenuItem icon="archive" onSelect={() => {}}>
        Archive
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon="trash" danger onSelect={() => {}}>
        Delete
      </ContextMenuItem>
    </ContextMenu>
  );
}
