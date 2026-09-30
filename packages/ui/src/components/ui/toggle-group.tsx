import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "../../style.ts";
import { t } from "../../vars.stylex.ts";

const styles = create({
  group: {
    display: "inline-flex",
    flexDirection: { default: "row", '[data-orientation="vertical"]': "column" },
    alignItems: "center",
    gap: 1,
    padding: 2,
    borderRadius: t.radius8,
    backgroundColor: t.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${t.borderSecondaryTranslucent}`,
  },
});

export type ToggleGroupProps<Value extends string = string> = StyledProps<
  ToggleGroupPrimitive.Props<Value>
>;

/** A track of `Toggle`s that share one pressed state. */
export function ToggleGroup<Value extends string>({
  xstyle,
  className,
  style,
  ...rest
}: ToggleGroupProps<Value>): ReactElement {
  return (
    <ToggleGroupPrimitive
      {...rest}
      {...mergeStyleProps(props(styles.group, xstyle), className, style)}
    />
  );
}
