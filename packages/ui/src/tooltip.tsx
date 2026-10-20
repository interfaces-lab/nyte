import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { floatingSurfaceStyles } from "./styles/floating-surface.stylex.ts";
import { layer, radius, space } from "./styles/schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { motion, role, shadow } from "./styles/vars.stylex.ts";

const styles = create({
  positioner: { zIndex: layer.tooltip, outline: "none" },
  popup: {
    maxWidth: 260,
    paddingBlock: space.s1,
    paddingInline: space.s1_5,
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    color: role.contentSecondary,
    whiteSpace: "pre-line",
    overflowWrap: "anywhere",
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
      "[data-instant]": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    width: "max-content",
    maxWidth: "min(260px, var(--available-width))",
    padding: space.s2,
    color: role.contentPrimary,
    whiteSpace: "normal",
  },
});

export function TooltipProvider({
  delay = 300,
  closeDelay = 100,
  timeout = 200,
  ...rest
}: TooltipPrimitive.Provider.Props): ReactElement {
  return (
    <TooltipPrimitive.Provider delay={delay} closeDelay={closeDelay} timeout={timeout} {...rest} />
  );
}

export const Tooltip = TooltipPrimitive.Root;

export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  side = "bottom",
  align,
  sideOffset = 6,
  alignOffset,
  tint,
  variant = "label",
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<TooltipPrimitive.Popup.Props, Restyle<"TooltipContent">> &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "align" | "sideOffset" | "alignOffset"> & {
    readonly tint?: Tint;
    readonly variant?: "label" | "card";
  }): ReactElement {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        positionMethod="fixed"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={8}
        {...props(styles.positioner)}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          {...mergeStyleProps(
            props(
              text.xs,
              tint !== undefined && surfaceTheme[tint],
              styles.popup,
              variant === "card" && [text.base, floatingSurfaceStyles.popup, styles.card],
              xstyle,
            ),
            className,
            style,
          )}
          {...rest}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
