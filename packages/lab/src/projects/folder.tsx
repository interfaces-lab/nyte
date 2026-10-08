/**
 * A project drawn as a folder, after define.app's sidebar folders. A back
 * silhouette, a page inside, and a front flap that leans towards you under a
 * short perspective. Hover eases the flap open; selection opens it further and
 * lifts the page. The flat variant is the ordinary icon for comparison.
 */
import { create, props } from "@stylexjs/stylex";
import { motion } from "motion/react";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { glyph } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";

export type FolderStyle = "paper" | "flat";

export type FolderFace = "blank" | "count" | "icon";

export type FolderPages = "one" | "stack";

export interface FolderDesign {
  readonly style: FolderStyle;
  readonly face: FolderFace;
  readonly pages: FolderPages;
}

type FolderState = "closed" | "hover-closed" | "open" | "hover-open";

/** Flap lean in degrees and page lift in px, per state. The flap never closes fully while hovered. */
const FLAP = { closed: 0, "hover-closed": -35, open: -50, "hover-open": -40 } as const;

const LIFT = { closed: 0, "hover-closed": -1.74, open: -2, "hover-open": -1.44 } as const;

const EASE_OUT_CUBIC = [0.215, 0.61, 0.355, 1] as const;

const EASE_IN_OUT_CUBIC = [0.645, 0.045, 0.355, 1] as const;

/** 20x18 silhouette: a rounded sheet with a raised tab across its left half. */
const BACK_PATH =
  "M2 0h5.4c.6 0 1.1.1 1.6.4l1.5.8c.5.2 1 .4 1.5.5l1.3.1H18a2 2 0 0 1 2 2v12.2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z";

export function ProjectFolder({
  design,
  open,
  hovering,
  count,
}: {
  readonly design: FolderDesign;
  readonly open: boolean;
  readonly hovering: boolean;
  /** Agents inside; drives the page stack and the count face. */
  readonly count: number;
}): ReactElement {
  if (design.style === "flat")
    return <Icon name={open ? "folder-open" : "folder"} size={14} label="Project" />;

  const state: FolderState = hovering
    ? open
      ? "hover-open"
      : "hover-closed"
    : open
      ? "open"
      : "closed";

  const pages = design.pages === "stack" ? Math.min(count, 3) : Math.min(count, 1);
  const loud = open;

  return (
    <span {...props(styles.folder)} data-state={state} aria-hidden="true">
      <svg viewBox="0 0 20 18" {...props(styles.back, loud && styles.backLoud)}>
        <path d={BACK_PATH} fill="currentColor" />
      </svg>
      {Array.from({ length: pages }, (_, index) => (
        <motion.span
          key={index}
          {...props(styles.page)}
          initial={false}
          // Each sheet behind the first sits a touch lower so the stack reads as depth.
          animate={{ y: LIFT[state] * (1 - index * 0.35) + index * 1.5, x: "-50%" }}
          transition={{ duration: 0.5, ease: EASE_IN_OUT_CUBIC }}
          style={{ zIndex: 3 - index }}
        />
      ))}
      <motion.span
        {...props(styles.front, loud && styles.frontLoud)}
        initial={false}
        animate={{ rotateX: FLAP[state], x: "-50%" }}
        transition={{ duration: 0.25, ease: EASE_OUT_CUBIC }}
      >
        {design.face === "count" && count > 0 && (
          <span {...props(styles.face, loud && styles.faceLoud)}>{count}</span>
        )}
        {design.face === "icon" && (
          <span {...props(styles.face, loud && styles.faceLoud)}>
            <Icon name="layers" size={9} />
          </span>
        )}
      </motion.span>
    </span>
  );
}

const styles = create({
  // The artwork is 20 by 18; every part is a fraction of that box.
  folder: {
    position: "relative",
    display: "block",
    width: glyph.lg,
    aspectRatio: "10 / 9",
    // A short perspective from the bottom edge is what makes the flap lean rather than shrink.
    perspective: "90px",
    perspectiveOrigin: "bottom",
    transformStyle: "preserve-3d",
  },
  back: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    color: role.bgInteractiveSecondaryPressed,
    transitionProperty: "color",
    transitionDuration: "150ms",
  },
  backLoud: { color: role.bgInteractivePrimaryPressed },
  page: {
    position: "absolute",
    bottom: 0,
    left: "50%",
    width: "90%",
    height: "66%",
    borderRadius: 1.5,
    backgroundColor: role.bgElevated,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  front: {
    position: "absolute",
    bottom: 0,
    left: "50%",
    zIndex: 4,
    display: "grid",
    placeItems: "center",
    width: "100%",
    height: "78%",
    borderRadius: 2,
    transformOrigin: "0 100%",
    backfaceVisibility: "hidden",
    backgroundColor: role.bgControl,
    boxShadow: `inset 0 0 0 1px ${role.borderStrongTranslucent}, 0 -1px 1px ${role.bgScrimTranslucent}`,
    transitionProperty: "background-color",
    transitionDuration: "150ms",
  },
  frontLoud: { backgroundColor: role.bgInteractivePrimary },
  face: {
    display: "grid",
    placeItems: "center",
    color: role.contentTertiary,
    fontSize: 8,
    fontWeight: 600,
    lineHeight: 1,
    fontFamily: type.fontSans,
    fontVariantNumeric: "tabular-nums",
  },
  faceLoud: { color: role.contentOnInteractiveStrong },
});
