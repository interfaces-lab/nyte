import { create, keyframes } from "@stylexjs/stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { conversation } from "../../theme/schema.stylex.ts";
import { role } from "@nyte-ai/ui/styles/vars.stylex";

const pulse = keyframes({
  "0%, 100%": { color: role.contentSecondary },
  "50%": { color: role.contentTertiary },
});

const PULSE = {
  animationName: {
    default: pulse,
    "@media (prefers-reduced-motion: reduce)": "none",
  },
  animationDuration: "1.6s",
  animationTimingFunction: "ease-in-out",
  animationIterationCount: "infinite",
} as const;

export const activityStyles = create({
  shimmer: {
    color: role.contentSecondary,
    ...PULSE,
  },
});

export const markerStyles = create({
  default: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: conversation.rowMinHeight,
    paddingBlock: space.s0_5,
    color: role.contentSecondary,
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  destructive: {
    color: role.contentSecondary,
  },
  retrying: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    minHeight: conversation.rowMinHeight,
    paddingBlock: space.s0_5,
    gap: space.s2,
    color: role.contentSecondary,
  },
  shimmer: {
    minWidth: 0,
    ...PULSE,
  },
});
