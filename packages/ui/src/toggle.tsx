import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import type { ReactElement } from "react";

import {
  buttonGlyphSize,
  buttonStyle,
  tooltipTitle,
  type ButtonAppearance,
  type ButtonSizing,
} from "./button.tsx";
import { ControlGlyphs, Icon } from "./icon.tsx";
import type { StyledProps } from "./style.ts";

export function Toggle<Value extends string>({
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
  ...rest
}: Omit<StyledProps<TogglePrimitive.Props<Value>>, "xstyle" | "children" | "aria-label"> &
  ButtonSizing &
  ButtonAppearance & {
    /** `glyph` drops the pressed fill, for a glyph that already draws its state. */
    readonly indicator?: "fill" | "glyph";
  }): ReactElement {
  return (
    <TogglePrimitive
      title={tooltipTitle(iconOnly, rest["aria-label"])}
      {...rest}
      {...buttonStyle(
        "ghost",
        size,
        { iconOnly, round, tone, xstyle, className, style },
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
