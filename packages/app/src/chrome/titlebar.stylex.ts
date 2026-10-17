import { create } from "@stylexjs/stylex";
import { button, layer, space } from "@nyte-ai/ui/styles/schema.stylex";
import { shell, sidebar, workbench } from "../theme/schema.stylex.ts";
import { role } from "@nyte-ai/ui/styles/vars.stylex";

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
    gap: space.s2,
    width: sidebar.width,
    minWidth: "max-content",
    height: "100%",
    flexShrink: 0,
    paddingInlineStart: `max(${shell.trafficLightInset}, 10px)`,
    paddingInlineEnd: space.s2,
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
  /** Without the workbench slot, the chat actions keep the slot's trailing inset so the glyph sits where the panel toggle would. */
  centerTrailing: { paddingInlineEnd: space.s2_5 },
  workbenchSlot: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    height: "100%",
    flexShrink: 1,
    paddingInlineEnd: space.s2_5,
  },
  workbenchSlotOpen: {
    width: workbench.activeWidth,
    paddingInlineStart: space.s1_5,
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
    paddingInlineStart: space.s3,
  },
  sessionTitleGroup: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
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
    gap: space.s1,
    flexShrink: 0,
    color: role.contentSecondary,
    whiteSpace: "nowrap",
  },
  sessionCrumbDivider: {
    flexShrink: 0,
    color: role.contentDisabled,
  },
  sessionTitle: {
    maxWidth: "min(420px, 50vw)",
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
