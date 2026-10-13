/**
 * Settings › Usage. Two cards over one table: what the window cost and its
 * shape, how much of each plan is left, then the rows that make up the cost.
 * Every figure uses tabular digits so a column lines up on its decimal.
 */
import { radius } from "@nyte-ai/ui/schema.stylex";
import { create, keyframes } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { settings } from "../theme/schema.stylex.ts";

/** Below this the table drops its secondary columns rather than squeezing names. */
const NARROW = "@container (max-width: 560px)";

const figure = { fontVariantNumeric: "tabular-nums" } as const;

export const usageStyles = create({
  page: { display: "flex", flexDirection: "column", gap: settings.sectionGap, minWidth: 0 },
  overview: { display: "flex", flexWrap: "wrap", gap: 8 },
  card: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
  },
  spend: { flex: "1 1 320px", gap: 16 },
  limits: { flex: "0 0 248px", gap: 12 },

  spendHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  spendTitle: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  spendFacts: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
    paddingTop: 2,
    textAlign: "end",
  },
  caption: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  amount: {
    ...figure,
    color: role.contentPrimary,
    fontSize: `calc(${type.fontBase} * 28 / 13)`,
    fontWeight: 590,
    lineHeight: `calc(${type.fontBase} * 34 / 13)`,
    letterSpacing: "-0.02em",
  },
  fact: {
    ...figure,
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  /** A change in spend: the hue scope it sits in says which way. */
  change: { color: role.contentInteractivePrimary },
  quiet: { color: role.contentTertiary, fontSize: type.fontXs, lineHeight: type.leadingXs },

  limitsHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  meterHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  meterValue: { color: role.contentPrimary, fontSize: type.fontBase, lineHeight: type.leadingBase },
  meterLabel: { fontSize: type.fontBase, lineHeight: type.leadingBase },
  meterHot: { color: role.contentInteractivePrimary },
  meterTrack: { backgroundColor: role.bgInteractiveSecondaryTranslucent },
  meterCalm: { backgroundColor: role.contentPrimary },

  breakdown: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  breakdownHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    paddingInline: 8,
  },
  table: {
    display: "flex",
    flexDirection: "column",
    overflow: "clip",
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    minHeight: 48,
    paddingBlock: 6,
    paddingInline: 12,
    borderBottomWidth: { default: 1, ":last-child": 0 },
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  headRow: { minHeight: 0, paddingBlock: 10 },
  head: {
    color: role.contentTertiary,
    fontSize: type.fontSm,
    fontWeight: 400,
    lineHeight: type.leadingSm,
  },
  headStrong: { color: role.contentPrimary },
  nameCell: { display: "flex", alignItems: "center", gap: 8, flex: "1 1 0", minWidth: 0 },
  dot: {
    flexShrink: 0,
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: role.bgInteractiveStrong,
  },
  dotIdle: { backgroundColor: role.contentDisabled },
  name: { display: "flex", flexDirection: "column", minWidth: 0 },
  rowLabel: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    overflowWrap: "anywhere",
  },
  rowMeta: {
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    overflowWrap: "anywhere",
  },
  number: {
    ...figure,
    flexShrink: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  turns: { width: 64 },
  perTurn: {
    width: 80,
    color: role.contentSecondary,
    display: { default: "block", [NARROW]: "none" },
  },
  trend: {
    display: { default: "flex", [NARROW]: "none" },
    justifyContent: "flex-end",
    flexShrink: 0,
    width: 96,
  },
  cost: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
    flexShrink: 0,
    width: 132,
  },
  costHead: { display: "flex", justifyContent: "flex-end", flexShrink: 0, width: 132 },
  costLine: { display: "flex", alignItems: "baseline", gap: 6 },
  share: {
    ...figure,
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  absent: { color: role.contentDisabled },
  shareTrack: {
    display: "flex",
    width: "100%",
    height: 2,
    overflow: "clip",
    borderRadius: 2,
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
  },
  shareFill: { height: "100%", backgroundColor: role.bgInteractiveStrong },
  more: {
    margin: 0,
    paddingBlock: 10,
    paddingInline: 12,
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },

  /** A read that failed or found nothing, said once, where its numbers would be. */
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 148,
    textAlign: "center",
  },
  emptyTitle: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    textWrap: "balance",
  },
  emptyBody: {
    maxWidth: 340,
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  emptyActions: { display: "flex", alignItems: "center", gap: 6, marginTop: 4 },
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
});
