import { create } from "@stylexjs/stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { media, row, space } from "@nyte-ai/ui/styles/schema.stylex";

export const searchPaletteStyles = create({
  tabsBar: {
    flexShrink: 0,
  },
  tabs: {
    padding: space.s2,
    overflowX: "auto",
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    minHeight: row.heightLg,
    paddingBlock: space.s1_5,
    paddingInline: space.s3,
    borderRadius: row.radius,
    backgroundColor: {
      default: "transparent",
      ":hover:not([data-disabled])": { [media.hover]: role.fillTertiary },
      "[data-active]": { default: role.fillTertiary, [media.forcedColors]: "SelectedItem" },
    },
    color: {
      default: role.contentSecondary,
      ":hover:not([data-disabled])": { [media.hover]: role.contentPrimary },
      "[data-active]": { default: role.contentPrimary, [media.forcedColors]: "SelectedItemText" },
    },
    forcedColorAdjust: { default: null, "[data-active]": "none" },
    whiteSpace: "nowrap",
    userSelect: "none",
  },
});
