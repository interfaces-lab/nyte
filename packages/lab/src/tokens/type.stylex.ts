/**
 * Type steps and motion.
 *
 * A step is a size and a leading together, the way Notion pairs them, so
 * these are styles rather than loose tokens: a call site cannot take the size
 * and leave the leading behind, or scale one without the other.
 *
 * Weights come from NOTION-TOKENS.md (450 / 550 / 650 / 700) and are read
 * through the shared colour file, which is where those custom properties are
 * already declared. Sizes and leadings are not in the audit and are DERIVED.
 *
 * Leadings are all multiples of four so a stack of text stays on the same
 * grid as the rows in space.stylex.ts. Sizes are not grid quantities and are
 * not forced onto it; an 11px caption on a 16px leading is correct, a 12px
 * caption stretched to fit the grid is not.
 */
import { create, defineConsts } from "@stylexjs/stylex";
import { color } from "./color.stylex";

export const text = create({
  /* The package loads Inter Variable once at the application boundary. */
  root: {
    fontFamily: '"Inter Variable", Inter, sans-serif',
    fontSize: "13px",
    lineHeight: "var(--lab-line-height, 18px)",
    fontWeight: color.weightRegular,
  },

  /* Shortcut hints, timestamps, counts. Medium because it sits in secondary
   * ink, where regular at this size goes soft. */
  caption: {
    fontSize: "11px",
    lineHeight: "16px",
    fontWeight: color.weightMedium,
  },

  /* Section headings and form labels. Names a group, never reads as content. */
  label: {
    fontSize: "12px",
    lineHeight: "16px",
    fontWeight: color.weightMedium,
  },

  /* Menu item labels, dialog body, shell rows. The default. */
  body: {
    fontSize: "13px",
    lineHeight: "var(--lab-line-height, 18px)",
    fontWeight: color.weightRegular,
  },

  /* Body metrics at medium weight: a selected or primary row can swap to this
   * without reflowing the row it sits in. */
  strong: {
    fontSize: "13px",
    lineHeight: "var(--lab-line-height, 18px)",
    fontWeight: color.weightMedium,
  },

  /* Dialog titles. The only step that changes the reading size. */
  title: {
    fontSize: "16px",
    lineHeight: "24px",
    fontWeight: color.weightSemibold,
  },
});

/**
 * Motion, named by lifecycle rather than by curve, so the name says when to
 * reach for it. The easings are audited; the durations are DERIVED.
 *
 * Duration and easing share a lifecycle name and are meant to travel in
 * pairs: state with default, enter with enter, exit with exit. Exit is
 * shorter than enter because a surface that is leaving has nothing left to
 * explain.
 *
 * The easings point at the same custom properties palette.css declares, so
 * the audited curves still have one home. They are written out rather than
 * read from the colour file because defineConsts takes static values only.
 */
export const motion = defineConsts({
  durationState: "80ms",
  durationEnter: "160ms",
  durationExit: "120ms",

  easeDefault: "var(--ease-default)",
  easeEnter: "var(--ease-enter)",
  easeExit: "var(--ease-exit)",
});
