import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, keyframes } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { settings } from "../theme/schema.stylex.ts";

const NARROW = "@container (max-width: 560px)";

const figure = { fontVariantNumeric: "tabular-nums" } as const;

export const usageStyles = create({
  page: { display: "flex", flexDirection: "column", gap: settings.sectionGap, minWidth: 0 },
  overview: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  card: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    padding: space.s4,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
  },
  spend: { flex: "1 1 320px", gap: space.s4 },
  limits: { flex: "0 0 248px", gap: space.s3 },

  spendHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.s3,
  },
  spendTitle: { display: "flex", flexDirection: "column", gap: space.s0_5, minWidth: 0 },
  spendFacts: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: space.s1,
    paddingTop: space.s0_5,
    textAlign: "end",
  },
  caption: {
    margin: 0,
    color: role.contentSecondary,
  },
  amount: {
    ...figure,
    color: role.contentPrimary,
    fontSize: `calc(${type.fontBase} * 28 / 13)`,
    fontWeight: type.weightSemibold,
    lineHeight: `calc(${type.fontBase} * 34 / 13)`,
    letterSpacing: "-0.02em",
  },
  fact: {
    ...figure,
    color: role.contentTertiary,
  },
  change: { color: role.contentInteractivePrimary },
  quiet: { ...figure, color: role.contentTertiary },

  limitsHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  meterHead: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.s2,
  },
  meterValue: { ...figure, color: role.contentPrimary },
  meterHot: { color: role.contentInteractivePrimary },

  breakdown: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  breakdownHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space.s2,
    paddingInline: space.s2,
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
    gap: space.s4,
    minHeight: 48,
    paddingBlock: space.s1_5,
    paddingInline: space.s3,
    borderBottomWidth: { default: 1, ":last-child": 0 },
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  headRow: { minHeight: 0, paddingBlock: space.s2_5 },
  head: {
    color: role.contentTertiary,
    fontWeight: type.weightRegular,
  },
  headStrong: { color: role.contentPrimary },
  nameCell: { display: "flex", alignItems: "center", gap: space.s2, flex: "1 1 0", minWidth: 0 },
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
    overflowWrap: "anywhere",
  },
  rowMeta: {
    color: role.contentTertiary,
    overflowWrap: "anywhere",
  },
  number: {
    ...figure,
    flexShrink: 0,
    color: role.contentPrimary,
    textAlign: "end",
    whiteSpace: "nowrap",
  },
  cache: { display: "flex", flexDirection: "column", alignItems: "flex-end", width: 104 },
  cacheLow: { color: role.contentInteractivePrimary },
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
    gap: space.s1,
    flexShrink: 0,
    width: 132,
  },
  costHead: { display: "flex", justifyContent: "flex-end", flexShrink: 0, width: 132 },
  costLine: { display: "flex", alignItems: "baseline", gap: space.s1_5 },
  share: {
    ...figure,
    color: role.contentTertiary,
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
    paddingBlock: space.s2_5,
    paddingInline: space.s3,
    color: role.contentTertiary,
  },

  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s1_5,
    minHeight: 148,
    textAlign: "center",
  },
  emptyTitle: {
    color: role.contentPrimary,
    textWrap: "balance",
  },
  emptyBody: {
    maxWidth: 340,
    margin: 0,
    color: role.contentSecondary,
    textWrap: "pretty",
  },
  emptyActions: { display: "flex", alignItems: "center", gap: space.s1_5, marginTop: space.s1 },
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s2,
    margin: 0,
    paddingBlock: space.s1_5,
    paddingInline: space.s2_5,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    textWrap: "pretty",
  },
  noticeIcon: {
    flexShrink: 0,
    marginBlockStart: space.px,
    color: role.contentTertiary,
  },
  noticeIconAlert: { color: role.contentInteractiveTertiary },
  noticeCopy: { flex: 1, minWidth: 0, paddingBlockStart: space.px },
});

const bonePulse = keyframes({
  "0%, 100%": { opacity: 0.55 },
  "50%": { opacity: 1 },
});

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
