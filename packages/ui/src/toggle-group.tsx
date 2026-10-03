import { radius } from "./schema.stylex.ts";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "./style.ts";
import { role } from "./vars.stylex.ts";

const styles = create({
  group: {
    display: "inline-flex",
    flexDirection: { default: "row", '[data-orientation="vertical"]': "column" },
    alignItems: "center",
    gap: 1,
    padding: 2,
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
}: StyledProps<ToggleGroupPrimitive.Props<Value>>): ReactElement {
  return (
    <ToggleGroupPrimitive
      {...rest}
      {...mergeStyleProps(props(styles.group, xstyle), className, style)}
    />
  );
}
