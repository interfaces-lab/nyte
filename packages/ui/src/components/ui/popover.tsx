import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { floatingSurfaceStyles } from "../../floating-surface.stylex.ts";
import { layer } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { surfaceTheme, type Tint } from "../../surface-theme.ts";
import { t } from "../../vars.stylex.ts";
import { useOverlayRef } from "./overlay.tsx";

const styles = create({
  positioner: { zIndex: layer.menu, outline: "none" },
  popup: {
    padding: 8,
    borderStyle: "none",
    borderRadius: t.radius12,
    outline: "none",
    color: t.contentPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
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
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
  title: {
    margin: 0,
    color: t.contentPrimary,
    fontSize: t.fontBase,
    fontWeight: 500,
    lineHeight: t.leadingBase,
  },
  description: {
    margin: 0,
    color: t.contentSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
});

export type PopoverPositionerProps = StyledProps<PopoverPrimitive.Positioner.Props>;

function PopoverPositioner({
  positionMethod = "fixed",
  collisionPadding = 8,
  className,
  style,
  xstyle,
  ...rest
}: PopoverPositionerProps): ReactElement {
  return (
    <PopoverPrimitive.Positioner
      positionMethod={positionMethod}
      collisionPadding={collisionPadding}
      {...mergeStyleProps(props(styles.positioner, xstyle), className, style)}
      {...rest}
    />
  );
}

export type PopoverPopupProps = StyledProps<PopoverPrimitive.Popup.Props> & {
  /** Scopes the popup to a hue. */
  readonly tint?: Tint;
};

function PopoverPopup({
  tint,
  className,
  style,
  xstyle,
  ...rest
}: PopoverPopupProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <PopoverPrimitive.Popup
      ref={overlayRef}
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
  );
}

export type PopoverTitleProps = StyledProps<PopoverPrimitive.Title.Props>;

function PopoverTitle({ className, style, xstyle, ...rest }: PopoverTitleProps): ReactElement {
  return (
    <PopoverPrimitive.Title
      {...mergeStyleProps(props(styles.title, xstyle), className, style)}
      {...rest}
    />
  );
}

export type PopoverDescriptionProps = StyledProps<PopoverPrimitive.Description.Props>;

function PopoverDescription({
  className,
  style,
  xstyle,
  ...rest
}: PopoverDescriptionProps): ReactElement {
  return (
    <PopoverPrimitive.Description
      {...mergeStyleProps(props(styles.description, xstyle), className, style)}
      {...rest}
    />
  );
}

export const Popover = {
  Root: PopoverPrimitive.Root,
  Trigger: PopoverPrimitive.Trigger,
  Portal: PopoverPrimitive.Portal,
  Backdrop: PopoverPrimitive.Backdrop,
  Positioner: PopoverPositioner,
  Popup: PopoverPopup,
  Arrow: PopoverPrimitive.Arrow,
  Viewport: PopoverPrimitive.Viewport,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: PopoverPrimitive.Close,
  createHandle: PopoverPrimitive.createHandle,
};
