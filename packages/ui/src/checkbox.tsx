import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { create, props } from "@stylexjs/stylex";
import { useId, type ComponentProps, type ReactElement } from "react";

import { focus } from "./a11y.stylex.ts";
import { checkbox, row, radius, target } from "./schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "./style.ts";
import { intent } from "./surface-theme.ts";
import { appearance, role, type } from "./vars.stylex.ts";
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
    gap: 8,
    width: "100%",
    minHeight: row.heightMd,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    cursor: appearance.cursorInteractive,
  },
  copy: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
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
        "@media (hover: hover) and (pointer: fine)": role.bgControlSelectedHover,
      },
      ":hover:is([data-unchecked]):not([data-disabled])": {
        "@media (hover: hover) and (pointer: fine)": role.bgHover,
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
});

/**
 * A box that is ticked, empty, or mixed. `indeterminate` draws the dash, for a
 * master box over a list that is partly ticked. It paints inside the primary
 * intent, whose selected control is blue.
 */
export function Checkbox({
  size = "md",
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<Omit<CheckboxPrimitive.Root.Props, "children">> & {
  readonly size?: "md" | "lg";
}): ReactElement {
  return (
    <span {...props(styles.target, styles[size])}>
      <CheckboxPrimitive.Root
        {...rest}
        {...mergeStyleProps(
          props(intent.primary, styles.box, focus.ring, xstyle),
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
  Pick<StyledProps<Field.Root.Props>, "className" | "style" | "xstyle"> & {
    readonly label: string;
    readonly description?: string;
  }): ReactElement {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;

  return (
    <Field.Root
      {...mergeStyleProps(props(styles.field, xstyle), className, style)}
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

            if (
              event.shiftKey ||
              currentTarget.ownerDocument.getSelection()?.isCollapsed === false
            ) {
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
