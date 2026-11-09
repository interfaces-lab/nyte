import { Toast } from "@base-ui/react/toast";
import type { ToastManager, ToastManagerAddOptions, ToastObject } from "@base-ui/react/toast";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";

import { hairline } from "./styles/hairline.stylex.ts";
import {
  control,
  glyph,
  layer,
  radius,
  space,
  toast as toastSize,
} from "./styles/schema.stylex.ts";
import { intent } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { appearance, motion, role, shadow, type } from "./styles/vars.stylex.ts";
import { Button, buttonStyle } from "./button.tsx";
import { Icon } from "./icon.tsx";
import { Spinner } from "./spinner.tsx";

const COPIED_MS = 1500;

export interface ToastData {
  readonly at?: number;
  readonly count?: number;
}

export type ToastOptions = ToastManagerAddOptions<ToastData>;

export type ToastItem = ToastObject<ToastData>;

export type HeldToast = Pick<
  ToastItem,
  "id" | "type" | "title" | "description" | "actionProps" | "data"
>;

const AT_ANCHOR = "translate(12px, -16px) scale(0.92)";

const COLLAPSED =
  "translateX(var(--toast-swipe-movement-x)) translateY(calc(var(--toast-swipe-movement-y) + var(--toast-index) * var(--_peek))) scale(var(--_scale))";

const EXPANDED =
  "translateX(var(--toast-swipe-movement-x)) translateY(calc(var(--toast-swipe-movement-y) + var(--toast-offset-y) + var(--toast-index) * var(--_gap)))";

const styles = create({
  viewport: {
    position: "fixed",
    zIndex: layer.toast,
    insetBlockStart: `calc(anchor(bottom, ${space.s3}) + ${space.s1})`,
    insetInlineEnd: `anchor(end, ${space.s4})`,
    width: `min(${toastSize.width}, calc(100vw - 2 * ${space.s4}))`,
    marginBlock: 0,
    marginInline: 0,
    padding: 0,
    pointerEvents: "none",
    outline: "none",
    fontFamily: type.fontSans,
  },
  anchored: (anchor: string) => ({ positionAnchor: anchor }),
  hidden: { display: "none" },
  root: {
    "--nyte-hairline-elevation": shadow.shadowLg,
    "--_gap": space.s2,
    "--_peek": space.s2,
    "--_scale": "max(0, 1 - var(--toast-index) * 0.05)",
    position: "absolute",
    insetBlockStart: 0,
    insetInlineEnd: 0,
    zIndex: "calc(100 - var(--toast-index))",
    boxSizing: "border-box",
    width: "max-content",
    minWidth: toastSize.minWidth,
    maxWidth: {
      default: `calc(100% - min(1, var(--toast-index)) * (100% - ${toastSize.minWidth}))`,
      "[data-expanded]": "100%",
    },
    height: {
      default: "var(--toast-frontmost-height, var(--toast-height))",
      "[data-expanded]": "var(--toast-height)",
    },
    overflow: "clip",
    pointerEvents: "auto",
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    color: role.contentPrimary,
    userSelect: "none",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: 0,
    transformOrigin: "top center",
    transform: {
      default: COLLAPSED,
      "[data-expanded]": EXPANDED,
      "[data-starting-style]": AT_ANCHOR,
      "[data-ending-style]": {
        default: AT_ANCHOR,
        "[data-swipe-direction='right']": "translateX(calc(var(--toast-swipe-movement-x) + 110%))",
        "[data-swipe-direction='up']": "translateY(calc(var(--toast-swipe-movement-y) - 110%))",
      },
    },
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
      "[data-limited]": 0,
    },
    transitionProperty: "transform, opacity, height",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOutQuint,
  },
  bridge: {
    "::before": {
      content: '""',
      position: "absolute",
      insetBlockStart: "100%",
      insetInline: 0,
      height: `calc(${space.s2} + 1px)`,
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
    opacity: { default: 1, "[data-behind]:not([data-expanded])": 0 },
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  glyph: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: glyph.md,
    color: role.contentAccent,
  },
  plainGlyph: { color: role.contentSecondary },
  words: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  headline: { display: "flex", alignItems: "baseline", gap: space.s1_5 },
  title: {
    margin: 0,
    fontWeight: type.weightMedium,
    fontVariantNumeric: "tabular-nums",
    textWrap: "pretty",
    overflowWrap: "anywhere",
  },
  count: { flexShrink: 0, color: role.contentTertiary, fontVariantNumeric: "tabular-nums" },
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
  copyHidden: { visibility: "hidden" },
  close: { flexShrink: 0 },
});

const STATUS_ICON = new Map(
  Object.entries({
    success: { intent: intent.success, name: "checkmark" },
    error: { intent: intent.danger, name: "warning" },
    warning: { intent: intent.warning, name: "warning" },
  } as const),
);

export function ToastGlyph({ type: kind }: { readonly type: string | undefined }): ReactElement {
  if (kind === "loading")
    return (
      <span {...props(styles.glyph)}>
        <Spinner />
      </span>
    );
  const status = kind === undefined ? undefined : STATUS_ICON.get(kind);

  if (status === undefined)
    return (
      <span {...props(styles.glyph, styles.plainGlyph)}>
        <Icon name="circle-info" size="md" />
      </span>
    );

  return (
    <span {...props(status.intent, styles.glyph)}>
      <Icon name={status.name} size="md" />
    </span>
  );
}

function copyText(title: ReactNode, description: ReactNode): string | undefined {
  if (typeof title !== "string") return undefined;

  return typeof description === "string" ? `${title}\n${description}` : title;
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
      <span {...props(styles.copyLabel, copied && styles.copyHidden)}>Copy error</span>
      <span {...props(styles.copyLabel, !copied && styles.copyHidden)}>
        <Icon name="checkmark" size="xs" />
        Copied
      </span>
    </button>
  );
}

function ToastCards(): ReactElement[] {
  return useToasts().map((item) => {
    const copy = item.type === "error" ? copyText(item.title, item.description) : undefined;
    const count = item.data?.count ?? 1;

    return (
      <Toast.Root
        key={item.id}
        toast={item}
        swipeDirection={["up", "right"]}
        data-slot="toast"
        {...props(styles.root, styles.bridge, hairline.ringAfter)}
      >
        <Toast.Content {...props(styles.content)}>
          <ToastGlyph type={item.type} />
          <div {...props(styles.words)}>
            <span {...props(styles.headline)}>
              <Toast.Title {...props(text.base, styles.title)} />
              {count > 1 && <span {...props(text.xs, styles.count)}>×{count}</span>}
            </span>
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

const manager = Toast.createToastManager<ToastData>();

let held: readonly HeldToast[] = [];

const heldListeners = new Set<() => void>();

let closingOnPurpose = false;

function setHeld(next: readonly HeldToast[]): void {
  held = next;

  for (const listener of heldListeners) listener();
}

function release(id: string): void {
  if (held.some((item) => item.id === id)) setHeld(held.filter((item) => item.id !== id));
}

export function toastHolds(item: Pick<ToastItem, "type">): boolean {
  return item.type === "warning" || item.type === "error";
}

function add(options: ToastOptions): string {
  const at = Date.now();

  if (options.id !== undefined) return open(options.id, options, at, 1);

  const id = `said:${[options.type, options.title, options.description].map(String).join("\n")}`;

  if (repeatLive(id, options, at)) return id;

  return open(id, options, at, (held.find((item) => item.id === id)?.data?.count ?? 0) + 1);
}

function repeatLive(id: string, options: ToastOptions, at: number): boolean {
  let live = false;

  manager.update(id, (previous) => {
    live = true;

    return stamped(
      id,
      { ...options, timeout: options.timeout },
      at,
      (previous.data?.count ?? 1) + 1,
    );
  });

  return live;
}

function open(id: string, options: ToastOptions, at: number, count: number): string {
  release(id);

  return manager.add({ ...stamped(id, options, at, count), id });
}

function stamped(id: string, options: ToastOptions, at: number, count: number): ToastOptions {
  const data = { ...options.data, at, count };

  return {
    ...options,
    data,
    onClose: () => {
      options.onClose?.();

      if (closingOnPurpose || !toastHolds(options)) return;

      const face = {
        id,
        type: options.type,
        title: options.title,
        description: options.description,
        actionProps: options.actionProps,
        data,
      };

      setHeld([face, ...held.filter((item) => item.id !== id)]);
    },
  };
}

function close(id?: string): void {
  closingOnPurpose = true;
  manager.close(id);
  closingOnPurpose = false;

  if (id === undefined) setHeld([]);
  else release(id);
}

function hold(id: string): void {
  manager.close(id);
}

export const toast: ToastManager<ToastData> & { readonly hold: (id: string) => void } = {
  ...manager,
  add,
  close,
  hold,
};

function subscribeHeld(listener: () => void): () => void {
  heldListeners.add(listener);

  return () => heldListeners.delete(listener);
}

export function useHeldToasts(): readonly HeldToast[] {
  return useSyncExternalStore(subscribeHeld, () => held);
}

export function ToastProvider({
  children,
  limit = 3,
}: {
  readonly children: ReactNode;
  readonly limit?: number;
}): ReactElement {
  return (
    <Toast.Provider toastManager={toast} limit={limit}>
      {children}
    </Toast.Provider>
  );
}

export function useToasts(): readonly ToastItem[] {
  return Toast.useToastManager<ToastData>().toasts;
}

export function ToastStack({
  anchor,
  hidden = false,
}: {
  readonly anchor?: string;
  readonly hidden?: boolean;
}): ReactElement {
  return (
    <Toast.Portal>
      <Toast.Viewport
        data-slot="toast-viewport"
        {...props(
          styles.viewport,
          anchor !== undefined && styles.anchored(anchor),
          hidden && styles.hidden,
        )}
      >
        <ToastCards />
      </Toast.Viewport>
    </Toast.Portal>
  );
}
