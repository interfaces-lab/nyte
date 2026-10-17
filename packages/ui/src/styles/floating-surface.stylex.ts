import { radius } from "./schema.stylex.ts";
import { create } from "@stylexjs/stylex";
import { appearance, role, shadow } from "./vars.stylex.ts";

export const floatingSurfaceStyles = create({
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
