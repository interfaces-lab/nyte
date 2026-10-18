import { create } from "@stylexjs/stylex";
import { media, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { conversation } from "../theme/schema.stylex.ts";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";

export const messageScrollerStyles = create({
  viewport: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflowX: "hidden",
    overflowY: "auto",
    overflowAnchor: "none",
    outlineStyle: "none",
    maskImage: {
      default: null,
      "[data-top-fade='true']": `linear-gradient(to bottom, transparent, black ${conversation.edgeFade})`,
    },
  },
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
    insetInlineStart: "50%",
    translate: "-50% 0",
    opacity: { default: 0, "[data-scroll-shown='true']": 1 },
    visibility: { default: "hidden", "[data-scroll-shown='true']": "visible" },
    pointerEvents: { default: "none", "[data-scroll-shown='true']": "auto" },
    transitionProperty: "opacity, visibility",
    transitionDuration: {
      default: "120ms",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: "ease-in-out",
  },
  buttonControl: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: role.borderSecondaryTranslucent,
      ":hover": { [media.hover]: role.borderPrimaryTranslucent },
    },
    backgroundColor: role.bgElevated,
    backgroundImage: {
      default: "none",
      ":hover": { [media.hover]: "none" },
      ":active": "none",
    },
    boxShadow: "none",
    transitionProperty: "border-color",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});
