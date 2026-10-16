/**
 * The rail's two layers, workspaces and Settings, and the list motion they
 * share.
 */
import { props } from "@stylexjs/stylex";
import { useMatch } from "@tanstack/react-router";
import { LayoutGroup, motion, MotionConfig } from "motion/react";
import type { Transition } from "motion/react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { SettingsNavigation, type SettingsSection } from "../settings/index.ts";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";

const INSTANT: Transition = { duration: 0 };

/** How far a rail layer travels while it fades; the two layers pass each other by this much. */
const LAYER_SHIFT = 12;

/** Repeats collapse into one settle, the way they collapse into one notification. */
const ARCHIVE_BURST_MS = 100;

let archiveSettle: "single" | "burst" | undefined;

let lastArchiveAt = -ARCHIVE_BURST_MS;

/** Call before the archive itself, so the render it causes settles the list to match. */
export function recordArchive(count: number): void {
  const at = performance.now();
  archiveSettle = count === 1 && at - lastArchiveAt > ARCHIVE_BURST_MS ? "single" : "burst";
  lastArchiveAt = at;
}

function sidebarLayoutTransition(node: HTMLElement, durationVariable: string): Transition {
  const css = getComputedStyle(node);
  const durationToken = css.getPropertyValue(durationVariable).trim();
  const duration = Number.parseFloat(durationToken) / (durationToken.endsWith("ms") ? 1000 : 1);
  const curve = css.getPropertyValue("--_sidebar-motion-easing").trim();

  const [x1, y1, x2, y2] =
    curve
      .match(/^cubic-bezier\(([^)]+)\)$/)?.[1]
      ?.split(",")
      .map(Number) ?? [];

  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return INSTANT;

  return { type: "tween", duration, ease: [x1, y1, x2, y2] };
}

/**
 * The rail's two layers. The workspace column stays mounted under Settings so
 * scroll position and row state survive the round trip; the settings column
 * stays mounted so opening it has nothing to build. The layer that is not
 * showing is inert and transparent, which Chromium neither paints nor hit-tests.
 *
 * Opening settings sends the workspace column a step left as the settings
 * column arrives from the right; going back plays the same in reverse. Only
 * opacity and transform move, so the swap composites without touching layout
 * or repainting the list.
 *
 * The settings column keeps its last section through the fade out, so the
 * selection does not jump to General as it leaves. Reduced motion is read
 * live, since Motion's useReducedMotion snapshots it at mount. Archiving is a
 * dismissal, not a rearrangement: one chat leaving gets a short slide, a burst
 * of them snaps rather than reading as churn; rows read the transition as they
 * render, so the settle is spent by the time this commits. The row that opened
 * a layer is inert once it has, so its counterpart on the new layer takes the
 * focus and the keyboard does not fall to the body.
 */
export function SidebarContent({ children }: { readonly children: ReactNode }): ReactElement {
  const settings = useMatch({ from: "/settings/$section", shouldThrow: false });
  const settingsOpen = settings !== undefined;
  const contentRef = useRef<HTMLElement>(null);
  const layoutId = useId();
  const [transitions, setTransitions] = useState({ list: INSTANT, archive: INSTANT });
  const [section, setSection] = useState<SettingsSection>("general");

  if (settings !== undefined && settings.params.section !== section)
    setSection(settings.params.section);

  useLayoutEffect(() => {
    const node = contentRef.current;

    if (node === null) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = (): void =>
      setTransitions(
        reducedMotion.matches
          ? { list: INSTANT, archive: INSTANT }
          : {
              list: sidebarLayoutTransition(node, "--_sidebar-motion-duration"),
              archive: sidebarLayoutTransition(node, "--_sidebar-archive-duration"),
            },
      );

    update();
    reducedMotion.addEventListener("change", update);

    return () => reducedMotion.removeEventListener("change", update);
  }, []);

  const settle = archiveSettle;
  useLayoutEffect(() => {
    archiveSettle = undefined;
  });

  const transition =
    settle === undefined ? transitions.list : settle === "single" ? transitions.archive : INSTANT;

  const shift = transitions.list === INSTANT ? 0 : LAYER_SHIFT;

  useLayoutEffect(() => {
    const node = contentRef.current;

    if (node === null || !node.contains(document.activeElement)) return;
    node
      .querySelector<HTMLElement>("[data-sidebar-layer]:not([inert]) [data-sidebar-return]")
      ?.focus({ preventScroll: true });
  }, [settingsOpen]);

  return (
    <nav
      ref={contentRef}
      aria-label={settingsOpen ? "Settings" : "Sessions and workspaces"}
      {...props(styles.content)}
    >
      <motion.div
        data-sidebar-layer="workspace"
        inert={settingsOpen}
        initial={false}
        animate={{ opacity: settingsOpen ? 0 : 1, x: settingsOpen ? -shift : 0 }}
        transition={transitions.list}
        {...props(styles.contentLayer)}
      >
        <MotionConfig reducedMotion="never" transition={{ layout: transition }}>
          <LayoutGroup id={layoutId} inherit={false}>
            {children}
          </LayoutGroup>
        </MotionConfig>
      </motion.div>
      <motion.div
        data-sidebar-layer="settings"
        inert={!settingsOpen}
        initial={false}
        animate={{ opacity: settingsOpen ? 1 : 0, x: settingsOpen ? 0 : shift }}
        transition={transitions.list}
        {...props(styles.contentLayer)}
      >
        <SettingsNavigation section={section} />
      </motion.div>
    </nav>
  );
}
