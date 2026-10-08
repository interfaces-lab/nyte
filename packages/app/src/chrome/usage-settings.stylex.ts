import { radius } from "@nyte-ai/ui/schema.stylex";
/**
 * Settings › Usage. The page is the settings surface it lives on: a total in
 * plain text, a curve, and lists in the same divided group every other settings
 * page uses. No nested cards, and no colour read off the document, so a theme
 * change repaints without measuring anything.
 */
import { create, keyframes } from "@stylexjs/stylex";
import { settings } from "../theme/schema.stylex.ts";
import { motion, role, shadow, type } from "@nyte-ai/ui/vars.stylex";

/** Tall enough for three lines to separate, short enough to stay under the total. */
const CHART_HEIGHT = 160;

/** The rail every line on the page starts from, matching the settings rows. */
const RAIL = 12;

export const usageStyles = create({
  page: { display: "flex", flexDirection: "column", gap: 12 },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    minHeight: settings.controlHeight,
    paddingInline: 8,
  },
  headingActions: { display: "flex", alignItems: "center", gap: 6 },
  hint: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  /** The name above a group, on the same rail as the rows inside it. */
  stack: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 },
  label: {
    margin: 0,
    paddingInline: 8,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontWeight: 400,
    lineHeight: type.leadingSm,
  },

  /** The one number the page is about, and the sentence that qualifies it. */
  headline: { display: "flex", flexDirection: "column", gap: 2, paddingInline: 8 },
  amount: {
    color: role.contentPrimary,
    fontSize: type.font2xl,
    fontWeight: 500,
    lineHeight: type.leadingLg,
    letterSpacing: type.letterLg,
  },
  meta: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  note: {
    margin: 0,
    paddingInline: 8,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  statusText: { color: role.contentSecondary },
  /** A number the history could not price reads as absent, never as free. */
  absent: { color: role.contentDisabled, fontWeight: 400 },

  /** What the tab would say if opened, so a glance at the strip is enough. */
  tabSummary: {
    color: role.contentSecondary,
    fontWeight: 400,
  },
  tabPanel: {
    display: { default: "flex", ":is([hidden])": "none" },
    flexDirection: "column",
    gap: settings.cardGap,
  },

  /** A strip inside a tab, on the rail. */
  subRoot: { display: "flex", flexDirection: "column", gap: settings.cardGap, minWidth: 0 },
  subList: { paddingInline: 8 },
  subPanel: {
    display: { default: "flex", ":is([hidden])": "none" },
    flexDirection: "column",
    gap: settings.cardGap,
  },

  /** Tokens per bucket. The legend names the lines; the axis carries the scale. */
  chart: { display: "flex", flexDirection: "column", gap: 6, paddingInline: 8 },
  chartLegend: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0 16px",
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  chartKey: { display: "inline-flex", alignItems: "center", gap: 6 },
  chartSwatch: { width: 10, height: 2, borderRadius: radius.pill },
  chartLine: { fill: "none", stroke: role.contentInteractiveTertiary },
  chartArea: { fill: role.bgInteractiveStrong },
  chartPlot: { height: CHART_HEIGHT, minWidth: 0 },
  chartTip: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "6px 8px",
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMd,
    color: role.contentPrimary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    whiteSpace: "nowrap",
  },
  chartTipLabel: { color: role.contentSecondary },
  chartTipRow: { display: "flex", justifyContent: "space-between", gap: 12 },

  /** A ranked list: one stacked bar, then the rows naming its segments. */
  group: {
    display: "flex",
    flexDirection: "column",
    overflow: "clip",
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
  },
  /**
   * The stacked bar sits in its own slot so the hairline under it lines up
   * with the row dividers, instead of the first name colliding with the rail.
   */
  barSlot: {
    position: "relative",
    paddingBlockStart: RAIL,
    paddingBlockEnd: 10,
    paddingInline: RAIL,
    "::after": {
      position: "absolute",
      insetInline: RAIL,
      insetBlockEnd: 0,
      height: 1,
      backgroundColor: role.borderSecondaryTranslucent,
      content: '""',
    },
  },
  bar: {
    display: "flex",
    gap: 2,
    height: 8,
    borderRadius: radius.pill,
    // One step above the group fill, so the unranked remainder is still a track.
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    overflow: "clip",
  },
  barSegment: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 2,
    borderRadius: 1,
    // A share moves when a history changes under it, so the segment slides.
    transitionProperty: "flex-basis",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },

  /**
   * One row. The name wraps rather than truncates: a chat title that needs a
   * second line is worth a second line, and nothing on this page is readable
   * only under the pointer.
   */
  row: {
    position: "relative",
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    minHeight: 38,
    paddingBlock: 8,
    paddingInline: RAIL,
    "::before": {
      position: "absolute",
      insetInline: RAIL,
      insetBlockStart: 0,
      height: 1,
      backgroundColor: role.borderSecondaryTranslucent,
      content: '""',
    },
    ":first-child::before": { display: "none" },
  },
  rowCopy: { display: "flex", flexDirection: "column", gap: 2, flex: "1 1 0", minWidth: 0 },
  /** The dot sits on the name's own line, centred against it rather than the row. */
  rowName: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    color: role.contentPrimary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    overflowWrap: "anywhere",
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill, flexShrink: 0 },
  rowMeta: {
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    overflowWrap: "anywhere",
  },
  /** The dot's width and gap, so a second line starts under the name, not the swatch. */
  rowMetaInset: { paddingInlineStart: 16 },
  rowValue: {
    flexShrink: 0,
    minWidth: 72,
    color: role.contentPrimary,
    fontSize: type.fontSm,
    fontWeight: 500,
    lineHeight: type.leadingSm,
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  rowShare: {
    flexShrink: 0,
    minWidth: 40,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  /** The unranked remainder: a caption, not an empty data row. */
  more: {
    position: "relative",
    margin: 0,
    paddingBlock: 8,
    paddingInline: RAIL,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    "::before": {
      position: "absolute",
      insetInline: RAIL,
      insetBlockStart: 0,
      height: 1,
      backgroundColor: role.borderSecondaryTranslucent,
      content: '""',
    },
  },
  series: { backgroundColor: role.bgInteractiveStrong },

  /** A subscription window: how much is gone, and when it comes back. */
  meter: { display: "flex", flexDirection: "column", gap: 4 },
  meterHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  meterTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    overflow: "clip",
  },
  meterFill: {
    display: "block",
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractiveStrong,
    transitionProperty: "width, background-color",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },

  /** A read that failed or found nothing, said once, where its numbers would be. */
  panel: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 148,
    padding: 24,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
    textAlign: "center",
  },
  panelTitle: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    textWrap: "balance",
  },
  panelBody: {
    maxWidth: 340,
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  panelActions: { display: "flex", alignItems: "center", gap: 6, marginTop: 4 },
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    margin: 0,
    paddingBlock: 6,
    paddingInline: 10,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  noticeIcon: {
    flexShrink: 0,
    // 14px glyph on 16px type: one pixel down sits on the first line's cap.
    marginBlockStart: 1,
    color: role.contentTertiary,
  },
  noticeIconAlert: { color: role.contentInteractiveTertiary },
  noticeCopy: { flex: 1, minWidth: 0, paddingBlockStart: 1 },
});

const bonePulse = keyframes({
  "0%, 100%": { opacity: 0.55 },
  "50%": { opacity: 1 },
});

/**
 * The page before its report lands. The frame is drawn for real and only the
 * marks that carry numbers are bones, so nothing jumps when they arrive.
 */
export const skeletonStyles = create({
  bone: {
    display: "inline-block",
    verticalAlign: "middle",
    flexShrink: 0,
    borderRadius: radius.indicator,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    animationName: { default: bonePulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  row: { display: "flex", flexDirection: "column", gap: 6, minHeight: 38, paddingBlock: 8 },
});
