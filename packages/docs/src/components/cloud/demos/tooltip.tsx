"use client";

import { Button } from "@nyte-ai/ui";
import {
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  overlayVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import { Tooltip } from "@nyte-ai/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import { IconClipboard } from "central-icons";

const styles = stylex.create({
  positioner: { zIndex: overlayVars["--nyte-layer-menu"] },
  popup: {
    paddingInline: controlVars["--nyte-control-padding-sm"],
    paddingBlock: spaceVars["--nyte-space-1"],
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: colorVars["--nyte-color-fill"],
    color: colorVars["--nyte-color-fill-label"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-detail"],
    lineHeight: fontVars["--nyte-leading-detail"],
    transformOrigin: "var(--transform-origin)",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    scale: { default: 1, "[data-starting-style]": 0.96, "[data-ending-style]": 0.96 },
    transitionProperty: "opacity, scale",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
});

export function TooltipDemo() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<Button size="icon-sm" variant="ghost" />} aria-label="Copy output">
        <IconClipboard size={14} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} {...stylex.props(styles.positioner)}>
          <Tooltip.Popup {...stylex.props(styles.popup)}>Copy output</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
