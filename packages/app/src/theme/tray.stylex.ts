import { create } from "@stylexjs/stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { tray } from "./schema.stylex.ts";
import { role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";

/** Shared frame for the queue, background agents, and terminal trays. */
export const trayStyles = create({
  surface: {
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minWidth: 0,
    overflow: "clip",
    borderRadius: tray.radius,
    backgroundColor: role.bgElevated,
    /**
     * The shadow alone disappears on a dark page; the outline's hairline is
     * what draws the tray's edge, as it does for tooltips and toasts.
     */
    boxShadow: shadow.shadowMdOutline,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: tray.headerHeight,
    paddingBlock: space.s2,
    paddingInline: tray.paddingInline,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: type.fontBase,
    fontWeight: type.weightRegular,
    lineHeight: type.leadingBase,
    color: role.contentSecondary,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.px,
    minWidth: 0,
    minHeight: 0,
    paddingTop: space.s1,
    paddingBottom: space.s1_5,
    paddingInline: tray.rowInset,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
});
