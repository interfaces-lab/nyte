import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { checkbox } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { intent } from "../../surface-theme.ts";
import { t } from "../../vars.stylex.ts";
import { Icon } from "./icon.tsx";

const styles = create({
  box: {
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
      default: t.bgControlSelected,
      "[data-unchecked]": t.borderControlTranslucent,
    },
    backgroundColor: {
      default: t.bgControlSelected,
      "[data-unchecked]": "transparent",
      ":hover:not([data-disabled])": t.bgControlSelectedHover,
      ":hover:is([data-unchecked]):not([data-disabled])": t.bgHover,
      ":active:not([data-disabled])": t.bgControlSelectedPressed,
      ":active:is([data-unchecked]):not([data-disabled])": t.bgPressed,
    },
    color: t.contentOnControl,
    opacity: { default: 1, "[data-disabled]": 0.5 },
    cursor: { default: t.cursorInteractive, "[data-disabled]": "default" },
  },
  md: { width: checkbox.sizeMd, height: checkbox.sizeMd },
  lg: { width: checkbox.sizeLg, height: checkbox.sizeLg },
  indicator: { display: "contents" },
  dash: {
    width: 8,
    height: 2,
    borderRadius: t.radiusFull,
    backgroundColor: "currentColor",
  },
});

/** Notion Calendar's checkbox sizes: `md` is 16px beside 16px glyphs, `lg` 20px. */
export type CheckboxSize = "md" | "lg";

export type CheckboxProps = StyledProps<
  Omit<CheckboxPrimitive.Root.Props, "children" | "render">
> & {
  readonly size?: CheckboxSize;
};

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
}: CheckboxProps): ReactElement {
  return (
    <CheckboxPrimitive.Root
      {...rest}
      {...mergeStyleProps(
        props(intent.primary, styles.box, styles[size], focus.ring, xstyle),
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
  );
}
