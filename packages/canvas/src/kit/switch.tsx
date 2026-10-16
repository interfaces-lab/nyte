import { create, props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { Switch as SwitchControl } from "@nyte-ai/ui/switch";

const styles = create({
  row: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    whiteSpace: "nowrap",
  },
});

/** An inline switch that shows its label beside the control; clicking either toggles it. */
export function Switch({ label, ...rest }: ComponentProps<typeof SwitchControl>): ReactElement {
  return (
    <label {...props(styles.row)}>
      <SwitchControl label={label} {...rest} />
      {label}
    </label>
  );
}
