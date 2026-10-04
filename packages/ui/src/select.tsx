import { Select as SelectPrimitive } from "@base-ui/react/select";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { layer, menu } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { appearance, motion, role, shadow, type } from "./vars.stylex.ts";
import { buttonStyle, type ButtonLayout } from "./button.tsx";
import { ControlGlyphs, Icon } from "./icon.tsx";

const COLLISION: NonNullable<SelectPrimitive.Positioner.Props["collisionAvoidance"]> = {
  side: "flip",
  align: "shift",
  fallbackAxisSide: "none",
};

const OVER_TRIGGER: NonNullable<SelectPrimitive.Positioner.Props["sideOffset"]> = ({
  side,
  anchor,
}) => -(side === "top" || side === "bottom" ? anchor.height : anchor.width);

const styles = create({
  /** The trigger is an `outline` `md` button; only its width is its own. */
  trigger: { maxWidth: 180 },
  value: {
    display: "block",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    fontFamily: "inherit",
    textOverflow: "ellipsis",
    textAlign: "start",
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
    borderRadius: menu.radius,
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
    outlineStyle: { default: "none", "[data-highlighted]": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": role.bgHover,
    },
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
  wide: { maxWidth: "100%" },
});

export const Select = SelectPrimitive.Root;

/** An `outline` `md` button that ends in a chevron, the same control a Menu opens from. */
export function SelectTrigger({
  width = "standard",
  children,
  xstyle,
  className,
  style,
  ...rest
}: Omit<StyledProps<SelectPrimitive.Trigger.Props>, "xstyle"> & {
  /** `wide` lets the trigger fill its container instead of stopping at 180px. */
  readonly width?: keyof typeof triggerWidths;
  readonly xstyle?: ButtonLayout;
}): ReactElement {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      {...buttonStyle("outline", "md", {
        xstyle: [styles.trigger, triggerWidths[width], xstyle],
        className,
        style,
      })}
      {...rest}
    >
      <ControlGlyphs>
        {children}
        <SelectPrimitive.Icon {...props(styles.icon)}>
          <Icon name="chevron-down" size={12} />
        </SelectPrimitive.Icon>
      </ControlGlyphs>
    </SelectPrimitive.Trigger>
  );
}

export function SelectValue({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<SelectPrimitive.Value.Props>): ReactElement {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      {...mergeStyleProps(props(styles.value, xstyle), className, style)}
      {...rest}
    />
  );
}

export function SelectContent({
  side = "bottom",
  align = "end",
  sideOffset = OVER_TRIGGER,
  alignOffset,
  alignItemWithTrigger = false,
  collisionAvoidance = COLLISION,
  tint,
  children,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<SelectPrimitive.Popup.Props> &
  Pick<
    SelectPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "alignItemWithTrigger" | "collisionAvoidance"
  > & {
    /** Scopes the popup to a hue. */
    readonly tint?: Tint;
  }): ReactElement {
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

export function SelectItem({
  children,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<SelectPrimitive.Item.Props>): ReactElement {
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
