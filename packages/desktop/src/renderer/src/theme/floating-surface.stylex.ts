/**
 * One painted frame for raised desktop surfaces. The popup owns its fill,
 * shadow, and hairline so all three follow the same enter/exit lifecycle.
 * Collision-aware positioners only handle placement.
 *
 * Based on Cursor's bundled floating-surface.stylex.js and Menu.stylex.js.
 */
import * as stylex from "@stylexjs/stylex";
import { t } from "./vars.stylex.ts";

export const floatingSurfaceStyles = stylex.create({
  modalPopup: {
    boxShadow: t.shadowModal,
  },
  popup: {
    boxSizing: "border-box",
    position: "relative",
    borderRadius: t.radius2xl,
    backgroundColor: t.bgElevated,
    boxShadow: t.shadowPopover,
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 1px ${t.strokeSecondary}, inset 0 0 0 1px ${t.bgElevated}`,
      pointerEvents: "none",
    },
  },
});
