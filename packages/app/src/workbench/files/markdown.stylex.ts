import { create } from "@stylexjs/stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

export const markdownStyles = create({
  heading: { scrollMarginBlockStart: space.s4 },
  pre: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  taskItem: { position: "relative", listStyleType: "none" },
  checkbox: {
    position: "absolute",
    insetInlineStart: "-1.5em",
    insetBlockStart: "0.2em",
    margin: 0,
    accentColor: role.contentPrimary,
  },
  raw: {
    marginBlock: space.s2,
    marginInline: 0,
    paddingBlock: space.s1_5,
    paddingInline: space.s2_5,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  rawInline: {
    paddingInline: space.s0_5,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: "0.9em",
  },
});
