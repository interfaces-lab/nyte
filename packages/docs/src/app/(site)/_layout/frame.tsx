import type { ReactNode } from "react";
import type { NavSection } from "~/lib/docs";
import { Sidebar } from "./sidebar";
import "./layout.css";

/* The docs frame under the site nav: sidebar, then the page. */
export function DocFrame({
  sections,
  children,
}: {
  sections: readonly NavSection[];
  children: ReactNode;
}) {
  return (
    <div className="doc flex min-w-0 flex-1 flex-col">
      <div className="doc-frame">
        <Sidebar sections={sections} />
        {children}
      </div>
    </div>
  );
}
