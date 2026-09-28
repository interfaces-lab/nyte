"use client";

import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "@nyte-ai/ui/context-menu";
import { t } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";

const styles = create({
  area: {
    display: "grid",
    placeItems: "center",
    width: 240,
    height: 96,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: t.strokePrimary,
    borderRadius: t.radiusLg,
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
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
