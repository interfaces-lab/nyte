import { radius, space } from "./styles/schema.stylex.ts";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { create, props } from "@stylexjs/stylex";
import { createContext } from "react";
import type { ReactElement } from "react";

import { mergeStyleProps, type StyledProps } from "./style.ts";
import { hairline } from "./styles/hairline.stylex.ts";
import type { Restyle } from "./styles/contracts.ts";
import { role } from "./styles/vars.stylex.ts";

const styles = create({
  group: {
    display: "inline-flex",
    flexDirection: { default: "row", '[data-orientation="vertical"]': "column" },
    alignItems: "center",
    gap: space.px,
    padding: space.s0_5,
    // A grouped Toggle's radius is this radius minus this padding, so their corners stay concentric.
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
  },
});

export const ToggleGroupContext = createContext(false);

export function ToggleGroup<Value extends string>({
  xstyle,
  className,
  style,
  children,
  ...rest
}: StyledProps<ToggleGroupPrimitive.Props<Value>, Restyle<"ToggleGroup">>): ReactElement {
  return (
    <ToggleGroupPrimitive
      {...rest}
      {...mergeStyleProps(props(styles.group, hairline.ring, xstyle), className, style)}
    >
      <ToggleGroupContext value={true}>{children}</ToggleGroupContext>
    </ToggleGroupPrimitive>
  );
}
