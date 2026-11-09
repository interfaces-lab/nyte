import { create, keyframes } from "@stylexjs/stylex";
import { control, glyph, media, radius, space, toast } from "@nyte-ai/ui/styles/schema.stylex";
import { appearance, motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";

const LIST_MAX_HEIGHT = 392;

const SCROLL_FADE = space.s4;

const fade = (top: string, bottom: string): string =>
  `linear-gradient(to bottom, transparent, black ${top}, black calc(100% - ${bottom}), transparent)`;

const edgeFades = keyframes({
  "0%": { maskImage: fade("0px", SCROLL_FADE) },
  "1%": { maskImage: fade(SCROLL_FADE, SCROLL_FADE) },
  "99%": { maskImage: fade(SCROLL_FADE, SCROLL_FADE) },
  "100%": { maskImage: fade(SCROLL_FADE, "0px") },
});

const streamIn = keyframes({
  from: { opacity: 0, transform: `translateY(calc(-1 * ${space.s1}))` },
  to: { opacity: 1, transform: "none" },
});

export const needsYouListStyles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    width: `calc(${toast.width} - 2 * ${space.s2})`,
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    height: control.heightMd,
    marginBlockEnd: space.s1,
    paddingInline: space.s2,
  },
  heading: { margin: 0, fontWeight: type.weightSemibold },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    maxHeight: LIST_MAX_HEIGHT,
    marginInlineEnd: `calc(-1 * ${space.s2})`,
    paddingInlineEnd: space.s2,
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollbarWidth: "thin",
    animationName: edgeFades,
    animationTimeline: "scroll(self block)",
    animationTimingFunction: "linear",
    animationFillMode: "both",
  },
  entry: {
    position: "relative",
    flexShrink: 0,
    display: "grid",
    gridTemplateColumns: `${glyph.md} minmax(0, 1fr) auto`,
    gridTemplateAreas: `"glyph title trail" ". description description" ". action action"`,
    alignItems: "center",
    columnGap: space.s2,
    paddingBlockStart: space.s1,
    paddingBlockEnd: space.s2,
    paddingInline: space.s2,
    overflow: "clip",
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": { [media.hover]: role.fillTertiary },
      ":has(:focus-visible)": role.fillTertiary,
    },
    "--_reveal": {
      default: "0",
      ":hover": { [media.hover]: "1" },
      ":has(:focus-visible)": "1",
      "@media (hover: none), (pointer: coarse)": "1",
    },
    transitionProperty: "background-color",
    transitionDuration: motion.durationFast,
  },
  arriving: {
    animationName: { default: streamIn, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: motion.durationNormal,
    animationTimingFunction: motion.easeOutQuint,
  },
  target: {
    position: "absolute",
    inset: 0,
    margin: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: "inherit",
    backgroundColor: "transparent",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineOffset: -1,
    outlineColor: appearance.focusRing,
  },
  inert: { cursor: "default" },
  title: {
    gridArea: "title",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentSecondary,
    pointerEvents: "none",
  },
  unreadTitle: { color: role.contentPrimary, fontWeight: type.weightMedium },
  trail: {
    gridArea: "trail",
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    height: control.heightSm,
    color: role.contentTertiary,
    fontVariantNumeric: "tabular-nums",
    pointerEvents: "none",
    opacity: "calc(1 - var(--_reveal))",
  },
  dot: {
    width: space.s1_5,
    height: space.s1_5,
    borderRadius: radius.pill,
    backgroundColor: role.contentAccent,
  },
  dismiss: {
    position: "absolute",
    insetBlockStart: space.s1,
    insetInlineEnd: `calc(${space.s2} - (${control.heightSm} - ${glyph.sm}) / 2)`,
    opacity: "var(--_reveal)",
  },
  description: {
    gridArea: "description",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 3,
    overflow: "hidden",
    margin: 0,
    color: role.contentSecondary,
    overflowWrap: "anywhere",
    pointerEvents: "none",
  },
  action: {
    gridArea: "action",
    marginBlockStart: space.s1,
    color: role.contentAccent,
    fontWeight: type.weightMedium,
    pointerEvents: "none",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s8,
    color: role.contentTertiary,
  },
  emptyText: { margin: 0, color: role.contentSecondary },
  foot: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    height: control.heightMd,
    marginBlockStart: space.s1,
    paddingInline: space.s2,
    color: role.contentTertiary,
  },
  hint: { display: "inline-flex", alignItems: "center", gap: space.s1 },
});
