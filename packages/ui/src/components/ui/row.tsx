import { useRender } from "@base-ui/react/use-render";
import * as stylex from "@stylexjs/stylex";

import { colorVars, controlVars, motionVars, radiusVars } from "../../platform-tokens.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    position: "relative",
    /*
     * `Row.Backdrop` sits at `z-index: -1`, which without a stacking context
     * here would put it behind the list rather than behind the row. Declaring
     * it on the row means no surface has to remember.
     */
    isolation: "isolate",
    display: "flex",
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    minHeight: `var(--nyte-row-height, ${controlVars["--nyte-control-height-md"]})`,
    gap: `var(--nyte-row-gap, ${controlVars["--nyte-control-padding-xs"]})`,
    paddingInline: `var(--nyte-row-padding-inline, ${controlVars["--nyte-control-padding-sm"]})`,
    borderStyle: "none",
    borderRadius: radiusVars["--nyte-radius-control"],
    backgroundColor: "var(--_row-fill, transparent)",
    color: colorVars["--nyte-color-foreground"],
    /*
     * Typography is inherited, not declared. A surface owns the family and the
     * size — the desktop app rebinds both from the user's Appearance settings —
     * and a row naming its own would ignore that, the same way a row naming its
     * own height would ignore the surface's density.
     */
    textAlign: "start",
    transitionProperty: "background-color, color",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  /*
   * One declaration owns the fill. StyleX merges a property's conditions into
   * one key, so a second style naming `--_row-fill` would drop these states
   * rather than add to them.
   */
  interactive: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--nyte-color-muted"] },
      ":focus-within": colorVars["--nyte-color-muted"],
      "[data-selected]": colorVars["--nyte-color-muted"],
    },
  },
  /*
   * No transition on the reveal. Pointing at rows is high-frequency, and a fade
   * only desynchronises the lane from whatever room the surface reclaims for
   * it: the title reflows on the first frame, the icons arrive later.
   *
   * A surface reclaiming room multiplies this value rather than repeating the
   * conditions, so the room and the lane cannot disagree:
   * `calc(var(--_row-actions-opacity, 0) * 44px)`.
   */
  revealActions: {
    "--_row-actions-opacity": { default: 0, ":hover": 1, ":focus-within": 1 },
    "--_row-actions-pointer-events": {
      default: "none",
      ":hover": "auto",
      ":focus-within": "auto",
    },
  },
  primary: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: "inherit",
    flex: 1,
    minWidth: 0,
    /*
     * A `button` or an `a` brings UA padding, borders, background, and font.
     * The reset has to be complete: Chrome's `1px 6px` on a button is invisible
     * until it costs a row two characters of title.
     */
    margin: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: "inherit",
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "start",
    textDecoration: "none",
    appearance: "none",
    // Extend through the row's inline padding without nesting sibling actions.
    "::before": { content: "''", position: "absolute", inset: 0 },
    // A row sits flush in a scroll container, where an outset ring would clip.
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: "-2px",
  },
  backdrop: {
    position: "absolute",
    inset: 0,
    zIndex: -1,
    borderRadius: "inherit",
    pointerEvents: "none",
  },
  leading: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: "var(--nyte-row-leading-size, auto)",
    lineHeight: 0,
    color: colorVars["--nyte-color-muted-foreground"],
  },
  body: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    flex: 1,
    minWidth: 0,
  },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  description: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--nyte-color-muted-foreground"],
    // Steps down from whatever the surface set rather than naming a size.
    fontSize: "0.9231em",
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    color: `var(--_row-meta-color, ${colorVars["--nyte-color-tertiary-foreground"]})`,
    fontSize: "0.9231em",
    // A time or a count updates in place; tabular figures keep it from shifting.
    fontVariantNumeric: "tabular-nums",
  },
  actions: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--nyte-control-gap-sm"],
    flexShrink: 0,
    opacity: "var(--_row-actions-opacity, 1)",
    pointerEvents: "var(--_row-actions-pointer-events, auto)",
  },
  actionsOverlay: {
    position: "absolute",
    zIndex: 1,
    insetInlineEnd: `var(--nyte-row-padding-inline, ${controlVars["--nyte-control-padding-sm"]})`,
    top: "50%",
    transform: "translateY(-50%)",
  },
});

type RowElementProps = StyledProps<useRender.ComponentProps<"div">>;

interface RowOwnProps {
  /**
   * Paints the row's own fill on hover and while selected. A surface that sets
   * `--_row-fill` itself owns every state of it and leaves this off.
   */
  readonly interactive?: boolean;
  /** Marks the row current. Surfaces style it through `[data-selected]`. */
  readonly selected?: boolean;
  /** Hides the action lane until the row is hovered or holds focus. */
  readonly revealActions?: boolean;
}

export type RowProps = RowElementProps & RowOwnProps;

/**
 * One row of a list.
 *
 * Row owns structure and nothing else. Height, gap, inline padding, and the
 * leading lane arrive as `--nyte-row-height`, `--nyte-row-gap`,
 * `--nyte-row-padding-inline`, and `--nyte-row-leading-size`, which the surface
 * sets on its list container. There is deliberately no size or density prop: a
 * dense list is a surface that measures differently, not a different row.
 *
 * The parts compose rather than arrive as slots, because a row's arrangement is
 * the surface's decision. A sidebar needs its selection layer behind everything
 * and its actions floating over the title; a settings list needs neither. Slots
 * would have to anticipate both.
 *
 * Fill is a variable: the shell reads `--_row-fill` and never writes it, so a
 * surface that sets it owns every state of it. StyleX merges a property's
 * conditions into one key, so a kind declaring its own `background-color` would
 * silently drop the states declared here.
 */
export function Row({
  className,
  interactive = false,
  render,
  revealActions = false,
  selected = false,
  style,
  xstyle,
  ...props
}: RowProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: {
      "data-slot": "row",
      "data-selected": selected ? "" : undefined,
      ...props,
      ...mergeStyleProps(
        stylex.props(
          styles.root,
          interactive && styles.interactive,
          revealActions && styles.revealActions,
          xstyle,
        ),
        className,
        style,
      ),
    },
  });
}

type RowSlot =
  | "row-primary"
  | "row-backdrop"
  | "row-leading"
  | "row-body"
  | "row-label"
  | "row-description"
  | "row-meta";

/**
 * Every part is the same component with a different slot name and style, so
 * they are built rather than written out. `Row.Actions` is the exception: it
 * takes a placement.
 */
function rowPart(slot: RowSlot, part: stylex.StyleXStyles, decorative = false) {
  return function RowPart({ className, render, style, xstyle, ...props }: RowElementProps) {
    return useRender({
      defaultTagName: "span",
      render,
      props: {
        "data-slot": slot,
        "aria-hidden": decorative ? "true" : undefined,
        ...props,
        ...mergeStyleProps(stylex.props(part, xstyle), className, style),
      },
    });
  };
}

/**
 * The click target, wrapping whichever parts should be clickable. Actions live
 * outside it: a row whose whole shell is a button cannot contain one.
 */
const RowPrimary = rowPart("row-primary", styles.primary);
/**
 * Sits behind the row's content, for a selection layer the surface animates
 * itself. It takes `render`, like every part.
 */
const RowBackdrop = rowPart("row-backdrop", styles.backdrop, true);
/** A fixed lane, so labels align down the list whatever glyph each row carries. */
const RowLeading = rowPart("row-leading", styles.leading);
/**
 * Stacks its children, so a label can carry a description under it, or two.
 * Omit it when there is only a label.
 */
const RowBody = rowPart("row-body", styles.body);
const RowLabel = rowPart("row-label", styles.label);
const RowDescription = rowPart("row-description", styles.description);
/** Trailing text such as a time or a count. */
const RowMeta = rowPart("row-meta", styles.meta);

export type RowActionsPlacement = "inline" | "overlay";

/**
 * Actions, a switch, or a chevron. A sibling of the primary, never a child.
 * `overlay` floats the lane over the row instead of taking space in it, so the
 * whole row stays clickable underneath; the surface reclaims the room itself.
 */
function RowActions({
  className,
  placement = "inline",
  render,
  style,
  xstyle,
  ...props
}: RowElementProps & { readonly placement?: RowActionsPlacement }) {
  return useRender({
    defaultTagName: "span",
    render,
    props: {
      "data-slot": "row-actions",
      ...props,
      ...mergeStyleProps(
        stylex.props(styles.actions, placement === "overlay" && styles.actionsOverlay, xstyle),
        className,
        style,
      ),
    },
  });
}

Row.Backdrop = RowBackdrop;
Row.Primary = RowPrimary;
Row.Leading = RowLeading;
Row.Body = RowBody;
Row.Label = RowLabel;
Row.Description = RowDescription;
Row.Meta = RowMeta;
Row.Actions = RowActions;
