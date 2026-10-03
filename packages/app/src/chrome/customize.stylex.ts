import { glyph, input, radius } from "@nyte-ai/ui/schema.stylex";
/** Customize inventory feature styles. */
import { create } from "@stylexjs/stylex";
import { settings } from "../theme/schema.stylex.ts";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";

export const customizeStyles = create({
  surface: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    backgroundColor: role.bgBase,
  },
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    maxWidth: 720,
    minHeight: "100%",
    marginInline: "auto",
    padding: "16px 24px 40px",
    gap: 12,
  },
  searchRow: { display: "flex", alignItems: "center", gap: 8 },
  searchField: {
    width: "100%",
    height: input.heightLg,
    gap: 6,
    paddingInline: 10,
    borderRadius: radius.control,
    borderColor: role.borderSecondaryTranslucent,
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
  },
  searchInput: { height: "100%" },
  inventory: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  inventoryHeading: { display: "flex", alignItems: "baseline", gap: 6, paddingInline: 6 },
  inventoryTitle: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: 600,
    lineHeight: type.leadingBase,
  },
  inventoryCount: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  settingsNote: {
    paddingInline: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    padding: 1,
    overflow: "hidden",
    borderRadius: radius.card,
    backgroundColor: role.borderSecondaryTranslucent,
  },
  row: {
    minHeight: settings.inventoryRowHeight,
    gap: 8,
    "--_row-padding-inline": "8px",
    // The list paints its hairlines as 1px gaps in its own background, so every
    // row needs an opaque resting fill and square corners to cover them.
    "--_row-fill": role.bgBase,
    paddingBlock: 6,
    borderRadius: 0,
  },
  rowLeading: { width: glyph.md },
  rowTitle: { fontWeight: 500 },
  quiet: {
    minHeight: 48,
    display: "flex",
    alignItems: "center",
    paddingInline: 10,
    backgroundColor: role.bgBase,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  loadingLine: {
    width: "42%",
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
  },
  error: { color: role.contentSecondary, fontSize: type.fontSm, lineHeight: type.leadingSm },
});
