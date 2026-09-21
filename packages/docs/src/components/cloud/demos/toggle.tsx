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
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import * as stylex from "@stylexjs/stylex";
import { IconBold, IconItalic, IconUnderline } from "central-icons";

const styles = stylex.create({
  toggle: {
    display: "inline-grid",
    height: controlVars["--nyte-control-height-md"],
    paddingInline: controlVars["--nyte-control-padding-sm"],
    borderStyle: "none",
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--nyte-color-muted"],
      "[data-pressed]": colorVars["--nyte-color-muted-hover"],
    },
    color: colorVars["--nyte-color-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    fontWeight: fontVars["--nyte-font-weight-medium"],
    placeItems: "center",
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: controlVars["--nyte-control-focus-offset"],
    transitionProperty: "background-color",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  square: { width: controlVars["--nyte-control-height-md"], paddingInline: 0 },
  group: {
    display: "inline-flex",
    gap: spaceVars["--nyte-space-1"],
    padding: spaceVars["--nyte-space-1"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-menu"],
  },
});

export function ToggleDemo() {
  return (
    <Toggle defaultPressed aria-label="Bold" {...stylex.props(styles.toggle, styles.square)}>
      <IconBold size={14} />
    </Toggle>
  );
}

export function ToggleGroupDemo() {
  return (
    <ToggleGroup defaultValue={["medium"]} {...stylex.props(styles.group)}>
      <Toggle value="low" {...stylex.props(styles.toggle)}>
        Low
      </Toggle>
      <Toggle value="medium" {...stylex.props(styles.toggle)}>
        Medium
      </Toggle>
      <Toggle value="high" {...stylex.props(styles.toggle)}>
        High
      </Toggle>
    </ToggleGroup>
  );
}

export function ToggleGroupMultipleDemo() {
  return (
    <ToggleGroup multiple defaultValue={["bold"]} {...stylex.props(styles.group)}>
      <Toggle value="bold" aria-label="Bold" {...stylex.props(styles.toggle, styles.square)}>
        <IconBold size={14} />
      </Toggle>
      <Toggle value="italic" aria-label="Italic" {...stylex.props(styles.toggle, styles.square)}>
        <IconItalic size={14} />
      </Toggle>
      <Toggle
        value="underline"
        aria-label="Underline"
        {...stylex.props(styles.toggle, styles.square)}
      >
        <IconUnderline size={14} />
      </Toggle>
    </ToggleGroup>
  );
}
