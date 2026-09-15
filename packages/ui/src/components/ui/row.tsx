import { useRender } from "@base-ui/react/use-render";
import * as stylex from "@stylexjs/stylex";
import type * as React from "react";

import {
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  radiusVars,
} from "../../platform-tokens.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";

/**
 * Whether the trailing lane is always visible, or appears on hover. `hover`
 * also reveals on `:focus-within`, or the actions would be unreachable by
 * keyboard.
 */
export type RowTrailingReveal = "always" | "hover";

interface RowOwnProps {
  /** Icon, avatar, or status indicator. Occupies a fixed lane so labels align. */
  readonly leading?: React.ReactNode;
  /** The primary label. Named `label` so the DOM `title` attribute stays free. */
  readonly label: React.ReactNode;
  /** A second line under the label. Its presence is what stacks the body. */
  readonly description?: React.ReactNode;
  /** Trailing text such as a time or a count. */
  readonly meta?: React.ReactNode;
  /** Actions, a switch, or a chevron. */
  readonly trailing?: React.ReactNode;
  readonly trailingReveal?: RowTrailingReveal;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** Applies the pointer cursor and the default hover fill. */
  readonly interactive?: boolean;
}

export type RowProps = StyledProps<useRender.ComponentProps<"div">> & RowOwnProps;

/**
 * One row of a list: a leading lane, a label with an optional description, and
 * trailing meta and actions.
 *
 * Row owns structure and nothing else. Height, gap, and inline padding are
 * surface decisions, so they arrive as `--nyte-row-height`, `--nyte-row-gap`,
 * and `--nyte-row-padding-inline`, each falling back to a control-scale value.
 * A surface sets them once on its list container. There is deliberately no
 * size or density prop: a dense list is a surface that measures differently,
 * not a different kind of row.
 *
 * Render it as the element the surface needs — a `button` for a command, an
 * `a` for navigation, an `li` inside a list — through `render`.
 */
export function Row({
  className,
  description,
  disabled = false,
  interactive = false,
  label,
  leading,
  meta,
  render,
  selected = false,
  style,
  trailing,
  trailingReveal = "always",
  xstyle,
  ...props
}: RowProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: {
      "data-slot": "row",
      "data-selected": selected ? "" : undefined,
      "data-disabled": disabled ? "" : undefined,
      ...props,
      ...mergeStyleProps(
        stylex.props(
          styles.root,
          interactive && styles.interactive,
          selected && styles.selected,
          disabled && styles.disabled,
          trailingReveal === "hover" && styles.trailingOnHover,
          xstyle,
        ),
        className,
        style,
      ),
      children: (
        <>
          {leading !== undefined && <span {...stylex.props(styles.leading)}>{leading}</span>}
          {description === undefined ? (
            <span {...stylex.props(styles.label)}>{label}</span>
          ) : (
            <span {...stylex.props(styles.body)}>
              <span {...stylex.props(styles.label)}>{label}</span>
              <span {...stylex.props(styles.description)}>{description}</span>
            </span>
          )}
          {meta !== undefined && <span {...stylex.props(styles.meta)}>{meta}</span>}
          {trailing !== undefined && <span {...stylex.props(styles.trailing)}>{trailing}</span>}
        </>
      ),
    },
  });
}

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: `var(--nyte-row-height, ${controlVars["--nyte-control-height-md"]})`,
    gap: `var(--nyte-row-gap, ${controlVars["--nyte-control-padding-xs"]})`,
    paddingInline: `var(--nyte-row-padding-inline, ${controlVars["--nyte-control-padding-sm"]})`,
    borderStyle: "none",
    borderRadius: radiusVars["--nyte-radius-control"],
    /*
     * The fill is a variable each row kind sets, never a condition declared
     * here: StyleX merges a property's conditions into one key, so a kind that
     * declared its own `backgroundColor` would silently drop the states below.
     * A kind that sets `--_row-fill` owns every state of it, which is the point.
     */
    backgroundColor: "var(--_row-fill, transparent)",
    color: colorVars["--nyte-color-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-body"],
    lineHeight: fontVars["--nyte-leading-body"],
    textAlign: "start",
    // A row sits flush in a scroll container, where an outset ring would clip.
    outlineColor: colorVars["--nyte-color-focus-ring"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--nyte-control-focus-width"],
    outlineOffset: "-2px",
    transitionProperty: "background-color, color",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
  interactive: {
    cursor: "pointer",
    "--_row-fill": {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--nyte-color-muted"] },
    },
  },
  selected: {
    "--_row-fill": colorVars["--nyte-color-muted"],
    // Meta text drops a step against a plain page and regains it once the row
    // is filled, so the two stay legible against different backgrounds.
    "--_row-meta-color": colorVars["--nyte-color-muted-foreground"],
  },
  disabled: {
    cursor: "default",
    pointerEvents: "none",
    opacity: controlVars["--nyte-control-disabled-opacity"],
  },
  trailingOnHover: {
    "--_row-trailing-opacity": {
      default: 0,
      ":hover": 1,
      ":focus-within": 1,
    },
  },
  leading: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
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
    fontSize: fontVars["--nyte-font-size-detail"],
    lineHeight: fontVars["--nyte-leading-detail"],
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    color: `var(--_row-meta-color, ${colorVars["--nyte-color-tertiary-foreground"]})`,
    fontSize: fontVars["--nyte-font-size-detail"],
    lineHeight: fontVars["--nyte-leading-detail"],
    fontVariantNumeric: "tabular-nums",
  },
  trailing: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--nyte-control-gap-sm"],
    flexShrink: 0,
    opacity: "var(--_row-trailing-opacity, 1)",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--nyte-motion-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--nyte-motion-ease-out"],
  },
});
