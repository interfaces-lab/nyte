import { create } from "@stylexjs/stylex";

import { media } from "./schema.stylex.ts";
import { role } from "./vars.stylex.ts";

/**
 * A hairline edge that takes no layout space, so the box keeps its grid size: an inset box-shadow in
 * `role.strokeQuaternary`, the stroke stairs' hairline divider. Forced colors drop box-shadows, so
 * there the edge comes back as a border, the one mode in which it takes a pixel. A box that takes it sets
 * no `border`, `borderWidth`, `borderStyle`, `borderColor` or `boxShadow` of its own: these styles
 * sit in an earlier layer than the app's, so the caller's shorthand would replace the fallback.
 */
export const hairline = create({
  blockEnd: {
    boxShadow: `inset 0 -1px 0 ${role.strokeQuaternary}`,
    borderBlockEndWidth: { default: null, [media.forcedColors]: 1 },
    borderBlockEndStyle: { default: null, [media.forcedColors]: "solid" },
    borderBlockEndColor: { default: null, [media.forcedColors]: role.strokeQuaternary },
  },
  /** A rule under each table row but the body's last, which the table's frame closes. Set it on the cells. */
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
    borderBlockEndColor: { default: null, [media.forcedColors]: role.strokeQuaternary },
  },
  /** An edge on all four sides, following the box's radius. */
  ring: {
    boxShadow: `inset 0 0 0 1px ${role.strokeQuaternary}`,
    borderWidth: { default: null, [media.forcedColors]: 1 },
    borderStyle: { default: null, [media.forcedColors]: "solid" },
    borderColor: { default: null, [media.forcedColors]: role.strokeQuaternary },
  },
});
