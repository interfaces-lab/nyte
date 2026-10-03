import { glyph, radius } from "@nyte-ai/ui/schema.stylex";
import { create } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";

export const paletteLegendStyles = create({
  footer: {
    display: "flex",
    alignItems: "center",
    minHeight: 48,
    flexShrink: 0,
    paddingInline: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    letterSpacing: type.letterBase,
    whiteSpace: "nowrap",
  },
  keys: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
  },
  keycap: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: glyph.lg,
    height: glyph.lg,
    paddingInline: 4,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontWeight: 400,
    lineHeight: type.leadingXs,
  },
  keycapIcon: {
    width: glyph.lg,
    paddingInline: 0,
  },
  mark: {
    display: "inline-flex",
    width: glyph.lg,
    height: glyph.lg,
    marginInlineStart: "auto",
    color: role.contentSecondary,
  },
});
