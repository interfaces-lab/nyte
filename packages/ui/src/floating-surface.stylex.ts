/**
 * One painted frame for raised surfaces. The popup owns its fill,
 * shadow, and hairline so all three follow the same enter/exit lifecycle.
 * Collision-aware positioners only handle placement.
 */
import { create } from "@stylexjs/stylex";
import { t } from "./vars.stylex.ts";

export const floatingSurfaceStyles = create({
  /** The translucent fill every floating surface shares, blurring the page behind it. */
  material: {
    backgroundColor: t.popupMaterial,
    backdropFilter: t.popupMaterialFilter,
  },
  modalPopup: {
    boxShadow: t.shadowXl,
  },
  popup: {
    boxSizing: "border-box",
    position: "relative",
    borderRadius: t.radius14,
    backgroundColor: t.popupMaterial,
    backdropFilter: t.popupMaterialFilter,
    boxShadow: t.shadowLg,
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 1px ${t.borderSecondaryTranslucent}`,
      pointerEvents: "none",
    },
  },
});
