/** The transcript's scroll frame. */
import { create } from "@stylexjs/stylex";
import { media, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { conversation } from "../theme/schema.stylex.ts";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";

/**
 * The transcript's scroll frame. The viewport's rows dissolve at the top edge
 * and run on under the composer. A stuck prompt
 * covers that edge with its own opaque inset and turns the mask off: masking
 * the viewport would make the strip translucent again and let rows surface
 * above the prompt. Rows resize under the virtualizer's own corrections, so
 * the browser's anchoring stays out.
 */
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
  /**
   * The container's height is the virtualizer's total; items sit inside it at
   * their measured offsets. Top and bottom padding live in the virtualizer
   * (`paddingStart`/`paddingEnd`), the turn gap on each item.
   */
  content: {
    position: "relative",
    flexGrow: 1,
    flexShrink: 0,
    width: `min(${conversation.measure}, 100%)`,
    marginInline: "auto",
  },
  /**
   * `top` rather than a transform: the prompt inside is `position: sticky`,
   * and a transformed ancestor would pin it to the item instead of the
   * viewport. An item that renders nothing drops its gap like a missing flex
   * item would.
   */
  item: {
    position: "absolute",
    insetInline: 0,
    paddingInline: conversation.gutter,
    paddingTop: { default: conversation.turnGap, ":empty": 0 },
    contain: "layout",
  },
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
