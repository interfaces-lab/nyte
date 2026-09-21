"use client";

import { Collapsible } from "@nyte-ai/ui/collapsible";
import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { IconChevronRightSmall } from "central-icons";

const styles = stylex.create({
  root: { width: "280px" },
  trigger: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: controlVars["--nyte-control-height-md"],
    gap: spaceVars["--nyte-space-2"],
    paddingInline: controlVars["--nyte-control-padding-sm"],
    borderStyle: "none",
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": colorVars["--nyte-color-muted"],
    },
    color: colorVars["--nyte-color-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    fontWeight: fontVars["--nyte-font-weight-medium"],
    lineHeight: fontVars["--nyte-leading-label"],
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: controlVars["--nyte-control-focus-offset"],
    // The chevron cannot read its parent's state, so the trigger publishes it.
    "--_chevron-rotate": { default: "0deg", "[data-panel-open]": "90deg" },
  },
  chevron: {
    flexShrink: 0,
    color: colorVars["--nyte-color-muted-foreground"],
    rotate: "var(--_chevron-rotate, 0deg)",
    transitionProperty: "rotate",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  panel: {
    height: {
      default: "var(--collapsible-panel-height)",
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    overflow: "hidden",
    transitionProperty: "height",
    transitionDuration: {
      default: motionVars["--nyte-motion-normal"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  body: {
    marginBlockStart: spaceVars["--nyte-space-1"],
    padding: controlVars["--nyte-control-padding-sm"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-control"],
    color: colorVars["--nyte-color-muted-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    lineHeight: fontVars["--nyte-leading-label"],
  },
});

export function CollapsibleDemo() {
  return (
    <Collapsible.Root {...stylex.props(styles.root)}>
      <Collapsible.Trigger {...stylex.props(styles.trigger)}>
        <IconChevronRightSmall size={12} {...stylex.props(styles.chevron)} />
        Advanced settings
      </Collapsible.Trigger>
      <Collapsible.Panel {...stylex.props(styles.panel)}>
        <div {...stylex.props(styles.body)}>
          Tools run without a confirmation prompt while this session is trusted.
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
