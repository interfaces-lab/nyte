import { create } from "@stylexjs/stylex";
import { button, glyph, menu, shape } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";

export const contextStyles = create({
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  controlLayout: { minWidth: 0, maxWidth: 280, flexShrink: 1 },
  readout: {
    display: "inline-flex",
    alignItems: "center",
    height: button.heightMd,
    paddingInline: 4,
    color: role.contentSecondary,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    fontWeight: 400,
    lineHeight: type.leadingBase,
    whiteSpace: "nowrap",
  },
  text: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  icon: { display: "inline-flex", flexShrink: 0 },
  menu: {
    minWidth: `min(${menu.width}, var(--available-width))`,
    maxWidth: `min(${menu.width}, var(--available-width))`,
    maxHeight: `min(${menu.maxHeight}, var(--available-height))`,
  },
  hint: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    maxWidth: "min(400px, calc(100vw - 16px))",
    paddingBlock: 6,
    paddingInline: 10,
    borderRadius: shape.control,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  hintHeading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    color: role.contentPrimary,
    whiteSpace: "nowrap",
  },
  hintValue: { color: role.contentSecondary, fontSize: type.fontSm, lineHeight: type.leadingSm },
  keys: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  key: {
    minWidth: glyph.md,
    minHeight: glyph.md,
    padding: 0,
    borderRadius: shape.indicator,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
});
