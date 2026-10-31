import { glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create } from "@stylexjs/stylex";
import { settings } from "../theme/schema.stylex.ts";
import { role } from "@nyte-ai/ui/styles/vars.stylex";

export const appearanceStyles = create({
  root: { display: "flex", flexDirection: "column", gap: settings.sectionGap },
  tintControl: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
  },
  tintSlider: { width: 120, minWidth: 0, flex: "0 1 auto" },
  tintSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: glyph.lg,
    flexShrink: 0,
  },
  tintSwatch: {
    display: "block",
    width: glyph.lg,
    height: glyph.lg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderPrimaryTranslucent,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
  },
  tintSwatchActive: {
    backgroundColor: role.bgInteractiveStrong,
  },
});
