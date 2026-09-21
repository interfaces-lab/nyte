/**
 * The dialog's geometry and motion. It paints no material of its own: the
 * panel composes `surface.floating.dialog` at the call site in `dialog.tsx`,
 * and the scrim composes `elevation.scrim` there for the same reason.
 *
 * Nothing here writes a colour, a radius, a shadow, a z-index or a length.
 * Two exceptions are marked DERIVED on the line: the focus ring width, which
 * no area owns, and the reduced-motion duration, which is a disable rather
 * than a value.
 */
import { create, keyframes } from "@stylexjs/stylex";
import { color } from "../tokens/color.stylex";
import { edge, layer, radius } from "../tokens/layer.stylex";
import { space } from "../tokens/space.stylex";
import { motion } from "../tokens/type.stylex";

/*
 * The panel enters by scale alone. A translate would need a displacement in
 * pixels and no area owns one; scale is unitless and reads as the sheet
 * settling rather than sliding in from a direction it has no reason to come
 * from.
 */
const scrimIn = keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const scrimOut = keyframes({
  from: { opacity: 1 },
  to: { opacity: 0 },
});

const panelIn = keyframes({
  from: { opacity: 0, transform: "scale(0.96)" },
  to: { opacity: 1, transform: "scale(1)" },
});

/* The exit travels under a third of the enter's distance. Softer, and the
 * panel stays legible for the whole of its departure. */
const panelOut = keyframes({
  from: { opacity: 1, transform: "scale(1)" },
  to: { opacity: 0, transform: "scale(0.988)" },
});

/* DERIVED: not a duration, a switch. Short enough to be instant and long
 * enough that `animationend` still fires, which is what unmounts the panel. */
const instant = "0.01ms";

export const dialog = create({
  /*
   * The scrim is a sibling of the panel, never its parent. A parent animating
   * opacity would pull the panel into its own group and flatten the shadow
   * the material casts, and any overflow on it would clip the material.
   *
   * It takes `motion.durationState` rather than `durationEnter`: the room
   * does not arrive, it only changes state, and this keeps it shorter than
   * the panel in both directions.
   */
  scrim: {
    position: "fixed",
    inset: 0,
    backgroundColor: color.scrim,
    animationTimingFunction: motion.easeEnter,
    animationFillMode: "both",
    animationName: scrimIn,
    animationDuration: {
      default: motion.durationState,
      "@media (prefers-reduced-motion: reduce)": instant,
    },
  },

  scrimExiting: {
    animationTimingFunction: motion.easeExit,
    animationName: scrimOut,
    animationDuration: {
      default: motion.durationState,
      "@media (prefers-reduced-motion: reduce)": instant,
    },
  },

  /*
   * Three rows rather than centring: 2fr of empty above and 3fr below lifts
   * the panel off the geometric centre. A centred box reads as sitting low,
   * and a ratio holds that correction at every viewport height without
   * naming a length.
   *
   * Pointer events pass through to the scrim beneath, so a press that starts
   * on the panel and ends outside it never reaches the scrim as a click. The
   * drag-out dismissal bug is absent by construction rather than guarded
   * against.
   *
   * This is the bare-layer case layer.stylex.ts describes: it positions the
   * dialog above the scrim and paints nothing, so it takes no elevation.
   */
  positioner: {
    position: "fixed",
    inset: 0,
    zIndex: layer.dialog,
    display: "grid",
    gridTemplateRows: "2fr auto 3fr",
    justifyItems: "center",
    padding: space.insetViewport,
    pointerEvents: "none",
  },

  panel: {
    gridRowStart: 2,
    pointerEvents: "auto",
    /*
     * The width is a ceiling, not a promise. A container narrower than the
     * dialog is a real case once the modal is scoped to a window rather than
     * the viewport, and overflowing it would put the actions off-screen.
     */
    inlineSize: `min(${space.widthDialog}, calc(100% - ${space.insetViewport} * 2))`,
    maxInlineSize: "100%",
    maxBlockSize: "100%",
    display: "flex",
    flexDirection: "column",
    padding: space.insetDialog,
    color: color.textPrimary,
    outlineStyle: "none",
    animationTimingFunction: motion.easeEnter,
    animationFillMode: "both",
    animationName: panelIn,
    animationDuration: {
      default: motion.durationEnter,
      "@media (prefers-reduced-motion: reduce)": instant,
    },
  },

  panelExiting: {
    animationTimingFunction: motion.easeExit,
    animationName: panelOut,
    animationDuration: {
      default: motion.durationExit,
      "@media (prefers-reduced-motion: reduce)": instant,
    },
  },

  title: {
    margin: 0,
  },

  /*
   * Rhythm decision 1 of 3, and the smallest. The title and the body are one
   * statement, so the margin only has to stop the two steps touching. It is
   * doing less work than it looks: the title step carries 4px of half-leading
   * below its baseline and the body step 3.5px above, so 4px of margin reads
   * as about 11px of air. gapContent here would open to 15px and the body
   * would start to look like a paragraph about something else.
   */
  body: {
    marginBlockStart: space.gapTight,
    minBlockSize: 0,
    overflowY: "auto",
    color: color.textSecondary,
  },

  /*
   * Rhythm decision 2 of 3, and the largest. Two reasons it clears the title
   * gap by four times rather than one step.
   *
   * Grouping: the gap that separates the text block from the controls has to
   * beat every gap inside the text block, and the text block already contains
   * the title gap plus the body's own leading.
   *
   * Optics: the body's last line leaves half a line of leading below its
   * baseline, which the eye discounts, while a button presents a hard filled
   * edge that it does not. The measured distance has to run ahead of the
   * optical one to land level.
   */
  actions: {
    marginBlockStart: space.gapBlock,
    display: "flex",
    flexDirection: "row",
    /* macOS order: the confirming action is last, hard against the trailing
     * edge, because that is where the reading finishes. */
    justifyContent: "flex-end",
    alignItems: "center",
    /* Rhythm decision 3 of 3. Buttons in a row are peers of one another, not
     * blocks of content, so this is the sibling gap and not the block gap. */
    columnGap: space.gapContent,
  },

  /*
   * Row anatomy from space.stylex.ts: fixed leading slot, flexible label,
   * optional trailing slot, at the button row height.
   *
   * The border is transparent rather than absent so all three variants share
   * one border box and the row stays level when a dialog mixes a filled
   * button with an outlined one.
   *
   * The radius is a scale step, not `concentric.inner`. Concentric binds only
   * while the inset separating child from parent is smaller than the parent's
   * radius. insetDialog is 20px against a 12px panel, so the panel's corner
   * passes nowhere near the button and there is no curve to inherit; the
   * helper would floor at zero and square the buttons off in the name of a
   * rule that has stopped applying. r6 is half the panel radius, which is
   * what a child at this size reads as related to.
   */
  button: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    columnGap: space.gapRow,
    blockSize: space.rowButton,
    paddingBlock: 0,
    /* DERIVED from the ruler: space.stylex.ts names no button inset. insetRow
     * is 8px, which works for a row whose leading slot already supplies the
     * optical margin, and cramps a two-word label that has no slot. */
    paddingInline: space.insetButton,
    borderStyle: "solid",
    borderWidth: edge.hairline,
    borderColor: "transparent",
    borderRadius: radius.r6,
    fontFamily: "inherit",
    cursor: "default",
    /* Longhand, and only the two properties that actually change. A shorthand
     * here would sweep up layout and fight the panel's own animation. */
    transitionProperty: "background-color, border-color, color",
    transitionDuration: motion.durationState,
    transitionTimingFunction: motion.easeDefault,
  },

  /*
   * DERIVED: no focus-ring token exists in any area. Two pixels is the
   * platform weight, and the offset is one hairline so the ring clears the
   * button's own edge by exactly the width of that edge.
   */
  buttonFocus: {
    outlineColor: {
      default: "transparent",
      ":focus-visible": color.blue500,
    },
    outlineStyle: "solid",
    outlineWidth: edge.focusRing,
    outlineOffset: edge.hairline,
  },

  /*
   * The filled variant cannot use the state wash: state-hover is 4% black
   * over a near-black pill and does nothing. It moves along the gray ramp
   * instead, away from the extreme, which lightens in light and dims in dark.
   */
  primary: {
    backgroundColor: {
      default: color.surfaceContrast,
      ":hover": color.gray800,
      ":active": color.gray500,
    },
    color: color.textOnContrast,
  },

  secondary: {
    backgroundColor: {
      default: "transparent",
      ":hover": color.stateHover,
      ":active": color.statePressed,
    },
    borderColor: color.strokePrimary,
    color: color.textPrimary,
  },

  /*
   * Destructive is not filled. It is the action the user is least likely to
   * want, so it takes the red label and the quiet frame, and its wash is the
   * neutral state step: the red ramp's 30 is translucent in light and a solid
   * pale pink in dark, and a hover must not change character between
   * appearances.
   */
  destructive: {
    backgroundColor: {
      default: "transparent",
      ":hover": color.stateHover,
      ":active": color.statePressed,
    },
    borderColor: color.strokePrimary,
    color: color.red600,
  },

  /* Same slot width as a menu item's, so labels land in the same column
   * across surfaces. Rendered only when a button has something to put in it:
   * reserving it on a bare button would push a centred label off centre for
   * the sake of an alignment nothing is using. */
  slot: {
    flexShrink: 0,
    inlineSize: space.slotLeading,
    blockSize: space.slotIcon,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: color.iconSecondary,
  },

  slotTrailing: {
    inlineSize: space.slotTrailing,
  },

  label: {
    whiteSpace: "nowrap",
  },
});
