import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { role } from "./styles/vars.stylex.ts";
import { Button, type ButtonProps } from "./button.tsx";
import { ControlGlyphs } from "./icon.tsx";
import { glyph, space, target } from "./styles/schema.stylex.ts";

const styles = create({
  row: {
    display: "flex",
    flexDirection: { default: "row", '[data-orientation="vertical"]': "column" },
    alignItems: "center",
    gap: target.gap,
  },
  separator: {
    flexShrink: 0,
    width: { default: 1, '[data-orientation="horizontal"]': glyph.md },
    height: { default: glyph.md, '[data-orientation="horizontal"]': 1 },
    marginInline: { default: space.s1, '[data-orientation="horizontal"]': 0 },
    marginBlock: { default: 0, '[data-orientation="horizontal"]': space.s1 },
    backgroundColor: role.borderSecondaryTranslucent,
  },
});

function ToolbarRoot({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ToolbarPrimitive.Root.Props, Restyle<"Toolbar.Root">>): ReactElement {
  return (
    <ToolbarPrimitive.Root
      {...rest}
      {...mergeStyleProps(props(styles.row, xstyle), className, style)}
    />
  );
}

function ToolbarGroup({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ToolbarPrimitive.Group.Props, Restyle<"Toolbar.Group">>): ReactElement {
  return (
    <ToolbarPrimitive.Group
      {...rest}
      {...mergeStyleProps(props(styles.row, xstyle), className, style)}
    />
  );
}

function ToolbarSeparator({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ToolbarPrimitive.Separator.Props, Restyle<"Toolbar.Separator">>): ReactElement {
  return (
    <ToolbarPrimitive.Separator
      {...rest}
      {...mergeStyleProps(props(styles.separator, xstyle), className, style)}
    />
  );
}

/** Renders a `Button` unless `render` passes a `Toggle` or a popup trigger. */
function ToolbarButton(
  buttonProps:
    | (ButtonProps & { readonly render?: never })
    | (ToolbarPrimitive.Button.Props & {
        readonly render: NonNullable<ToolbarPrimitive.Button.Props["render"]>;
      }),
): ReactElement {
  if (buttonProps.render !== undefined) {
    return (
      <ControlGlyphs>
        <ToolbarPrimitive.Button {...buttonProps} />
      </ControlGlyphs>
    );
  }

  return (
    <ToolbarPrimitive.Button
      disabled={buttonProps.disabled}
      render={<Button focusableWhenDisabled {...buttonProps} />}
    />
  );
}

export const Toolbar = {
  Root: ToolbarRoot,
  Group: ToolbarGroup,
  Separator: ToolbarSeparator,
  Button: ToolbarButton,
};
