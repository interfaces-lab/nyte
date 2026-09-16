/**
 * Settings › Usage. The page is the settings surface it lives on: a total in
 * plain text, a trend, and lists in the same divided group every other settings
 * page uses. No nested cards, and no colour read off the document, so a theme
 * change repaints without measuring anything.
 */
import * as stylex from "@stylexjs/stylex";
import { settings } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

/** Tall enough to read a shape, short enough to stay under the numbers it serves. */
const TREND_HEIGHT = 44;

/** The rail every line on the page starts from, matching the settings rows. */
const RAIL = 12;

export const usageStyles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: settings.sectionGap },
  section: { display: "flex", flexDirection: "column", gap: settings.cardGap },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    minHeight: settings.headingHeight,
    paddingInline: 8,
  },
  headingCopy: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  headingTitle: { textWrap: "balance" },
  headingActions: { display: "flex", alignItems: "center", gap: 6 },
  hint: {
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    textWrap: "pretty",
  },
  /** The name above a group, on the same rail as the rows inside it. */
  stack: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 },
  label: {
    margin: 0,
    paddingInline: 8,
    color: t.textSecondary,
    fontSize: t.fontSm,
    fontWeight: 400,
    lineHeight: t.leadingSm,
  },

  segments: {
    display: "inline-flex",
    alignItems: "center",
    gap: 1,
    padding: 2,
    borderRadius: t.radiusLg,
    backgroundColor: t.fillSecondary,
    boxShadow: `inset 0 0 0 1px ${t.strokeSecondary}`,
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    // 2px group padding + 24px chip = 28px, the same height as Refresh.
    height: settings.controlHeight,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover:not([data-pressed])": t.fillGhostHover,
      "[data-pressed]": t.bgElevated,
    },
    boxShadow: { default: "none", "[data-pressed]": t.shadowControlColor },
    color: { default: t.textTertiary, "[data-pressed]": t.textPrimary },
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    scale: { default: "1", ":active": "0.96" },
    transitionProperty: "background-color, color, scale",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
    "@media (prefers-reduced-motion: reduce)": { scale: "1" },
  },

  /** The one number the page is about, and the sentence that qualifies it. */
  headline: { display: "flex", flexDirection: "column", gap: 2, paddingInline: 8 },
  amount: {
    color: t.textPrimary,
    fontSize: t.font2xl,
    fontWeight: 500,
    lineHeight: t.leadingLg,
    letterSpacing: t.letterLg,
    fontVariantNumeric: "tabular-nums",
  },
  meta: {
    margin: 0,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    textWrap: "pretty",
  },
  note: {
    margin: 0,
    paddingInline: 8,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    textWrap: "pretty",
  },
  changeUp: { color: t.textWarning },
  changeDown: { color: t.textSuccess },
  /** A number the history could not price reads as absent, never as free. */
  absent: { color: t.textQuaternary, fontWeight: 400 },

  /** Spend per bucket. The caption carries the numbers the bars only shape. */
  trend: { display: "flex", flexDirection: "column", gap: 6, paddingInline: 8 },
  trendBars: {
    display: "flex",
    alignItems: "flex-end",
    gap: 2,
    height: TREND_HEIGHT,
  },
  trendBar: {
    flex: "1 1 0",
    minWidth: 2,
    minHeight: 2,
    borderRadius: 2,
    // Idle days stay on the fill ramp so a zero does not read as a sliver of spend.
    backgroundColor: t.fillGhostHover,
  },
  trendSpent: { backgroundColor: t.fillAccentSubtle },
  /** The tallest bucket keeps the full accent, so the peak is visible, not hovered. */
  trendPeak: { backgroundColor: t.accent },
  trendCaption: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "0 12px",
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    fontVariantNumeric: "tabular-nums",
  },

  /** A ranked list: one stacked bar, then the rows naming its segments. */
  group: {
    display: "flex",
    flexDirection: "column",
    overflow: "clip",
    borderRadius: t.radiusXl,
    backgroundColor: t.fillSecondary,
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
      backgroundColor: t.strokeQuaternary,
      content: '""',
    },
  },
  bar: {
    display: "flex",
    gap: 2,
    height: 8,
    borderRadius: t.radiusFull,
    // One step above the group fill, so the unranked remainder is still a track.
    backgroundColor: t.fillGhostHover,
    overflow: "hidden",
  },
  barSegment: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 2,
    borderRadius: 1,
    // A share moves when a history changes under it, so the segment slides.
    transitionProperty: "flex-basis",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
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
      backgroundColor: t.strokeQuaternary,
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
    color: t.textPrimary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    overflowWrap: "anywhere",
  },
  dot: { width: 8, height: 8, borderRadius: t.radiusFull, flexShrink: 0 },
  rowMeta: {
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    fontVariantNumeric: "tabular-nums",
    overflowWrap: "anywhere",
  },
  /** The dot's width and gap, so a second line starts under the name, not the swatch. */
  rowMetaInset: { paddingInlineStart: 16 },
  rowValue: {
    flexShrink: 0,
    minWidth: 72,
    color: t.textPrimary,
    fontSize: t.fontSm,
    fontWeight: 500,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  rowShare: {
    flexShrink: 0,
    minWidth: 40,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  /** The unranked remainder: a caption, not an empty data row. */
  more: {
    position: "relative",
    margin: 0,
    paddingBlock: 8,
    paddingInline: RAIL,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    "::before": {
      position: "absolute",
      insetInline: RAIL,
      insetBlockStart: 0,
      height: 1,
      backgroundColor: t.strokeQuaternary,
      content: '""',
    },
  },
  series0: { backgroundColor: t.accent },
  series1: { backgroundColor: t.purple },
  series2: { backgroundColor: t.cyan },
  series3: { backgroundColor: t.orange },
  series4: { backgroundColor: t.green },
  series5: { backgroundColor: t.magenta },

  /** A subscription window: how much is gone, and when it comes back. */
  meter: { display: "flex", flexDirection: "column", gap: 4 },
  meterHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  meterHigh: { color: t.textWarning },
  meterTrack: {
    height: 6,
    borderRadius: t.radiusFull,
    backgroundColor: t.fillGhostHover,
    overflow: "hidden",
  },
  meterFill: {
    display: "block",
    height: "100%",
    borderRadius: t.radiusFull,
    backgroundColor: t.accent,
    transitionProperty: "width",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  /** Near the ceiling the bar changes colour, and so does the number beside it. */
  meterFillHigh: { backgroundColor: t.textWarning },

  /** A read that failed or found nothing, said once, where its numbers would be. */
  panel: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 148,
    padding: 24,
    borderRadius: t.radiusXl,
    backgroundColor: t.fillSecondary,
    textAlign: "center",
  },
  panelTitle: {
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    textWrap: "balance",
  },
  panelBody: {
    maxWidth: 340,
    margin: 0,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
  panelActions: { display: "flex", alignItems: "center", gap: 6, marginTop: 4 },
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    margin: 0,
    minHeight: 30,
    paddingBlock: 6,
    paddingInline: 10,
    borderRadius: t.radiusLg,
    backgroundColor: t.fillSecondary,
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
  noticeIcon: {
    flexShrink: 0,
    // 14px glyph on 16px type: one pixel down sits on the first line's cap.
    marginBlockStart: 1,
    color: t.iconTertiary,
  },
  noticeIconAlert: { color: t.textWarning },
  noticeCopy: { flex: 1, minWidth: 0, paddingBlockStart: 1 },
  noticeAction: {
    flexShrink: 0,
    minHeight: 24,
    paddingBlock: 0,
    paddingInline: 4,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: t.textAccent,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
});

const bonePulse = stylex.keyframes({
  "0%, 100%": { opacity: 0.55 },
  "50%": { opacity: 1 },
});

/**
 * The page before its report lands. The frame is drawn for real and only the
 * marks that carry numbers are bones, so nothing jumps when they arrive.
 */
export const skeletonStyles = stylex.create({
  bone: {
    display: "inline-block",
    verticalAlign: "middle",
    flexShrink: 0,
    borderRadius: t.radiusSm,
    backgroundColor: t.fillGhostHover,
    animationName: { default: bonePulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  row: { display: "flex", flexDirection: "column", gap: 6, minHeight: 38, paddingBlock: 8 },
});
