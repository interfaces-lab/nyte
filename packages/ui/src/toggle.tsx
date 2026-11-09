import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { use } from "react";
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
import { hairline } from "./styles/hairline.stylex.ts";
import { ToggleGroupContext } from "./toggle-group.tsx";

export function Toggle<Value extends string>({
  indicator = "fill",
  size = "md",
  iconOnly = false,
  pill = false,
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
    readonly indicator?: "fill" | "glyph";
  }): ReactElement {
  const grouped = use(ToggleGroupContext);

  return (
    <TogglePrimitive
      title={tooltipTitle(iconOnly, rest["aria-label"])}
      {...rest}
      {...buttonStyle(
        "ghost",
        size,
        {
          iconOnly,
          pill,
          tone,
          grouped,
          xstyle: [hairline.pressedRing, xstyle],
          className,
          style,
        },
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
