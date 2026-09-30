import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef, type ReactElement } from "react";
import {
  Toaster as Sonner,
  useSonner,
  type ExternalToast,
  type ToasterProps as SonnerToasterProps,
} from "sonner";

import { focus } from "../../a11y.stylex.ts";
import { button, layer, toast } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { surfaceTheme, type Tint } from "../../surface-theme.ts";
import { t } from "../../vars.stylex.ts";
import { Icon } from "./icon.tsx";
import { useOverlayRef } from "./overlay.tsx";

// Hairline lives in the shadow stack. Sonner already uses ::after for the
// stacked-toast hit lane, so an extra inset ring there would collide.
const TOAST_SHADOW = t.shadowMdOutline;

const styles = create({
  root: {
    "--_toast-duration": {
      default: t.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  toast: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxSizing: "border-box",
    width: "var(--width)",
    minHeight: 48,
    padding: `12px ${toast.closeGutter} 12px 12px`,
    overflow: "visible",
    borderStyle: "none",
    borderRadius: t.radius14,
    backgroundColor: t.bgElevated,
    boxShadow: TOAST_SHADOW,
    color: t.contentPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: t.focusRing,
    outlineOffset: 0,
    "--_toast-icon-color": t.contentSecondary,
  },
  content: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 2 },
  title: {
    fontWeight: 500,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    fontVariantNumeric: "tabular-nums",
    textWrap: "balance",
  },
  description: {
    color: t.contentSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
  icon: {
    display: "grid",
    placeItems: "center",
    alignSelf: "flex-start",
    flexShrink: 0,
    width: 16,
    height: t.leadingBase,
    color: "var(--_toast-icon-color)",
  },
  success: { "--_toast-icon-color": t.intentSuccessContent },
  error: { "--_toast-icon-color": t.intentDangerContent },
  warning: { "--_toast-icon-color": t.intentWarningContent },
  action: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    minHeight: button.heightSm,
    paddingBlock: 0,
    paddingInline: button.paddingInlineSm,
    appearance: "none",
    borderStyle: "none",
    borderRadius: button.radiusSm,
    backgroundColor: t.bgInteractiveSecondaryTranslucent,
    backgroundImage: {
      default: "none",
      ":hover": { "@media (hover: hover)": t.layerHover },
    },
    color: t.contentPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    fontWeight: 400,
    lineHeight: t.leadingSm,
    whiteSpace: "nowrap",
    cursor: t.cursorInteractive,
    scale: { default: 1, ":active": 0.96 },
    transitionProperty: "background-color, scale",
    transitionDuration: {
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
  close: {
    position: "absolute",
    zIndex: 1,
    insetBlockStart: 8,
    insetInlineEnd: 8,
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
    width: button.heightSm,
    height: button.heightSm,
    padding: 0,
    appearance: "none",
    borderStyle: "none",
    borderRadius: button.radiusSm,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": t.bgHover },
    },
    color: { default: t.contentInteractiveSecondary, ":hover": t.contentInteractivePrimary },
    cursor: t.cursorInteractive,
    scale: { default: 1, ":active": 0.96 },
    transitionProperty: "background-color, color, scale",
    transitionDuration: {
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
    // 40×40 hit area. 12px of trailing padding keeps it off the action.
    "::after": {
      content: '""',
      position: "absolute",
      inset: -8,
    },
  },
});

// Sonner injects unlayered layout CSS. These token-backed overrides sit at its
// public style boundary; the unstyled content above remains ordinary StyleX.
const positionerStyle = {
  "--width": "min(380px, calc(100vw - 32px))",
  "--gray11": t.contentSecondary,
  fontFamily: t.fontSans,
  zIndex: layer.toast,
  transitionDuration: "var(--_toast-duration)",
};

const toastStyle = {
  boxShadow: TOAST_SHADOW,
  transitionProperty: "transform, opacity, height",
  transitionDuration: "var(--_toast-duration)",
  transitionTimingFunction: t.easeOut,
};

/** Options that scope one toast to a hue: `toast("Saved", toastTint("green"))`. */
export function toastTint(tint: Tint): Pick<ExternalToast, "className"> {
  return { className: props(surfaceTheme[tint]).className };
}

/** The look is fixed. `xstyle`, `className`, and `style` land on the toast list. */
export type ToasterProps = StyledProps<
  Omit<SonnerToasterProps, "icons" | "toastOptions" | "richColors" | "invert">
>;

export function Toaster({ xstyle, className, style, ...rest }: ToasterProps): ReactElement {
  const overlayRef = useOverlayRef();
  const { toasts } = useSonner();
  const host = useRef<HTMLElement>(null);

  // Register the list only while it holds something, or an empty list would
  // keep every native view behind it hidden for good.
  useEffect(() => {
    if (overlayRef === undefined || toasts.length === 0) return;
    const list = host.current?.querySelector("ol");

    return list === null || list === undefined ? undefined : overlayRef(list);
  }, [overlayRef, toasts.length]);

  return (
    <Sonner
      ref={host}
      position="bottom-right"
      offset={16}
      mobileOffset={16}
      gap={8}
      expand
      closeButton
      containerAriaLabel="Notifications"
      {...rest}
      {...mergeStyleProps(props(styles.root, xstyle), className, { ...positionerStyle, ...style })}
      icons={{
        success: <Icon name="checkmark" size={16} />,
        error: <Icon name="warning" size={16} />,
        warning: <Icon name="warning" size={16} />,
        close: <Icon name="x" size={12} />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: "Dismiss notification",
        style: toastStyle,
        classNames: {
          toast: props(styles.toast).className,
          content: props(styles.content).className,
          title: props(styles.title).className,
          description: props(styles.description).className,
          icon: props(styles.icon).className,
          success: props(styles.success).className,
          error: props(styles.error).className,
          warning: props(styles.warning).className,
          actionButton: props(styles.action, focus.ring).className,
          cancelButton: props(styles.action, focus.ring).className,
          closeButton: props(styles.close, focus.ring).className,
        },
      }}
    />
  );
}
