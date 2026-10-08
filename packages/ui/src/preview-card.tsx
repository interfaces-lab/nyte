import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { floatingSurfaceStyles } from "./floating-surface.stylex.ts";
import { layer, radius } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { motion, role, type } from "./vars.stylex.ts";

const styles = create({
  positioner: { zIndex: layer.menu, outline: "none" },
  popup: {
    display: "flex",
    flexDirection: "column",
    width: "max-content",
    maxWidth: "min(260px, var(--available-width))",
    padding: 8,
    borderStyle: "none",
    borderRadius: radius.control,
    outline: "none",
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    transformOrigin: "var(--transform-origin)",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    scale: {
      default: 1,
      "[data-starting-style]": 0.98,
      "[data-ending-style]": 0.98,
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity, scale",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

export const PreviewCard = PreviewCardPrimitive.Root;

export const PreviewCardTrigger = PreviewCardPrimitive.Trigger;

export function PreviewCardContent({
  anchor,
  side,
  align,
  sideOffset = 4,
  alignOffset,
  collisionAvoidance,
  tint,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<PreviewCardPrimitive.Popup.Props> &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "anchor" | "side" | "align" | "sideOffset" | "alignOffset" | "collisionAvoidance"
  > & {
    /** Scopes the popup to a hue. */
    readonly tint?: Tint;
  }): ReactElement {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        positionMethod="fixed"
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={8}
        {...props(styles.positioner)}
      >
        <PreviewCardPrimitive.Popup
          data-slot="preview-card-content"
          {...mergeStyleProps(
            props(
              tint !== undefined && surfaceTheme[tint],
              floatingSurfaceStyles.popup,
              styles.popup,
              xstyle,
            ),
            className,
            style,
          )}
          {...rest}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}
