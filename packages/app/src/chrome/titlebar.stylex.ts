import { create } from "@stylexjs/stylex";
import { button, layer } from "@nyte-ai/ui/schema.stylex";
import { shell, sidebar, workbench } from "../theme/schema.stylex.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";

/**
 * One row of three slots, each sized by the token its stage column already
 * uses, so the chrome lines up with the columns beneath it by construction.
 */
export const titlebarStyles = create({
  bar: {
    position: "relative",
    zIndex: layer.chrome,
    display: "flex",
    alignItems: "center",
    height: shell.titlebarHeight,
    minHeight: button.heightMd,
    flexShrink: 0,
    WebkitAppRegion: "drag",
  },
  /** The traffic-light lane is 0 off macOS and in fullscreen, so the row's own 10px wins there. */
  sidebarSlot: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: sidebar.width,
    minWidth: "max-content",
    height: "100%",
    flexShrink: 0,
    paddingInlineStart: `max(${shell.trafficLightInset}, 10px)`,
    paddingInlineEnd: 8,
  },
  sidebarSlotHidden: { width: "auto" },
  contentArea: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    height: "100%",
    backgroundColor: role.bgBase,
  },
  contentAreaTabbed: { backgroundColor: "transparent" },
  /** Tabs or title and the chat actions; it yields first when the workbench overlays the center. */
  center: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    height: "100%",
    overflow: "clip",
  },
  workbenchSlot: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    height: "100%",
    flexShrink: 1,
    paddingInlineEnd: 10,
  },
  workbenchSlotOpen: {
    width: workbench.activeWidth,
    paddingInlineStart: 6,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.borderSecondaryTranslucent,
    boxShadow: `inset 0 -1px ${role.borderSecondaryTranslucent}`,
  },
  /** Window tabs: the panel sits inside the inset card, so the slot runs from its edge to the window's. */
  workbenchSlotOpenTabbed: {
    width: `calc(${workbench.activeWidth} + ${shell.cardInset})`,
    borderInlineStartWidth: 0,
    boxShadow: "none",
  },
  actionTrack: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: button.heightMd,
    height: button.heightMd,
    flexShrink: 0,
    WebkitAppRegion: "no-drag",
  },
  historyControl: {
    display: "inline-flex",
    flexDirection: "column",
    flexShrink: 0,
    width: button.heightMd,
    height: button.heightMd,
    overflow: "clip",
    overflowClipMargin: 2,
    WebkitAppRegion: "no-drag",
  },
  historyControlBack: { marginInlineStart: "auto" },
  control: { display: "inline-flex", flexShrink: 0, WebkitAppRegion: "no-drag" },
  titleSlot: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    paddingInlineStart: 12,
  },
  sessionTitleGroup: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  sessionBack: {
    display: "inline-flex",
    flexShrink: 0,
    WebkitAppRegion: "no-drag",
  },
  /** A step of the chat's location: the title's type, one tone quieter. */
  sessionCrumb: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    whiteSpace: "nowrap",
  },
  sessionCrumbDivider: {
    flexShrink: 0,
    color: role.contentDisabled,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  sessionTitle: {
    maxWidth: "min(420px, 50vw)",
    overflow: "hidden",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
