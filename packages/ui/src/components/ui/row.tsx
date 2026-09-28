import { useRender } from "@base-ui/react/use-render";
import { create, props, type StyleXStyles } from "@stylexjs/stylex";

import { focus } from "../../a11y.stylex.ts";
import { glyph } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";

const styles = create({
  root: {
    boxSizing: "border-box",
    position: "relative",
    // `Row.Backdrop` sits at `z-index: -1`; this keeps it behind the row, not the list.
    isolation: "isolate",
    display: "flex",
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    minHeight: "var(--nyte-row-height, 28px)",
    gap: "var(--nyte-row-gap, 6px)",
    paddingInline: "var(--nyte-row-padding-inline, 6px)",
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "var(--_row-fill, transparent)",
    color: t.textPrimary,
    // Typography is inherited: the surface owns the family and the size.
    textAlign: "start",
    transitionProperty: "background-color, color",
    transitionDuration: {
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
  lg: {
    "--nyte-row-height": "44px",
    "--nyte-row-gap": "12px",
    "--nyte-row-padding-inline": "12px",
    paddingBlock: 8,
  },
  /*
   * One declaration owns the fill. StyleX merges a property's conditions into
   * one key, so a second style naming `--_row-fill` replaces these states.
   */
  interactive: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillHover },
      ":focus-within": t.fillHover,
      "[data-selected]": t.fillSelected,
    },
  },
  /*
   * The row is the control. Its label brightens on hover and on keyboard focus,
   * and the leading glyph follows the label.
   */
  nav: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillHover },
    },
    "--_row-leading-color": "currentColor",
    flexShrink: 0,
    margin: 0,
    paddingBlock: 0,
    borderRadius: t.radiusLg,
    color: {
      default: t.textSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.textPrimary },
      ":focus-visible": t.textPrimary,
      ":disabled": t.textQuaternary,
    },
    font: "inherit",
    textDecoration: "none",
    appearance: "none",
    cursor: { default: t.cursorInteractive, ":disabled": "default" },
  },
  navSelected: {
    "--_row-fill": t.fillSelected,
    color: t.textPrimary,
  },
  /*
   * A surface reclaiming room multiplies this value rather than repeating the
   * conditions: `calc(var(--_row-actions-opacity, 0) * 44px)`.
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
    // A `button` or an `a` brings user agent padding, borders, background, and font.
    margin: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: "inherit",
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    letterSpacing: "inherit",
    textAlign: "start",
    textDecoration: "none",
    appearance: "none",
    cursor: { default: t.cursorInteractive, ":disabled": "default" },
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
    width: `var(--nyte-row-leading-size, ${glyph.box})`,
    lineHeight: 0,
    color: `var(--_row-leading-color, ${t.iconSecondary})`,
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
    color: t.textTertiary,
    fontSize: t.fontSm,
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    color: `var(--_row-meta-color, ${t.textTertiary})`,
    fontSize: t.fontSm,
    // A time or a count updates in place; tabular figures keep it from shifting.
    fontVariantNumeric: "tabular-nums",
  },
  actions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    opacity: "var(--_row-actions-opacity, 1)",
    pointerEvents: "var(--_row-actions-pointer-events, auto)",
  },
  actionsOverlay: {
    position: "absolute",
    zIndex: 1,
    insetInlineEnd: "var(--nyte-row-padding-inline, 6px)",
    top: "50%",
    transform: "translateY(-50%)",
  },
});

type RowElementProps = StyledProps<useRender.ComponentProps<"div">>;

type RowButtonProps = StyledProps<useRender.ComponentProps<"button">>;

/** `lg` is the settings row: taller, with room for a description under the label. */
export type RowSize = "default" | "lg";

/**
 * `list` holds a `Row.Primary` and its actions. `nav` is itself the control:
 * a `<button type="button">` that fills on hover and brightens its label.
 */
export type RowVariant = "list" | "nav";

interface RowOwnProps {
  readonly size?: RowSize;
  /**
   * Paints the row's own fill on hover, on focus within, and while selected. A
   * surface that sets `--_row-fill` itself owns every state of it and leaves this off.
   */
  readonly interactive?: boolean;
  /** Marks the row current. Surfaces style it through `[data-selected]`. */
  readonly selected?: boolean;
  /** Hides the action lane until the row is hovered or holds focus. */
  readonly revealActions?: boolean;
}

export type RowProps =
  | (RowElementProps & RowOwnProps & { readonly variant?: "list" })
  | (RowButtonProps & RowOwnProps & { readonly variant: "nav" });

/**
 * One row of a list.
 *
 * Geometry arrives as `--nyte-row-height`, `--nyte-row-gap`,
 * `--nyte-row-padding-inline`, and `--nyte-row-leading-size`, which a surface
 * sets on its list container; `size="lg"` sets them on the row. Fill is a
 * variable: the row reads `--_row-fill` and `interactive` writes it.
 */
export function Row({
  className,
  interactive = false,
  render,
  revealActions = false,
  selected = false,
  size = "default",
  style,
  variant = "list",
  xstyle,
  ...rest
}: RowProps) {
  const nav = variant === "nav";

  return useRender({
    defaultTagName: nav ? "button" : "div",
    render,
    props: {
      "data-slot": "row",
      "data-selected": selected ? "" : undefined,
      type: nav && render === undefined ? "button" : undefined,
      ...rest,
      ...mergeStyleProps(
        props(
          styles.root,
          size === "lg" && styles.lg,
          interactive && styles.interactive,
          revealActions && styles.revealActions,
          nav && [styles.nav, selected && styles.navSelected, focus.ringInset],
          xstyle,
        ),
        className,
        style,
      ),
    },
  });
}

type RowSlot =
  | "row-backdrop"
  | "row-leading"
  | "row-body"
  | "row-label"
  | "row-description"
  | "row-meta";

function rowPart(slot: RowSlot, part: StyleXStyles, decorative = false) {
  return function RowPart({ className, render, style, xstyle, ...rest }: RowElementProps) {
    return useRender({
      defaultTagName: "span",
      render,
      props: {
        "data-slot": slot,
        "aria-hidden": decorative ? "true" : undefined,
        ...rest,
        ...mergeStyleProps(props(part, xstyle), className, style),
      },
    });
  };
}

/**
 * The click target, wrapping whichever parts should be clickable. It renders a
 * `<button type="button">`; `render` swaps it for a link or another trigger.
 * Actions live outside it: a button cannot contain one.
 */
function RowPrimary({
  className,
  render,
  style,
  xstyle,
  ...rest
}: StyledProps<useRender.ComponentProps<"button">>) {
  return useRender({
    defaultTagName: "button",
    render,
    props: {
      "data-slot": "row-primary",
      type: render === undefined ? "button" : undefined,
      ...rest,
      ...mergeStyleProps(props(styles.primary, focus.ringInset, xstyle), className, style),
    },
  });
}

/** Sits behind the row's content, for a selection layer the surface animates itself. */
const RowBackdrop = rowPart("row-backdrop", styles.backdrop, true);

/** A fixed lane, so labels align down the list whatever glyph each row carries. */
const RowLeading = rowPart("row-leading", styles.leading);

/** Stacks its children, so a label can carry a description under it. */
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
  ...rest
}: RowElementProps & { readonly placement?: RowActionsPlacement }) {
  return useRender({
    defaultTagName: "span",
    render,
    props: {
      "data-slot": "row-actions",
      ...rest,
      ...mergeStyleProps(
        props(styles.actions, placement === "overlay" && styles.actionsOverlay, xstyle),
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
