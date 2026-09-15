import { Toaster as Sonner, useSonner } from "@nyte-ai/ui/sonner";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { layer } from "../theme/schema.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { t } from "../theme/vars.stylex.ts";
import { Icon } from "./icons.tsx";
import { registerOverlay } from "./overlay-occlusion.ts";
import { focus } from "./ui.tsx";

// Hairline lives in the shadow stack. Sonner already uses ::after for the
// stacked-toast hit lane, so an extra inset ring there would collide.
const TOAST_SHADOW = `${t.shadowPopover}, inset 0 0 0 1px ${t.strokeSecondary}, inset 0 0 0 1px ${t.bgElevated}`;

const styles = stylex.create({
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
    padding: "12px 44px 12px 12px",
    overflow: "visible",
    borderStyle: "none",
    borderRadius: t.radius2xl,
    backgroundColor: t.bgElevated,
    boxShadow: TOAST_SHADOW,
    color: t.textPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
    outlineColor: t.focusRing,
    outlineOffset: 1,
    "--_toast-icon-color": t.iconSecondary,
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
    color: t.textSecondary,
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
  success: { "--_toast-icon-color": t.textSuccess },
  error: { "--_toast-icon-color": t.textDanger },
  warning: { "--_toast-icon-color": t.textWarning },
  action: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    minHeight: 26,
    paddingBlock: 0,
    paddingInline: 8,
    appearance: "none",
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: t.fillSecondary,
      ":hover": { "@media (hover: hover)": t.fillGhostHover },
    },
    color: t.textPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    fontWeight: 400,
    lineHeight: t.leadingSm,
    whiteSpace: "nowrap",
    cursor: "pointer",
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
    width: 24,
    height: 24,
    padding: 0,
    appearance: "none",
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": t.fillGhostHover },
    },
    color: { default: t.iconSecondary, ":hover": t.iconPrimary },
    cursor: "pointer",
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
  "--gray11": t.iconSecondary,
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

export function Toaster(): ReactElement {
  const { theme } = useAppearanceSettings();
  const { toasts } = useSonner();
  const host = useRef<HTMLDivElement>(null);
  // Toasts sit on the bottom-right of the stage, where a browser page is.
  // Register the list only while it holds something, or an empty list would keep
  // every page hidden for good.
  useEffect(() => {
    if (toasts.length === 0) return;
    const list = host.current?.querySelector("ol");
    return list === null || list === undefined ? undefined : registerOverlay(list);
  }, [toasts.length]);
  return (
    <div ref={host}>
      <Sonner
        theme={theme}
        position="bottom-right"
        offset={16}
        mobileOffset={16}
        gap={8}
        expand
        closeButton
        containerAriaLabel="Notifications"
        style={positionerStyle}
        {...stylex.props(styles.root)}
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
            toast: stylex.props(styles.toast).className,
            content: stylex.props(styles.content).className,
            title: stylex.props(styles.title).className,
            description: stylex.props(styles.description).className,
            icon: stylex.props(styles.icon).className,
            success: stylex.props(styles.success).className,
            error: stylex.props(styles.error).className,
            warning: stylex.props(styles.warning).className,
            actionButton: stylex.props(styles.action, focus.ring).className,
            cancelButton: stylex.props(styles.action, focus.ring).className,
            closeButton: stylex.props(styles.close, focus.ring).className,
          },
        }}
      />
    </div>
  );
}
