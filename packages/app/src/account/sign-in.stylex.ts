import { media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

/** The sign-in panels' rules: key entry and the device code. Settings › Models shares the key row. */
export const signInStyles = create({
  keyRow: { display: "flex", alignItems: "center", gap: space.s2 },
  keyInput: { flex: 1 },
  deviceCodePanel: { display: "flex", flexDirection: "column", gap: space.s2 },
  deviceCodeRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
  deviceCodeBox: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.s4,
    rowGap: space.s2,
    paddingInline: space.s3,
    paddingBlock: space.s2_5,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.strokeQuaternary,
    backgroundColor: role.bgBase,
  },
  deviceCode: {
    flexShrink: 0,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    letterSpacing: "0.12em",
    userSelect: "all",
    whiteSpace: "nowrap",
  },
  deviceCodeLead: {
    flex: "1 1 180px",
    minWidth: 0,
    color: role.contentSecondary,
    overflowWrap: "anywhere",
  },
  deviceCodeLink: {
    color: role.contentPrimary,
    textDecorationLine: {
      default: "none",
      ":hover": { [media.hover]: "underline" },
    },
    textUnderlineOffset: 3,
  },
  deviceCodeNote: {
    color: role.contentSecondary,
    overflowWrap: "anywhere",
  },
});
