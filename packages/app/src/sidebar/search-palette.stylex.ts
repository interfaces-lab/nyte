import { create } from "@stylexjs/stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";

export const searchPaletteStyles = create({
  tabsBar: {
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  tabs: {
    flexShrink: 0,
    paddingInline: space.s2,
    paddingBlock: space.s1_5,
    overflowX: "auto",
  },
});
