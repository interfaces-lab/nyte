import { create } from "@stylexjs/stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

export const NEEDS_YOU_ANCHOR = "--nyte-needs-you";

export const needsYouStyles = create({
  anchor: { position: "relative", display: "inline-flex", anchorName: NEEDS_YOU_ANCHOR },
  badge: {
    position: "absolute",
    insetBlockStart: `calc(-1 * ${space.s0_5})`,
    insetInlineEnd: `calc(-1 * ${space.s0_5})`,
    minWidth: type.leadingXs,
    height: type.leadingXs,
    paddingInline: space.s1,
    boxSizing: "border-box",
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractiveStrong,
    boxShadow: `0 0 0 2px ${role.surfaceMaterial}`,
    color: role.contentOnInteractiveStrong,
    fontWeight: type.weightSemibold,
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
    pointerEvents: "none",
  },
  urgent: { backgroundColor: role.buttonFill },
});
