import { create } from "@stylexjs/stylex";
import { menu } from "@nyte-ai/ui/schema.stylex";
import { t } from "@nyte-ai/ui/vars.stylex";

export const contextStyles = create({
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minWidth: 0,
  },
  controlLayout: { minWidth: 0, maxWidth: 280, flexShrink: 1 },
  readout: {
    display: "inline-flex",
    alignItems: "center",
    height: 28,
    paddingInline: 4,
    color: t.contentSecondary,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    fontWeight: 400,
    lineHeight: t.leadingBase,
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
    borderRadius: t.radius8,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  hintHeading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    color: t.contentPrimary,
    whiteSpace: "nowrap",
  },
  hintValue: { color: t.contentSecondary, fontSize: t.fontSm, lineHeight: t.leadingSm },
  keys: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  key: {
    minWidth: 16,
    minHeight: 16,
    padding: 0,
    borderRadius: t.radius4,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
});
