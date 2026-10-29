import { button, glyph, media, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, keyframes } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { tab } from "../theme/schema.stylex.ts";

const fade = (start: string, end: string): string =>
  `linear-gradient(to right, transparent, black ${start}, black calc(100% - ${end}), transparent)`;

/** Driven by the strip's own scroll: an edge fades while more tabs lie past it. */
const edgeFades = keyframes({
  "0%": { maskImage: fade("0px", tab.stripEdgeFade) },
  "1%": { maskImage: fade(tab.stripEdgeFade, tab.stripEdgeFade) },
  "99%": { maskImage: fade(tab.stripEdgeFade, tab.stripEdgeFade) },
  "100%": { maskImage: fade(tab.stripEdgeFade, "0px") },
});

export const stripStyles = create({
  strip: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    flex: 1,
    minWidth: 0,
    height: "100%",
    WebkitAppRegion: "drag",
  },
  list: { display: "flex", flex: "0 1 auto", minWidth: 0, height: "100%" },
  scroller: {
    display: "flex",
    alignItems: "center",
    gap: space.s0_5,
    minWidth: 0,
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
    animationName: edgeFades,
    animationTimeline: "scroll(self inline)",
    animationTimingFunction: "linear",
    animationFillMode: "both",
  },
  slot: {
    display: "flex",
    flex: "0 1 auto",
    minWidth: tab.minWidth,
    maxWidth: tab.maxWidth,
    WebkitAppRegion: "no-drag",
  },
  tab: {
    "--_close-opacity": {
      default: "0",
      ":hover": { [media.hover]: "1" },
      ":focus-within": "1",
    },
    position: "relative",
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    height: button.heightMd,
    borderRadius: button.radiusMd,
    backgroundColor: {
      default: "transparent",
      ":hover": { [media.hover]: role.bgHover },
    },
    color: {
      default: role.contentSecondary,
      ":hover": { [media.hover]: role.contentPrimary },
    },
  },
  tabClosable: { paddingInlineEnd: space.s1 },
  tabPreview: { fontStyle: "italic" },
  tabActive: {
    backgroundColor: {
      default: role.surfaceMaterial,
      ":hover": { [media.hover]: role.surfaceMaterial },
    },
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
  },
  tabButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: space.s1_5,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    height: "100%",
    paddingBlock: 0,
    paddingInlineStart: space.s2_5,
    paddingInlineEnd: space.s1_5,
    borderRadius: button.radiusMd,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    letterSpacing: type.letterBase,
    cursor: "default",
    userSelect: "none",
  },
  tabButtonUnclosable: { paddingInlineEnd: space.s2_5 },
  glyph: {
    display: { default: "grid", ":empty": "none" },
    placeItems: "center",
    width: glyph.box,
    height: glyph.box,
    flexShrink: 0,
  },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  splitMark: { display: "inline-flex", flexShrink: 0, color: role.contentTertiary },
  unread: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: role.contentInteractiveTertiary,
  },
  close: { display: "inline-flex", flexShrink: 0, opacity: "var(--_close-opacity)" },
  closeVisible: { opacity: 1 },
  control: { display: "inline-flex", flexShrink: 0, WebkitAppRegion: "no-drag" },
  keys: { display: "inline-flex", gap: space.s0_5 },
});
