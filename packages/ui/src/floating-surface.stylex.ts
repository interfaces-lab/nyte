import { radius } from "./schema.stylex.ts";
/**
 * One painted frame for raised surfaces. The popup owns its fill,
 * shadow, and hairline so all three follow the same enter/exit lifecycle.
 * Collision-aware positioners only handle placement.
 */
import { create } from "@stylexjs/stylex";
import { appearance, role, shadow } from "./vars.stylex.ts";

export const floatingSurfaceStyles = create({
  /** The translucent fill every floating surface shares, blurring the page behind it. */
  material: {
    backgroundColor: role.popupMaterial,
    backdropFilter: appearance.popupMaterialFilter,
  },
  modalPopup: {
    boxShadow: shadow.shadowXl,
  },
  popup: {
    boxSizing: "border-box",
    position: "relative",
    borderRadius: radius.surface,
    backgroundColor: role.popupMaterial,
    backdropFilter: appearance.popupMaterialFilter,
    boxShadow: shadow.shadowLg,
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
      pointerEvents: "none",
    },
  },
});
