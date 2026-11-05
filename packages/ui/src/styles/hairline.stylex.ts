import { create } from "@stylexjs/stylex";

import { media } from "./schema.stylex.ts";
import { role } from "./vars.stylex.ts";

/**
 * A hairline edge that takes no layout space, so the box keeps its grid size: an inset box-shadow in
 * `role.strokeQuaternary`, the stroke stairs' hairline divider. Forced colors drop box-shadows, so
 * there the edge comes back as a border, the one mode in which it takes a pixel.
 */
export const hairline = create({
  blockEnd: {
    boxShadow: `inset 0 -1px 0 ${role.strokeQuaternary}`,
    borderBlockEndWidth: { default: null, [media.forcedColors]: 1 },
    borderBlockEndStyle: { default: null, [media.forcedColors]: "solid" },
    borderBlockEndColor: { default: null, [media.forcedColors]: role.strokeQuaternary },
  },
});
