/**
 * The three painted frames. Nothing else paints a background, a border or a
 * shadow, and `floating` is the only translucent thing in the package.
 *
 * Each frame is addressed by the one axis it really varies on, and by nothing
 * else. `flat` varies by fill, because a rail and a pane are both unelevated
 * and are not the same colour. `floating` varies by layer, because the same
 * material is used at three heights. `raised` varies by nothing, so it is a
 * style on its own.
 *
 * CONTRACT: the contract spells these as three bare styles. `surface.flat`
 * and `surface.floating` are groups instead, so `surface.floating.dialog` is
 * the only way to say it and a dialog cannot quietly come out at the popover
 * height with the popover's shadow. A missing layer is a type error at the
 * call site rather than a stacking bug found by eye.
 *
 * A layer only takes effect on a positioned element. Position is layout, so
 * it stays with the component that owns the layout.
 */
import { create } from "@stylexjs/stylex";
import { color } from "../tokens/color.stylex";
import { edge, elevation, radius } from "../tokens/layer.stylex";

const frame = create({
  page: { backgroundColor: color.surfacePage },

  wash: { backgroundColor: color.surfaceWash },

  /**
   * DERIVED: the stroke and the radius. Notion audits neither for an opaque
   * card. stroke-primary rather than the material's stroke-secondary because
   * secondary reads at 0.08 and needs the blur behind the material to be
   * visible at all; over an opaque fill it disappears. The radius matches the
   * material so a card and a menu are the same kind of panel.
   */
  raised: {
    backgroundColor: color.surfaceElevated,
    borderWidth: edge.hairline,
    borderStyle: "solid",
    borderColor: color.strokePrimary,
    borderRadius: radius.floating,
  },

  /**
   * The material, audited value for value: fill, backdrop filter, a
   * stroke-secondary hairline, the clip, and a 12px radius.
   *
   * `backgroundClip` resolves per appearance through the palette, which is
   * padding-box in light and border-box in dark. Under padding-box the
   * translucent fill stops at the inside of the border, so the hairline is
   * one hairline; without it the fill paints under the border as well and the
   * edge reads at double strength.
   */
  material: {
    backgroundColor: color.materialFill,
    backdropFilter: color.materialEffect,
    backgroundClip: color.materialClip,
    borderWidth: edge.hairline,
    borderStyle: "solid",
    borderColor: color.strokeSecondary,
    borderRadius: radius.floating,
  },
});

export const surface = {
  flat: {
    page: [frame.page, elevation.base],
    wash: [frame.wash, elevation.base],
  },
  raised: [frame.raised, elevation.raised],
  floating: {
    popover: [frame.material, elevation.popover],
    submenu: [frame.material, elevation.submenu],
    dialog: [frame.material, elevation.dialog],
  },
};
