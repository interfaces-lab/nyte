import { button, shape } from "../../schema.stylex.ts";
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { appearance, role, type } from "../../vars.stylex.ts";

const styles = create({
  root: {
    display: "grid",
    "--_number-hit-floor": { default: "24px", "@media (pointer: coarse)": "44px" },
    gridTemplateColumns: `max(var(--_number-hit-floor), ${button.heightSm}) 48px max(var(--_number-hit-floor), ${button.heightSm})`,
    boxSizing: "border-box",
    width: "max-content",
    minHeight: `calc(max(var(--_number-hit-floor), ${button.heightSm}) + 2px)`,
    overflow: "hidden",
    borderRadius: shape.control,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderPrimaryTranslucent,
    backgroundColor: role.bgMutedTranslucent,
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
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": role.bgHover },
    color: { default: role.contentInteractiveSecondary, ":disabled": role.contentDisabled },
    fontSize: type.fontLg,
    lineHeight: type.leadingBase,
    cursor: { default: appearance.cursorInteractive, ":disabled": "default" },
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
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textAlign: "center",
    // The global ::selection is an accent wash and would tint the value.
    "::selection": {
      backgroundColor: role.bgInteractiveSecondaryTranslucent,
      color: role.contentSecondary,
    },
  },
});

export type NumberFieldProps = StyledProps<
  Omit<NumberFieldPrimitive.Root.Props, "children" | "render" | "onValueChange">
> & {
  /** Names the input, and the two buttons as "Decrease …" and "Increase …". */
  readonly label: string;
  /** Called with each committed number. Clearing the input does not call it. */
  readonly onValueChange?: (value: number) => void;
};

/** A compact stepper: a decrement button, the value, and an increment button. */
export function NumberField({
  label,
  onValueChange,
  xstyle,
  className,
  style,
  ...rest
}: NumberFieldProps): ReactElement {
  const name = label.toLocaleLowerCase();

  return (
    <NumberFieldPrimitive.Root
      {...rest}
      onValueChange={(candidate) => {
        if (candidate !== null) onValueChange?.(candidate);
      }}
      {...mergeStyleProps(props(styles.root, xstyle), className, style)}
    >
      <NumberFieldPrimitive.Decrement
        type="button"
        aria-label={`Decrease ${name}`}
        {...props(styles.button, styles.split)}
      >
        −
      </NumberFieldPrimitive.Decrement>
      <NumberFieldPrimitive.Input aria-label={label} {...props(styles.value, styles.split)} />
      <NumberFieldPrimitive.Increment
        type="button"
        aria-label={`Increase ${name}`}
        {...props(styles.button)}
      >
        +
      </NumberFieldPrimitive.Increment>
    </NumberFieldPrimitive.Root>
  );
}
