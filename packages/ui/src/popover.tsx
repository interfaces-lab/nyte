import { Popover } from "@base-ui/react/popover";
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
    padding: 8,
    borderStyle: "none",
    borderRadius: radius.card,
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
  title: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: 500,
    lineHeight: type.leadingBase,
  },
  description: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
});

function PopoverBackdrop({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Popover.Backdrop.Props>): ReactElement {
  return (
    <Popover.Backdrop
      data-slot="popover-backdrop"
      {...rest}
      {...mergeStyleProps(props(xstyle), className, style)}
    />
  );
}

function PopoverPositioner({
  positionMethod = "fixed",
  collisionPadding = 8,
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<Popover.Positioner.Props>): ReactElement {
  return (
    <Popover.Positioner
      positionMethod={positionMethod}
      collisionPadding={collisionPadding}
      {...mergeStyleProps(props(styles.positioner, xstyle), className, style)}
      {...rest}
    />
  );
}

function PopoverPopup({
  tint,
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<Popover.Popup.Props> & {
  /** Scopes the popup to a hue. */
  readonly tint?: Tint;
}): ReactElement {
  return (
    <Popover.Popup
      data-slot="popover-popup"
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

function PopoverTitle({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<Popover.Title.Props>): ReactElement {
  return (
    <Popover.Title {...mergeStyleProps(props(styles.title, xstyle), className, style)} {...rest} />
  );
}

function PopoverDescription({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<Popover.Description.Props>): ReactElement {
  return (
    <Popover.Description
      {...mergeStyleProps(props(styles.description, xstyle), className, style)}
      {...rest}
    />
  );
}

const popoverParts = {
  Root: Popover.Root,
  Trigger: Popover.Trigger,
  Portal: Popover.Portal,
  Backdrop: PopoverBackdrop,
  Positioner: PopoverPositioner,
  Popup: PopoverPopup,
  Arrow: Popover.Arrow,
  Viewport: Popover.Viewport,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: Popover.Close,
  createHandle: Popover.createHandle,
};

export { popoverParts as Popover };
