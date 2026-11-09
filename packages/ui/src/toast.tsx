import { Toast } from "@base-ui/react/toast";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { hairline } from "./styles/hairline.stylex.ts";
import { control, glyph, layer, radius, space } from "./styles/schema.stylex.ts";
import { intent } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { appearance, motion, role, shadow, type } from "./styles/vars.stylex.ts";
import { Button, buttonStyle } from "./button.tsx";
import { Icon } from "./icon.tsx";
import { Spinner } from "./spinner.tsx";

const COPIED_MS = 1500;

export const TOAST_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type ToastPosition = (typeof TOAST_POSITIONS)[number];

const SWIPED_AWAY = {
  "[data-swipe-direction='left']": "translateX(calc(var(--toast-swipe-movement-x) - 110%))",
  "[data-swipe-direction='right']": "translateX(calc(var(--toast-swipe-movement-x) + 110%))",
  "[data-swipe-direction='down']": "translateY(calc(var(--toast-swipe-movement-y) + 110%))",
  "[data-swipe-direction='up']": "translateY(calc(var(--toast-swipe-movement-y) - 110%))",
} as const;

const SWIPING =
  "translateX(var(--toast-swipe-movement-x)) translateY(var(--toast-swipe-movement-y))";

const styles = create({
  viewport: {
    position: "fixed",
    zIndex: layer.toast,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column-reverse",
    alignItems: "flex-end",
    width: "min(440px, calc(100vw - 32px))",
    marginBlock: 0,
    marginInline: 0,
    padding: 0,
    pointerEvents: "none",
    outline: "none",
    fontFamily: type.fontSans,
  },
  viewportTop: { insetBlockStart: space.s4, flexDirection: "column" },
  viewportBottom: { insetBlockEnd: space.s4 },
  viewportLeft: { insetInlineStart: space.s4, alignItems: "flex-start" },
  viewportRight: { insetInlineEnd: space.s4 },
  viewportCenter: {
    insetInlineStart: 0,
    insetInlineEnd: 0,
    marginInline: "auto",
    alignItems: "center",
  },
  root: {
    "--nyte-hairline-elevation": shadow.shadowLg,
    position: "relative",
    flexShrink: 0,
    boxSizing: "border-box",
    maxWidth: "100%",
    marginBlockStart: { default: space.s2, "[data-ending-style]": 0, "[data-limited]": 0 },
    height: { default: "auto", "[data-ending-style]": 0, "[data-limited]": 0 },
    interpolateSize: "allow-keywords",
    overflow: { default: "visible", "[data-ending-style]": "clip", "[data-limited]": "clip" },
    pointerEvents: "auto",
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    color: role.contentPrimary,
    userSelect: "none",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: 0,
    transform: {
      default: SWIPING,
      "[data-starting-style]": "translateY(8px)",
      "[data-ending-style]": { default: SWIPING, ...SWIPED_AWAY },
    },
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
      "[data-limited]": 0,
    },
    transitionProperty: "transform, opacity, height, margin-block",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  rootTop: {
    marginBlockStart: 0,
    marginBlockEnd: { default: space.s2, "[data-ending-style]": 0, "[data-limited]": 0 },
    transform: {
      default: SWIPING,
      "[data-starting-style]": "translateY(-8px)",
      "[data-ending-style]": { default: SWIPING, ...SWIPED_AWAY },
    },
  },
  content: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    boxSizing: "border-box",
    minHeight: control.heightMd,
    paddingBlock: space.s1_5,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s1_5,
  },
  glyph: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: glyph.md,
    color: role.contentAccent,
  },
  words: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  title: {
    margin: 0,
    fontWeight: type.weightMedium,
    fontVariantNumeric: "tabular-nums",
    textWrap: "pretty",
    overflowWrap: "anywhere",
  },
  description: {
    margin: 0,
    color: role.contentSecondary,
    textWrap: "pretty",
    overflowWrap: "anywhere",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    flexShrink: 0,
    marginInlineStart: space.s2,
  },
  copy: { display: "inline-grid" },
  copyLabel: {
    gridArea: "1 / 1",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
  },
  hidden: { visibility: "hidden" },
  close: { flexShrink: 0 },
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

function StatusGlyph({ type }: { readonly type: string | undefined }): ReactElement | null {
  if (type === "loading")
    return (
      <span {...props(styles.glyph)}>
        <Spinner />
      </span>
    );
  const status = type === undefined ? undefined : STATUS_ICON.get(type);

  if (status === undefined) return null;

  return (
    <span {...props(status.intent, styles.glyph)}>
      <Icon name={status.name} size="md" />
    </span>
  );
}

function CopyButton({ value }: { readonly value: string }): ReactElement {
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
      {...buttonStyle("text", "sm", { tone: "neutral", xstyle: styles.copy })}
    >
      <span {...props(styles.copyLabel, copied && styles.hidden)}>Copy error</span>
      <span {...props(styles.copyLabel, !copied && styles.hidden)}>
        <Icon name="checkmark" size="xs" />
        Copied
      </span>
    </button>
  );
}

const SWIPE: Readonly<Record<ToastPosition, Toast.Root.Props["swipeDirection"]>> = {
  "top-left": ["up", "left"],
  "top-center": ["up"],
  "top-right": ["up", "right"],
  "bottom-left": ["down", "left"],
  "bottom-center": ["down"],
  "bottom-right": ["down", "right"],
};

function ToastList({ position }: { readonly position: ToastPosition }): ReactElement[] {
  const { toasts } = Toast.useToastManager();
  const top = position.startsWith("top");

  return toasts.map((item) => {
    const copy = item.type === "error" ? copyText(item.title, item.description) : undefined;

    return (
      <Toast.Root
        key={item.id}
        toast={item}
        swipeDirection={SWIPE[position]}
        data-slot="toast"
        {...props(styles.root, top && styles.rootTop, hairline.ringAfter)}
      >
        <Toast.Content {...props(styles.content)}>
          <StatusGlyph type={item.type} />
          <div {...props(styles.words)}>
            <Toast.Title {...props(text.base, styles.title)} />
            <Toast.Description {...props(text.sm, styles.description)} />
          </div>
          {(item.actionProps !== undefined || copy !== undefined) && (
            <div {...props(styles.actions)}>
              {copy !== undefined && <CopyButton value={copy} />}
              <Toast.Action {...buttonStyle("text", "sm", {})} />
            </div>
          )}
          <Toast.Close
            render={
              <Button
                size="sm"
                iconOnly
                icon="close"
                aria-label="Dismiss notification"
                xstyle={styles.close}
              />
            }
          />
        </Toast.Content>
      </Toast.Root>
    );
  });
}

export const toast = Toast.createToastManager();

export function Toaster({
  toastManager = toast,
  position = "bottom-right",
  ...rest
}: Omit<Toast.Provider.Props, "children"> & {
  readonly position?: ToastPosition;
}): ReactElement {
  return (
    <Toast.Provider toastManager={toastManager} {...rest}>
      <Toast.Portal>
        <Toast.Viewport
          data-slot="toast-viewport"
          {...props(
            styles.viewport,
            position.startsWith("top") ? styles.viewportTop : styles.viewportBottom,
            position.endsWith("left") && styles.viewportLeft,
            position.endsWith("right") && styles.viewportRight,
            position.endsWith("center") && styles.viewportCenter,
          )}
        >
          <ToastList position={position} />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

export type { ToastManagerAddOptions as ToastOptions } from "@base-ui/react/toast";
