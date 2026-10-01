import { mergeProps } from "@base-ui/react/merge-props";
import type { BaseUIEvent } from "@base-ui/react/types";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useRender } from "@base-ui/react/use-render";
import { create, props, type StyleXStyles } from "@stylexjs/stylex";

import { focus } from "../../a11y.stylex.ts";
import { glyph, row } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { appearance, motion, role, type } from "../../vars.stylex.ts";

const styles = create({
  root: {
    boxSizing: "border-box",
    position: "relative",
    isolation: "isolate",
    display: "flex",
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    minHeight: row.heightMd,
    gap: row.gap,
    "--_row-padding-inline": row.paddingInlineMd,
    paddingInline: "var(--_row-padding-inline)",
    borderStyle: "none",
    borderRadius: row.radius,
    backgroundColor: "var(--_row-fill, transparent)",
    color: role.contentPrimary,
    textAlign: "start",
    transitionProperty: "background-color, color",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  lg: {
    minHeight: row.heightLg,
    "--_row-padding-inline": row.paddingInlineLg,
    paddingBlock: 6,
  },
  interactive: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
      ":focus-within": role.bgHover,
    },
  },
  nav: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
    "--_row-leading-color": "currentColor",
    flexShrink: 0,
    margin: 0,
    paddingBlock: 0,
    borderRadius: row.radius,
    color: {
      default: role.contentChrome,
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.contentPrimary },
      ":focus-visible": role.contentPrimary,
      ":disabled": role.contentDisabled,
    },
    font: "inherit",
    textDecoration: "none",
    appearance: "none",
    cursor: { default: appearance.cursorInteractive, ":disabled": "default" },
  },
  selected: {
    "--_row-fill": role.bgInteractiveSecondaryTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimary}`,
    color: role.contentPrimary,
  },
  primaryFocus: {
    outlineStyle: {
      default: "none",
      ':has([data-slot="row-primary"]:focus-visible)': "solid",
    },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
  },
  revealActions: {
    "--_row-actions-display": {
      default: "none",
      ":hover": "inline-flex",
      ":focus-within": "inline-flex",
      "@media (hover: none), (pointer: coarse)": "inline-flex",
    },
    "--_row-actions-opacity": {
      default: 0,
      ":hover": 1,
      ":focus-within": 1,
      "@media (hover: none), (pointer: coarse)": 1,
    },
  },
  primary: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: "inherit",
    flex: 1,
    minWidth: 0,
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
    outlineStyle: "none",
    cursor: { default: appearance.cursorInteractive, ":disabled": "default" },
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
    width: glyph.box,
    lineHeight: 0,
    color: `var(--_row-leading-color, ${role.contentSecondary})`,
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
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    color: `var(--_row-meta-color, ${role.contentSecondary})`,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
  },
  actions: {
    position: "relative",
    zIndex: 1,
    display: "var(--_row-actions-display, inline-flex)",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    alignSelf: "stretch",
    minWidth: 24,
  },
  actionsOverlay: {
    position: "absolute",
    zIndex: 1,
    insetInlineEnd: "var(--_row-padding-inline)",
    insetBlock: 0,
  },
});

type RowElementProps = StyledProps<useRender.ComponentProps<"div">>;

type RowButtonProps = StyledProps<useRender.ComponentProps<"button">>;

/** Notion Calendar's row sizes. `lg` is taller, with room for a description under the label. */
export type RowSize = "md" | "lg";

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
  /** Hides actions until hover or focus; always visible without hover support. */
  readonly revealActions?: boolean;
}

export type RowProps =
  | (RowElementProps & RowOwnProps & { readonly variant?: "list" })
  | (RowButtonProps & RowOwnProps & { readonly variant: "nav" });

type RowClickEvent = BaseUIEvent<ReactMouseEvent<HTMLElement>>;

function rowClickTarget(event: RowClickEvent) {
  const target = event.target;
  const root = event.currentTarget;
  if (!(target instanceof Element) || target.closest('[data-slot="row"]') !== root) return;
  if (target.closest('[data-slot="row-actions"]')) return;

  const primary =
    root.dataset.variant === "nav" ? root : root.querySelector('[data-slot="row-primary"]');
  if (!(primary instanceof HTMLElement)) return;

  const control = target.closest(
    'button, a[href], input, select, textarea, summary, [tabindex], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="combobox"], [role="spinbutton"], [role="textbox"], [contenteditable]:not([contenteditable="false"])',
  );
  if (control && control !== primary) return;
  return primary;
}

function preserveRowSelection(event: RowClickEvent) {
  if (!rowClickTarget(event)) return;
  if (!event.shiftKey && !event.currentTarget.ownerDocument.getSelection()?.toString()) return;
  event.preventDefault();
  event.stopPropagation();
  event.preventBaseUIHandler();
}

function activateRow(event: RowClickEvent) {
  if (event.defaultPrevented) return;
  const primary = rowClickTarget(event);
  if (!primary || primary === event.currentTarget) return;
  if (event.target instanceof Node && primary.contains(event.target)) return;
  if (primary.matches(':disabled, [aria-disabled="true"]')) return;

  event.stopPropagation();
  event.preventBaseUIHandler();
  primary.focus({ preventScroll: true });
  if (!primary.dispatchEvent(new MouseEvent("click", event.nativeEvent))) event.preventDefault();
}

/** One painted target, with sibling controls excluded from its primary action. */
export function Row({
  className,
  interactive = false,
  render,
  revealActions = false,
  selected = false,
  size = "md",
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
      ...mergeProps<"button" | "div">(rest, {
        onClickCapture: preserveRowSelection,
        onClick: activateRow,
      }),
      "data-slot": "row",
      "data-variant": variant,
      "data-selected": selected ? "" : undefined,
      type: nav && render === undefined ? "button" : undefined,
      ...mergeStyleProps(
        props(
          styles.root,
          size === "lg" && styles.lg,
          interactive && styles.interactive,
          revealActions && styles.revealActions,
          nav ? [styles.nav, focus.ringInset] : styles.primaryFocus,
          (interactive || nav) && selected && styles.selected,
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
 * The primary action for the whole row, including padding and sibling metadata.
 * `render` swaps the button for a link or another trigger. Actions remain siblings.
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
      ...mergeStyleProps(props(styles.primary, xstyle), className, style),
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
 * `overlay` floats the lane without taking layout space. The entire lane,
 * including gaps between controls, is excluded from primary activation.
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
