import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode, Ref } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { useOverlayRef } from "@nyte-ai/ui/overlay";
import { glyph } from "@nyte-ai/ui/schema.stylex";
import { tray } from "../../theme/schema.stylex.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";

/** Parts every composer tray draws: its pill, rows, header actions, and notices. */
export const trayParts = create({
  root: { position: "relative", minWidth: 0 },
  presence: { display: "contents" },
  pills: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 },
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
    minHeight: tray.rowHeight,
    "--_row-padding-inline": tray.rowInset,
  },
  notice: {
    paddingBlock: 8,
    paddingInline: 12,
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  error: { color: role.contentSecondary },
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
      <Button
        ref={ref}
        variant="outline"
        round
        aria-description={label}
        aria-controls={controls}
        aria-expanded={false}
        onClick={onClick}
      >
        {children}
      </Button>
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
    <Button iconOnly aria-label={label} onClick={onClick}>
      <Icon name={icon} size={size} />
    </Button>
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
  const overlayRef = useOverlayRef();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.section
          ref={overlayRef}
          key="surface"
          id={id}
          tabIndex={-1}
          aria-description={label}
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
