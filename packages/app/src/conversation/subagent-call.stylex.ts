import { create } from "@stylexjs/stylex";
import { button, glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

export const subagentCallStyles = create({
  root: { display: "flex", flexDirection: "column", minWidth: 0 },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s2,
    width: "100%",
    minWidth: 0,
    paddingBlock: 0,
    paddingInline: 0,
    minHeight: button.heightSm,
    textAlign: "start",
  },
  header: { paddingBlock: space.s1_5 },
  nested: { display: "flex", flexDirection: "column", marginTop: space.s2_5 },
  nestedRow: { paddingBlock: space.s0_5, paddingInlineStart: space.s3 },
  indicator: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: glyph.lg,
    height: type.leadingLg,
    paddingLeft: space.s0_5,
  },
  dot: { width: 6, height: 6, borderRadius: radius.pill },
  attention: { backgroundColor: role.contentInteractiveTertiary },
  failed: { backgroundColor: role.bgInteractiveStrong },
  done: { backgroundColor: role.contentTertiary },
  text: {
    display: "flex",
    flex: "1 1 0",
    flexDirection: "column",
    gap: space.s0_5,
    minWidth: 0,
  },
  titleRow: { display: "flex", alignItems: "center", gap: space.s1_5, minWidth: 0 },
  title: {
    minWidth: 0,
    overflow: "hidden",
    color: role.contentPrimary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  model: {
    flexShrink: 2,
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  status: { display: "flex", minWidth: 0, color: role.contentSecondary },
  statusAttention: { color: role.contentSecondary },
});
