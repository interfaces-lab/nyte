import { create } from "@stylexjs/stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { conversation } from "../../theme/schema.stylex.ts";

export const messageScrollerStyles = create({
  frame: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
  },
  viewport: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflowX: "hidden",
    overflowY: "auto",
    overflowAnchor: "none",
    outlineStyle: "none",
    "--_top-fade": { default: "0px", "[data-top-fade='true']": conversation.edgeFade },
    maskImage:
      "linear-gradient(to bottom, transparent, black var(--_top-fade), black calc(100% - var(--_dock-height, 0px) - var(--_dock-fade, 0px)), transparent calc(100% - var(--_dock-height, 0px)))",
  },
  /** Fades messages out above the composer into the surface itself, which an opaque backdrop can't match over the window's material. */
  docked: (height: number) => ({
    "--_dock-height": `${height}px`,
    "--_dock-fade": conversation.edgeFade,
  }),
  content: {
    position: "relative",
    flexGrow: 1,
    flexShrink: 0,
    width: `min(${conversation.measure}, 100%)`,
    marginInline: "auto",
  },
  item: {
    position: "absolute",
    insetInline: 0,
    paddingInline: conversation.gutter,
    paddingTop: { default: conversation.turnGap, ":empty": 0 },
    contain: "layout",
  },
  itemWithin: { paddingTop: { default: conversation.rowGap, ":empty": 0 } },
  itemSticky: { zIndex: 1 },
  span: { pointerEvents: "none" },
  itemFirst: { paddingTop: 0 },
  button: {
    position: "absolute",
    insetBlockEnd: 0,
    left: "50%",
    translate: "-50% 0",
    opacity: { default: 0, "[data-scroll-shown='true']": 1 },
    visibility: { default: "hidden", "[data-scroll-shown='true']": "visible" },
    pointerEvents: { default: "none", "[data-scroll-shown='true']": "auto" },
    transitionProperty: "opacity, visibility",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

export const dividerStyles = create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s1,
    color: role.contentInteractivePrimary,
  },
  rule: {
    flex: 1,
    height: space.px,
    backgroundColor: "currentColor",
  },
  label: { fontWeight: type.weightMedium },
});
