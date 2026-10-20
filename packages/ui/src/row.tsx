import { mergeProps } from "@base-ui/react/merge-props";
import type { BaseUIEvent } from "@base-ui/react/types";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useRender } from "@base-ui/react/use-render";
import { create, props, type StyleXStyles } from "@stylexjs/stylex";

import { focus } from "./styles/a11y.stylex.ts";
import { glyph, media, row, space, target } from "./styles/schema.stylex.ts";
import { selectionWithin } from "./selection.ts";
import { mergeStyleProps, type StyledProps, type XStyle } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { appearance, motion, role, type } from "./styles/vars.stylex.ts";

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
  bare: { position: "relative", isolation: "isolate" },
  lg: {
    minHeight: row.heightLg,
    "--_row-padding-inline": row.paddingInlineLg,
    paddingBlock: space.s1_5,
  },
  interactive: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { [media.hover]: role.bgHover },
      ":focus-within": role.bgHover,
    },
  },
  nav: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { [media.hover]: role.bgHover },
    },
    flexShrink: 0,
    margin: 0,
    paddingBlock: 0,
    borderRadius: row.radius,
    color: {
      default: role.contentChrome,
      ":hover": { [media.hover]: role.contentPrimary },
      ":focus-visible": role.contentPrimary,
      ":disabled": role.contentDisabled,
      "[data-disabled]": role.contentDisabled,
    },
    font: "inherit",
    textDecoration: "none",
    appearance: "none",
    cursor: {
      default: appearance.cursorInteractive,
      ":disabled": "default",
      "[data-disabled]": "default",
    },
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
      ":hover": { [media.hover]: "inline-flex" },
      ":focus-within": "inline-flex",
      "@media (hover: none), (pointer: coarse)": "inline-flex",
    },
    "--_row-actions-opacity": {
      default: 0,
      ":hover": { [media.hover]: 1 },
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
    color: "inherit",
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
    gap: target.gap,
    flexShrink: 0,
    alignSelf: "stretch",
    minWidth: target.min,
  },
  actionsOverlay: {
    position: "absolute",
    zIndex: 1,
    insetInlineEnd: "var(--_row-padding-inline)",
    insetBlock: 0,
  },
});

type RowPartProps<Style extends XStyle = XStyle> = StyledProps<
  useRender.ComponentProps<"span">,
  Style
>;

interface RowOwnProps {
  readonly size?: "md" | "lg";
  readonly interactive?: boolean;
  readonly selected?: boolean;
  readonly revealActions?: boolean;
}

type RowProps =
  | (StyledProps<useRender.ComponentProps<"div">, Restyle<"Row">> &
      RowOwnProps & { readonly variant?: "list" })
  | (StyledProps<useRender.ComponentProps<"button">, Restyle<"Row">> &
      RowOwnProps & {
        readonly variant: "nav";
      })
  | (StyledProps<useRender.ComponentProps<"div">, Restyle<"Row[variant=bare]">> &
      RowOwnProps & {
        readonly variant: "bare";
      });

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

  if (control && control !== primary && root.contains(control)) return;

  return primary;
}

function preserveRowSelection(event: RowClickEvent) {
  if (!rowClickTarget(event)) return;

  if (!event.shiftKey && !selectionWithin(event.currentTarget)) return;
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
      type: nav && render === undefined ? "button" : undefined,
      ...mergeProps<"button" | "div">(rest, {
        onClickCapture: preserveRowSelection,
        onClick: activateRow,
      }),
      "data-slot": "row",
      ...mergeStyleProps(
        props(
          variant === "bare"
            ? styles.bare
            : [
                styles.root,
                size === "lg" && styles.lg,
                interactive && styles.interactive,
                revealActions && styles.revealActions,
                nav ? [styles.nav, focus.ringInset] : styles.primaryFocus,
                (interactive || nav) && selected && styles.selected,
              ],
          xstyle,
        ),
        className,
        style,
      ),
    },
    state: { variant, selected },
  });
}

type RowSlot =
  | "row-backdrop"
  | "row-leading"
  | "row-body"
  | "row-label"
  | "row-description"
  | "row-meta";

function rowPart<Style extends XStyle = XStyle>(
  slot: RowSlot,
  part: StyleXStyles,
  decorative = false,
) {
  return function RowPart({ className, render, style, xstyle, ...rest }: RowPartProps<Style>) {
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

const RowBackdrop = rowPart("row-backdrop", styles.backdrop, true);

const RowLeading = rowPart<Restyle<"Row.Leading">>("row-leading", styles.leading);

const RowBody = rowPart<Restyle<"Row.Body">>("row-body", styles.body);

const RowLabel = rowPart<Restyle<"Row.Label">>("row-label", styles.label);

const RowDescription = rowPart<Restyle<"Row.Description">>("row-description", styles.description);

const RowMeta = rowPart<Restyle<"Row.Meta">>("row-meta", styles.meta);

function RowActions({
  className,
  placement = "inline",
  render,
  style,
  xstyle,
  ...rest
}: RowPartProps<Restyle<"Row.Actions">> & { readonly placement?: "inline" | "overlay" }) {
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
