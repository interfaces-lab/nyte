import { create, props } from "@stylexjs/stylex";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { sidebar } from "../theme/schema.stylex.ts";
import { floatingSurfaceStyles } from "@nyte-ai/ui/styles/floating-surface.stylex";
import { layer, media } from "@nyte-ai/ui/styles/schema.stylex";
import { motion as motionTokens, role } from "@nyte-ai/ui/styles/vars.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { preferences, SIDEBAR_WIDTH, useSetting } from "../preferences/index.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { occludes } from "../workbench/browser-occlusion.ts";
import { applySidebarWidth, clampSidebarWidth, shellActions } from "./shell-state.ts";
import { useSidebar } from "./use-sidebar.ts";

const FLOAT_OMEGA = (2 * Math.PI) / 0.18;

const FLOAT_SPRING = {
  type: "spring",
  stiffness: FLOAT_OMEGA ** 2,
  damping: 2 * 0.8 * FLOAT_OMEGA,
} as const;

const REVEAL_EDGE = 8;

const HOLD_SLACK = 24;

const HIDE_DELAY = 0.12;

const styles = create({
  seat: {
    position: "relative",
    width: sidebar.width,
    minWidth: 0,
    minHeight: 0,
    flexShrink: 0,
    overflow: "clip",
    transitionProperty: "width",
    transitionDuration: sidebar.slideDuration,
    transitionTimingFunction: sidebar.slideEasing,
  },
  seatHidden: {
    width: 0,
    pointerEvents: "none",
  },
  seatFloating: { overflow: "visible" },
  still: { transitionDuration: "0s" },
  rail: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: 0,
    display: "flex",
    width: sidebar.width,
    minHeight: 0,
    visibility: "visible",
    transitionProperty: "visibility",
    transitionDuration: sidebar.slideDuration,
    transitionTimingFunction: sidebar.slideEasing,
  },
  railAway: { visibility: "hidden" },
  railFloating: {
    position: "absolute",
    zIndex: layer.chrome,
    insetBlock: sidebar.floatInset,
    insetInlineStart: sidebar.floatInset,
    insetInlineEnd: "auto",
    borderRadius: sidebar.floatRadius,
    overflow: "clip",
    pointerEvents: "auto",
    transform: {
      default: "translateX(calc(var(--_float, 1) * (-100% - 12px)))",
      "@media (prefers-reduced-motion: reduce)": "none",
    },
  },
  handle: {
    position: "fixed",
    zIndex: layer.sash,
    insetBlock: 0,
    insetInlineStart: `calc(${sidebar.width} - ${sidebar.handleWidth})`,
    width: sidebar.handleWidth,
    cursor: "col-resize",
    touchAction: "none",

    outlineStyle: "none",
    WebkitAppRegion: "no-drag",
    "::after": {
      content: '""',
      position: "absolute",
      insetBlock: 0,
      insetInlineEnd: 0,
      width: 1,
      backgroundColor: "transparent",
      transitionProperty: "background-color",
      transitionDuration: motionTokens.durationFast,
      transitionTimingFunction: motionTokens.easeOut,
    },
    ":hover::after": {
      backgroundColor: {
        [media.hover]: role.borderPrimaryTranslucent,
      },
    },
    ":focus-visible::after": { backgroundColor: role.borderStrongTranslucent },
  },
  handleEdge: { "::after": { backgroundColor: role.borderSecondaryTranslucent } },
  handleActive: { "::after": { backgroundColor: role.borderStrongTranslucent } },
});

interface ResizeState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  nextWidth: number;
}

export function SidebarPane({ children }: { readonly children: ReactNode }): ReactElement {
  const docked = useSidebar().state === "expanded";
  const sidebarWidth = useSetting(preferences.sidebarWidth);
  const rail = useRef<HTMLDivElement | null>(null);
  const [float, setFloat] = useState<"in" | "out">();
  const [docksInPlace, setDocksInPlace] = useState(false);

  if (docked && float !== undefined) {
    setFloat(undefined);
    setDocksInPlace(true);
  }

  if (!docked && docksInPlace) setDocksInPlace(false);

  const presentation = docked ? "expanded" : float === undefined ? "collapsed" : "floating";
  const floating = presentation === "floating";
  const away = presentation === "collapsed";

  useMountEffect(() => {
    const root = document.documentElement;

    const follow = (event: globalThis.PointerEvent): void => {
      const element = rail.current;

      if (element === null || element.dataset.state === "expanded") return;

      const panel =
        element.dataset.state === "floating" && event.type === "pointermove"
          ? element.getBoundingClientRect()
          : undefined;

      const near =
        event.clientX < REVEAL_EDGE ||
        (panel !== undefined &&
          (event.clientX < panel.right + HOLD_SLACK ||
            (event.target instanceof Element &&
              event.target.closest("[data-base-ui-portal]") !== null)));

      setFloat((current) => (near ? "in" : current === undefined ? undefined : "out"));
    };

    window.addEventListener("pointermove", follow);
    root.addEventListener("pointerleave", follow);
    const release = occludes(rail.current);

    return () => {
      window.removeEventListener("pointermove", follow);
      root.removeEventListener("pointerleave", follow);
      release?.();
    };
  });

  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<ResizeState | undefined>(undefined);

  const beginResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidth,
      nextWidth: sidebarWidth,
    };
    setResizing(true);
  };

  const moveResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;

    if (resize === undefined || resize.pointerId !== event.pointerId) return;
    resize.nextWidth = clampSidebarWidth(resize.startWidth + event.clientX - resize.startX);
    applySidebarWidth(resize.nextWidth);
  };

  const endResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;

    if (resize === undefined || resize.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resizeRef.current = undefined;
    shellActions.setSidebarWidth(resize.nextWidth);
    setResizing(false);
  };

  const cancelResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;

    if (resize === undefined || resize.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    applySidebarWidth(resize.startWidth);
    setResizing(false);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    let width: number | undefined;
    const step = event.shiftKey ? SIDEBAR_WIDTH.step * 4 : SIDEBAR_WIDTH.step;

    if (event.key === "ArrowLeft") width = sidebarWidth - step;
    else if (event.key === "ArrowRight") width = sidebarWidth + step;
    else if (event.key === "Home") width = SIDEBAR_WIDTH.min;
    else if (event.key === "End") width = SIDEBAR_WIDTH.max;

    if (width === undefined) return;
    event.preventDefault();
    shellActions.setSidebarWidth(width);
  };

  return (
    <div
      {...props(
        styles.seat,
        !docked && styles.seatHidden,
        floating && styles.seatFloating,
        (resizing || docksInPlace) && styles.still,
      )}
    >
      <motion.div
        ref={rail}
        data-state={presentation}
        aria-hidden={away}
        inert={away ? true : undefined}
        {...props(
          styles.rail,
          away && styles.railAway,
          floating && [floatingSurfaceStyles.popup, styles.railFloating],
        )}
        initial={false}
        animate={{ "--_float": float === "in" ? 0 : 1 }}
        transition={{ ...FLOAT_SPRING, delay: float === "out" ? HIDE_DELAY : 0 }}
        onAnimationComplete={() => {
          if (float === "out") setFloat(undefined);
        }}
      >
        {children}
      </motion.div>
      {docked && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_WIDTH.min}
          aria-valuemax={SIDEBAR_WIDTH.max}
          aria-valuenow={sidebarWidth}
          {...props(
            styles.handle,
            !windowTabs.strip && styles.handleEdge,
            resizing && styles.handleActive,
          )}
          onKeyDown={resizeWithKeyboard}
          onPointerDown={beginResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={cancelResize}
        />
      )}
    </div>
  );
}
