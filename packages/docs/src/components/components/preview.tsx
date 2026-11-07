import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactNode } from "react";

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
    backgroundImage: `radial-gradient(circle at 1px 1px, ${role.strokeQuaternary} 1px, transparent 0)`,
    backgroundSize: "20px 20px",
    backgroundColor: role.bgBase,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
});
