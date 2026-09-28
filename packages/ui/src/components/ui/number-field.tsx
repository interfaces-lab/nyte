import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";

const styles = create({
  root: {
    display: "grid",
    gridTemplateColumns: "26px 42px 26px",
    boxSizing: "border-box",
    width: "max-content",
    height: 24,
    overflow: "hidden",
    borderRadius: t.radiusBase,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokePrimary,
    backgroundColor: t.fillQuiet,
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: 1,
    outlineColor: t.focusRing,
    outlineOffset: 0,
  },
  split: {
    boxShadow: `inset -1px 0 0 0 ${t.strokeSecondary}`,
  },
  button: {
    display: "grid",
    placeItems: "center",
    padding: 0,
    borderStyle: "none",
    outlineStyle: "none",
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": t.fillHover },
    color: { default: t.textTertiary, ":disabled": t.textQuaternary },
    fontSize: t.fontLg,
    lineHeight: t.leadingBase,
    cursor: { default: t.cursorInteractive, ":disabled": "default" },
  },
  value: {
    width: "100%",
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    borderRadius: 0,
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: t.textSecondary,
    fontFamily: "inherit",
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textAlign: "center",
    // The global ::selection is an accent wash and would tint the value.
    "::selection": {
      backgroundColor: t.fillSelected,
      color: t.textSecondary,
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
