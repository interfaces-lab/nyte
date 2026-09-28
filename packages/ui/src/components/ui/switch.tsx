import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { focus } from "../../a11y.stylex.ts";
import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";

const styles = create({
  track: {
    appearance: "none",
    position: "relative",
    flexShrink: 0,
    boxShadow: "none",
    display: "inline-flex",
    alignItems: "center",
    width: 30,
    height: 18,
    padding: 2,
    borderStyle: "none",
    borderRadius: t.radiusFull,
    backgroundColor: { default: t.fillStrong, "[data-checked]": t.accent },
    opacity: { default: 1, "[data-disabled]": 0.5 },
    transitionProperty: "background-color",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
    cursor: { default: t.cursorInteractive, "[data-disabled]": "default" },
  },
  thumb: {
    display: "block",
    width: 14,
    height: 14,
    borderRadius: t.radiusFull,
    backgroundColor: t.switchThumb,
    transform: { default: "translateX(0)", "[data-checked]": "translateX(12px)" },
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

/** An on/off control that applies the moment it changes. */
export function Switch({ label, xstyle, className, style, ...rest }: SwitchProps): ReactElement {
  return (
    <SwitchPrimitive.Root
      aria-label={label}
      {...rest}
      {...mergeStyleProps(props(styles.track, focus.ring, xstyle), className, style)}
    >
      <SwitchPrimitive.Thumb {...props(styles.thumb)} />
    </SwitchPrimitive.Root>
  );
}
