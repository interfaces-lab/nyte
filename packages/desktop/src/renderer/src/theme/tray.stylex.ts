import { create } from "@stylexjs/stylex";
import { tray } from "./schema.stylex.ts";
import { t } from "./vars.stylex.ts";

/** Shared frame for the queue, background agents, and terminal trays. */
export const trayStyles = create({
  surface: {
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
    borderRadius: tray.radius,
    backgroundColor: t.trayBg,
    // The soft shadow alone disappears on a dark page; the inset hairline is
    // what draws the tray's edge, as menus and tooltips do.
    boxShadow: `${t.trayShadow}, inset 0 0 0 1px ${t.strokeTertiary}`,
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: tray.lineHeight,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: tray.headerHeight,
    paddingInline: tray.paddingInline,
    paddingTop: 8,
    paddingBottom: 0,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 400,
    lineHeight: "20px",
    fontVariantNumeric: "tabular-nums",
    color: t.textSecondary,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minWidth: 0,
    minHeight: 0,
    paddingTop: 4,
    paddingBottom: 6,
    paddingInline: tray.rowInset,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
});
