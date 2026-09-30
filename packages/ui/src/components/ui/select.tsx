import { Select as SelectPrimitive } from "@base-ui/react/select";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { button, layer, menu } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";
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
    paddingBlock: 0,
    paddingInline: button.paddingInlineSm,
    overflow: "hidden",
    appearance: "none",
    borderRadius: button.radiusSm,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.borderPrimaryTranslucent,
    backgroundColor: t.bgInteractiveSecondaryTranslucent,
    backgroundImage: {
      default: "none",
      ":hover": t.layerHover,
      "[data-popup-open]": t.layerHover,
      "[data-disabled]": "none",
    },
    color: { default: t.contentPrimary, "[data-disabled]": t.contentDisabled },
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    cursor: { default: t.cursorInteractive, "[data-disabled]": "default" },
    flexShrink: 0,
  },
  triggerWide: { minWidth: 0, maxWidth: "100%" },
  value: {
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
    borderRadius: t.radius8,
    outline: "none",
    backgroundColor: t.popupMaterial,
    backdropFilter: t.popupMaterialFilter,
    boxShadow: t.shadowLg,
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 1px ${t.borderSecondaryTranslucent}`,
      pointerEvents: "none",
    },
    color: t.contentPrimary,
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
      "[data-highlighted]": t.bgHover,
      "[data-selected]": t.bgInteractiveSecondaryTranslucent,
      "[data-selected][data-highlighted]": t.bgInteractiveSecondaryTranslucent,
    },
    // A selected row carries a hairline, so it reads apart from the hovered one.
    boxShadow: { default: "none", "[data-selected]": `inset 0 0 0 1px ${t.borderPrimary}` },
    color: { default: t.contentPrimary, "[data-disabled]": t.contentDisabled },
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
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
    color: t.contentSecondary,
  },
});

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Renders the option in its own typeface, such as a font picker's families. */
  readonly fontFamily?: string;
}

export type SelectWidth = "standard" | "wide";

export type SelectProps<T extends string> = StyledProps<{
  /** Names the trigger for assistive technology. */
  readonly label: string;
  readonly value: T;
  readonly options: readonly SelectOption<T>[];
  readonly disabled?: boolean;
  /** `wide` lets the trigger fill its container instead of stopping at 180px. */
  readonly width?: SelectWidth;
  readonly onValueChange: (value: T) => void;
}>;

/** A compact trigger that opens a list of options below it and writes back the chosen one. */
export function Select<T extends string>({
  label,
  value,
  options,
  disabled = false,
  width = "standard",
  onValueChange,
  xstyle,
  className,
  style,
}: SelectProps<T>): ReactElement {
  const overlayRef = useOverlayRef();
  const selected = options.find((option) => option.value === value);

  return (
    <SelectPrimitive.Root<T>
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(candidate) => {
        if (candidate === null) return;
        const option = options.find((entry) => entry.value === candidate);

        if (option !== undefined) onValueChange(option.value);
      }}
    >
      <SelectPrimitive.Trigger
        type="button"
        aria-label={label}
        {...mergeStyleProps(
          props(styles.trigger, width === "wide" && styles.triggerWide, focus.ring, xstyle),
          className,
          style,
        )}
      >
        <SelectPrimitive.Value {...props(styles.value)}>
          {selected?.label ?? value}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon {...props(styles.icon)}>
          <Icon name="chevron-down" size={11} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          positionMethod="fixed"
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          collisionAvoidance={COLLISION}
          alignItemWithTrigger={false}
          {...props(styles.positioner)}
        >
          <SelectPrimitive.Popup ref={overlayRef} {...props(styles.popup)}>
            <SelectPrimitive.List {...props(styles.list)}>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  {...props(styles.item)}
                >
                  <SelectPrimitive.ItemText
                    style={
                      option.fontFamily === undefined
                        ? undefined
                        : { fontFamily: option.fontFamily }
                    }
                    {...props(styles.itemText)}
                  >
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator {...props(styles.itemIndicator)}>
                    <Icon name="checkmark" size={11} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
