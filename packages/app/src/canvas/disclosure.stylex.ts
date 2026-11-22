import { create } from "@stylexjs/stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { conversation } from "../theme/schema.stylex.ts";

/** A collapsible block in a conversation: a toggle row that opens an indented, ruled body. */
export const disclosureStyles = create({
  toggle: {
    width: "fit-content",
    minHeight: conversation.rowMinHeight,
  },
  root: { display: "flex", flexDirection: "column", minWidth: 0 },
  body: {
    boxSizing: "border-box",
    width: "100%",
    marginTop: space.s1,
    paddingBlock: space.s0_5,
    paddingInlineStart: space.s3,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.strokeTertiary,
    color: role.contentSecondary,
  },
});
