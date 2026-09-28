import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
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
    borderWidth: 1,
    borderStyle: "solid",
    // Ticked and mixed share the accent; only an empty box answers the pointer.
    borderColor: {
      default: t.accent,
      "[data-unchecked]": t.strokeSecondary,
      ":hover:is([data-unchecked])": t.strokePrimary,
    },
    backgroundColor: { default: t.accent, "[data-unchecked]": "transparent" },
    color: { default: t.textOnColor, "[data-unchecked]": t.iconSecondary },
    opacity: { default: 1, "[data-disabled]": 0.5 },
    cursor: { default: t.cursorInteractive, "[data-disabled]": "default" },
  },
  default: { width: 16, height: 16, borderRadius: t.radiusSm },
  sm: { width: 14, height: 14, borderRadius: t.radiusXs },
  indicator: { display: "contents" },
  dash: {
    width: 8,
    height: 2,
    borderRadius: t.radiusFull,
    backgroundColor: "currentColor",
  },
});

/** `default` is 16px, beside 16px glyphs; `sm` is 14px, on a line of text. */
export type CheckboxSize = "default" | "sm";

export type CheckboxProps = StyledProps<
  Omit<CheckboxPrimitive.Root.Props, "children" | "render">
> & {
  readonly size?: CheckboxSize;
};

/**
 * A box that is ticked, empty, or mixed. `indeterminate` draws the dash, for a
 * master box over a list that is partly ticked.
 */
export function Checkbox({
  size = "default",
  xstyle,
  className,
  style,
  ...rest
}: CheckboxProps): ReactElement {
  return (
    <CheckboxPrimitive.Root
      {...rest}
      {...mergeStyleProps(props(styles.box, styles[size], focus.ring, xstyle), className, style)}
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
