import { create } from "@stylexjs/stylex";
import { tray } from "./schema.stylex.ts";
import { t } from "@nyte-ai/ui/vars.stylex";

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
    backgroundColor: t.composerBg,
    // The shadow alone disappears on a dark page; the outline's hairline is
    // what draws the tray's edge, as it does for tooltips and toasts.
    boxShadow: t.shadowMdOutline,
    color: t.contentSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: tray.headerHeight,
    paddingBlock: 8,
    paddingInline: tray.paddingInline,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: t.fontBase,
    fontWeight: 400,
    lineHeight: "20px",
    color: t.contentSecondary,
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
