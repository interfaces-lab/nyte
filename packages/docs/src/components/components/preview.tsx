import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactNode } from "react";

/*
 * A framed canvas for live Cloud examples. Document color-scheme (set from
 * the theme class) drives the `light-dark()` Cloud tokens; the preview does
 * not restyle them.
 */
export function Preview({
  children,
  align = "center",
}: {
  children: ReactNode;
  align?: "center" | "start" | "stretch";
}) {
  return (
    <div {...props(styles.canvas)} className="cloud-preview" data-align={align}>
      {children}
    </div>
  );
}

const styles = create({
  canvas: {
    backgroundImage: `radial-gradient(circle at 1px 1px, ${role.borderSecondaryTranslucent} 1px, transparent 0)`,
    backgroundSize: "20px 20px",
    backgroundColor: role.bgBase,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
});
