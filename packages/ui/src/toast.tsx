import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef, type ReactElement } from "react";
import {
  Toaster,
  useSonner,
  type ExternalToast,
  type ToasterProps as SonnerToasterProps,
} from "sonner";

import { focus } from "./a11y.stylex.ts";
import { button, glyph, layer, shape, target, toast } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { intent, surfaceTheme, type Tint } from "./surface-theme.ts";
import { appearance, motion, role, shadow, type } from "./vars.stylex.ts";
import { Icon } from "./icon.tsx";
import { useOverlayRef } from "./overlay.tsx";

// Hairline lives in the shadow stack. Sonner already uses ::after for the
// stacked-toast hit lane, so an extra inset ring there would collide.
const TOAST_SHADOW = shadow.shadowMdOutline;

const styles = create({
  root: {
    "--_toast-duration": {
      default: motion.durationNormal,
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
    minHeight: toast.minHeight,
    padding: 12,
    paddingInlineEnd: toast.closeGutter,
    overflow: "visible",
    borderStyle: "none",
    borderRadius: shape.surface,
    backgroundColor: role.bgElevated,
    boxShadow: TOAST_SHADOW,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: 0,
  },
  content: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 2 },
  title: {
    fontWeight: 500,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontVariantNumeric: "tabular-nums",
    textWrap: "balance",
  },
  description: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  icon: {
    display: "grid",
    placeItems: "center",
    alignSelf: "flex-start",
    flexShrink: 0,
    width: glyph.md,
    height: type.leadingBase,
    color: role.contentSecondary,
  },
  statusIcon: { display: "inline-flex", color: role.contentSecondary },
  action: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    minHeight: target.min,
    minWidth: target.min,
    paddingBlock: 0,
    paddingInline: button.paddingInlineSm,
    appearance: "none",
    borderStyle: "none",
    borderRadius: button.radiusSm,
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    backgroundImage: {
      default: "none",
      ":hover": { "@media (hover: hover)": role.layerHover },
    },
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    fontWeight: 400,
    lineHeight: type.leadingSm,
    whiteSpace: "nowrap",
    cursor: appearance.cursorInteractive,
    scale: { default: 1, ":active": 0.96 },
    transitionProperty: "background-color, scale",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
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
    minWidth: target.min,
    minHeight: target.min,
    padding: 0,
    appearance: "none",
    borderStyle: "none",
    borderRadius: button.radiusSm,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": role.bgHover },
    },
    color: { default: role.contentInteractiveSecondary, ":hover": role.contentInteractivePrimary },
    cursor: appearance.cursorInteractive,
    scale: { default: 1, ":active": 0.96 },
    transitionProperty: "background-color, color, scale",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

// Sonner injects unlayered layout CSS. These token-backed overrides sit at its
// public style boundary; the unstyled content above remains ordinary StyleX.
const positionerStyle = {
  "--width": "min(380px, calc(100vw - 32px))",
  "--gray11": role.contentSecondary,
  fontFamily: type.fontSans,
  zIndex: layer.toast,
  transitionDuration: "var(--_toast-duration)",
};

const toastStyle = {
  boxShadow: TOAST_SHADOW,
  transitionProperty: "transform, opacity, height",
  transitionDuration: "var(--_toast-duration)",
  transitionTimingFunction: motion.easeOut,
};

/** Options that scope one toast to a hue: `toast("Saved", toastTint("green"))`. */
export function toastTint(tint: Tint): Pick<ExternalToast, "className"> {
  return { className: props(surfaceTheme[tint]).className };
}

/** The look is fixed. `xstyle`, `className`, and `style` land on the toast list. */
export type ToasterProps = StyledProps<
  Omit<SonnerToasterProps, "icons" | "toastOptions" | "richColors" | "invert" | "closeButton">
> & { readonly tint?: Tint };

function StyledToaster({ tint, xstyle, className, style, ...rest }: ToasterProps): ReactElement {
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
    <Toaster
      ref={host}
      position="bottom-right"
      offset={16}
      mobileOffset={16}
      gap={8}
      expand
      containerAriaLabel="Notifications"
      {...rest}
      closeButton
      {...mergeStyleProps(
        props(tint !== undefined && surfaceTheme[tint], styles.root, xstyle),
        className,
        { ...positionerStyle, ...style },
      )}
      icons={{
        success: (
          <span {...props(intent.success, styles.statusIcon)}>
            <Icon name="checkmark" size={16} />
          </span>
        ),
        error: (
          <span {...props(intent.danger, styles.statusIcon)}>
            <Icon name="warning" size={16} />
          </span>
        ),
        warning: (
          <span {...props(intent.warning, styles.statusIcon)}>
            <Icon name="warning" size={16} />
          </span>
        ),
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
          actionButton: props(styles.action, focus.ring).className,
          cancelButton: props(styles.action, focus.ring).className,
          closeButton: props(styles.close, focus.ring).className,
        },
      }}
    />
  );
}

export { StyledToaster as Toaster };

export { toast } from "sonner";

export type { ExternalToast } from "sonner";
