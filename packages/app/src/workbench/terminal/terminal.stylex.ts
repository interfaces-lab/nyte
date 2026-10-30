import { create } from "@stylexjs/stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";

export const terminalStyles = create({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: role.bgBase,
  },
  body: { position: "relative", flex: 1, minHeight: 0, minWidth: 0 },
  panel: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    outlineStyle: "none",
    backgroundColor: role.bgBase,
  },
  canvas: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    paddingBlock: space.s2,
    paddingInline: space.s1_5,
    overflow: "clip",
  },
  state: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    color: role.contentSecondary,
  },
  failure: { color: role.contentSecondary },
  empty: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s3,
    padding: space.s6,
    color: role.contentSecondary,
    textAlign: "center",
  },
});
