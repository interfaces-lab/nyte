import { Toast } from "@base-ui/react/toast";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

import { focus } from "./a11y.stylex.ts";
import { button, glyph, layer, radius, target, toast as toastSchema } from "./schema.stylex.ts";
import { intent } from "./surface-theme.ts";
import { appearance, motion, role, shadow, type } from "./vars.stylex.ts";
import { Icon } from "./icon.tsx";

const GAP = 8;

const PEEK = 12;

const EXIT = "translateY(150%)";

const styles = create({
  viewport: {
    position: "fixed",
    insetInlineEnd: 16,
    insetBlockEnd: 16,
    zIndex: layer.toast,
    boxSizing: "border-box",
    width: "min(380px, calc(100vw - 32px))",
    margin: 0,
    padding: 0,
    pointerEvents: "none",
    outline: "none",
    fontFamily: type.fontSans,
  },
  root: {
    "--_gap": `${GAP}px`,
    "--_height": "var(--toast-frontmost-height, var(--toast-height))",
    "--_scale": "calc(max(0, 1 - (var(--toast-index) * 0.1)))",
    "--_shrink": "calc(1 - var(--_scale))",
    "--_offset-y":
      "calc(var(--toast-offset-y) * -1 + calc(var(--toast-index) * var(--_gap) * -1) + var(--toast-swipe-movement-y))",
    position: "absolute",
    insetInlineEnd: 0,
    insetBlockEnd: 0,
    zIndex: "calc(1000 - var(--toast-index))",
    boxSizing: "border-box",
    width: "100%",
    height: { default: "var(--_height)", "[data-expanded]": "var(--toast-height)" },
    pointerEvents: "auto",
    transformOrigin: "bottom",
    borderStyle: "none",
    borderRadius: radius.surface,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    color: role.contentPrimary,
    userSelect: "none",
    willChange: "transform",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: 0,
    transform: {
      default: `translateX(var(--toast-swipe-movement-x)) translateY(calc(var(--toast-swipe-movement-y) - (var(--toast-index) * ${PEEK}px) - (var(--_shrink) * var(--_height)))) scale(var(--_scale))`,
      "[data-expanded]": "translateX(var(--toast-swipe-movement-x)) translateY(var(--_offset-y))",
      "[data-starting-style]": EXIT,
      "[data-ending-style]": {
        default: EXIT,
        "[data-swipe-direction='left']":
          "translateX(calc(var(--toast-swipe-movement-x) - 150%)) translateY(var(--_offset-y))",
        "[data-swipe-direction='right']":
          "translateX(calc(var(--toast-swipe-movement-x) + 150%)) translateY(var(--_offset-y))",
        "[data-swipe-direction='down']": "translateY(calc(var(--toast-swipe-movement-y) + 150%))",
      },
    },
    opacity: { default: 1, "[data-limited]": 0 },
    transitionProperty: "transform, opacity, height",
    transitionDuration: {
      default: `${motion.durationNormal}, ${motion.durationNormal}, ${motion.durationFast}`,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
    "::after": {
      content: "''",
      position: "absolute",
      insetBlockStart: "100%",
      insetInlineStart: 0,
      width: "100%",
      height: "calc(var(--_gap) + 1px)",
    },
  },
  content: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxSizing: "border-box",
    height: "100%",
    minHeight: toastSchema.minHeight,
    padding: 12,
    paddingInlineEnd: toastSchema.closeGutter,
    overflow: "hidden",
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    opacity: { default: 1, "[data-behind]": 0, "[data-expanded]": 1 },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  text: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 2 },
  title: {
    margin: 0,
    fontWeight: 500,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontVariantNumeric: "tabular-nums",
    textWrap: "balance",
  },
  description: {
    margin: 0,
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

const STATUS_ICON = {
  success: { intent: intent.success, name: "checkmark" },
  error: { intent: intent.danger, name: "warning" },
  warning: { intent: intent.warning, name: "warning" },
} as const;

function isStatus(type: string | undefined): type is keyof typeof STATUS_ICON {
  return type !== undefined && type in STATUS_ICON;
}

function copyText(title: ReactNode, description: ReactNode): string | undefined {
  if (typeof title !== "string") return undefined;

  return typeof description === "string" ? `${title}\n${description}` : title;
}

function ToastList(): ReactElement[] {
  const { toasts } = Toast.useToastManager();

  return toasts.map((item) => {
    const text = copyText(item.title, item.description);
    const status = isStatus(item.type) ? STATUS_ICON[item.type] : undefined;

    return (
      <Toast.Root key={item.id} toast={item} data-slot="toast" {...props(styles.root)}>
        <Toast.Content {...props(styles.content)}>
          {status !== undefined && (
            <span {...props(status.intent, styles.icon)}>
              <Icon name={status.name} size={16} />
            </span>
          )}
          <div {...props(styles.text)}>
            <Toast.Title {...props(styles.title)} />
            <Toast.Description {...props(styles.description)} />
          </div>
          {text !== undefined && (
            <button
              type="button"
              aria-label="Copy notification"
              onClick={() => void navigator.clipboard.writeText(text)}
              {...props(styles.action, focus.ring)}
            >
              Copy
            </button>
          )}
          <Toast.Action {...props(styles.action, focus.ring)} />
          <Toast.Close aria-label="Dismiss notification" {...props(styles.close, focus.ring)}>
            <Icon name="x" size={12} />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}

export const toast = Toast.createToastManager();

export function Toaster({
  toastManager = toast,
  ...rest
}: Omit<Toast.Provider.Props, "children">): ReactElement {
  return (
    <Toast.Provider toastManager={toastManager} {...rest}>
      <Toast.Portal>
        <Toast.Viewport data-slot="toast-viewport" {...props(styles.viewport)}>
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

export type { ToastManagerAddOptions as ToastOptions } from "@base-ui/react/toast";
