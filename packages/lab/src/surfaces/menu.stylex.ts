/**
 * Menu geometry. The material comes from `surface.floating`; nothing here
 * paints a background, a hairline, a blur or a shadow, and nothing here
 * writes a `zIndex`, because `elevation` carries that with its shadow.
 *
 * Two ideas carry the whole file:
 *
 * 1. Every row is the same row. An item, a group heading and a submenu
 *    trigger are the same anatomy at the same widths, so labels line up
 *    across them by construction rather than by a matching pair of paddings
 *    that someone has to keep in step.
 * 2. Every inset is named once, and the submenu's placement is written in
 *    those names rather than in a measured pixel.
 */
import { create } from "@stylexjs/stylex";
import { color } from "../tokens/color.stylex";
import { concentric, edge, radius } from "../tokens/layer.stylex";
import { space } from "../tokens/space.stylex";
import { motion } from "../tokens/type.stylex";

/**
 * DERIVED by construction, and the only arithmetic allowed near this file:
 * the menu paints `radius.r12` and pads itself by `space.insetMenu`, so a row
 * takes the concentric inner radius of those two. Computed once, through area
 * A's helper, so the subtraction exists in one place.
 *
 * CONTRACT: `radius.r12` is read from `surface.stylex.ts`, where the material
 * paints it. If the material's radius moves, this line moves with it.
 */
export const rowRadius = concentric.inner(radius.r12, space.insetMenu);

export const menu = create({
  /**
   * `position` is here rather than left to the caller because the layer that
   * `surface.floating` applies only takes effect on a positioned element, and
   * `relative` with no insets places nothing. Whatever opens the menu still
   * owns where it goes.
   */
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    padding: space.insetMenu,
    inlineSize: "max-content",
    minInlineSize: space.widthMenuMin,
    maxInlineSize: space.widthMenuMax,
  },

  /**
   * Anchored to the trigger row's box, which is what `space.submenuOffset*`
   * is derived against.
   *
   * Block takes the exported offset as it is: signed, and exactly the frame
   * padding the submenu is about to add back, so its first row lands level
   * with the trigger row instead of one inset below it.
   *
   * Inline subtracts the exported offset rather than adding it. Added, the
   * submenu's frame sits flush against the parent's outer edge; subtracted,
   * it comes back inside by two steps of the same token and covers the
   * parent's inset and the trailing edge of its rows. That overlap is the
   * macOS behaviour, and it also means the pointer crosses no gap on its way
   * in, which is the difference between a submenu that stays open and one
   * that flickers shut.
   */
  atSubmenu: {
    position: "absolute",
    insetInlineStart: `calc(100% - ${space.submenuOffsetInline})`,
    insetBlockStart: space.submenuOffsetBlock,
  },

  /**
   * The trigger's box, and the submenu's containing block. The submenu is
   * inside it rather than beside it so that crossing the overlap never leaves
   * the trigger's subtree, and a pointer leaving the anchor means the pointer
   * really has left.
   */
  anchor: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  },

  group: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  },

  /**
   * The row anatomy, shared by items and submenu triggers. Rows sit flush:
   * `space` reserves no gap for stacked menu rows because the hover fill is
   * what separates them.
   */
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.gapRow,
    blockSize: space.rowMenu,
    paddingInline: space.insetRow,
    // The row owns the ink, so a variant recolours the row once and the label
    // and the shortcut inherit instead of restating it.
    color: color.textPrimary,
    // A desktop menu, not a web link.
    cursor: "default",
    userSelect: "none",
    textAlign: "start",
    // A menu row's highlight is its focus indicator. See `interactive`.
    outline: "none",
    transitionProperty: "background-color, color, transform",
    transitionDuration: motion.durationState,
    transitionTimingFunction: motion.easeDefault,
  },

  /**
   * The heading takes the label column directly. `space.insetLabel` is
   * insetRow plus the leading slot plus the gap, already resolved, so the
   * heading starts in the same column as every label below it without this
   * file adding those three up again.
   */
  headingRow: {
    paddingInlineStart: space.insetLabel,
    color: color.textSecondary,
  },

  /**
   * Rendered whether or not there is a glyph to put in it. An empty slot is
   * what keeps a plain item's label in the same column as a checked one's.
   */
  slot: {
    flexGrow: 0,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    inlineSize: space.slotLeading,
    blockSize: space.slotLeading,
    color: color.iconSecondary,
  },

  trailingSlot: {
    flexGrow: 0,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    inlineSize: space.slotTrailing,
    blockSize: space.slotTrailing,
    color: color.iconTertiary,
  },

  glyph: {
    flexGrow: 0,
    flexShrink: 0,
    inlineSize: space.slotIcon,
    blockSize: space.slotIcon,
  },

  label: {
    flexGrow: 1,
    flexShrink: 1,
    // Lets a long label ellipsis at the menu's max width instead of pushing
    // the trailing slot out of the panel.
    minInlineSize: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  /**
   * The shortcut sets no size of its own. It inherits the row's step, so its
   * line box is the label's line box and the two share a baseline exactly.
   *
   * CONTRACT: `text.caption` is offered for shortcut hints. Not used here.
   * A 16px leading beside a 20px one cannot share a baseline in a centred
   * row, only a centre, and the gap between the two was the defect this menu
   * is replacing. Tertiary ink already separates the shortcut from the label
   * without a second size doing it.
   */
  shortcut: {
    flexGrow: 0,
    flexShrink: 0,
    color: color.textTertiary,
    // Shortcut glyphs are mostly caps and symbols, but digits appear in
    // function keys and should not jitter between rows.
    fontVariantNumeric: "tabular-nums",
  },

  /**
   * Full content width. The menu's own inset is already the separator's
   * inset, so it ends exactly where the row highlight above and below it
   * ends. A row's internal inset is a different decision and does not apply.
   */
  separator: {
    blockSize: 0,
    borderBlockStartWidth: edge.hairline,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: color.strokeSecondary,
    marginBlock: space.gapTight,
  },

  /**
   * Hover lighter than selected, pressed heaviest, in the order the palette
   * already puts them in. Keyboard focus takes the selected step because a
   * highlighted menu row is what focus means here; a ring would be a second
   * vocabulary for the same state.
   */
  interactive: {
    backgroundColor: {
      default: null,
      ":hover": color.stateHover,
      ":focus-visible": color.stateSelected,
      ":active": color.statePressed,
    },
    transform: {
      default: null,
      ":active": "scale(0.96)",
    },
  },

  /**
   * Held while a submenu is open. Every condition is restated so hover cannot
   * lighten a row that is already carrying the heavier step.
   */
  selected: {
    backgroundColor: {
      default: color.stateSelected,
      ":hover": color.stateSelected,
      ":focus-visible": color.stateSelected,
      ":active": color.statePressed,
    },
  },

  /**
   * Red ink, neutral state layers. The red ramp's low steps are a wash in
   * light and a near-white text step in dark, so one of them used as a hover
   * fill would flip the row white in dark. Only the ink changes.
   */
  danger: {
    color: color.red600,
  },

  // Never composed with `interactive`, so there is nothing to reset.
  disabled: {
    color: color.textTertiary,
  },

  // Slots carry icon ink rather than text ink, so they dim to the icon ramp's
  // matching step rather than the text one.
  disabledSlot: {
    color: color.iconTertiary,
  },
});
