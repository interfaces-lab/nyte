import * as stylex from "@stylexjs/stylex";
import { t } from "@nyte-ai/ui/vars.stylex";

export const paletteLegendStyles = stylex.create({
  footer: {
    display: "flex",
    alignItems: "center",
    minHeight: 48,
    flexShrink: 0,
    paddingInline: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: t.strokeSecondary,
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
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    letterSpacing: t.letterBase,
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
    minWidth: 20,
    height: 20,
    paddingInline: 4,
    borderRadius: t.radiusBase,
    backgroundColor: t.fillQuiet,
    boxShadow: `inset 0 0 0 1px ${t.strokeTertiary}`,
    color: t.textSecondary,
    fontFamily: t.fontMono,
    fontSize: t.fontXs,
    fontWeight: 400,
    lineHeight: t.leadingXs,
  },
  keycapIcon: {
    width: 20,
    paddingInline: 0,
  },
  mark: {
    display: "inline-flex",
    width: 18,
    height: 18,
    marginInlineStart: "auto",
    color: t.iconSecondary,
  },
});
