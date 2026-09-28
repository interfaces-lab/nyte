import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { create, props } from "@stylexjs/stylex";
import { createContext, use, type ReactElement, type Ref } from "react";

import { focus } from "../../a11y.stylex.ts";
import { floatingSurfaceStyles } from "../../floating-surface.stylex.ts";
import { layer, menu } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";
import { Icon } from "./icon.tsx";
import { useOverlayRef } from "./overlay.tsx";

const styles = create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    boxSizing: "border-box",
    minWidth: 0,
    maxWidth: "100%",
    height: 24,
    paddingBlock: 0,
    paddingInline: 8,
    overflow: "hidden",
    appearance: "none",
    borderRadius: t.radiusBase,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokePrimary,
    backgroundColor: t.fillQuiet,
    backgroundImage: {
      default: "none",
      ":hover": t.layerHover,
      "[data-popup-open]": t.layerHover,
      "[data-disabled]": "none",
    },
    color: { default: t.textPrimary, "[data-disabled]": t.textQuaternary },
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    cursor: { default: t.cursorInteractive, "[data-disabled]": "default" },
    flexShrink: 0,
  },
  triggerValue: {
    display: "block",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    fontFamily: "inherit",
    lineHeight: t.leadingSm,
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
    borderRadius: t.radiusLg,
    outline: "none",
    color: t.textPrimary,
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
      default: t.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOutQuint,
  },
  input: {
    boxSizing: "border-box",
    flexShrink: 0,
    width: "100%",
    height: 36,
    margin: 0,
    paddingBlock: 0,
    paddingInline: 12,
    borderStyle: "none",
    borderRadius: 0,
    outline: "none",
    backgroundColor: "transparent",
    boxShadow: `inset 0 -1px 0 0 ${t.strokeSecondary}`,
    color: t.textPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    "::placeholder": { color: t.textTertiary },
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
    minHeight: 30,
    paddingBlock: 0,
    paddingInline: 12,
    borderRadius: t.radiusBase,
    outline: "none",
    backgroundColor: { default: "transparent", "[data-highlighted]": t.fillHover },
    color: { default: t.textPrimary, "[data-disabled]": t.textQuaternary },
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
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
  itemSelectedInline: { backgroundColor: t.fillSelected },
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
    color: t.textSecondary,
  },
  itemIndicatorInline: { width: 14 },
  groupLabel: {
    paddingBlockStart: 6,
    paddingBlockEnd: 2,
    paddingInline: 12,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  groupLabelInline: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    paddingBlockStart: 4,
    paddingInline: 8,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    userSelect: "none",
  },
  separator: {
    flexShrink: 0,
    height: 1,
    marginBlock: 4,
    backgroundColor: t.strokeSecondary,
  },
  empty: {
    flexShrink: 0,
    padding: "10px 12px",
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
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

export type AutocompletePopupProps = StyledProps<AutocompletePrimitive.Popup.Props>;

function AutocompletePopup({
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
          props(floatingSurfaceStyles.popup, styles.popup, xstyle),
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

export const Autocomplete = {
  Root: AutocompletePrimitive.Root,
  Value: AutocompletePrimitive.Value,
  Trigger: AutocompleteTrigger,
  InputGroup: AutocompletePrimitive.InputGroup,
  Input: AutocompleteInput,
  Icon: AutocompletePrimitive.Icon,
  Clear: AutocompletePrimitive.Clear,
  Portal: AutocompletePrimitive.Portal,
  Backdrop: AutocompletePrimitive.Backdrop,
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
