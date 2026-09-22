import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode, Ref } from "react";
import { Icon } from "../../components/icons.tsx";
import type { IconName } from "../../components/icons.tsx";
import { focus } from "../../components/ui.tsx";
import { glyph, tray } from "../../theme/schema.stylex.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { t } from "../../theme/vars.stylex.ts";

/** Parts every composer tray draws: its pill, rows, header actions, and notices. */
export const trayParts = create({
  root: { position: "relative", minWidth: 0 },
  presence: { display: "contents" },
  pills: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: 28,
    paddingBlock: 0,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: t.strokeTertiary,
      ":hover": t.strokeSecondary,
      ":focus-visible": t.strokeSecondary,
    },
    borderRadius: t.radiusFull,
    backgroundColor: { default: t.bgElevated, ":hover": t.fillGhostHover },
    color: { default: t.textSecondary, ":hover": t.textPrimary },
    fontSize: t.fontBase,
    lineHeight: "16px",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "color, background-color, border-color, opacity, transform",
    transitionDuration: "150ms",
    transitionTimingFunction: t.easeOut,
  },
  pillIndicator: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: glyph.box,
    height: glyph.box,
    lineHeight: 0,
  },
  listHeight: (height: number) => ({ maxHeight: Math.min(260, height) }),
  row: {
    "--nyte-row-height": tray.rowHeight,
    "--nyte-row-gap": "6px",
    "--nyte-row-padding-inline": tray.rowInset,
    "--nyte-row-leading-size": glyph.box,
    "--_row-fill": {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${t.fillGhostHover} 50%, transparent)`,
      ":focus-within": `color-mix(in srgb, ${t.fillGhostHover} 50%, transparent)`,
    },
    borderRadius: t.radiusBase,
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: tray.lineHeight,
  },
  action: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    flexShrink: 0,
    minHeight: tray.rowHeight,
    paddingBlock: 0,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": t.fillGhostHover,
      ":focus-visible": t.fillGhostHover,
      ":active:not(:disabled)": t.fillGhostSelected,
    },
    color: {
      default: t.textSecondary,
      ":hover:not(:disabled)": t.textPrimary,
      ":focus-visible": t.textPrimary,
    },
    fontSize: t.fontSm,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.5 },
  },
  iconAction: {
    position: "relative",
    width: 28,
    height: 28,
    paddingInline: 0,
    lineHeight: 0,
    color: {
      default: t.iconSecondary,
      ":hover": t.iconPrimary,
      ":focus-visible": t.iconPrimary,
    },
    // Header spacing reserves a non-overlapping 40px target around the 28px control.
    "::before": { content: '""', position: "absolute", inset: -6 },
  },
  notice: { paddingBlock: 8, paddingInline: 12, color: t.textSecondary, fontSize: t.fontSm },
  error: { color: t.textDanger },
});

/**
 * Anchors a tray above the composer and measures how tall it may grow before
 * it would cover the transcript's first line.
 */
export function useTrayRoot(viewport: HTMLElement | null) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [availableHeight, setAvailableHeight] = useState(260);

  useLayoutEffect(() => {
    if (root === null || viewport === null) return undefined;

    const measure = (): void => {
      setAvailableHeight(
        Math.max(
          0,
          root.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top - 44,
        ),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [root, viewport]);

  return { root, ref: setRoot, availableHeight };
}

export function TrayPill({
  label,
  controls,
  ref,
  onClick,
  children,
}: {
  readonly label: string;
  readonly controls?: string;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div {...props(trayParts.pills)}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-controls={controls}
        aria-expanded={false}
        {...props(trayParts.pill, focus.ring)}
        onClick={onClick}
      >
        {children}
      </button>
    </div>
  );
}

export function TrayIconAction({
  icon,
  label,
  size = 16,
  onClick,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly size?: number;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props(trayParts.action, trayParts.iconAction, focus.ringInset)}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

function TrayContent({
  focusKey,
  children,
}: {
  readonly focusKey: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const isPresent = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (focusKey === undefined) return;
    ref.current?.closest("section")?.focus({ preventScroll: true });
  }, [focusKey]);

  return (
    <div ref={ref} inert={!isPresent} {...props(trayParts.presence)}>
      {children}
    </div>
  );
}

/**
 * The surface every composer tray opens into. Escape closes it, and a tray
 * given a `focusKey` takes focus whenever that key changes; one without keeps
 * focus where the user left it.
 */
export function Tray({
  open,
  id,
  label,
  focusKey,
  onClose,
  xstyle,
  children,
}: {
  readonly open: boolean;
  readonly id?: string;
  readonly label: string;
  readonly focusKey?: string;
  readonly onClose?: () => void;
  readonly xstyle?: StyleXStyles;
  readonly children: ReactNode;
}): ReactElement {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.section
          key="surface"
          id={id}
          tabIndex={-1}
          aria-label={label}
          initial={reducedMotion ? false : { opacity: 0, y: 4, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            reducedMotion
              ? { opacity: 1, pointerEvents: "none" }
              : { opacity: 0, y: 4, scale: 0.99, pointerEvents: "none" }
          }
          transition={reducedMotion ? { duration: 0 } : { duration: 0.15, ease: "easeOut" }}
          {...props(trayStyles.surface, xstyle)}
          onKeyDown={(event) => {
            if (onClose === undefined || event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
        >
          <TrayContent focusKey={focusKey}>{children}</TrayContent>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
