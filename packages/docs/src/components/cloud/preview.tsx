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
    <div className="cloud-preview" data-align={align}>
      {children}
    </div>
  );
}
