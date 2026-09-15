/** Settings navigation in the persistent sidebar and route-owned page content. */
import * as stylex from "@stylexjs/stylex";
import { settings, sidebar } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

export const appearanceSettingsStyles = stylex.create({
  navigation: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    paddingInline: sidebar.gutter,
    paddingBlock: "6px 12px",
  },
  back: { marginBlockEnd: sidebar.sectionGap },
  // The field is one row tall on the rail's grid, and its glyph and placeholder
  // sit on the icon and label edges the rows below it use.
  search: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    height: sidebar.rowHeight,
    marginBlockEnd: 16,
    paddingInline: 7,
    borderRadius: t.radiusLg,
    borderStyle: "none",
    backgroundColor: t.fillSecondary,
    boxShadow: {
      default: `inset 0 0 0 1px ${t.strokeSecondary}`,
      ":focus-within": `inset 0 0 0 1px ${t.strokePrimary}`,
    },
    color: t.iconTertiary,
    flexShrink: 0,
  },
  searchIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  searchInput: {
    minWidth: 0,
    flex: 1,
    padding: 0,
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: t.textPrimary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    "::placeholder": { color: t.textTertiary },
  },
  // Headerless groups read their breaks from the gap, so it has to beat the
  // gap between two rows of one group.
  navGroups: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    minHeight: 0,
    overflowY: "auto",
  },
  navList: { display: "flex", flexDirection: "column", gap: sidebar.listGap },
  navItem: { textDecoration: "none" },
  /** The arrow keys' cursor while searching; the open section keeps its fill. */
  navItemHighlighted: { backgroundColor: t.fillGhostHover, color: t.textPrimary },
  emptyNavigation: {
    padding: "6px 4px",
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  content: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    backgroundColor: t.bgBase,
  },
  contentInner: {
    display: "flex",
    flexDirection: "column",
    containerType: "inline-size",
    gap: settings.sectionGap,
    width: `min(${settings.contentWidth}, calc(100% - 2 * ${settings.contentGutter}))`,
    minHeight: "100%",
    marginInline: "auto",
    paddingBlock: "48px 80px",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    minHeight: 22,
    paddingInline: 8,
  },
  panel: { display: "flex", flexDirection: "column", gap: settings.sectionGap },
});
