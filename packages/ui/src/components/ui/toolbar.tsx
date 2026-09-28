import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";
import { Button } from "./button.tsx";

const styles = create({
  row: {
    display: "flex",
    flexDirection: { default: "row", '[data-orientation="vertical"]': "column" },
    alignItems: "center",
    gap: 2,
  },
  separator: {
    flexShrink: 0,
    width: { default: 1, '[data-orientation="horizontal"]': 16 },
    height: { default: 16, '[data-orientation="horizontal"]': 1 },
    marginInline: { default: 4, '[data-orientation="horizontal"]': 0 },
    marginBlock: { default: 0, '[data-orientation="horizontal"]': 4 },
    backgroundColor: t.strokeSecondary,
  },
});

export type ToolbarRootProps = StyledProps<ToolbarPrimitive.Root.Props>;

export type ToolbarGroupProps = StyledProps<ToolbarPrimitive.Group.Props>;

export type ToolbarSeparatorProps = StyledProps<ToolbarPrimitive.Separator.Props>;

export type ToolbarButtonProps = ToolbarPrimitive.Button.Props;

function ToolbarRoot({ xstyle, className, style, ...rest }: ToolbarRootProps): ReactElement {
  return (
    <ToolbarPrimitive.Root
      {...rest}
      {...mergeStyleProps(props(styles.row, xstyle), className, style)}
    />
  );
}

function ToolbarGroup({ xstyle, className, style, ...rest }: ToolbarGroupProps): ReactElement {
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
}: ToolbarSeparatorProps): ReactElement {
  return (
    <ToolbarPrimitive.Separator
      {...rest}
      {...mergeStyleProps(props(styles.separator, xstyle), className, style)}
    />
  );
}

/** Renders a `Button` unless `render` passes a `Toggle` or a popup trigger. */
function ToolbarButton({ render = <Button />, ...rest }: ToolbarButtonProps): ReactElement {
  return <ToolbarPrimitive.Button render={render} {...rest} />;
}

export const Toolbar = {
  Root: ToolbarRoot,
  Group: ToolbarGroup,
  Separator: ToolbarSeparator,
  Button: ToolbarButton,
};
