/**
 * One painted frame for raised surfaces. The popup owns its fill,
 * shadow, and hairline so all three follow the same enter/exit lifecycle.
 * Collision-aware positioners only handle placement.
 */
import * as stylex from "@stylexjs/stylex";
import { t } from "./vars.stylex.ts";

export const floatingSurfaceStyles = stylex.create({
  /** The translucent fill every floating surface shares, blurring the page behind it. */
  material: {
    backgroundColor: t.materialBg,
    backdropFilter: t.materialFilter,
  },
  modalPopup: {
    boxShadow: t.shadowModal,
  },
  popup: {
    boxSizing: "border-box",
    position: "relative",
    borderRadius: t.radius2xl,
    backgroundColor: t.materialBg,
    backdropFilter: t.materialFilter,
    boxShadow: t.shadowPopover,
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 1px ${t.strokeSecondary}`,
      pointerEvents: "none",
    },
  },
});
