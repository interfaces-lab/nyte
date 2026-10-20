import { Toast } from "@base-ui/react/toast";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { focus } from "./styles/a11y.stylex.ts";
import {
  button,
  glyph,
  layer,
  media,
  radius,
  space,
  target,
  toast as toastSchema,
} from "./styles/schema.stylex.ts";
import { intent } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { appearance, motion, role, shadow, type } from "./styles/vars.stylex.ts";
import { Icon } from "./icon.tsx";

const GAP = 8;

const PEEK = 12;

const EXIT = "translateY(150%)";

const COPIED_MS = 1500;

const styles = create({
  viewport: {
    position: "fixed",
    insetInlineEnd: space.s4,
    insetBlockEnd: space.s4,
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
        default: "translateY(8px)",
        "[data-swipe-direction='left']":
          "translateX(calc(var(--toast-swipe-movement-x) - 150%)) translateY(var(--_offset-y))",
        "[data-swipe-direction='right']":
          "translateX(calc(var(--toast-swipe-movement-x) + 150%)) translateY(var(--_offset-y))",
        "[data-swipe-direction='down']": "translateY(calc(var(--toast-swipe-movement-y) + 150%))",
      },
    },
    opacity: {
      default: 1,
      "[data-limited]": 0,
      "[data-ending-style]": { default: 0, "[data-swipe-direction]": 1 },
    },
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
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
    gridTemplateAreas: `"icon title inline close" ". description description description" ". actions actions actions"`,
    alignItems: "start",
    boxSizing: "border-box",
    height: "100%",
    minHeight: toastSchema.minHeight,
    paddingBlock: toastSchema.paddingBlock,
    paddingInlineStart: space.s4,
    paddingInlineEnd: toastSchema.inset,
    overflow: "clip",
    opacity: { default: 1, "[data-behind]": 0, "[data-expanded]": 1 },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  withActionsBelow: { paddingBlockEnd: toastSchema.inset },
  title: {
    gridArea: "title",
    margin: 0,
    fontWeight: type.weightMedium,
    fontVariantNumeric: "tabular-nums",
    textWrap: "pretty",
    overflowWrap: "anywhere",
  },
  description: {
    gridArea: "description",
    margin: 0,
    marginBlockStart: space.s0_5,
    color: role.contentSecondary,
    textWrap: "pretty",
    overflowWrap: "anywhere",
  },
  icon: {
    gridArea: "icon",
    display: "grid",
    placeItems: "center",
    width: glyph.md,
    height: type.leadingBase,
    marginInlineEnd: space.s2,
    color: role.contentSecondary,
  },
  inline: {
    gridArea: "inline",
    marginBlock: toastSchema.overhang,
    marginInlineStart: space.s3,
  },
  actions: {
    gridArea: "actions",
    display: "flex",
    flexWrap: "wrap",
    gap: space.s1_5,
    marginBlockStart: space.s2_5,
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
      ":hover": { [media.hover]: role.layerHover },
    },
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontWeight: type.weightRegular,
    whiteSpace: "nowrap",
    cursor: appearance.cursorInteractive,
    scale: { default: 1, ":active": 0.96 },
    transitionProperty: "background-color, scale",
    transitionDuration: {
      default: motion.durationFast,
      ":active": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  copy: {
    display: "inline-grid",
    backgroundColor: "transparent",
    color: {
      default: role.contentSecondary,
      ":hover": { [media.hover]: role.contentPrimary },
    },
  },
  copyLabel: {
    gridArea: "1 / 1",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
  },
  copied: { color: role.contentPrimary },
  hidden: { visibility: "hidden" },
  close: {
    gridArea: "close",
    marginBlock: toastSchema.overhang,
    marginInlineStart: space.s1_5,
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
      ":hover": { [media.hover]: role.bgHover },
    },
    color: {
      default: role.contentInteractiveSecondary,
      ":hover": { [media.hover]: role.contentInteractivePrimary },
    },
    cursor: appearance.cursorInteractive,
    scale: { default: 1, ":active": 0.96 },
    transitionProperty: "background-color, color, scale",
    transitionDuration: {
      default: motion.durationFast,
      ":active": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

const STATUS_ICON = new Map(
  Object.entries({
    success: { intent: intent.success, name: "checkmark" },
    error: { intent: intent.danger, name: "warning" },
    warning: { intent: intent.warning, name: "warning" },
  } as const),
);

function copyText(title: ReactNode, description: ReactNode): string | undefined {
  if (typeof title !== "string") return undefined;

  return typeof description === "string" ? `${title}\n${description}` : title;
}

function CopyButton({
  value,
  inline,
}: {
  readonly value: string;
  readonly inline: boolean;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    clearTimeout(reset.current);
    setCopied(true);
    reset.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      {...props(text.sm, styles.action, styles.copy, inline && styles.inline, focus.ring)}
    >
      <span {...props(styles.copyLabel, copied && styles.hidden)}>Copy error</span>
      <span {...props(styles.copyLabel, styles.copied, !copied && styles.hidden)}>
        <Icon name="checkmark" size={12} />
        Copied
      </span>
    </button>
  );
}

function ToastList(): ReactElement[] {
  const { toasts } = Toast.useToastManager();

  return toasts.map((item) => {
    const copy = item.type === "error" ? copyText(item.title, item.description) : undefined;
    const status = item.type === undefined ? undefined : STATUS_ICON.get(item.type);
    const buttonCount = Number(item.actionProps !== undefined) + Number(copy !== undefined);
    const below = buttonCount > 1 || (buttonCount === 1 && item.description !== undefined);

    const buttons = (
      <>
        <Toast.Action {...props(text.sm, styles.action, !below && styles.inline, focus.ring)} />
        {copy !== undefined && <CopyButton value={copy} inline={!below} />}
      </>
    );

    return (
      <Toast.Root key={item.id} toast={item} data-slot="toast" {...props(styles.root)}>
        <Toast.Content {...props(text.base, styles.content, below && styles.withActionsBelow)}>
          {status !== undefined && (
            <span {...props(status.intent, styles.icon)}>
              <Icon name={status.name} size={16} />
            </span>
          )}
          <Toast.Title {...props(text.base, styles.title)} />
          {!below && buttons}
          <Toast.Close aria-label="Dismiss notification" {...props(styles.close, focus.ring)}>
            <Icon name="x" size={12} />
          </Toast.Close>
          <Toast.Description {...props(text.sm, styles.description)} />
          {below && <div {...props(styles.actions)}>{buttons}</div>}
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
