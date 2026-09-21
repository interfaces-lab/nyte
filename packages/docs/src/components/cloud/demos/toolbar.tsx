"use client";

import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { Toolbar } from "@nyte-ai/ui/toolbar";
import * as stylex from "@stylexjs/stylex";
import { IconArrowUndoUp, IconBold, IconItalic, IconTrashCanSimple } from "central-icons";

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: spaceVars["--nyte-space-1"],
    padding: spaceVars["--nyte-space-1"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-menu"],
    backgroundColor: colorVars["--nyte-color-chrome"],
    fontFamily: fontVars["--nyte-font-family-ui"],
  },
  group: { display: "inline-flex", gap: spaceVars["--nyte-space-1"] },
  item: {
    display: "inline-grid",
    width: controlVars["--nyte-control-height-md"],
    height: controlVars["--nyte-control-height-md"],
    padding: 0,
    borderStyle: "none",
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--nyte-color-muted"],
      "[data-pressed]": colorVars["--nyte-color-muted-hover"],
    },
    color: colorVars["--nyte-color-foreground"],
    placeItems: "center",
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: controlVars["--nyte-control-focus-offset"],
    opacity: { default: 1, "[data-disabled]": controlVars["--nyte-control-disabled-opacity"] },
    transitionProperty: "background-color, opacity",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  separator: {
    width: borderVars["--nyte-border-hairline-width"],
    height: spaceVars["--nyte-space-4"],
    marginInline: spaceVars["--nyte-space-1"],
    backgroundColor: colorVars["--nyte-color-border"],
  },
});

export function ToolbarDemo() {
  return (
    <Toolbar.Root aria-label="Formatting" {...stylex.props(styles.root)}>
      <Toolbar.Group aria-label="Text style" {...stylex.props(styles.group)}>
        <Toolbar.Button
          render={<Toggle defaultPressed />}
          aria-label="Bold"
          {...stylex.props(styles.item)}
        >
          <IconBold size={14} />
        </Toolbar.Button>
        <Toolbar.Button render={<Toggle />} aria-label="Italic" {...stylex.props(styles.item)}>
          <IconItalic size={14} />
        </Toolbar.Button>
      </Toolbar.Group>
      <Toolbar.Separator {...stylex.props(styles.separator)} />
      <Toolbar.Button aria-label="Undo" {...stylex.props(styles.item)}>
        <IconArrowUndoUp size={14} />
      </Toolbar.Button>
      <Toolbar.Button disabled aria-label="Delete" {...stylex.props(styles.item)}>
        <IconTrashCanSimple size={14} />
      </Toolbar.Button>
    </Toolbar.Root>
  );
}
