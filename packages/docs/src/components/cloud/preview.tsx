import type { ReactNode } from "react";

/*
 * A framed canvas for live Cloud examples. `.cloud` sets color-scheme, so the
 * `light-dark()` tokens follow the site theme without overrides.
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
