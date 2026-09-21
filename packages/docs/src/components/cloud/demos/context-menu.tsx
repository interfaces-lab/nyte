"use client";

import { ContextMenu } from "@nyte-ai/ui/context-menu";
import {
  borderVars,
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  overlayVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  trigger: {
    display: "grid",
    width: "240px",
    height: "96px",
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "dashed",
    borderColor: colorVars["--nyte-color-border-strong"],
    borderRadius: radiusVars["--nyte-radius-menu"],
    color: colorVars["--nyte-color-muted-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    placeItems: "center",
    userSelect: "none",
  },
  positioner: { zIndex: overlayVars["--nyte-layer-menu"] },
  popup: {
    boxSizing: "border-box",
    minWidth: overlayVars["--nyte-menu-min-width"],
    padding: spaceVars["--nyte-space-1"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-menu"],
    backgroundColor: colorVars["--nyte-color-popover"],
    boxShadow: elevationVars["--nyte-elevation-menu"],
    color: colorVars["--nyte-color-popover-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    lineHeight: fontVars["--nyte-leading-label"],
    outline: "none",
  },
  item: {
    display: "flex",
    alignItems: "center",
    minHeight: controlVars["--nyte-control-height-md"],
    paddingInline: controlVars["--nyte-control-padding-sm"],
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--nyte-color-muted-hover"],
    },
    outline: "none",
    userSelect: "none",
  },
  destructive: {
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--nyte-color-destructive-muted"],
    },
    color: colorVars["--nyte-color-destructive"],
  },
  separator: {
    height: borderVars["--nyte-border-hairline-width"],
    marginBlock: spaceVars["--nyte-space-1"],
    marginInline: `calc(-1 * ${spaceVars["--nyte-space-1"]})`,
    backgroundColor: colorVars["--nyte-color-border"],
  },
});

export function ContextMenuDemo() {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger {...stylex.props(styles.trigger)}>
        Right click this area
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner {...stylex.props(styles.positioner)}>
          <ContextMenu.Popup {...stylex.props(styles.popup)}>
            <ContextMenu.Item {...stylex.props(styles.item)}>Rename</ContextMenu.Item>
            <ContextMenu.Item {...stylex.props(styles.item)}>Duplicate</ContextMenu.Item>
            <ContextMenu.Separator {...stylex.props(styles.separator)} />
            <ContextMenu.Item {...stylex.props(styles.item, styles.destructive)}>
              Delete
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
