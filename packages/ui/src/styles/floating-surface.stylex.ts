import { radius } from "./schema.stylex.ts";
import { create } from "@stylexjs/stylex";
import { hairline } from "./hairline.stylex.ts";
import { appearance, role, shadow } from "./vars.stylex.ts";

const surface = create({
  material: {
    backgroundColor: role.popupMaterial,
    backdropFilter: appearance.popupMaterialFilter,
  },
  modalPopup: {
    "--nyte-hairline-elevation": shadow.shadowXl,
  },
  popup: {
    boxSizing: "border-box",
    position: "relative",
    borderRadius: radius.surface,
    backgroundColor: role.popupMaterial,
    backdropFilter: appearance.popupMaterialFilter,
    "--nyte-hairline-elevation": shadow.shadowLg,
  },
});

/** The raised surface every popup shares: material, radius, `shadowLg` and the hairline frame. */
export const floatingSurfaceStyles = {
  material: surface.material,
  modalPopup: surface.modalPopup,
  popup: [surface.popup, hairline.ringAfter],
} as const;
