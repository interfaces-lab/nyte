import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { create, keyframes } from "@stylexjs/stylex";

const sweep = keyframes({
  "0%": { opacity: 0 },
  "5%": { opacity: 1 },
  "28%": { opacity: 0.22 },
  "55%": { opacity: 0 },
  "100%": { opacity: 0 },
});

const settle = keyframes({
  "0%": { opacity: 0, transform: "scale(0.6)" },
  "100%": { opacity: 1, transform: "scale(1)" },
});

const breathe = keyframes({
  "0%": { opacity: 1 },
  "100%": { opacity: 0.4 },
});

const dissolve = keyframes({
  "0%": { opacity: 1, transform: "scale(1)" },
  "35%": { opacity: 1, transform: "scale(1.25)" },
  "100%": { opacity: 0, transform: "scale(0.3)" },
});

const fade = keyframes({
  "0%": { opacity: 1 },
  "100%": { opacity: 0 },
});

const REDUCED = "@media (prefers-reduced-motion: reduce)";

const VIVID = `oklch(from ${role.chartSeries} calc(l + 0.04) calc(c * 1.4) h)`;

export const storageStyles = create({
  meter: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s4,
  },
  dots: {
    display: "grid",
    gridAutoFlow: "column",
    gridTemplateRows: "repeat(6, auto)",
    gap: space.s1,
  },
  dot: {
    position: "relative",
    aspectRatio: "1",
    minWidth: 0,
    borderRadius: radius.indicator,
    backgroundColor: role.fillTertiary,
    transitionProperty: "background-color",
    transitionDuration: motion.durationSlow,
    transitionTimingFunction: "ease",
    "::after": {
      position: "absolute",
      inset: 0,
      borderRadius: radius.indicator,
      backgroundColor: VIVID,
      content: '""',
      opacity: 0,
    },
  },
  used: { backgroundColor: role.fillPrimary },
  heat1: { backgroundColor: `color-mix(in oklab, ${VIVID} 34%, ${role.fillTertiary})` },
  heat2: { backgroundColor: `color-mix(in oklab, ${VIVID} 55%, ${role.fillTertiary})` },
  heat3: { backgroundColor: `color-mix(in oklab, ${VIVID} 78%, ${role.fillTertiary})` },
  heat4: { backgroundColor: VIVID },
  scanning: {
    "::after": {
      animationName: { default: sweep, [REDUCED]: "none" },
      animationDuration: "2.4s",
      animationTimingFunction: "linear",
      animationIterationCount: "infinite",
      animationFillMode: "backwards",
    },
  },
  settling: {
    animationName: { default: settle, [REDUCED]: "none" },
    animationDuration: "360ms",
    animationTimingFunction: motion.easeOutQuint,
    animationFillMode: "backwards",
  },
  working: {
    animationName: { default: breathe, [REDUCED]: "none" },
    animationDuration: "0.7s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
  },
  freed: {
    "::after": {
      animationName: { default: dissolve, [REDUCED]: fade },
      animationDuration: { default: "520ms", [REDUCED]: "200ms" },
      animationTimingFunction: motion.easeOutQuint,
      animationFillMode: "backwards",
    },
  },
  delay: (ms: number) => ({
    animationDelay: { default: `${String(ms)}ms`, [REDUCED]: "0ms" },
    transitionDelay: { default: `${String(ms)}ms`, [REDUCED]: "0ms" },
    "::after": { animationDelay: { default: `${String(ms)}ms`, [REDUCED]: "0ms" } },
  }),
  legend: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s4,
    color: role.contentTertiary,
  },
  legendEntry: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
  },
  swatch: {
    width: space.s2_5,
    height: space.s2_5,
    borderRadius: radius.indicator,
    backgroundColor: role.fillTertiary,
  },
  ramp: { display: "inline-flex", gap: space.s0_5 },
  disk: {
    marginInlineStart: "auto",
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  size: {
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  control: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
  },
  items: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    width: "100%",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  item: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s3,
    minWidth: 0,
  },
  itemCopy: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    overflow: "hidden",
    color: role.contentPrimary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemDetail: {
    overflow: "hidden",
    color: role.contentTertiary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemCleaned: {
    color: role.contentTertiary,
    textDecorationLine: "line-through",
  },
  count: { fontVariantNumeric: "tabular-nums", fontWeight: type.weightMedium },
});
