import { props } from "@stylexjs/stylex";
import { useMatch } from "@tanstack/react-router";
import { motion } from "motion/react";
import type { Transition } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { SettingsNavigation, type SettingsSection } from "../settings/index.ts";
import { sidebarStyles as styles } from "./sidebar.stylex.ts";

const INSTANT: Transition = { duration: 0 };

const LAYER_SHIFT = 12;

function sidebarLayerTransition(node: HTMLElement): Transition {
  const css = getComputedStyle(node);
  const durationToken = css.getPropertyValue("--_sidebar-motion-duration").trim();
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

export function SidebarContent({ children }: { readonly children: ReactNode }): ReactElement {
  const openSection = useMatch({
    from: "/settings/$section",
    shouldThrow: false,
    select: (match): SettingsSection => match.params.section,
  });

  const settingsOpen = openSection !== undefined;
  const contentRef = useRef<HTMLElement>(null);
  const [transition, setTransition] = useState(INSTANT);
  const [section, setSection] = useState<SettingsSection>("general");

  if (openSection !== undefined && openSection !== section) setSection(openSection);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- reads the CSS motion tokens before the first frame
  useLayoutEffect(() => {
    const node = contentRef.current;

    if (node === null) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = (): void =>
      setTransition(reducedMotion.matches ? INSTANT : sidebarLayerTransition(node));

    update();
    reducedMotion.addEventListener("change", update);

    return () => reducedMotion.removeEventListener("change", update);
  }, []);

  const shift = transition === INSTANT ? 0 : LAYER_SHIFT;

  return (
    <nav
      ref={contentRef}
      aria-label={settingsOpen ? "Settings" : "Sessions and workspaces"}
      {...props(styles.content)}
    >
      <LayerFocus key={settingsOpen ? "settings" : "workspace"} contentRef={contentRef} />
      <motion.div
        data-sidebar-layer="workspace"
        inert={settingsOpen}
        initial={false}
        animate={{ opacity: settingsOpen ? 0 : 1, x: settingsOpen ? -shift : 0 }}
        transition={transition}
        {...props(styles.contentLayer)}
      >
        {children}
      </motion.div>
      <motion.div
        data-sidebar-layer="settings"
        inert={!settingsOpen}
        initial={false}
        animate={{ opacity: settingsOpen ? 1 : 0, x: settingsOpen ? 0 : shift }}
        transition={transition}
        {...props(styles.contentLayer)}
      >
        <SettingsNavigation section={section} />
      </motion.div>
    </nav>
  );
}

function LayerFocus({ contentRef }: { readonly contentRef: RefObject<HTMLElement | null> }): null {
  useMountEffect(() => {
    const node = contentRef.current;

    if (node === null || !node.contains(document.activeElement)) return;
    node
      .querySelector<HTMLElement>("[data-sidebar-layer]:not([inert]) [data-sidebar-return]")
      ?.focus({ preventScroll: true });
  });

  return null;
}
