import { create } from "@stylexjs/stylex";
import { menu, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { conversation } from "../theme/schema.stylex.ts";

export const contextStyles = create({
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
  },
  controlLayout: { minWidth: 0, maxWidth: 280, flexShrink: 1 },
  footerLayout: { maxWidth: conversation.composerFooterSegmentMaxWidth },
  text: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  icon: { display: "inline-flex", flexShrink: 0 },
  menu: {
    minWidth: `min(${menu.width}, var(--available-width))`,
    maxWidth: `min(${menu.width}, var(--available-width))`,
    maxHeight: `min(${menu.maxHeight}, var(--available-height))`,
  },
  hint: {
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    maxWidth: "min(400px, calc(100vw - 16px))",
    paddingBlock: space.s1_5,
    paddingInline: space.s2_5,
  },
  hintHeading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
    color: role.contentPrimary,
    whiteSpace: "nowrap",
  },
  hintValue: { color: role.contentSecondary },
  keys: { display: "inline-flex", alignItems: "center", gap: space.s0_5, flexShrink: 0 },
});
