/**
 * A centered modal over a scrim. `Popup` renders the portal, backdrop, and
 * panel as one unit, so every dialog paints the same surface and attaches the
 * overlay ref. The alert dialog reuses these parts under its own root.
 */
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";

import { floatingSurfaceStyles } from "../../floating-surface.stylex.ts";
import { dialog, layer } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";
import { useOverlayRef } from "./overlay.tsx";

const styles = create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: layer.dialogBackdrop,
    backgroundColor: t.bgScrim,
  },
  popup: {
    position: "fixed",
    top: "50%",
    left: "50%",
    zIndex: layer.dialog,
    display: "flex",
    flexDirection: "column",
    gap: dialog.gap,
    width: `min(${dialog.width}, calc(100vw - 48px))`,
    maxHeight: "calc(100dvh - 48px)",
    padding: dialog.padding,
    overflowY: "auto",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    borderRadius: dialog.radius,
    outline: "none",
    boxShadow: t.shadowModal,
    color: t.textPrimary,
    transform: "translate(-50%, -50%)",
  },
  header: { display: "flex", flexDirection: "column", gap: 4 },
  title: {
    margin: 0,
    color: t.textPrimary,
    fontSize: t.fontLg,
    fontWeight: 600,
    lineHeight: t.leadingLg,
  },
  description: {
    margin: 0,
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 },
});

export type DialogRootProps = DialogPrimitive.Root.Props;

export type DialogTriggerProps = StyledProps<DialogPrimitive.Trigger.Props>;

function DialogTrigger({ xstyle, className, style, ...rest }: DialogTriggerProps): ReactElement {
  return (
    <DialogPrimitive.Trigger {...rest} {...mergeStyleProps(props(xstyle), className, style)} />
  );
}

export type DialogCloseProps = StyledProps<DialogPrimitive.Close.Props>;

function DialogClose({ xstyle, className, style, ...rest }: DialogCloseProps): ReactElement {
  return <DialogPrimitive.Close {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

export type DialogPopupProps = StyledProps<Omit<DialogPrimitive.Popup.Props, "ref">>;

function DialogPopup({ xstyle, className, style, ...rest }: DialogPopupProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop ref={overlayRef} {...props(styles.backdrop)} />
      <DialogPrimitive.Popup
        ref={overlayRef}
        {...rest}
        {...mergeStyleProps(
          props(styles.popup, floatingSurfaceStyles.material, xstyle),
          className,
          style,
        )}
      />
    </DialogPrimitive.Portal>
  );
}

export type DialogHeaderProps = StyledProps<ComponentProps<"div">>;

function DialogHeader({ xstyle, className, style, ...rest }: DialogHeaderProps): ReactElement {
  return <div {...rest} {...mergeStyleProps(props(styles.header, xstyle), className, style)} />;
}

export type DialogTitleProps = StyledProps<DialogPrimitive.Title.Props>;

function DialogTitle({ xstyle, className, style, ...rest }: DialogTitleProps): ReactElement {
  return (
    <DialogPrimitive.Title
      {...rest}
      {...mergeStyleProps(props(styles.title, xstyle), className, style)}
    />
  );
}

export type DialogDescriptionProps = StyledProps<DialogPrimitive.Description.Props>;

function DialogDescription({
  xstyle,
  className,
  style,
  ...rest
}: DialogDescriptionProps): ReactElement {
  return (
    <DialogPrimitive.Description
      {...rest}
      {...mergeStyleProps(props(styles.description, xstyle), className, style)}
    />
  );
}

export type DialogFooterProps = StyledProps<ComponentProps<"div">>;

function DialogFooter({ xstyle, className, style, ...rest }: DialogFooterProps): ReactElement {
  return <div {...rest} {...mergeStyleProps(props(styles.footer, xstyle), className, style)} />;
}

export const Dialog = {
  Root: DialogPrimitive.Root,
  Trigger: DialogTrigger,
  Popup: DialogPopup,
  Header: DialogHeader,
  Title: DialogTitle,
  Description: DialogDescription,
  Footer: DialogFooter,
  Close: DialogClose,
};
