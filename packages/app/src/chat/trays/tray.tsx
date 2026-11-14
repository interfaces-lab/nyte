import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode, Ref, RefObject } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { groupMark, taskEnded, taskLabel } from "@nyte-ai/plugin/client/presentation";
import type { Task } from "../../chats/index.ts";
import { tray } from "../../theme/schema.stylex.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { TaskGlyph } from "./task-list.tsx";
import { occludes } from "../../components/overlay-occlusion.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";

const TRAY_TRANSITION = { duration: 0.15, ease: [0.16, 1, 0.3, 1] } as const;

export const trayParts = create({
  root: { display: "contents" },
  placed: { order: -1 },
  presence: { display: "contents" },
  pillCount: { fontVariantNumeric: "tabular-nums" },
  pillMark: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: glyph.md,
    height: glyph.md,
    marginInlineStart: `calc(-1 * ${space.s0_5})`,
  },
  pillFrame: {
    position: "relative",
    display: "inline-flex",
    width: "fit-content",
    borderRadius: radius.pill,
  },
  pillOpen: {
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 1px ${role.strokePrimary}`,
      pointerEvents: "none",
    },
  },
  notice: {
    paddingBlock: space.s2,
    paddingInline: tray.paddingInline,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  error: { color: role.contentSecondary },
});

export function useTrayRoot(viewport: HTMLElement | null) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [availableHeight, setAvailableHeight] = useState(260);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the tray against the viewport before paint
  useLayoutEffect(() => {
    const row = root?.parentElement;

    if (row === null || row === undefined || viewport === null) return undefined;

    const measure = (): void => {
      setAvailableHeight(
        Math.max(0, row.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top - 44),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [root, viewport]);

  return { root, ref: setRoot, availableHeight };
}

export function pillCounts(tasks: readonly Task[]): string {
  const going = tasks.filter((task) => !taskEnded(task.state)).length;
  const failed = tasks.filter((task) => task.state === "failed").length;
  const done = tasks.length - going - failed;

  return [
    `${String(going)} active`,
    ...(done === 0 ? [] : [`${String(done)} ${taskLabel("done").toLowerCase()}`]),
    ...(failed === 0 ? [] : [`${String(failed)} ${taskLabel("failed").toLowerCase()}`]),
  ].join(", ");
}

export function TrayPill({
  icon,
  title,
  description,
  tasks,
  expanded,
  controls,
  ref,
  onClick,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly description: string;
  readonly tasks: readonly Task[];
  readonly expanded: boolean;
  readonly controls?: string;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly onClick: () => void;
}): ReactElement {
  const state = groupMark(tasks.map((task) => task.state));

  return (
    <span {...props(trayParts.pillFrame, expanded && trayParts.pillOpen)}>
      <Button
        ref={ref}
        variant="outline"
        pill
        size="sm"
        title={title}
        aria-description={description}
        aria-controls={controls}
        aria-expanded={expanded}
        onClick={onClick}
      >
        <Icon name={icon} size="sm" label={title} />
        <span {...props(trayParts.pillCount)}>{String(tasks.length)}</span>
        {state !== "done" && (
          <span {...props(trayParts.pillMark)}>
            <TaskGlyph state={state} job={tasks.some((task) => task.kind === "job")} />
          </span>
        )}
      </Button>
    </span>
  );
}

export function TrayIconAction({
  icon,
  label,
  loading = false,
  onClick,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly loading?: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <Button iconOnly aria-label={label} loading={loading} onClick={onClick}>
      <Icon name={icon} />
    </Button>
  );
}

function FocusSection({ within }: { readonly within: RefObject<HTMLDivElement | null> }): null {
  const focused = useRef(false);

  useMountEffect(() => {
    if (focused.current) return;
    focused.current = true;
    within.current?.closest("section")?.focus({ preventScroll: true });
  });

  return null;
}

function TrayContent({
  focusKey,
  onStranded,
  children,
}: {
  readonly focusKey: string | undefined;
  readonly onStranded: () => void;
  readonly children: ReactNode;
}): ReactElement {
  const isPresent = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);

  const reappear = useEffectEvent(() => {
    if (!isPresent) onStranded();
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- runs again when a hidden Activity shows the tray; an exit that started or was due while hidden never finishes
  useLayoutEffect(() => reappear(), []);

  return (
    <div ref={ref} inert={!isPresent} {...props(trayParts.presence)}>
      {focusKey !== undefined && <FocusSection key={focusKey} within={ref} />}
      {children}
    </div>
  );
}

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
  const [generation, setGeneration] = useState(0);

  return (
    <AnimatePresence key={generation} initial={false} mode="popLayout" anchorY="bottom">
      {open && (
        <motion.section
          ref={occludes}
          key="surface"
          data-slot="tray"
          id={id}
          tabIndex={-1}
          aria-description={label}
          initial={reducedMotion ? false : { y: 4, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            reducedMotion
              ? { opacity: 1, pointerEvents: "none" }
              : { opacity: 0, y: 4, scale: 0.99, pointerEvents: "none" }
          }
          transition={reducedMotion ? { duration: 0 } : TRAY_TRANSITION}
          {...props(trayStyles.surface, trayParts.placed, xstyle)}
          onKeyDown={(event) => {
            if (onClose === undefined || event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
        >
          <TrayContent focusKey={focusKey} onStranded={() => setGeneration(generation + 1)}>
            {children}
          </TrayContent>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
