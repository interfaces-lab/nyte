import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { dialogStyles } from "./dialog.tsx";

export const AlertDialog = AlertDialogPrimitive.Root;

export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export const AlertDialogClose = AlertDialogPrimitive.Close;

export type AlertDialogContentProps = StyledProps<AlertDialogPrimitive.Popup.Props>;

export function AlertDialogContent({
  children,
  className,
  style,
  xstyle,
  ...props
}: AlertDialogContentProps) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop
        data-slot="alert-dialog-overlay"
        {...stylex.props(dialogStyles.overlay)}
      />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        {...mergeStyleProps(stylex.props(dialogStyles.popup, xstyle), className, style)}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  );
}

export type AlertDialogTitleProps = StyledProps<AlertDialogPrimitive.Title.Props>;

export function AlertDialogTitle({ className, style, xstyle, ...props }: AlertDialogTitleProps) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      {...mergeStyleProps(stylex.props(dialogStyles.title, xstyle), className, style)}
      {...props}
    />
  );
}

export type AlertDialogDescriptionProps = StyledProps<AlertDialogPrimitive.Description.Props>;

export function AlertDialogDescription({
  className,
  style,
  xstyle,
  ...props
}: AlertDialogDescriptionProps) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      {...mergeStyleProps(stylex.props(dialogStyles.description, xstyle), className, style)}
      {...props}
    />
  );
}

export type AlertDialogFooterProps = StyledProps<React.ComponentProps<"div">>;

export function AlertDialogFooter({ className, style, xstyle, ...props }: AlertDialogFooterProps) {
  return (
    <div
      data-slot="alert-dialog-footer"
      {...mergeStyleProps(stylex.props(dialogStyles.footer, xstyle), className, style)}
      {...props}
    />
  );
}
