"use client";

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
import { PreviewCard } from "@nyte-ai/ui/preview-card";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  trigger: {
    borderRadius: radiusVars["--nyte-radius-control"],
    color: colorVars["--nyte-color-accent"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-body"],
    textDecorationLine: "underline",
    textUnderlineOffset: "2px",
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: controlVars["--nyte-control-focus-offset"],
  },
  positioner: { zIndex: overlayVars["--nyte-layer-menu"] },
  popup: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    width: "260px",
    gap: spaceVars["--nyte-space-1"],
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
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  heading: {
    fontWeight: fontVars["--nyte-font-weight-semibold"],
  },
  body: {
    margin: 0,
    color: colorVars["--nyte-color-muted-foreground"],
  },
});

export function PreviewCardDemo() {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger href="/cloud/components/button" {...stylex.props(styles.trigger)}>
        Button
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={8} {...stylex.props(styles.positioner)}>
          <PreviewCard.Popup {...stylex.props(styles.popup)}>
            <span {...stylex.props(styles.heading)}>Button</span>
            <p {...stylex.props(styles.body)}>Variants, sizes, and an unstyled mode.</p>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
