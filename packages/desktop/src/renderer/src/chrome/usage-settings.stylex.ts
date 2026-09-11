/** Settings › Usage: the range control, the summary tiles, and the card grid. */
import * as stylex from "@stylexjs/stylex";
import { control, layer, settings } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

/** Tall enough for four gridlines to breathe without the card dominating the page. */
export const BODY_HEIGHT = 176;

/** The gap nivo leaves between an axis tick and the plot it labels. */
export const AXIS_TICK_PADDING = 8;

export const usageStyles = stylex.create({
  panel: { display: "flex", flexDirection: "column", gap: settings.sectionGap },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: control.regularHeight,
    paddingInline: 8,
  },
  toolbarCopy: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 },
  toolbarTitle: {
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  toolbarHint: {
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  toolbarActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  /** The rail section headings sit on, so their prose lines up under them. */
  sectionCopy: { paddingInline: "8px 4px" },
  segments: {
    display: "inline-flex",
    alignItems: "center",
    gap: 1,
    padding: 2,
    borderRadius: t.radiusLg,
    backgroundColor: t.fillSecondary,
    boxShadow: `inset 0 0 0 1px ${t.borderWeak}`,
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    height: 22,
    paddingInline: 9,
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
  reset: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 26,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.textSecondary,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    cursor: "pointer",
    whiteSpace: "nowrap",
    scale: { default: "1", ":active": "0.96" },
    transitionProperty: "background-color, scale",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
    "@media (prefers-reduced-motion: reduce)": { scale: "1" },
  },

  tiles: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(4, minmax(0, 1fr))",
      "@container (max-width: 560px)": "repeat(2, minmax(0, 1fr))",
    },
    gap: settings.cardGap,
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
    padding: "12px 13px 13px",
    borderRadius: t.radiusXl,
    backgroundColor: t.bgFaint,
  },
  tileLabel: {
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    letterSpacing: t.letterBase,
  },
  tileValue: {
    color: t.textPrimary,
    fontSize: t.fontXl,
    fontWeight: 500,
    lineHeight: t.leadingLg,
    letterSpacing: t.letterLg,
    fontVariantNumeric: "tabular-nums",
  },
  tileDetail: {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    // A chat name is arbitrarily long. Wrapping it would make one tile two
    // lines taller than its neighbours and cost the row its shared baselines.
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  changeUp: { color: t.textWarning, fontVariantNumeric: "tabular-nums" },
  changeDown: { color: t.textSuccess, fontVariantNumeric: "tabular-nums" },

  grid: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@container (max-width: 560px)": "minmax(0, 1fr)",
    },
    gap: settings.cardGap,
  },
  card: {
    // The grip stays out of the way until the card is under the pointer or
    // a keyboard reaches it, which is how the sidebar reveals its own actions.
    // Revealed on hover for a fine pointer. A coarse pointer has no hover to
    // reveal it with, so the grip is simply always there.
    "--_grip-opacity": {
      default: "1",
      "@media (hover: hover) and (pointer: fine)": "0",
      ":hover": "1",
      ":focus-within": "1",
    },
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    padding: "12px 13px 10px",
    borderRadius: t.radiusXl,
    backgroundColor: t.bgFaint,
    boxShadow: "none",
    // The lifted card leaves the flow visually, never structurally.
    touchAction: "manipulation",
    // Grabbing and dropping are interruptible, so the lift is a transition and
    // not a keyframe: a card caught mid-settle picks up from where it is.
    transitionProperty: "background-color, box-shadow",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  cardLifted: {
    zIndex: layer.dragPreview,
    backgroundColor: t.bgElevated,
    // A dragged card outranks every other floating surface, so it wears the
    // deepest shadow. The popover shadow it used to wear is a 6% black that a
    // dark page swallows, leaving the lift to read as a colour glitch.
    boxShadow: `${t.shadowModal}, inset 0 0 0 1px ${t.strokeSecondary}`,
  },
  cardSorting: {
    // A neighbour sliding into place should not fight the pointer for hover.
    pointerEvents: "none",
    // Only while the grid is actually moving; a promoted layer costs memory.
    willChange: "transform",
  },
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    minHeight: 20,
  },
  cardCopy: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 },
  cardTitle: {
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    letterSpacing: t.letterBase,
  },
  cardValue: {
    overflow: "hidden",
    color: t.textPrimary,
    fontSize: t.fontLg,
    fontWeight: 500,
    lineHeight: t.leadingLg,
    fontVariantNumeric: "tabular-nums",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardDetail: {
    display: "block",
    marginTop: 3,
    overflow: "hidden",
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  handle: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    marginTop: -2,
    marginRight: -4,
    flexShrink: 0,
    borderStyle: "none",
    borderRadius: t.radiusSm,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.iconTertiary,
    opacity: "var(--_grip-opacity)",
    cursor: { default: "grab", ":active": "grabbing" },
    touchAction: "none",
    transitionProperty: "opacity, background-color",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
    // A 22px grip is a 22px target. The card header holds nothing else, so the
    // grip can claim a full-size hit area without stealing another control's.
    "::after": {
      content: "''",
      position: "absolute",
      insetBlock: -9,
      insetInline: -9,
    },
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  // Elevation is not the only cue: the grip being held is the one holding colour.
  handleDragging: { opacity: 1, color: t.iconPrimary, cursor: "grabbing" },
  legend: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "2px 10px",
    marginTop: 2,
  },
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
  },
  legendDot: { width: 6, height: 6, borderRadius: t.radiusFull, flexShrink: 0 },
  cardBody: {
    position: "relative",
    height: BODY_HEIGHT,
    marginTop: 8,
    minWidth: 0,
  },
  cardBodyList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    height: BODY_HEIGHT,
    marginTop: 8,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },

  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    minHeight: 32,
    paddingBlock: 0,
    paddingInline: 7,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "transparent",
    overflow: "hidden",
    isolation: "isolate",
    textAlign: "start",
    fontFamily: t.fontSans,
  },
  rowTrack: {
    position: "absolute",
    insetBlock: 2,
    insetInlineStart: 0,
    zIndex: -1,
    borderRadius: t.radiusSm,
    backgroundColor: t.fillAccentSubtle,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: t.textPrimary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowMeta: {
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  rowValue: {
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },

  state: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 220,
    padding: 24,
    borderRadius: t.radiusXl,
    backgroundColor: t.bgFaint,
    textAlign: "center",
  },
  stateTitle: {
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    textWrap: "balance",
  },
  stateBody: {
    maxWidth: 340,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
  stateActions: { display: "flex", alignItems: "center", gap: 6, marginTop: 4 },

  /** A read that failed or went stale, said once, above the numbers it affects. */
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
    paddingBlock: 5,
    paddingInline: 10,
    borderRadius: t.radiusLg,
    backgroundColor: t.bgFaint,
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
  noticeIcon: { flexShrink: 0, color: t.iconTertiary },
  noticeCopy: { flex: 1, minWidth: 0 },
  noticeAction: {
    flexShrink: 0,
    borderStyle: "none",
    padding: 0,
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
 * The page while its report is still being read. The frame — axes, gridlines,
 * card and tile geometry — is drawn for real; only the marks that carry numbers
 * are bones, and only bones move.
 */
export const skeletonStyles = stylex.create({
  bone: {
    // Phrasing content: a bone stands in for text as often as it does for a mark.
    display: "inline-block",
    verticalAlign: "middle",
    flexShrink: 0,
    borderRadius: t.radiusSm,
    // A bone stands on the card's own fill, so it takes the next surface step up.
    backgroundColor: t.bgHover,
    animationName: { default: bonePulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  /** For a drawn shape that carries its own fill and cannot be a plain bone. */
  pulse: {
    animationName: { default: bonePulse, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },

  /** A chart body laid out on its own margins: left axis, plot, bottom axis. */
  chart: { display: "grid", height: "100%", minWidth: 0 },
  plotCell: { position: "relative", minWidth: 0 },
  plot: { position: "relative", width: "100%", height: "100%", minWidth: 0 },
  axisLeft: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingInlineEnd: AXIS_TICK_PADDING,
  },
  axisLeftBands: {
    display: "grid",
    alignItems: "center",
    justifyItems: "end",
    paddingInlineEnd: AXIS_TICK_PADDING,
  },
  axisBottom: {
    gridColumnStart: 2,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBlockStart: AXIS_TICK_PADDING,
  },
  gridRows: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  gridRow: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "dashed",
    borderBlockStartColor: t.strokeQuaternary,
  },
  gridColumns: {
    position: "absolute",
    inset: 0,
    display: "flex",
    justifyContent: "space-between",
  },
  gridColumn: {
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "dashed",
    borderInlineStartColor: t.strokeQuaternary,
  },

  /** Where the marks go: bars from the baseline, a line across, days in a grid. */
  bars: {
    position: "relative",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    width: "100%",
    height: "100%",
  },
  bar: { alignSelf: "flex-end", borderRadius: 1.5 },
  line: { position: "relative", display: "block", width: "100%", height: "100%" },
  lineArea: { fill: t.bgHover, fillOpacity: 0.55 },
  lineStroke: { fill: "none", stroke: t.bgActive, strokeWidth: 1.5, strokeLinecap: "round" },
  bands: { position: "relative", display: "grid", width: "100%", height: "100%" },
  band: { alignSelf: "center", height: "62%", borderRadius: 2 },
  weekdays: { display: "grid", alignItems: "center", justifyItems: "start" },
  days: { display: "grid", gridAutoFlow: "column", overflow: "hidden" },
  day: { borderRadius: 2, backgroundColor: t.bgHover },

  /** A ranked row of the two list cards, in the geometry `ShareRow` will fill. */
  rowBones: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 32,
    paddingInline: 7,
    borderRadius: t.radiusBase,
    overflow: "hidden",
    isolation: "isolate",
  },
});

/**
 * Shared by the cross-tool total and each tool's by-model section. Their
 * numbers are the largest on the page, so the total leads at display size and
 * everything qualifying it — token count, coverage, rows — steps down from
 * there rather than sitting flat beside it.
 */
export const localHistoryStyles = stylex.create({
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
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    textWrap: "pretty",
  },
  rowMeta: {
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
  },
  rowAmount: {
    color: t.textPrimary,
    fontSize: t.fontLg,
    fontWeight: 500,
    lineHeight: t.leadingLg,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  /** No price is not no spend, so it reads as absent rather than as a number. */
  rowUnpriced: {
    color: t.textQuaternary,
    fontSize: t.fontSm,
    fontWeight: 400,
    lineHeight: t.leadingSm,
    whiteSpace: "nowrap",
  },
});

/** The cross-tool total: a headline, a share bar, and one row per tool. */
export const toolStyles = stylex.create({
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
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    textWrap: "pretty",
  },
  // Sits on the same rail as the headline and the rows' text, so the segments
  // start where the first row's dot does.
  bar: {
    display: "flex",
    gap: 2,
    height: 6,
    marginInline: 8,
    marginBlock: "6px 2px",
    borderRadius: t.radiusFull,
    backgroundColor: t.fillSecondary,
    overflow: "hidden",
  },
  barSegment: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    borderRadius: 1,
    // A tool's share moves when another tool's history changes under it, so
    // the segment slides rather than jumps.
    transitionProperty: "flex-basis",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  rowTitle: { display: "inline-flex", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: t.radiusFull, flexShrink: 0 },
  rowMeta: {
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
  },
  // Shares and amounts are two right-aligned columns; fixed widths keep the
  // decimals stacked across rows whose labels differ in length.
  rowShare: {
    minWidth: 40,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  rowAmount: {
    minWidth: 88,
    color: t.textPrimary,
    fontSize: t.fontLg,
    fontWeight: 500,
    lineHeight: t.leadingLg,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  /** A tool that gave no number reads as absent rather than as free. */
  rowAbsent: {
    color: t.textQuaternary,
    fontSize: t.fontSm,
    fontWeight: 400,
    lineHeight: t.leadingSm,
    whiteSpace: "nowrap",
  },
});
