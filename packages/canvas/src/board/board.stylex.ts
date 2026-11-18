import { create, keyframes } from "@stylexjs/stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";

const ZOOM = "var(--zoom, 1)";

const NAMED_FROM = 0.2;

const SPARE = `(var(--_room) * ${ZOOM} - ${type.leadingSm} - ${space.s1_5})`;

const LABEL_FITS = `min(clamp(0px, calc((${ZOOM} - ${NAMED_FROM}) * 1000000px), 100000px), clamp(0px, calc(${SPARE} * 1000), 100000px))`;

const LABEL_HIDDEN = `max(clamp(0px, calc((${NAMED_FROM} - ${ZOOM}) * 1000000px), 100000px), clamp(0px, calc(${SPARE} * -1000), 100000px))`;

const RINGED_FROM = 0.25;

const RINGED = `clamp(0, (${ZOOM} - ${RINGED_FROM}) * 1000000, 1)`;

const flash = keyframes({
  "0%": { opacity: 0 },
  "8%, 80%": { opacity: 1 },
  "100%": { opacity: 0 },
});

/**
 * The board's own chrome. It lives in the board's shadow root, where no design's stylesheet can select it; the
 * board writes its zoom into --zoom, and labels, rings and tags divide by it to stay one size on screen. Selection,
 * typing and an agent's change share one ring, in the app's accent or the agent's orange; zoomed far out, an agent's
 * change is a dot in the frame's corner, under its label.
 */
export const boardStyles = create({
  stage: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    cursor: "default",
    touchAction: "none",
    userSelect: "none",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    outlineStyle: "none",
  },
  panning: { cursor: "grabbing" },
  world: { position: "absolute", insetBlockStart: 0, insetInlineStart: 0, transformOrigin: "0 0" },
  layer: { position: "absolute", insetBlockStart: 0, insetInlineStart: 0, pointerEvents: "none" },
  box: {
    position: "absolute",
    pointerEvents: "none",
    boxShadow: `0 0 0 calc(1px / ${ZOOM}) ${role.strokeTertiary}, ${shadow.shadowSm}`,
  },
  room: (pixels: number) => ({ "--_room": `${String(pixels)}px` }),
  label: {
    position: "absolute",
    insetBlockEnd: "100%",
    insetInlineStart: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, auto) auto",
    minWidth: "min-content",
    maxWidth: `calc(100% * ${ZOOM})`,
    maxHeight: LABEL_FITS,
    paddingBlockEnd: `min(${space.s1_5}, ${LABEL_FITS})`,
    overflow: "hidden",
    color: role.contentTertiary,
    whiteSpace: "nowrap",
    transform: `scale(calc(1 / ${ZOOM}))`,
    transformOrigin: "0 100%",
    pointerEvents: "auto",
    cursor: "grab",
  },
  labelName: { overflow: "hidden", textOverflow: "ellipsis" },
  labelVariant: { whiteSpace: "pre" },
  labelFixed: { cursor: "default" },
  labelLit: { color: role.contentAccent },
  name: {
    position: "absolute",
    insetBlockEnd: "100%",
    insetInlineStart: 0,
    maxWidth: LABEL_HIDDEN,
    overflow: "hidden",
    transform: `scale(calc(1 / ${ZOOM}))`,
    transformOrigin: "0 100%",
    pointerEvents: "none",
  },
  nameText: {
    display: "block",
    marginBlockEnd: space.s1,
    paddingInline: space.s1_5,
    color: role.contentPrimary,
    whiteSpace: "nowrap",
    backgroundColor: role.bgElevated,
    borderRadius: radius.indicator,
    boxShadow: `inset 0 0 0 1px ${role.strokeTertiary}`,
  },
  ring: {
    position: "absolute",
    pointerEvents: "none",
    borderRadius: `calc(${radius.indicator} / ${ZOOM})`,
    outlineStyle: "solid",
    outlineColor: role.strokeAccent,
    outlineWidth: `calc(1.5px / ${ZOOM})`,
    outlineOffset: `calc(1px / ${ZOOM})`,
  },
  hovered: { outlineColor: `color-mix(in srgb, ${role.strokeAccent} 50%, transparent)` },
  glow: { inset: 0, opacity: 0, outlineWidth: `calc(1.5px / ${ZOOM} * ${RINGED})` },
  glowLit: {
    animationName: flash,
    animationDuration: "2.5s",
    animationTimingFunction: {
      default: motion.easeOut,
      "@media (prefers-reduced-motion: reduce)": "step-start",
    },
  },
  dot: {
    position: "absolute",
    insetBlockStart: `calc(${space.s1} / ${ZOOM})`,
    insetInlineStart: `calc(${space.s1} / ${ZOOM})`,
    width: `calc(${space.s1_5} / ${ZOOM})`,
    height: `calc(${space.s1_5} / ${ZOOM})`,
    opacity: `clamp(0, (${RINGED_FROM} - ${ZOOM}) * 1000000, 1)`,
    borderRadius: radius.pill,
    backgroundColor: role.strokeAccent,
  },
  held: { position: "absolute", inset: 0, pointerEvents: "none", boxShadow: shadow.shadowXl },
  raised: { zIndex: 1 },
  tag: {
    position: "absolute",
    insetBlockStart: "100%",
    insetInlineStart: 0,
    paddingBlockStart: space.s1_5,
    transform: `scale(calc(1 / ${ZOOM}))`,
    transformOrigin: "0 0",
    pointerEvents: "none",
  },
  tagText: {
    display: "block",
    paddingInline: space.s1_5,
    color: role.contentOnInteractiveStrong,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    backgroundColor: role.strokeAccent,
    borderRadius: radius.indicator,
  },
  readOnly: { color: role.contentSecondary, backgroundColor: role.bgElevated },
  failure: {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    paddingBlock: space.s2_5,
    paddingInline: space.s3,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: role.strokeSecondary,
    color: role.contentSecondary,
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  },
});
