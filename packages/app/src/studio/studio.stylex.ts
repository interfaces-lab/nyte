import { create } from "@stylexjs/stylex";
import { control, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { workbench } from "../theme/schema.stylex.ts";

const NARROW = "@container (width < 760px)";

/** Styles of the design panel: its toolbar, the frame the board runs in, and the list of designs. */
export const studioStyles = create({
  boardBox: { position: "relative", flex: 1, minWidth: 0, minHeight: 0 },
  board: {
    position: "absolute",
    inset: 0,
    display: "block",
    width: "100%",
    height: "100%",
    borderWidth: 0,
    backgroundColor: role.bgBase,
  },
  stills: { position: "absolute", inset: 0, overflow: "clip", pointerEvents: "none" },
  still: {
    position: "absolute",
    // oxlint-disable-next-line nyte-design/logical-properties -- the board reports physical viewport coordinates
    left: 0,
    top: 0,
    objectFit: "cover",
    objectPosition: "0 0",
    transformOrigin: "0 0",
  },
  panel: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    containerType: "inline-size",
  },
  column: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space.s1,
    height: control.heightXl,
    flexShrink: 0,
    paddingInline: space.s2,
  },
  listToggle: { display: { default: "none", [NARROW]: "contents" } },
  leading: { marginInlineEnd: "auto" },
  empty: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s2,
    padding: space.s6,
    color: role.contentSecondary,
    textAlign: "center",
    textWrap: "pretty",
  },
  emptyTitle: { margin: 0, color: role.contentPrimary, fontWeight: type.weightMedium },
  emptyBody: { margin: 0 },
  emptyAction: { marginBlockStart: space.s2 },
  sidebar: {
    display: { default: "flex", [NARROW]: "none" },
    flexDirection: "column",
    gap: space.px,
    width: workbench.fileListWidth,
    flexShrink: 0,
    minHeight: 0,
    padding: space.s2,
    overflowY: "auto",
  },
  sidebarOpen: { display: "flex" },
  heading: {
    display: "flex",
    alignItems: "center",
    minHeight: control.heightSm,
    margin: 0,
    paddingInline: row.paddingInlineMd,
    color: role.contentTertiary,
    fontWeight: type.weightMedium,
  },
  zoom: { minWidth: "4rem" },
});
