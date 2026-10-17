/** What is running: the shimmering verb on a working row, and the status markers between turns. */
import { create, keyframes } from "@stylexjs/stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { conversation } from "../theme/schema.stylex.ts";
import { role } from "@nyte-ai/ui/styles/vars.stylex";

const activityShine = keyframes({
  "0%": { backgroundPosition: "200% 0" },
  "100%": { backgroundPosition: "-200% 0" },
});

const textShimmer = keyframes({
  from: { backgroundPosition: "100% 0" },
  to: { backgroundPosition: "-100% 0" },
});

const ACTIVITY_SHIMMER = `linear-gradient(90deg, ${role.contentSecondary} 0%, ${role.contentSecondary} 28%, ${role.contentPrimary} 58%, ${role.contentSecondary} 76%, ${role.contentSecondary} 100%)`;

export const activityStyles = create({
  shimmer: {
    animationName: {
      default: activityShine,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: {
      default: "2.4s",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    backgroundImage: {
      default: ACTIVITY_SHIMMER,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    backgroundSize: "200% 100%",
    backgroundClip: "text",
    color: {
      default: "transparent",
      "@media (prefers-reduced-motion: reduce)": role.contentSecondary,
    },
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
    backgroundImage: {
      default: ACTIVITY_SHIMMER,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    backgroundSize: "200% 100%",
    backgroundClip: {
      default: "text",
      "@media (prefers-reduced-motion: reduce)": "border-box",
    },
    WebkitBackgroundClip: {
      default: "text",
      "@media (prefers-reduced-motion: reduce)": "border-box",
    },
    WebkitTextFillColor: {
      default: "transparent",
      "@media (prefers-reduced-motion: reduce)": "unset",
    },
    animationName: {
      default: textShimmer,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "1s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});
