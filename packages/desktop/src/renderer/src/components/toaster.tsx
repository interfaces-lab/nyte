import { Toaster as Sonner } from "@nyte-ai/ui/sonner";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { layer } from "../theme/schema.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { t } from "../theme/vars.stylex.ts";
import { Icon } from "./icons.tsx";
import { focus } from "./ui.tsx";

const styles = stylex.create({
  root: {
    "--_toast-duration": {
      default: t.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "var(--width)",
    minHeight: 48,
    padding: "12px 36px 12px 12px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    borderRadius: t.radiusXl,
    backgroundColor: t.bgElevated,
    color: t.textPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    "--_toast-icon-color": t.iconSecondary,
  },
  content: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 2 },
  title: { fontWeight: 500, fontSize: t.fontBase, lineHeight: t.leadingBase },
  description: { color: t.textSecondary, fontSize: t.fontSm, lineHeight: t.leadingSm },
  icon: {
    display: "grid",
    placeItems: "center",
    position: "relative",
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
    minHeight: 26,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: t.fillSecondary,
      ":hover": { "@media (hover: hover)": t.fillSecondaryHover },
    },
    color: t.textPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    fontWeight: 400,
    lineHeight: t.leadingSm,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  close: {
    position: "absolute",
    insetBlockStart: 8,
    insetInlineEnd: 8,
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": t.fillGhostHover },
    },
    color: t.iconSecondary,
    cursor: "pointer",
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

export function Toaster(): ReactElement {
  const { theme } = useAppearanceSettings();
  return (
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
        success: <Icon name="checkmark" size={15} />,
        error: <Icon name="warning" size={15} />,
        warning: <Icon name="warning" size={15} />,
        close: <Icon name="x" size={12} />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: "Dismiss notification",
        style: {
          boxShadow: t.shadowPopover,
          transitionProperty: "transform, opacity",
          transitionDuration: "var(--_toast-duration)",
          transitionTimingFunction: t.easeOut,
        },
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
  );
}
