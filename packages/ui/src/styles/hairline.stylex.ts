import { create } from "@stylexjs/stylex";

import { media } from "./schema.stylex.ts";
import { role } from "./vars.stylex.ts";

/** The box's elevation, a registered custom property that doesn't inherit (base.css); none by default. */
const ELEVATION = "var(--nyte-hairline-elevation, 0 0 #0000)";

/** Under forced colors: a 1px line along one edge, drawn by a border image with no border width. */
const FORCED_BLOCK_END = "linear-gradient(CanvasText, CanvasText) 0 0 1 0 / 0 0 1px 0 / 0 stretch";

/** Physical sides for the inline edges, picked by `:dir()`. */
const FORCED_LEFT = "linear-gradient(CanvasText, CanvasText) 0 0 0 1 / 0 0 0 1px / 0 stretch";

const FORCED_RIGHT = "linear-gradient(CanvasText, CanvasText) 0 1 0 0 / 0 1px 0 0 / 0 stretch";

/**
 * A hairline edge that takes no layout space, so the box keeps its grid size: an inset box-shadow in
 * `role.strokeQuaternary`, the stroke stairs' hairline divider. Forced colors drop box-shadows, so
 * there `blockEnd`, `inlineStart` and `tableCell` are a border image with no border width and `ring`
 * an outline drawn inside the box, none taking a pixel. A box takes one hairline style, and sets no
 * `boxShadow` of its own nor the property its forced-colors edge uses (`borderImage` or `outline*`):
 * StyleX merges per property, and ui's styles sit in an earlier layer than the app's, so a second
 * hairline or the caller's value would replace the first. A raised box sets its drop shadow as
 * `--nyte-hairline-elevation` instead, which every style draws before its edge.
 */
export const hairline = create({
  blockEnd: {
    boxShadow: `${ELEVATION}, inset 0 -1px 0 ${role.strokeQuaternary}`,
    borderImage: { default: null, [media.forcedColors]: FORCED_BLOCK_END },
  },
  /** The inline-start edge, the left one in left-to-right text: a panel's divider from what is beside it. */
  inlineStart: {
    boxShadow: {
      default: `${ELEVATION}, inset 1px 0 0 ${role.strokeQuaternary}`,
      ":dir(rtl)": `${ELEVATION}, inset -1px 0 0 ${role.strokeQuaternary}`,
    },
    borderImage: {
      default: null,
      [media.forcedColors]: { default: FORCED_LEFT, ":dir(rtl)": FORCED_RIGHT },
    },
  },
  /**
   * A table cell's rules: one under each row but the body's last, which the table's frame closes, and
   * one at the inline end of each cell but the row's last. Set it on the cells. `--_hairline-dir` is 1,
   * or -1 in right-to-left text, so the inline-end shadow and border image land on the right side.
   */
  tableCell: {
    "--_hairline-dir": { default: "1", ":dir(rtl)": "-1" },
    "--_hairline-block-end": { default: "1px", ":is(tbody > tr:last-child > *)": "0px" },
    "--_hairline-inline-end": { default: "1px", ":last-child": "0px" },
    boxShadow: `${ELEVATION}, inset 0 calc(-1 * var(--_hairline-block-end)) 0 ${role.strokeQuaternary}, inset calc(-1 * var(--_hairline-dir) * var(--_hairline-inline-end)) 0 0 ${role.strokeQuaternary}`,
    borderImage: {
      default: null,
      [media.forcedColors]:
        "linear-gradient(CanvasText, CanvasText) 1 / 0 calc(var(--_hairline-inline-end) * max(0, var(--_hairline-dir))) var(--_hairline-block-end) calc(var(--_hairline-inline-end) * max(0, -1 * var(--_hairline-dir))) / 0 stretch",
    },
  },
  /**
   * An edge on all four sides, drawn on the box's `::after` above its content, for a box whose own
   * outline is taken (a focus ring) or whose ring must sit over its content (a popup). Under forced
   * colors the pseudo-element gets a 1px border, which takes none of the box's layout. The box must
   * be positioned and must not use its own `::after`; the elevation draws on the box itself.
   */
  ringAfter: {
    boxShadow: ELEVATION,
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 1px ${role.strokeQuaternary}`,
      borderWidth: { default: 0, [media.forcedColors]: 1 },
      borderStyle: "solid",
      borderColor: { default: "transparent", [media.forcedColors]: "CanvasText" },
      pointerEvents: "none",
    },
  },
  /**
   * A control's boundary in `strokeTertiary`: the ring is an inset shadow on the box, after its
   * elevation, and only under forced colors a 1px `CanvasText` border on its `::after`, which takes none
   * of its layout. A focused control's border turns `Highlight` there, so an inset focus ring, which
   * that border covers, still shows. The box must be positioned and leave its `::after` free.
   */
  controlRing: {
    boxShadow: `${ELEVATION}, inset 0 0 0 1px ${role.strokeTertiary}`,
    "::after": {
      content: { default: null, [media.forcedColors]: '""' },
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: "CanvasText",
      pointerEvents: "none",
    },
    ":focus-visible::after": { borderColor: "Highlight" },
  },
  /**
   * Marks a pressed toggle under forced colors only: a 1px `Highlight` border on its `::after`, where
   * forced colors would otherwise erase the pressed fill. The glyph keeps its forced colors, so it reads
   * on light and dark high-contrast themes alike. Normal colors draw nothing. The box is positioned and
   * leaves its `::after` free.
   */
  pressedRing: {
    "[data-pressed]::after": {
      content: { default: null, [media.forcedColors]: '""' },
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: "Highlight",
      pointerEvents: "none",
    },
  },
  /** An edge on all four sides, following the box's radius. */
  ring: {
    boxShadow: `${ELEVATION}, inset 0 0 0 1px ${role.strokeQuaternary}`,
    outlineStyle: { default: null, [media.forcedColors]: "solid" },
    outlineWidth: { default: null, [media.forcedColors]: 1 },
    outlineColor: { default: null, [media.forcedColors]: "CanvasText" },
    outlineOffset: { default: null, [media.forcedColors]: -1 },
  },
});
