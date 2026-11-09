import { create, createTheme } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { avatar, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { settingsDensity } from "../theme/tokens.stylex.ts";

/** Customize borrows the settings patterns but keeps the roomier rows and type that only Settings dropped. */
export const customizeDensity = createTheme(settingsDensity, {
  "--nyte-settings-row-padding": "12px 16px",
  "--nyte-settings-section-title-font-size": "var(--nyte-font-size-lg)",
  "--nyte-settings-section-title-line-height": "var(--nyte-line-height-lg)",
  "--nyte-settings-description-font-size": "var(--nyte-font-size-base)",
  "--nyte-settings-description-line-height": "var(--nyte-line-height-base)",
});

export const customizeStyles = create({
  header: { display: "flex", flexDirection: "column", gap: space.s5 },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space.s3,
  },
  search: { width: "min(100%, 240px)" },
  searchIcon: { display: "inline-flex", alignItems: "center", flexShrink: 0 },
  count: {
    marginInlineStart: space.s1_5,
    color: role.contentTertiary,
    fontVariantNumeric: "tabular-nums",
  },
  attention: {
    width: 6,
    height: 6,
    marginInlineStart: space.s1_5,
    borderRadius: radius.pill,
    backgroundColor: role.contentSecondary,
  },
  empty: { paddingInline: space.s1 },
  controls: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  details: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    alignItems: "center",
    columnGap: space.s4,
    rowGap: space.s3,
    paddingInlineStart: `calc(${avatar.md} + ${space.s3})`,
  },
  wide: { gridColumn: "1 / -1" },
  label: { color: role.contentSecondary },
  value: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, minWidth: 0 },
  note: { margin: 0, color: role.contentSecondary },
  stack: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  chips: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s1 },
  chip: {
    paddingBlock: space.px,
    paddingInline: space.s1_5,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
  },
  path: { color: role.contentSecondary, fontFamily: type.fontMono, overflowWrap: "anywhere" },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s1_5 },
  failed: { color: role.contentAccent },
  trace: {
    margin: 0,
    padding: space.s3,
    overflowX: "auto",
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  loadingLine: {
    width: "42%",
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
  },
});
