import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { IconCrossSmall } from "central-icons";
import type * as React from "react";

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
} from "../../platform-tokens.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { Button } from "./button.tsx";
import { IconBox } from "./icon-box.tsx";

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: overlayVars["--nyte-layer-dialog"],
    backgroundColor: colorVars["--nyte-color-scrim"],
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--nyte-motion-normal"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  popup: {
    position: "fixed",
    top: "50%",
    left: "50%",
    zIndex: overlayVars["--nyte-layer-dialog"],
    display: "grid",
    boxSizing: "border-box",
    width: overlayVars["--nyte-dialog-width"],
    maxWidth: overlayVars["--nyte-dialog-max-width"],
    maxHeight: overlayVars["--nyte-dialog-max-height"],
    gap: spaceVars["--nyte-space-4"],
    overflowY: "auto",
    padding: spaceVars["--nyte-space-4"],
    transform: "translate(-50%, -50%)",
    transformOrigin: "center",
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-dialog"],
    backgroundColor: colorVars["--nyte-color-popover"],
    boxShadow: elevationVars["--nyte-elevation-dialog"],
    color: colorVars["--nyte-color-popover-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-body"],
    lineHeight: fontVars["--nyte-leading-body"],
    outline: "none",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    scale: { default: 1, "[data-starting-style]": 0.98, "[data-ending-style]": 0.98 },
    transitionProperty: "opacity, scale",
    transitionDuration: {
      default: motionVars["--nyte-motion-normal"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  close: {
    position: "absolute",
    top: spaceVars["--nyte-space-2"],
    right: spaceVars["--nyte-space-2"],
  },
  header: {
    display: "flex",
    flexDirection: "column",
    // Clears the absolutely positioned close button.
    paddingInlineEnd: controlVars["--nyte-control-height-sm"],
    gap: spaceVars["--nyte-space-1"],
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spaceVars["--nyte-space-2"],
  },
  title: {
    margin: 0,
    color: colorVars["--nyte-color-popover-foreground"],
    fontSize: fontVars["--nyte-font-size-title"],
    fontWeight: fontVars["--nyte-font-weight-medium"],
    lineHeight: fontVars["--nyte-leading-title"],
  },
  description: {
    margin: 0,
    color: colorVars["--nyte-color-muted-foreground"],
    fontSize: fontVars["--nyte-font-size-body"],
    lineHeight: fontVars["--nyte-leading-body"],
  },
});

// Shared with alert-dialog.tsx, which renders the same popup surface.
export const dialogStyles = styles;

export const Dialog = DialogPrimitive.Root;

type DialogOverlayProps = StyledProps<DialogPrimitive.Backdrop.Props>;

function DialogOverlay({ className, style, xstyle, ...props }: DialogOverlayProps) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      {...mergeStyleProps(stylex.props(styles.overlay, xstyle), className, style)}
      {...props}
    />
  );
}

export interface DialogContentProps extends StyledProps<DialogPrimitive.Popup.Props> {
  showCloseButton?: boolean;
}

export function DialogContent({
  children,
  className,
  showCloseButton = true,
  style,
  xstyle,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        {...mergeStyleProps(stylex.props(styles.popup, xstyle), className, style)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            aria-label="Close"
            render={<Button size="icon-sm" variant="ghost" xstyle={styles.close} />}
          >
            <IconBox glyphSize={12}>
              <IconCrossSmall />
            </IconBox>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export type DialogHeaderProps = StyledProps<React.ComponentProps<"div">>;

export function DialogHeader({ className, style, xstyle, ...props }: DialogHeaderProps) {
  return (
    <div
      data-slot="dialog-header"
      {...mergeStyleProps(stylex.props(styles.header, xstyle), className, style)}
      {...props}
    />
  );
}

export type DialogFooterProps = StyledProps<React.ComponentProps<"div">>;

export function DialogFooter({ className, style, xstyle, ...props }: DialogFooterProps) {
  return (
    <div
      data-slot="dialog-footer"
      {...mergeStyleProps(stylex.props(styles.footer, xstyle), className, style)}
      {...props}
    />
  );
}

export type DialogTitleProps = StyledProps<DialogPrimitive.Title.Props>;

export function DialogTitle({ className, style, xstyle, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      {...mergeStyleProps(stylex.props(styles.title, xstyle), className, style)}
      {...props}
    />
  );
}

export type DialogDescriptionProps = StyledProps<DialogPrimitive.Description.Props>;

export function DialogDescription({ className, style, xstyle, ...props }: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      {...mergeStyleProps(stylex.props(styles.description, xstyle), className, style)}
      {...props}
    />
  );
}
