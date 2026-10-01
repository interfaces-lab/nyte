import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import type { ReactElement } from "react";

import {
  buttonGlyphSize,
  buttonStyle,
  tooltipTitle,
  type ButtonAppearance,
  type ButtonElementProps,
  type ButtonSizing,
} from "./button.tsx";
import { ControlGlyphs, Icon } from "./icon.tsx";

export type ToggleProps = Omit<
  ButtonElementProps,
  "aria-pressed" | "onClick" | "value" | "defaultValue"
> &
  ButtonSizing &
  ButtonAppearance &
  Pick<TogglePrimitive.Props, "pressed" | "defaultPressed" | "onPressedChange" | "value"> & {
    /** `glyph` drops the pressed fill, for a glyph that already draws its state. */
    readonly indicator?: "fill" | "glyph";
  };

export function Toggle({
  pressed,
  defaultPressed,
  onPressedChange,
  value,
  indicator = "fill",
  size = "md",
  iconOnly = false,
  round,
  icon,
  tone,
  xstyle,
  className,
  style,
  children,
  type = "button",
  disabled,
  ...rest
}: ToggleProps): ReactElement {
  return (
    <TogglePrimitive
      pressed={pressed}
      defaultPressed={defaultPressed}
      value={value}
      disabled={disabled}
      onPressedChange={onPressedChange}
      render={<button type={type} title={tooltipTitle(iconOnly, rest["aria-label"])} {...rest} />}
      {...buttonStyle(
        "ghost",
        size,
        { iconOnly, round, disabled, tone, xstyle, className, style },
        indicator === "glyph",
      )}
    >
      <ControlGlyphs>
        {icon !== undefined && <Icon name={icon} size={buttonGlyphSize(size, iconOnly)} />}
        {children}
      </ControlGlyphs>
    </TogglePrimitive>
  );
}
