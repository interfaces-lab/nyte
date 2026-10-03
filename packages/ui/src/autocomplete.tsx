import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { focus } from "./a11y.stylex.ts";
import { floatingSurfaceStyles } from "./floating-surface.stylex.ts";
import { button, glyph, input, layer, menu, radius, target } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { appearance, motion, role, type } from "./vars.stylex.ts";
import { Icon } from "./icon.tsx";

const styles = create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    boxSizing: "border-box",
    minWidth: target.min,
    maxWidth: "100%",
    height: button.heightSm,
    minHeight: target.min,
    paddingBlock: 0,
    paddingInline: button.paddingInlineSm,
    overflow: "hidden",
    appearance: "none",
    borderRadius: button.radiusSm,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderPrimaryTranslucent,
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    backgroundImage: {
      default: "none",
      ":hover": role.layerHover,
      "[data-popup-open]": role.layerHover,
      "[data-disabled]": "none",
    },
    color: { default: role.contentPrimary, "[data-disabled]": role.contentDisabled },
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    cursor: { default: appearance.cursorInteractive, "[data-disabled]": "default" },
    flexShrink: 0,
  },
  clear: {
    minWidth: menu.itemHeight,
    minHeight: menu.itemHeight,
  },
  triggerValue: {
    display: "block",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    fontFamily: "inherit",
    lineHeight: type.leadingSm,
    textOverflow: "ellipsis",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  triggerIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  positioner: { zIndex: layer.menu, outline: "none" },
  popup: {
    display: "flex",
    flexDirection: "column",
    width: "min(280px, var(--available-width))",
    minWidth: "min(280px, var(--available-width))",
    maxWidth: "min(280px, var(--available-width))",
    maxHeight: "min(320px, var(--available-height))",
    padding: 0,
    overflowY: "hidden",
    borderStyle: "none",
    borderRadius: radius.control,
    outline: "none",
    color: role.contentPrimary,
    transformOrigin: "var(--transform-origin)",
    opacity: { default: 1, "[data-starting-style]": 0, "[data-ending-style]": 0 },
    transform: {
      default: "none",
      "[data-starting-style][data-side='top']": "translate3d(0, 2px, 0) scale(0.98)",
      "[data-ending-style][data-side='top']": "translate3d(0, 2px, 0) scale(0.98)",
      "[data-starting-style][data-side='right']": "translate3d(-2px, 0, 0) scale(0.98)",
      "[data-ending-style][data-side='right']": "translate3d(-2px, 0, 0) scale(0.98)",
      "[data-starting-style][data-side='bottom']": "translate3d(0, -2px, 0) scale(0.98)",
      "[data-ending-style][data-side='bottom']": "translate3d(0, -2px, 0) scale(0.98)",
      "[data-starting-style][data-side='left']": "translate3d(2px, 0, 0) scale(0.98)",
      "[data-ending-style][data-side='left']": "translate3d(2px, 0, 0) scale(0.98)",
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOutQuint,
  },
  input: {
    boxSizing: "border-box",
    flexShrink: 0,
    width: "100%",
    height: input.heightXl,
    margin: 0,
    paddingBlock: 0,
    paddingInline: 12,
    borderStyle: "none",
    borderRadius: 0,
    outline: "none",
    backgroundColor: "transparent",
    boxShadow: `inset 0 -1px 0 0 ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    "::placeholder": { color: role.contentTertiary },
  },
  list: {
    display: "flex",
    flexDirection: "column",
    flex: "0 1 auto",
    minHeight: 0,
    paddingBlock: 6,
    overflowY: "auto",
    overscrollBehavior: "contain",
    outline: "none",
  },
  item: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 6,
    minHeight: menu.itemHeight,
    paddingBlock: 0,
    paddingInline: 12,
    borderRadius: radius.control,
    outline: "none",
    backgroundColor: { default: "transparent", "[data-highlighted]": role.bgHover },
    color: { default: role.contentPrimary, "[data-disabled]": role.contentDisabled },
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    cursor: "default",
    userSelect: "none",
  },
  itemText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemIndicator: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 12,
    color: role.contentSecondary,
  },
  groupLabel: {
    paddingBlockStart: 6,
    paddingBlockEnd: 2,
    paddingInline: 12,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  separator: {
    flexShrink: 0,
    height: 1,
    marginBlock: 4,
    backgroundColor: role.borderSecondaryTranslucent,
  },
  empty: {
    flexShrink: 0,
    padding: "10px 12px",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  status: { padding: { default: 0, ":not(:empty)": "10px 12px" } },
});

/**
 * `popup` sits inside `AutocompleteContent`; `inline` sits in a host surface such as
 * a menu, which already supplies the padding and the item rhythm.
 */
const inputVariants = create({
  popup: {},
  inline: { height: menu.itemHeight, paddingInline: 8, boxShadow: "none" },
});

const listVariants = create({
  popup: {},
  inline: { display: "block", flex: 1, marginInline: -4, paddingBlock: 0, paddingInline: 4 },
});

const itemVariants = create({
  popup: {},
  inline: {
    gridTemplateColumns: `minmax(0, 1fr) ${glyph.sm}`,
    columnGap: 8,
    minHeight: menu.itemHeight,
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: menu.itemRadius,
  },
});

const itemIndicatorVariants = create({
  popup: {},
  inline: { width: glyph.sm },
});

const groupLabelVariants = create({
  popup: {},
  inline: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    paddingBlockStart: 4,
    paddingInline: 8,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    userSelect: "none",
  },
});

type AutocompleteVariant = keyof typeof inputVariants;

export const Autocomplete = AutocompletePrimitive.Root;

export const AutocompleteValue = AutocompletePrimitive.Value;

export const AutocompleteInputGroup = AutocompletePrimitive.InputGroup;

export const AutocompleteGroup = AutocompletePrimitive.Group;

export const AutocompleteCollection = AutocompletePrimitive.Collection;

export function AutocompleteTrigger({
  children,
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AutocompletePrimitive.Trigger.Props>): ReactElement {
  return (
    <AutocompletePrimitive.Trigger
      data-slot="autocomplete-trigger"
      {...mergeStyleProps(props(styles.trigger, focus.ring, xstyle), className, style)}
      {...rest}
    >
      <span {...props(styles.triggerValue)}>{children}</span>
      <AutocompletePrimitive.Icon {...props(styles.triggerIcon)}>
        <Icon name="chevron-down" size={11} />
      </AutocompletePrimitive.Icon>
    </AutocompletePrimitive.Trigger>
  );
}

export function AutocompleteClear({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AutocompletePrimitive.Clear.Props>): ReactElement {
  return (
    <AutocompletePrimitive.Clear
      data-slot="autocomplete-clear"
      {...mergeStyleProps(props(styles.clear, focus.ring, xstyle), className, style)}
      {...rest}
    />
  );
}

export type AutocompleteContentProps = StyledProps<AutocompletePrimitive.Popup.Props> &
  Pick<
    AutocompletePrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor" | "collisionAvoidance"
  > & {
    /** Scopes the popup to a hue. */
    readonly tint?: Tint;
  };

export function AutocompleteContent({
  side = "bottom",
  align = "start",
  sideOffset = 4,
  alignOffset,
  anchor,
  collisionAvoidance,
  tint,
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteContentProps): ReactElement {
  return (
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner
        positionMethod="fixed"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={8}
        {...props(styles.positioner)}
      >
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-content"
          {...mergeStyleProps(
            props(
              tint !== undefined && surfaceTheme[tint],
              floatingSurfaceStyles.popup,
              styles.popup,
              xstyle,
            ),
            className,
            style,
          )}
          {...rest}
        />
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  );
}

export function AutocompleteInput({
  variant = "popup",
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AutocompletePrimitive.Input.Props> & {
  readonly variant?: AutocompleteVariant;
}): ReactElement {
  return (
    <AutocompletePrimitive.Input
      data-slot="autocomplete-input"
      {...mergeStyleProps(props(styles.input, inputVariants[variant], xstyle), className, style)}
      {...rest}
    />
  );
}

export function AutocompleteList({
  variant = "popup",
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AutocompletePrimitive.List.Props> & {
  readonly variant?: AutocompleteVariant;
}): ReactElement {
  return (
    <AutocompletePrimitive.List
      data-slot="autocomplete-list"
      {...mergeStyleProps(props(styles.list, listVariants[variant], xstyle), className, style)}
      {...rest}
    />
  );
}

export function AutocompleteItem({
  variant = "popup",
  selected = false,
  children,
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AutocompletePrimitive.Item.Props> & {
  readonly variant?: AutocompleteVariant;
  /** Marks the current value with a trailing checkmark. */
  readonly selected?: boolean;
}): ReactElement {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      {...mergeStyleProps(props(styles.item, itemVariants[variant], xstyle), className, style)}
      {...rest}
    >
      <span {...props(styles.itemText)}>{children}</span>
      <span aria-hidden="true" {...props(styles.itemIndicator, itemIndicatorVariants[variant])}>
        {selected ? <Icon name="checkmark" size={11} /> : null}
      </span>
    </AutocompletePrimitive.Item>
  );
}

export function AutocompleteGroupLabel({
  variant = "popup",
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AutocompletePrimitive.GroupLabel.Props> & {
  readonly variant?: AutocompleteVariant;
}): ReactElement {
  return (
    <AutocompletePrimitive.GroupLabel
      data-slot="autocomplete-group-label"
      {...mergeStyleProps(
        props(styles.groupLabel, groupLabelVariants[variant], xstyle),
        className,
        style,
      )}
      {...rest}
    />
  );
}

export function AutocompleteSeparator({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AutocompletePrimitive.Separator.Props>): ReactElement {
  return (
    <AutocompletePrimitive.Separator
      data-slot="autocomplete-separator"
      {...mergeStyleProps(props(styles.separator, xstyle), className, style)}
      {...rest}
    />
  );
}

export function AutocompleteEmpty({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AutocompletePrimitive.Empty.Props>): ReactElement {
  return (
    <AutocompletePrimitive.Empty
      data-slot="autocomplete-empty"
      {...mergeStyleProps(props(styles.empty, xstyle), className, style)}
      {...rest}
    />
  );
}

export function AutocompleteStatus({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<AutocompletePrimitive.Status.Props>): ReactElement {
  return (
    <AutocompletePrimitive.Status
      data-slot="autocomplete-status"
      {...mergeStyleProps(props(styles.empty, styles.status, xstyle), className, style)}
      {...rest}
    />
  );
}
