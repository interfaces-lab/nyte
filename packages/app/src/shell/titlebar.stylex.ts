import { create } from "@stylexjs/stylex";
import { control, layer, space, target } from "@nyte-ai/ui/styles/schema.stylex";
import { shell, sidebar, workbench } from "../theme/schema.stylex.ts";
import { role } from "@nyte-ai/ui/styles/vars.stylex";

export const titlebarStyles = create({
  bar: {
    position: "relative",
    zIndex: layer.chrome,
    display: "flex",
    alignItems: "center",
    height: shell.titlebarHeight,
    minHeight: control.heightMd,
    flexShrink: 0,
    WebkitAppRegion: "drag",
  },
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
    transitionProperty: "width",
    transitionDuration: sidebar.resizeDuration,
    transitionTimingFunction: sidebar.resizeEasing,
  },
  sidebarSlotHidden: { width: 0, transitionDelay: sidebar.resizeDelay },
  appSlot: { display: "flex" },
  /**
   * Beside a docked sidebar, the app switcher takes the room the sidebar's width leaves and adds none to the slot,
   * so the slot never outgrows the sidebar and the panes stay under their titlebar controls at every zoom.
   */
  appSlotDocked: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    overflowX: "clip",
    contain: "inline-size",
  },
  contentArea: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    height: "100%",
    backgroundColor: role.surfaceMaterial,
  },
  contentAreaTabbed: { backgroundColor: "transparent" },
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
    gap: target.gap,
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
    borderInlineStartColor: role.strokeQuaternary,
    boxShadow: `inset 0 -1px ${role.strokeQuaternary}`,
  },
  workbenchSlotOpenTabbed: {
    width: `calc(${workbench.activeWidth} + ${shell.cardInset})`,
    borderInlineStartWidth: 0,
    boxShadow: "none",
  },
  splitGroup: { display: "flex", alignItems: "center", gap: target.gap },
  trailing: {
    display: "flex",
    alignItems: "center",
    gap: target.gap,
    flexShrink: 0,
    height: "100%",
    paddingInlineEnd: space.s2_5,
  },
  actionTrack: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: control.heightMd,
    height: control.heightMd,
    flexShrink: 0,
    WebkitAppRegion: "no-drag",
  },
  control: { display: "inline-flex", flexShrink: 0, WebkitAppRegion: "no-drag" },
  /** An inactive window's titlebar dims as the system's own controls do; tertiary is the lowest step text may take. */
  windowInactive: {
    "--nyte-content-primary": role.contentTertiary,
    "--nyte-content-secondary": role.contentTertiary,
  },
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
  sessionTitle: {
    maxWidth: "min(420px, 50vw)",
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
