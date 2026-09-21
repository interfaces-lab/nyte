/**
 * One painted frame for every floating surface, the way
 * `theme/floating-surface.stylex.ts` already does it on the desktop — except
 * the fill is a material rather than a slab.
 *
 * The recipe is Notion's, from the `data-floating-context-panel` element:
 *
 *   background      rgba(255,255,255,.8) light, rgba(32,32,32,.9) dark
 *   backdrop-filter blur(12px), plus brightness(120%) in dark
 *   border          1px of the warm 8% stroke
 *   clip            padding-box in light, border-box in dark
 *   shadow          md in light, lg in dark
 *
 * `background-clip: padding-box` is the part that is easy to miss: without it
 * the translucent fill paints under the border and the hairline reads at
 * double strength.
 *
 * The desktop's current popup backs its hairline with a second opaque inset
 * ring. That backing has to go here, or it becomes a visible opaque rim.
 */
import * as stylex from "@stylexjs/stylex";
import { g, t } from "./vars.stylex";

export const wax = stylex.create({
  surface: {
    backgroundColor: t.surfaceWax,
    backdropFilter: t.waxEffect,
    WebkitBackdropFilter: t.waxEffect,
    backgroundClip: "var(--nds-wax-clip, padding-box)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    borderRadius: "var(--nds-wax-radius, 12px)",
    boxShadow: t.shadowWax,
    color: t.textPrimary,
  },
  /* A menu clips its own rows; a panel lets a header sit flush. */
  clipped: { overflow: "hidden" },
});

export const menu = stylex.create({
  /* Sits under the open surface and over everything else, so one click closes. */
  catcher: {
    position: "absolute",
    inset: 0,
    zIndex: 55,
    borderStyle: "none",
    backgroundColor: "transparent",
    cursor: "default",
  },
  popup: {
    position: "absolute",
    zIndex: 60,
    minWidth: 200,
    padding: 4,
  },
  group: {
    margin: 0,
    padding: "6px 8px 4px",
    color: t.textQuaternary,
    fontSize: g.bodyXs,
    lineHeight: g.bodyXsLeading,
    fontWeight: t.weightSemibold,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    height: g.menuItemHeight,
    paddingInline: 8,
    borderStyle: "none",
    borderRadius: "calc(var(--nds-wax-radius, 12px) - 4px)",
    backgroundColor: {
      default: "transparent",
      ":hover": t.stateHover,
      ":active": t.statePressed,
    },
    color: t.textPrimary,
    fontSize: g.body,
    lineHeight: g.bodyLeading,
    fontWeight: t.weightRegular,
    textAlign: "left",
    cursor: "default",
  },
  itemSelected: {
    backgroundColor: { default: t.stateSelected, ":hover": t.stateSelectedHover },
    fontWeight: t.weightMedium,
  },
  itemDanger: { color: t.danger },
  check: { width: 14, color: t.textSecondary },
  key: { marginLeft: "auto", color: t.textQuaternary, fontSize: g.bodyXs },
  /* A submenu sits on its parent, so the stack is wax over wax over content. */
  submenu: { zIndex: 61 },
  chevron: { marginLeft: "auto", color: t.textQuaternary, fontSize: g.bodyXs },
  separator: {
    height: 1,
    marginBlock: 4,
    marginInline: 4,
    backgroundColor: t.strokeSecondary,
  },
});

export const dialog = stylex.create({
  scrim: {
    position: "absolute",
    inset: 0,
    zIndex: 70,
    display: "grid",
    placeItems: "center",
    backgroundColor: t.scrim,
  },
  panel: {
    width: 380,
    padding: 16,
  },
  title: {
    margin: 0,
    color: t.textPrimary,
    fontSize: g.title,
    lineHeight: g.titleLeading,
    fontWeight: t.weightSemibold,
  },
  body: {
    margin: "6px 0 0",
    color: t.textSecondary,
    fontSize: g.body,
    lineHeight: g.bodyLeading,
  },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  button: {
    height: 28,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    borderRadius: g.radius8,
    backgroundColor: { default: "transparent", ":hover": t.stateHover, ":active": t.statePressed },
    color: t.textPrimary,
    fontSize: g.body,
    fontWeight: t.weightMedium,
    cursor: "default",
  },
  buttonDanger: {
    borderColor: "transparent",
    backgroundColor: { default: t.danger, ":hover": t.red600, ":active": t.red600 },
    color: "#fff",
  },
});
