import { create } from "@stylexjs/stylex";
import { role } from "@nyte-ai/ui/vars.stylex";

export const searchPaletteStyles = create({
  tabs: {
    flexShrink: 0,
    paddingInline: 8,
    paddingBlock: 6,
    overflowX: "auto",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
});
