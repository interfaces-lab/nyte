import { Select as SelectPrimitive } from "@base-ui/react/select";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { focus } from "./a11y.stylex.ts";
import { button, layer, menu, shape, target } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { appearance, motion, role, shadow, type } from "./vars.stylex.ts";
import { Icon } from "./icon.tsx";
import { useOverlayRef } from "./overlay.tsx";

const COLLISION: NonNullable<SelectPrimitive.Positioner.Props["collisionAvoidance"]> = {
  side: "flip",
  align: "shift",
  fallbackAxisSide: "none",
};

const styles = create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    boxSizing: "border-box",
    minWidth: 112,
    maxWidth: 180,
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
  value: {
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
  icon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  positioner: { zIndex: layer.menu, outline: "none" },
  popup: {
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: "var(--anchor-width)",
    maxWidth: "min(320px, var(--available-width))",
    maxHeight: "var(--available-height)",
    padding: menu.padding,
    overflowY: "auto",
    overscrollBehavior: "contain",
    borderStyle: "none",
    borderRadius: shape.control,
    outline: "none",
    backgroundColor: role.popupMaterial,
    backdropFilter: appearance.popupMaterialFilter,
    boxShadow: shadow.shadowLg,
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
      pointerEvents: "none",
    },
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
  list: {
    display: "flex",
    flexDirection: "column",
    outline: "none",
  },
  item: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: menu.itemGap,
    minHeight: menu.itemHeight,
    paddingBlock: menu.itemPaddingBlock,
    paddingInline: menu.itemPaddingInline,
    borderRadius: menu.itemRadius,
    outline: "none",
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": role.bgHover,
      "[data-selected]": role.bgInteractiveSecondaryTranslucent,
      "[data-selected][data-highlighted]": role.bgInteractiveSecondaryTranslucent,
    },
    // A selected row carries a hairline, so it reads apart from the hovered one.
    boxShadow: { default: "none", "[data-selected]": `inset 0 0 0 1px ${role.borderPrimary}` },
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
});

const triggerWidths = create({
  standard: {},
  wide: { minWidth: 0, maxWidth: "100%" },
});

export const Select = SelectPrimitive.Root;

export type SelectTriggerProps = StyledProps<SelectPrimitive.Trigger.Props> & {
  /** `wide` lets the trigger fill its container instead of stopping at 180px. */
  readonly width?: keyof typeof triggerWidths;
};

export function SelectTrigger({
  width = "standard",
  children,
  xstyle,
  className,
  style,
  ...rest
}: SelectTriggerProps): ReactElement {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      {...mergeStyleProps(
        props(styles.trigger, triggerWidths[width], focus.ring, xstyle),
        className,
        style,
      )}
      {...rest}
    >
      {children}
      <SelectPrimitive.Icon {...props(styles.icon)}>
        <Icon name="chevron-down" size={11} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export type SelectValueProps = StyledProps<SelectPrimitive.Value.Props>;

export function SelectValue({ xstyle, className, style, ...rest }: SelectValueProps): ReactElement {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      {...mergeStyleProps(props(styles.value, xstyle), className, style)}
      {...rest}
    />
  );
}

export type SelectContentProps = StyledProps<Omit<SelectPrimitive.Popup.Props, "ref">> &
  Pick<
    SelectPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "alignItemWithTrigger" | "collisionAvoidance"
  > & {
    /** Scopes the popup to a hue. */
    readonly tint?: Tint;
  };

export function SelectContent({
  side = "bottom",
  align = "end",
  sideOffset = 4,
  alignOffset,
  alignItemWithTrigger = false,
  collisionAvoidance = COLLISION,
  tint,
  children,
  xstyle,
  className,
  style,
  ...rest
}: SelectContentProps): ReactElement {
  const overlayRef = useOverlayRef();

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        positionMethod="fixed"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        collisionPadding={8}
        collisionAvoidance={collisionAvoidance}
        {...props(styles.positioner)}
      >
        <SelectPrimitive.Popup
          ref={overlayRef}
          data-slot="select-content"
          {...mergeStyleProps(
            props(tint !== undefined && surfaceTheme[tint], styles.popup, xstyle),
            className,
            style,
          )}
          {...rest}
        >
          <SelectPrimitive.List {...props(styles.list)}>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export type SelectItemProps = StyledProps<SelectPrimitive.Item.Props>;

export function SelectItem({
  children,
  xstyle,
  className,
  style,
  ...rest
}: SelectItemProps): ReactElement {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      {...mergeStyleProps(props(styles.item, xstyle), className, style)}
      {...rest}
    >
      <SelectPrimitive.ItemText {...props(styles.itemText)}>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator {...props(styles.itemIndicator)}>
        <Icon name="checkmark" size={11} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
