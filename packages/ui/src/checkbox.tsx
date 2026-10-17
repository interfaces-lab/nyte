import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { create, props } from "@stylexjs/stylex";
import { useId, type ComponentProps, type ReactElement } from "react";

import { focus } from "./styles/a11y.stylex.ts";
import { checkbox, media, radius, row, space, target } from "./styles/schema.stylex.ts";
import { selectionWithin } from "./selection.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { intent } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { appearance, role, type } from "./styles/vars.stylex.ts";
import { Icon } from "./icon.tsx";

const styles = create({
  target: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: `max(${target.min}, var(--_checkbox-size))`,
    height: `max(${target.min}, var(--_checkbox-size))`,
  },
  field: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    width: "100%",
    minHeight: row.heightMd,
    color: role.contentPrimary,
    cursor: appearance.cursorInteractive,
  },
  copy: { display: "flex", flexDirection: "column", gap: space.s0_5, minWidth: 0 },
  description: { color: role.contentSecondary, fontSize: type.fontSm },
  box: {
    position: "relative",
    width: "var(--_checkbox-size)",
    height: "var(--_checkbox-size)",
    "::before": {
      content: '""',
      position: "absolute",
      top: "50%",
      left: "50%",
      translate: "-50% -50%",
      width: `max(${target.min}, var(--_checkbox-size))`,
      height: `max(${target.min}, var(--_checkbox-size))`,
    },
    appearance: "none",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderRadius: checkbox.radius,
    // Ticked and mixed fill with the selected control; an empty box answers the pointer.
    borderColor: {
      default: role.bgControlSelected,
      "[data-unchecked]": role.borderControlTranslucent,
    },
    backgroundColor: {
      default: role.bgControlSelected,
      "[data-unchecked]": "transparent",
      ":hover:not([data-disabled])": {
        [media.hover]: role.bgControlSelectedHover,
      },
      ":hover:is([data-unchecked]):not([data-disabled])": {
        [media.hover]: role.bgHover,
      },
      ":active:not([data-disabled])": role.bgControlSelectedPressed,
      ":active:is([data-unchecked]):not([data-disabled])": role.bgPressed,
    },
    color: role.contentOnControl,
    opacity: { default: 1, "[data-disabled]": 0.5 },
    cursor: { default: appearance.cursorInteractive, "[data-disabled]": "default" },
  },
  md: { "--_checkbox-size": checkbox.sizeMd },
  lg: { "--_checkbox-size": checkbox.sizeLg },
  indicator: { display: "contents" },
  dash: {
    width: 8,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: "currentColor",
  },
  attention: {
    borderColor: role.contentInteractiveTertiary,
    color: role.contentInteractiveTertiary,
    "::after": {
      content: "''",
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: "currentColor",
    },
  },
});

/**
 * A box that is ticked, empty, or mixed. `indeterminate` draws the dash, for a
 * master box over a list that is partly ticked. It paints inside the primary
 * intent, whose selected control is blue. `attention` dots an empty box in the
 * warning hue, for an item that wants another look.
 */
export function Checkbox({
  size = "md",
  attention = false,
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Omit<CheckboxPrimitive.Root.Props, "children">, Restyle<"Checkbox">> & {
  readonly size?: "md" | "lg";
  readonly attention?: boolean;
}): ReactElement {
  return (
    <span {...props(styles.target, styles[size])}>
      <CheckboxPrimitive.Root
        {...rest}
        {...mergeStyleProps(
          props(
            intent.primary,
            styles.box,
            attention && [intent.warning, styles.attention],
            focus.ring,
            xstyle,
          ),
          className,
          style,
        )}
      >
        <CheckboxPrimitive.Indicator
          {...props(styles.indicator)}
          render={(indicatorProps, state) => (
            <span {...indicatorProps}>
              {state.indeterminate ? (
                <span {...props(styles.dash)} />
              ) : (
                <Icon name="checkmark" size={10} />
              )}
            </span>
          )}
        />
      </CheckboxPrimitive.Root>
    </span>
  );
}

export function CheckboxField({
  label,
  description,
  id,
  xstyle,
  className,
  style,
  ...rest
}: Omit<
  ComponentProps<typeof Checkbox>,
  "aria-label" | "aria-labelledby" | "nativeButton" | "className" | "style" | "xstyle"
> &
  Pick<
    StyledProps<Field.Root.Props, Restyle<"CheckboxField">>,
    "className" | "style" | "xstyle"
  > & {
    readonly label: string;
    readonly description?: string;
  }): ReactElement {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;

  return (
    <Field.Root
      {...mergeStyleProps(props(text.base, styles.field, xstyle), className, style)}
      render={
        <label
          htmlFor={controlId}
          onClickCapture={(event) => {
            const { target, currentTarget } = event;

            if (
              target instanceof Element &&
              (target === currentTarget.control || target.closest('[role="checkbox"]'))
            )
              return;

            if (event.shiftKey || selectionWithin(currentTarget)) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        />
      }
    >
      <Checkbox {...rest} id={controlId} aria-labelledby={labelId} />
      <span {...props(styles.copy)}>
        <span id={labelId}>{label}</span>
        {description !== undefined && (
          <Field.Description render={<span />} {...props(styles.description)}>
            {description}
          </Field.Description>
        )}
      </span>
    </Field.Root>
  );
}
