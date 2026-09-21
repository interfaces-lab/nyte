"use client";

import { Button } from "@nyte-ai/ui";
import {
  borderVars,
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  overlayVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import { Popover } from "@nyte-ai/ui/popover";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  positioner: { zIndex: overlayVars["--nyte-layer-menu"] },
  popup: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    width: "260px",
    gap: spaceVars["--nyte-space-2"],
    padding: controlVars["--nyte-control-padding-lg"],
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
    transformOrigin: "var(--transform-origin)",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    scale: { default: 1, "[data-starting-style]": 0.98, "[data-ending-style]": 0.98 },
    transitionProperty: "opacity, scale",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  title: {
    margin: 0,
    fontSize: fontVars["--nyte-font-size-title"],
    fontWeight: fontVars["--nyte-font-weight-semibold"],
    lineHeight: fontVars["--nyte-leading-title"],
  },
  description: {
    margin: 0,
    color: colorVars["--nyte-color-muted-foreground"],
  },
  footer: { display: "flex", justifyContent: "flex-end" },
});

export function PopoverDemo() {
  return (
    <Popover.Root>
      <Popover.Trigger render={<Button variant="outline" />}>Notifications</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} {...stylex.props(styles.positioner)}>
          <Popover.Popup {...stylex.props(styles.popup)}>
            <Popover.Title {...stylex.props(styles.title)}>Notifications</Popover.Title>
            <Popover.Description {...stylex.props(styles.description)}>
              You are all caught up.
            </Popover.Description>
            <div {...stylex.props(styles.footer)}>
              <Popover.Close render={<Button size="sm" variant="ghost" />}>Close</Popover.Close>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
