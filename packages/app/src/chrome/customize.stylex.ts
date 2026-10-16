import { create } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";

/** What Customize adds to the Settings patterns it is built from. */
export const customizeStyles = create({
  titleCopy: { flexDirection: "column", alignItems: "flex-start", gap: space.s1 },
  back: { alignSelf: "flex-start", marginBlockEnd: `calc(${space.s6} * -1)` },
  failed: { color: role.contentInteractivePrimary },
  trace: {
    margin: 0,
    padding: space.s3,
    overflowX: "auto",
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  value: { color: role.contentSecondary },
  loadingLine: {
    width: "42%",
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
  },
});
