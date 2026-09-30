import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { switchControl } from "../../schema.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { intent } from "../../surface-theme.ts";
import { t } from "../../vars.stylex.ts";

const styles = create({
  track: {
    appearance: "none",
    boxSizing: "border-box",
    position: "relative",
    flexShrink: 0,
    boxShadow: "none",
    display: "inline-flex",
    alignItems: "center",
    width: switchControl.widthMd,
    height: switchControl.heightMd,
    padding: switchControl.paddingMd,
    borderStyle: "none",
    borderRadius: t.radiusFull,
    backgroundColor: {
      default: t.bgControl,
      ":hover:not([data-disabled])": t.bgControlHover,
      ":active:not([data-disabled])": t.bgControlPressed,
      "[data-checked]": t.bgControlSelected,
      ":hover:is([data-checked]):not([data-disabled])": t.bgControlSelectedHover,
      ":active:is([data-checked]):not([data-disabled])": t.bgControlSelectedPressed,
    },
    opacity: { default: 1, "[data-disabled]": 0.5 },
    transitionProperty: "background-color",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
    cursor: { default: t.cursorInteractive, "[data-disabled]": "default" },
  },
  thumb: {
    display: "block",
    width: switchControl.knobMd,
    height: switchControl.knobMd,
    borderRadius: t.radiusFull,
    backgroundColor: t.contentOnControl,
    boxShadow: t.shadowSm,
    transform: {
      default: "translateX(0)",
      "[data-checked]": `translateX(calc(${switchControl.widthMd} - ${switchControl.knobMd} - ${switchControl.paddingMd} * 2))`,
    },
    transitionProperty: "transform",
    transitionDuration: {
      default: t.durationSlow,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeInOutStrong,
  },
});

export type SwitchProps = StyledProps<Omit<SwitchPrimitive.Root.Props, "children" | "render">> & {
  /** Names the switch for assistive technology. */
  readonly label: string;
};

/** An on/off control that applies the moment it changes, inside the primary intent. */
export function Switch({ label, xstyle, className, style, ...rest }: SwitchProps): ReactElement {
  return (
    <SwitchPrimitive.Root
      aria-label={label}
      {...rest}
      {...mergeStyleProps(
        props(intent.primary, styles.track, focus.ring, xstyle),
        className,
        style,
      )}
    >
      <SwitchPrimitive.Thumb {...props(styles.thumb)} />
    </SwitchPrimitive.Root>
  );
}
