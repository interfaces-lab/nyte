/**
 * A centered modal over a scrim. `Popup` renders the portal, backdrop, and
 * panel as one unit, so every dialog paints the same surface and attaches the
 * overlay ref. The alert dialog reuses these parts under its own root.
 */
import { Dialog } from "@base-ui/react/dialog";
import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";

import { floatingSurfaceStyles } from "./floating-surface.stylex.ts";
import { dialog, layer } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { role, shadow, type } from "./vars.stylex.ts";
import { useOverlayRef } from "./overlay.tsx";

const styles = create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: layer.dialogBackdrop,
    backgroundColor: role.bgScrim,
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
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: dialog.radius,
    outline: "none",
    boxShadow: shadow.shadowXl,
    color: role.contentPrimary,
    transform: "translate(-50%, -50%)",
  },
  header: { display: "flex", flexDirection: "column", gap: 4 },
  title: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontLg,
    fontWeight: 600,
    lineHeight: type.leadingLg,
  },
  description: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 },
});

export type DialogRootProps = Dialog.Root.Props;

export type DialogTriggerProps = StyledProps<Dialog.Trigger.Props>;

function DialogTrigger({ xstyle, className, style, ...rest }: DialogTriggerProps): ReactElement {
  return <Dialog.Trigger {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

export type DialogCloseProps = StyledProps<Dialog.Close.Props>;

function DialogClose({ xstyle, className, style, ...rest }: DialogCloseProps): ReactElement {
  return <Dialog.Close {...rest} {...mergeStyleProps(props(xstyle), className, style)} />;
}

export type DialogPopupProps = StyledProps<Omit<Dialog.Popup.Props, "ref">> & {
  /** Scopes the panel to a hue; the scrim stays neutral. */
  readonly tint?: Tint;
};

function DialogPopup({ tint, xstyle, className, style, ...rest }: DialogPopupProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <Dialog.Portal>
      <Dialog.Backdrop ref={overlayRef} {...props(styles.backdrop)} />
      <Dialog.Popup
        ref={overlayRef}
        {...rest}
        {...mergeStyleProps(
          props(
            tint !== undefined && surfaceTheme[tint],
            styles.popup,
            floatingSurfaceStyles.material,
            xstyle,
          ),
          className,
          style,
        )}
      />
    </Dialog.Portal>
  );
}

export type DialogHeaderProps = StyledProps<ComponentProps<"div">>;

function DialogHeader({ xstyle, className, style, ...rest }: DialogHeaderProps): ReactElement {
  return <div {...rest} {...mergeStyleProps(props(styles.header, xstyle), className, style)} />;
}

export type DialogTitleProps = StyledProps<Dialog.Title.Props>;

function DialogTitle({ xstyle, className, style, ...rest }: DialogTitleProps): ReactElement {
  return (
    <Dialog.Title {...rest} {...mergeStyleProps(props(styles.title, xstyle), className, style)} />
  );
}

export type DialogDescriptionProps = StyledProps<Dialog.Description.Props>;

function DialogDescription({
  xstyle,
  className,
  style,
  ...rest
}: DialogDescriptionProps): ReactElement {
  return (
    <Dialog.Description
      {...rest}
      {...mergeStyleProps(props(styles.description, xstyle), className, style)}
    />
  );
}

export type DialogFooterProps = StyledProps<ComponentProps<"div">>;

function DialogFooter({ xstyle, className, style, ...rest }: DialogFooterProps): ReactElement {
  return <div {...rest} {...mergeStyleProps(props(styles.footer, xstyle), className, style)} />;
}

const dialogParts = {
  Root: Dialog.Root,
  Trigger: DialogTrigger,
  Popup: DialogPopup,
  Header: DialogHeader,
  Title: DialogTitle,
  Description: DialogDescription,
  Footer: DialogFooter,
  Close: DialogClose,
};

export { dialogParts as Dialog };
