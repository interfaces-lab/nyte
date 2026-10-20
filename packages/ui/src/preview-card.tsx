import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { floatingSurfaceStyles } from "./styles/floating-surface.stylex.ts";
import { layer, radius, space } from "./styles/schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { motion, role } from "./styles/vars.stylex.ts";

const styles = create({
  positioner: { zIndex: layer.menu, outline: "none", pointerEvents: "none" },
  popup: {
    pointerEvents: "auto",
    display: "flex",
    flexDirection: "column",
    width: "max-content",
    maxWidth: "min(260px, var(--available-width))",
    padding: space.s2,
    borderStyle: "none",
    borderRadius: radius.control,
    outline: "none",
    color: role.contentPrimary,
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
}: StyledProps<PreviewCardPrimitive.Popup.Props, Restyle<"PreviewCardContent">> &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "anchor" | "side" | "align" | "sideOffset" | "alignOffset" | "collisionAvoidance"
  > & {
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
              text.base,
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
