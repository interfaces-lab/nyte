/**
 * Stacking, elevation and radius, in one owner.
 *
 * Height and shadow are a single decision, so they are never exported apart.
 * `elevation` is the only thing in the package that writes `zIndex`, every
 * one of its variants writes `boxShadow` in the same object, and no shadow
 * token is re-exported for a component to pair with a height of its choosing.
 * Casting the wrong shadow for a layer means naming a variant that does not
 * exist, which the type system already refuses.
 */
import { create, defineConsts } from "@stylexjs/stylex";
import { color } from "./color.stylex";

/**
 * The scale in CONTRACT.md. Numbers because `zIndex` takes a number, and the
 * gaps leave room to slot a layer in without renumbering the ones above it.
 *
 * Reach for these only where an element needs the bare value and paints
 * nothing, a portal root for instance. Anything painted takes `elevation`.
 */
export const layer = defineConsts({
  base: 0,
  raised: 10,
  popover: 100,
  submenu: 110,
  scrim: 200,
  dialog: 210,
});

/**
 * Radius steps and the floating panel role.
 *
 * `floating` is what the material paints, and it is the name a child reads
 * when it has to stay concentric with the panel around it. Reading the role
 * rather than the step means the step can move without every child following
 * it by hand.
 *
 * DERIVED: `full` uses a large length rather than `50%` so a pill keeps
 * rounded ends at any width.
 */
export const radius = defineConsts({
  floating: "12px",

  r0: "0px",
  r2: "2px",
  r4: "4px",
  r6: "6px",
  r8: "8px",
  r10: "10px",
  r12: "12px",
  r14: "14px",
  r16: "16px",
  r20: "20px",
  r24: "24px",
  full: "9999px",
});

/**
 * The hairline that separates a surface from what is behind it. Audited: the
 * material's border is `1px solid` stroke-secondary. It lives here because a
 * border is the zero-distance member of the elevation set, and keeping it
 * here is what stops a surface file writing its own width.
 */
export const edge = defineConsts({
  hairline: "1px",
  /*
   * DERIVED: two hairlines make the focus ring a separate edge.
   */
  focusRing: "2px",
});

/**
 * DERIVED: shadows follow layers. Base and scrim cast none, raised takes
 * shadow-sm, popover and submenu take shadow-md, and dialog takes shadow-lg.
 *
 * Submenus share the popover shadow; their z-index separates them.
 * Shadow tiers stay the same across appearances because palette.css already
 * deepens each shadow in dark mode.
 *
 * `none` rather than an omitted property: a variant is applied after a frame,
 * so it has to overwrite whatever that frame set.
 */
export const elevation = create({
  base: { zIndex: layer.base, boxShadow: "none" },
  raised: { zIndex: layer.raised, boxShadow: color.shadowSm },
  popover: { zIndex: layer.popover, boxShadow: color.shadowMd },
  submenu: { zIndex: layer.submenu, boxShadow: color.shadowMd },
  scrim: { zIndex: layer.scrim, boxShadow: "none" },
  dialog: { zIndex: layer.dialog, boxShadow: color.shadowLg },
});

/**
 * Concentric corners: inner radius is outer minus the inset that separates
 * them. A child never states a radius, it names the two tokens its parent
 * already uses and the subtraction happens once, here.
 *
 * `calc` defers the arithmetic to the browser, which is what lets the inset
 * come from the space scale without this file knowing anything about it. The
 * `max` floor stops an inset larger than the radius producing a negative
 * length, which would drop the declaration entirely.
 *
 * A style rather than a function returning a string, because the compiler
 * cannot evaluate an imported function inside another file's `create` call:
 * imports across a `.stylex` boundary resolve to a variable reference, not to
 * source. As a style it is applied where the element is built:
 *
 *   props(menu.row, concentric.inner(radius.floating, space.insetMenu))
 */
export const concentric = create({
  inner: (outer: string, inset: string) => ({
    borderRadius: `max(${radius.r0}, calc(${outer} - ${inset}))`,
  }),
});
