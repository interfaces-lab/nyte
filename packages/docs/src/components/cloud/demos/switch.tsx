"use client";

import {
  borderVars,
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import { Switch } from "@nyte-ai/ui/switch";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: spaceVars["--nyte-space-2"],
    color: colorVars["--nyte-color-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    lineHeight: fontVars["--nyte-leading-label"],
    userSelect: "none",
  },
  root: {
    boxSizing: "border-box",
    position: "relative",
    display: "inline-block",
    width: "36px",
    height: "20px",
    padding: 0,
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radiusVars["--nyte-radius-pill"],
    backgroundColor: {
      default: colorVars["--nyte-color-muted-hover"],
      "[data-checked]": colorVars["--nyte-color-primary"],
    },
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: controlVars["--nyte-control-focus-offset"],
    transitionProperty: "background-color",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  thumb: {
    position: "absolute",
    insetBlockStart: "2px",
    insetInlineStart: "2px",
    display: "block",
    width: spaceVars["--nyte-space-4"],
    height: spaceVars["--nyte-space-4"],
    borderRadius: radiusVars["--nyte-radius-pill"],
    backgroundColor: colorVars["--nyte-color-primary-foreground"],
    boxShadow: elevationVars["--nyte-elevation-field"],
    translate: { default: "0", "[data-checked]": "16px" },
    transitionProperty: "translate",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
});

export function SwitchDemo() {
  return (
    <label {...stylex.props(styles.label)}>
      <Switch.Root defaultChecked {...stylex.props(styles.root)}>
        <Switch.Thumb {...stylex.props(styles.thumb)} />
      </Switch.Root>
      Notifications
    </label>
  );
}
