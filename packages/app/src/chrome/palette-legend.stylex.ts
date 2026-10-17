import { glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

export const paletteLegendStyles = create({
  footer: {
    display: "flex",
    alignItems: "center",
    minHeight: 48,
    flexShrink: 0,
    paddingInline: space.s3,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondaryTranslucent,
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: space.s4,
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
  },
  keys: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s0_5,
  },
  keycap: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: glyph.lg,
    height: glyph.lg,
    paddingInline: space.s1,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontWeight: type.weightRegular,
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
