import { Combobox } from "@base-ui/react/combobox";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { focus } from "./styles/a11y.stylex.ts";
import { floatingSurfaceStyles } from "./styles/floating-surface.stylex.ts";
import { glyph, input, layer, menu, radius, space } from "./styles/schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { appearance, motion, role, type } from "./styles/vars.stylex.ts";
import { PickerTrigger, type PickerTriggerProps } from "./button.tsx";
import { Icon } from "./icon.tsx";

const styles = create({
  clear: {
    minWidth: menu.itemHeight,
    minHeight: menu.itemHeight,
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
    overflowY: "clip",
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
    paddingInline: space.s3,
    borderStyle: "none",
    borderRadius: 0,
    backgroundColor: "transparent",
    boxShadow: `inset 0 -1px 0 0 ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: {
      default: type.fontBase,
      "@media (pointer: coarse)": `max(16px, ${type.fontBase})`,
    },
    lineHeight: type.leadingBase,
    "::placeholder": { color: role.contentSecondary },
  },
  list: {
    display: "flex",
    flexDirection: "column",
    flex: "0 1 auto",
    minHeight: 0,
    paddingBlock: space.s1_5,
    overflowY: "auto",
    overscrollBehavior: "contain",
    outline: "none",
  },
  item: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 12px",
    alignItems: "center",
    columnGap: space.s1_5,
    minHeight: menu.itemHeight,
    paddingBlock: 0,
    paddingInline: space.s3,
    borderRadius: radius.control,
    outlineStyle: { default: "none", "[data-highlighted]": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
    backgroundColor: { default: "transparent", "[data-highlighted]": role.bgHover },
    color: { default: role.contentPrimary, "[data-disabled]": role.contentDisabled },
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
    paddingBlockStart: space.s1_5,
    paddingBlockEnd: space.s0_5,
    paddingInline: space.s3,
    color: role.contentSecondary,
  },
  separator: {
    flexShrink: 0,
    height: 1,
    marginBlock: space.s1,
    backgroundColor: role.borderSecondaryTranslucent,
  },
  empty: {
    flexShrink: 0,
    padding: { default: 0, ":not(:empty)": `${space.s2_5} ${space.s3}` },
    color: role.contentSecondary,
  },
});

const inputVariants = create({
  popup: {},
  inline: { height: menu.itemHeight, paddingInline: space.s2, boxShadow: "none" },
});

const listVariants = create({
  popup: {},
  inline: {
    display: "block",
    flex: 1,
    marginInline: `calc(${space.s1} * -1)`,
    paddingBlock: 0,
    paddingInline: space.s1,
  },
});

const itemVariants = create({
  popup: {},
  inline: {
    gridTemplateColumns: `minmax(0, 1fr) ${glyph.sm}`,
    columnGap: space.s2,
    minHeight: menu.itemHeight,
    paddingBlock: space.s1,
    paddingInline: space.s2,
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
    gap: space.s1_5,
    paddingBlockStart: space.s1,
    paddingInline: space.s2,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    userSelect: "none",
  },
});

type AutocompleteVariant = keyof typeof inputVariants;

export const Autocomplete = Combobox.Root;

export const AutocompleteValue = Combobox.Value;

export const AutocompleteInputGroup = Combobox.InputGroup;

export const AutocompleteGroup = Combobox.Group;

export const AutocompleteCollection = Combobox.Collection;

export function AutocompleteTrigger({
  width,
  xstyle,
  className,
  style,
  ...rest
}: Omit<Combobox.Trigger.Props, "className" | "style" | "render"> &
  Pick<PickerTriggerProps, "width" | "xstyle" | "className" | "style">): ReactElement {
  return (
    <Combobox.Trigger
      data-slot="autocomplete-trigger"
      render={<PickerTrigger width={width} xstyle={xstyle} className={className} style={style} />}
      {...rest}
    />
  );
}

export function AutocompleteClear({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<Combobox.Clear.Props, Restyle<"AutocompleteClear">>): ReactElement {
  return (
    <Combobox.Clear
      data-slot="autocomplete-clear"
      {...mergeStyleProps(props(styles.clear, focus.ring, xstyle), className, style)}
      {...rest}
    />
  );
}

export type AutocompleteContentProps = StyledProps<
  Combobox.Popup.Props,
  Restyle<"AutocompleteContent">
> &
  Pick<
    Combobox.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor" | "collisionAvoidance"
  > & {
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
    <Combobox.Portal>
      <Combobox.Positioner
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
        <Combobox.Popup
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
      </Combobox.Positioner>
    </Combobox.Portal>
  );
}

export function AutocompleteInput({
  variant = "popup",
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<Combobox.Input.Props, Restyle<"AutocompleteInput">> & {
  readonly variant?: AutocompleteVariant;
}): ReactElement {
  return (
    <Combobox.Input
      data-slot="autocomplete-input"
      {...mergeStyleProps(
        props(styles.input, focus.ringInset, inputVariants[variant], xstyle),
        className,
        style,
      )}
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
}: StyledProps<Combobox.List.Props, Restyle<"AutocompleteList">> & {
  readonly variant?: AutocompleteVariant;
}): ReactElement {
  return (
    <Combobox.List
      data-slot="autocomplete-list"
      {...mergeStyleProps(props(styles.list, listVariants[variant], xstyle), className, style)}
      {...rest}
    />
  );
}

export function AutocompleteItem({
  variant = "popup",
  children,
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<Combobox.Item.Props, Restyle<"AutocompleteItem">> & {
  readonly variant?: AutocompleteVariant;
}): ReactElement {
  return (
    <Combobox.Item
      data-slot="autocomplete-item"
      {...mergeStyleProps(
        props(text.base, styles.item, itemVariants[variant], xstyle),
        className,
        style,
      )}
      {...rest}
    >
      <span {...props(styles.itemText)}>{children}</span>
      <Combobox.ItemIndicator {...props(styles.itemIndicator, itemIndicatorVariants[variant])}>
        <Icon name="checkmark" size={11} />
      </Combobox.ItemIndicator>
    </Combobox.Item>
  );
}

export function AutocompleteGroupLabel({
  variant = "popup",
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<Combobox.GroupLabel.Props, Restyle<"AutocompleteGroupLabel">> & {
  readonly variant?: AutocompleteVariant;
}): ReactElement {
  return (
    <Combobox.GroupLabel
      data-slot="autocomplete-group-label"
      {...mergeStyleProps(
        props(text.sm, styles.groupLabel, groupLabelVariants[variant], xstyle),
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
}: StyledProps<Combobox.Separator.Props, Restyle<"AutocompleteSeparator">>): ReactElement {
  return (
    <Combobox.Separator
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
}: StyledProps<Combobox.Empty.Props, Restyle<"AutocompleteEmpty">>): ReactElement {
  return (
    <Combobox.Empty
      data-slot="autocomplete-empty"
      {...mergeStyleProps(props(text.sm, styles.empty, xstyle), className, style)}
      {...rest}
    />
  );
}

export function AutocompleteStatus({
  className,
  style,
  xstyle,
  ...rest
}: StyledProps<Combobox.Status.Props, Restyle<"AutocompleteStatus">>): ReactElement {
  return (
    <Combobox.Status
      data-slot="autocomplete-status"
      {...mergeStyleProps(props(text.sm, styles.empty, xstyle), className, style)}
      {...rest}
    />
  );
}
