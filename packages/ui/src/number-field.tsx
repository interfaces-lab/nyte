import { radius, target } from "./schema.stylex.ts";
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "./style.ts";
import { appearance, role, shadow, type } from "./vars.stylex.ts";

const styles = create({
  group: {
    display: "grid",
    gridTemplateColumns: `${target.min} 48px ${target.min}`,
    boxSizing: "border-box",
    width: "max-content",
    minHeight: `calc(${target.min} + 2px)`,
    overflow: "clip",
    borderRadius: radius.control,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderPrimary,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowSm,
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: 0,
  },
  split: {
    boxShadow: `inset -1px 0 0 0 ${role.borderSecondaryTranslucent}`,
  },
  button: {
    display: "grid",
    placeItems: "center",
    padding: 0,
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: "transparent",
    backgroundImage: {
      default: "none",
      ":hover:not([data-disabled])": {
        "@media (hover: hover) and (pointer: fine)": role.layerHover,
      },
      ":active:not([data-disabled])": role.layerPressed,
    },
    color: {
      default: role.contentSecondary,
      ":hover:not([data-disabled])": {
        "@media (hover: hover) and (pointer: fine)": role.contentPrimary,
      },
      "[data-disabled]": role.contentDisabled,
    },
    fontSize: type.fontLg,
    lineHeight: type.leadingBase,
    cursor: { default: appearance.cursorInteractive, "[data-disabled]": "default" },
  },
  value: {
    width: "100%",
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: 0,
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: role.contentSecondary,
    fontFamily: "inherit",
    fontSize: {
      default: type.fontSm,
      "@media (pointer: coarse)": `max(16px, ${type.fontSm})`,
    },
    lineHeight: type.leadingSm,
    textAlign: "center",
    // The global ::selection is an accent wash and would tint the value.
    "::selection": {
      backgroundColor: role.bgInteractiveSecondaryTranslucent,
      color: role.contentSecondary,
    },
  },
});

export const NumberField = NumberFieldPrimitive.Root;

/** A compact stepper: the decrement button, the value, and the increment button. */
export function NumberFieldGroup({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<NumberFieldPrimitive.Group.Props>): ReactElement {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      {...mergeStyleProps(props(styles.group, xstyle), className, style)}
      {...rest}
    />
  );
}

export function NumberFieldDecrement({
  children = "−",
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<NumberFieldPrimitive.Decrement.Props>): ReactElement {
  return (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      {...mergeStyleProps(props(styles.button, styles.split, xstyle), className, style)}
      {...rest}
    >
      {children}
    </NumberFieldPrimitive.Decrement>
  );
}

export function NumberFieldInput({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<NumberFieldPrimitive.Input.Props>): ReactElement {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      {...mergeStyleProps(props(styles.value, styles.split, xstyle), className, style)}
      {...rest}
    />
  );
}

export function NumberFieldIncrement({
  children = "+",
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<NumberFieldPrimitive.Increment.Props>): ReactElement {
  return (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      {...mergeStyleProps(props(styles.button, xstyle), className, style)}
      {...rest}
    >
      {children}
    </NumberFieldPrimitive.Increment>
  );
}
