import { radius, space } from "./styles/schema.stylex.ts";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { role } from "./styles/vars.stylex.ts";

const styles = create({
  group: {
    display: "inline-flex",
    flexDirection: { default: "row", '[data-orientation="vertical"]': "column" },
    alignItems: "center",
    gap: space.px,
    padding: space.s0_5,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
});

/** A track of `Toggle`s that share one pressed state. */
export function ToggleGroup<Value extends string>({
  xstyle,
  className,
  style,
  ...rest
}: StyledProps<ToggleGroupPrimitive.Props<Value>, Restyle<"ToggleGroup">>): ReactElement {
  return (
    <ToggleGroupPrimitive
      {...rest}
      {...mergeStyleProps(props(styles.group, xstyle), className, style)}
    />
  );
}
