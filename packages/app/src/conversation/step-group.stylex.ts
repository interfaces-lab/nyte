import { create } from "@stylexjs/stylex";
import { button, media, space } from "@nyte-ai/ui/styles/schema.stylex";
import { conversation } from "../theme/schema.stylex.ts";
import { appearance, motion, role } from "@nyte-ai/ui/styles/vars.stylex";

export const stepGroupStyles = create({
  root: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    contain: "layout",
    "--_group-chevron-opacity": {
      default: 0,
      ":hover": { [media.hover]: 1 },
      ":focus-within": 1,
    },
  },
  status: {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    gap: space.s1,
    width: "fit-content",
    maxWidth: "100%",
    minHeight: conversation.rowMinHeight,
    color: role.contentSecondary,
  },
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    width: "100%",
    maxWidth: "100%",
    minHeight: button.heightSm,
    minWidth: 0,
    textAlign: "start",
    color: role.contentSecondary,
    userSelect: "none",
    "--_group-chevron-color": {
      default: role.contentTertiary,
      ":hover": { [media.hover]: role.contentSecondary },
      "[data-panel-open]": role.contentSecondary,
    },
    "--_group-chevron-opacity": { default: null, "[data-panel-open]": 1 },
  },
  chevron: {
    marginInlineStart: space.s0_5,
    color: "var(--_group-chevron-color, currentcolor)",
    opacity: "var(--_group-chevron-opacity, 1)",
    transitionProperty: "transform, color, opacity",
    transitionDuration: {
      default: `${motion.durationNormal}, ${motion.durationFast}, ${motion.durationFast}`,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  verb: { flexShrink: 0 },
  summary: {
    minWidth: 0,
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  stats: {
    display: "inline-flex",
    gap: space.s1_5,
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: role.contentSecondary },
  removed: { color: role.contentSecondary },
  calls: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
    paddingBlockStart: space.s1_5,
  },
  earlier: { alignSelf: "flex-start" },
  panel: { position: "relative" },
  preview: {
    boxSizing: "border-box",
    maxHeight: 144,
    overflowX: "hidden",
    overflowY: "auto",
    cursor: appearance.cursorInteractive,
    overscrollBehavior: "auto",
    maskImage: {
      default: null,
      "[data-overflow]": "linear-gradient(to bottom, rgba(0, 0, 0, 0.15) 0px, black 32px)",
    },
  },
  thinking: {
    minWidth: 0,
    color: role.contentSecondary,
    opacity: 0.5,
    "--_prose-strong-color": "currentcolor",
  },
});
