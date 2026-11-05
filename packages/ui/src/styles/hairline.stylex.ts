import { create } from "@stylexjs/stylex";

import { media } from "./schema.stylex.ts";
import { role } from "./vars.stylex.ts";

/** Under forced colors: a 1px line along the box's bottom edge, drawn by a border image with no border width. */
const FORCED_BLOCK_END = "linear-gradient(CanvasText, CanvasText) 0 0 1 0 / 0 0 1px 0 / 0 stretch";

/**
 * A hairline edge that takes no layout space, so the box keeps its grid size: an inset box-shadow in
 * `role.strokeQuaternary`, the stroke stairs' hairline divider. Forced colors drop box-shadows, so
 * there `blockEnd` is a border image with no border width and `ring` an outline drawn inside the box,
 * neither taking a pixel. A box that takes a hairline sets no `boxShadow` of its own, nor the
 * property its forced-colors edge uses (`borderImage`, `outline*`, or a border on the edge `tableRow`
 * draws): StyleX merges per property, and ui's styles sit in an earlier layer than the app's, so the
 * caller's value would replace the hairline's.
 */
export const hairline = create({
  blockEnd: {
    boxShadow: `inset 0 -1px 0 ${role.strokeQuaternary}`,
    borderImage: { default: null, [media.forcedColors]: FORCED_BLOCK_END },
  },
  /**
   * A rule under each table row but the body's last, which the table's frame closes. Set it on the
   * cells. Under forced colors it is a block-end border: a border image would stop the cells' own
   * column dividers from drawing.
   */
  tableRow: {
    boxShadow: {
      default: `inset 0 -1px 0 ${role.strokeQuaternary}`,
      ":is(tbody > tr:last-child > *)": "none",
    },
    borderBlockEndWidth: {
      default: null,
      [media.forcedColors]: { default: 1, ":is(tbody > tr:last-child > *)": 0 },
    },
    borderBlockEndStyle: { default: null, [media.forcedColors]: "solid" },
    borderBlockEndColor: { default: null, [media.forcedColors]: "CanvasText" },
  },
  /** An edge on all four sides, following the box's radius. */
  ring: {
    boxShadow: `inset 0 0 0 1px ${role.strokeQuaternary}`,
    outlineStyle: { default: null, [media.forcedColors]: "solid" },
    outlineWidth: { default: null, [media.forcedColors]: 1 },
    outlineColor: { default: null, [media.forcedColors]: "CanvasText" },
    outlineOffset: { default: null, [media.forcedColors]: -1 },
  },
});
