import { create } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { radius } from "@nyte-ai/ui/schema.stylex";

/** What Customize adds to the Settings patterns it is built from. */
export const customizeStyles = create({
  titleCopy: { flexDirection: "column", alignItems: "flex-start", gap: 4 },
  back: { alignSelf: "flex-start", marginBlockEnd: -24 },
  failed: { color: role.contentInteractivePrimary },
  trace: {
    margin: 0,
    padding: 12,
    overflowX: "auto",
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
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
