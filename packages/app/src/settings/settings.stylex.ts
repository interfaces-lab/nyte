import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create } from "@stylexjs/stylex";
import { settings, sidebar } from "../theme/schema.stylex.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

export const settingsStyles = create({
  section: {
    display: { default: "flex", ":not(:has([data-settings-row]))": "none" },
  },
  steps: {
    display: "flex",
    flexDirection: "column",
    width: {
      default: 150,
      "@media (max-width: 500px)": "100%",
      "@container (max-width: 500px)": "100%",
    },
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
  },
  stepsSlider: {
    width: "100%",
    paddingBlock: space.s2,
  },
  rowValue: {
    marginInlineEnd: space.s3,
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  stepsLabels: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: space.s1,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  navigation: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    paddingInline: sidebar.gutter,
    paddingBlock: `${space.s1_5} ${space.s3}`,
  },
  back: { marginBlockEnd: sidebar.sectionGap },
  search: {
    gap: sidebar.rowGap,
    marginBlockEnd: space.s4,
    paddingInline: sidebar.rowPaddingInline,
    flexShrink: 0,
  },
  searchIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: sidebar.iconSlot,
    flexShrink: 0,
  },
  navGroups: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    minHeight: 0,
    overflowY: "auto",
  },
  navList: { display: "flex", flexDirection: "column", gap: sidebar.listGap },
  navItemHighlighted: { "--_row-fill": role.bgHover, color: role.contentPrimary },
  emptyNavigation: {
    padding: `${space.s1_5} ${space.s1}`,
    color: role.contentSecondary,
  },
  content: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    backgroundColor: role.bgBase,
  },
  contentInner: {
    display: "flex",
    flexDirection: "column",
    containerType: "inline-size",
    gap: settings.sectionGap,
    width: `min(${settings.contentWidth}, calc(100% - 2 * ${settings.contentGutter}))`,
    minHeight: "100%",
    marginInline: "auto",
    paddingBlock: settings.pagePaddingBlock,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space.s2,
    paddingInline: space.s1,
  },
  panel: { display: "flex", flexDirection: "column", gap: settings.sectionGap },
});
