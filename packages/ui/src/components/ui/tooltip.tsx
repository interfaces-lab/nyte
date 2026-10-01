import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { layer, shape } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { surfaceTheme, type Tint } from "../../surface-theme.ts";
import { motion, role, shadow, type } from "../../vars.stylex.ts";
import { useOverlayRef } from "./overlay.tsx";

const styles = create({
  positioner: { zIndex: layer.tooltip, outline: "none" },
  popup: {
    maxWidth: 260,
    paddingBlock: 4,
    paddingInline: 6,
    borderRadius: shape.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
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
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

export type TooltipProviderProps = TooltipPrimitive.Provider.Props;

export function TooltipProvider({
  delay = 300,
  closeDelay = 100,
  timeout = 200,
  ...rest
}: TooltipProviderProps): ReactElement {
  return (
    <TooltipPrimitive.Provider delay={delay} closeDelay={closeDelay} timeout={timeout} {...rest} />
  );
}

export const Tooltip = TooltipPrimitive.Root;

export const TooltipTrigger = TooltipPrimitive.Trigger;

export type TooltipContentProps = StyledProps<Omit<TooltipPrimitive.Popup.Props, "ref">> &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "align" | "sideOffset" | "alignOffset"> & {
    /** Scopes the popup to a hue. */
    readonly tint?: Tint;
  };

export function TooltipContent({
  side = "bottom",
  align = "center",
  sideOffset = 6,
  alignOffset,
  tint,
  xstyle,
  className,
  style,
  ...rest
}: TooltipContentProps): ReactElement {
  const overlayRef = useOverlayRef();

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
          ref={overlayRef}
          data-slot="tooltip-content"
          {...mergeStyleProps(
            props(tint !== undefined && surfaceTheme[tint], styles.popup, xstyle),
            className,
            style,
          )}
          {...rest}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
