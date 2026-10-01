import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, type ReactElement, type Ref } from "react";

import { focus } from "../../a11y.stylex.ts";
import { floatingSurfaceStyles } from "../../floating-surface.stylex.ts";
import { button, input, layer, menu, shape } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { surfaceTheme, type Tint } from "../../surface-theme.ts";
import { appearance, motion, role, type } from "../../vars.stylex.ts";
import { Icon } from "./icon.tsx";
import { useOverlayRef } from "./overlay.tsx";

const styles = create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    boxSizing: "border-box",
    minWidth: { default: 0, "@media (pointer: coarse)": menu.itemHeight },
    maxWidth: "100%",
    height: { default: button.heightSm, "@media (pointer: coarse)": menu.itemHeight },
    minHeight: 24,
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
    borderRadius: shape.control,
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
  inputInline: {
    height: menu.itemHeight,
    paddingInline: 8,
    boxShadow: "none",
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
  listInline: {
    display: "block",
    flex: 1,
    marginInline: -4,
    paddingBlock: 0,
    paddingInline: 4,
  },
  item: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 6,
    minHeight: `max(30px, ${menu.itemHeight})`,
    paddingBlock: 0,
    paddingInline: 12,
    borderRadius: shape.control,
    outline: "none",
    backgroundColor: { default: "transparent", "[data-highlighted]": role.bgHover },
    color: { default: role.contentPrimary, "[data-disabled]": role.contentDisabled },
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    cursor: "default",
    userSelect: "none",
  },
  itemInline: {
    gridTemplateColumns: "minmax(0, 1fr) 14px",
    columnGap: 8,
    minHeight: menu.itemHeight,
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: menu.itemRadius,
  },
  itemSelectedInline: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimary}`,
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
  itemIndicatorInline: { width: 14 },
  groupLabel: {
    paddingBlockStart: 6,
    paddingBlockEnd: 2,
    paddingInline: 12,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  groupLabelInline: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    paddingBlockStart: 4,
    paddingInline: 8,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    userSelect: "none",
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

const InPopupContext = createContext(false);

export type AutocompleteTriggerProps = StyledProps<AutocompletePrimitive.Trigger.Props>;

function AutocompleteTrigger({
  children,
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteTriggerProps): ReactElement {
  return (
    <AutocompletePrimitive.Trigger
      {...mergeStyleProps(props(styles.trigger, focus.ring, xstyle), className, style)}
      {...rest}
    >
      <span {...props(styles.triggerValue)}>{children}</span>
      <span aria-hidden="true" {...props(styles.triggerIcon)}>
        <Icon name="chevron-down" size={11} />
      </span>
    </AutocompletePrimitive.Trigger>
  );
}

export type AutocompletePositionerProps = StyledProps<AutocompletePrimitive.Positioner.Props>;

function AutocompletePositioner({
  positionMethod = "fixed",
  collisionPadding = 8,
  className,
  style,
  xstyle,
  ...rest
}: AutocompletePositionerProps): ReactElement {
  return (
    <AutocompletePrimitive.Positioner
      positionMethod={positionMethod}
      collisionPadding={collisionPadding}
      {...mergeStyleProps(props(styles.positioner, xstyle), className, style)}
      {...rest}
    />
  );
}

export type AutocompletePopupProps = StyledProps<AutocompletePrimitive.Popup.Props> & {
  readonly tint?: Tint;
};

function AutocompletePopup({
  tint,
  className,
  style,
  xstyle,
  ...rest
}: AutocompletePopupProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <InPopupContext value>
      <AutocompletePrimitive.Popup
        ref={overlayRef}
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
    </InPopupContext>
  );
}

export type AutocompleteInputProps = StyledProps<AutocompletePrimitive.Input.Props> & {
  readonly ref?: Ref<HTMLInputElement>;
};

function AutocompleteInput({
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteInputProps): ReactElement {
  const inPopup = use(InPopupContext);

  return (
    <AutocompletePrimitive.Input
      {...mergeStyleProps(
        props(styles.input, !inPopup && styles.inputInline, xstyle),
        className,
        style,
      )}
      {...rest}
    />
  );
}

export type AutocompleteListProps = StyledProps<AutocompletePrimitive.List.Props>;

function AutocompleteList({
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteListProps): ReactElement {
  const inPopup = use(InPopupContext);

  return (
    <AutocompletePrimitive.List
      {...mergeStyleProps(
        props(styles.list, !inPopup && styles.listInline, xstyle),
        className,
        style,
      )}
      {...rest}
    />
  );
}

export type AutocompleteItemProps = StyledProps<AutocompletePrimitive.Item.Props> & {
  readonly ref?: Ref<HTMLDivElement>;
  /** Marks the current value with a trailing checkmark. */
  readonly selected?: boolean;
};

function AutocompleteItem({
  selected = false,
  children,
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteItemProps): ReactElement {
  const inPopup = use(InPopupContext);

  return (
    <AutocompletePrimitive.Item
      {...mergeStyleProps(
        props(
          styles.item,
          !inPopup && styles.itemInline,
          !inPopup && selected && styles.itemSelectedInline,
          xstyle,
        ),
        className,
        style,
      )}
      {...rest}
    >
      <span {...props(styles.itemText)}>{children}</span>
      <span
        aria-hidden="true"
        {...props(styles.itemIndicator, !inPopup && styles.itemIndicatorInline)}
      >
        {selected ? <Icon name="checkmark" size={11} /> : null}
      </span>
    </AutocompletePrimitive.Item>
  );
}

export type AutocompleteGroupLabelProps = StyledProps<AutocompletePrimitive.GroupLabel.Props>;

function AutocompleteGroupLabel({
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteGroupLabelProps): ReactElement {
  const inPopup = use(InPopupContext);

  return (
    <AutocompletePrimitive.GroupLabel
      {...mergeStyleProps(
        props(styles.groupLabel, !inPopup && styles.groupLabelInline, xstyle),
        className,
        style,
      )}
      {...rest}
    />
  );
}

export type AutocompleteSeparatorProps = StyledProps<AutocompletePrimitive.Separator.Props>;

function AutocompleteSeparator({
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteSeparatorProps): ReactElement {
  return (
    <AutocompletePrimitive.Separator
      {...mergeStyleProps(props(styles.separator, xstyle), className, style)}
      {...rest}
    />
  );
}

export type AutocompleteEmptyProps = StyledProps<AutocompletePrimitive.Empty.Props>;

function AutocompleteEmpty({
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteEmptyProps): ReactElement {
  return (
    <AutocompletePrimitive.Empty
      {...mergeStyleProps(props(styles.empty, xstyle), className, style)}
      {...rest}
    />
  );
}

export type AutocompleteStatusProps = StyledProps<AutocompletePrimitive.Status.Props>;

function AutocompleteStatus({
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteStatusProps): ReactElement {
  return (
    <AutocompletePrimitive.Status
      {...mergeStyleProps(props(styles.empty, styles.status, xstyle), className, style)}
      {...rest}
    />
  );
}

export type AutocompleteBackdropProps = StyledProps<AutocompletePrimitive.Backdrop.Props>;

function AutocompleteBackdrop({
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteBackdropProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <AutocompletePrimitive.Backdrop
      ref={overlayRef}
      {...rest}
      {...mergeStyleProps(props(xstyle), className, style)}
    />
  );
}

export type AutocompleteClearProps = StyledProps<AutocompletePrimitive.Clear.Props>;

function AutocompleteClear({
  className,
  style,
  xstyle,
  ...rest
}: AutocompleteClearProps): ReactElement {
  return (
    <AutocompletePrimitive.Clear
      {...rest}
      {...mergeStyleProps(props(styles.clear, focus.ring, xstyle), className, style)}
    />
  );
}

export const Autocomplete = {
  Root: AutocompletePrimitive.Root,
  Value: AutocompletePrimitive.Value,
  Trigger: AutocompleteTrigger,
  InputGroup: AutocompletePrimitive.InputGroup,
  Input: AutocompleteInput,
  Icon: AutocompletePrimitive.Icon,
  Clear: AutocompleteClear,
  Portal: AutocompletePrimitive.Portal,
  Backdrop: AutocompleteBackdrop,
  Positioner: AutocompletePositioner,
  Popup: AutocompletePopup,
  Arrow: AutocompletePrimitive.Arrow,
  Status: AutocompleteStatus,
  Empty: AutocompleteEmpty,
  List: AutocompleteList,
  Group: AutocompletePrimitive.Group,
  GroupLabel: AutocompleteGroupLabel,
  Collection: AutocompletePrimitive.Collection,
  Item: AutocompleteItem,
  Row: AutocompletePrimitive.Row,
  Separator: AutocompleteSeparator,
  useFilter: AutocompletePrimitive.useFilter,
  useFilteredItems: AutocompletePrimitive.useFilteredItems,
};
